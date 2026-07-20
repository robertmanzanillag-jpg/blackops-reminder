import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BLACKROOM_WORKER_LOCK_PATH,
  BLACKROOM_WORKER_STATE_PATH,
  buildBlackRoomWorkerPrompt,
  createBlackRoomLocalWorkerState,
  shouldRunBlackRoomWorker,
  type BlackRoomLocalWorkerState,
} from "../server/blackroom-local-worker";
import { BLACKROOM_QUEUE_PATH } from "../server/blackroom-daily-queue";

const projectDir = path.resolve(process.env.BLACKROOM_PROJECT_DIR || process.cwd());
const queuePath = path.join(projectDir, process.env.BLACKROOM_QUEUE_PATH || BLACKROOM_QUEUE_PATH);
const statePath = path.join(projectDir, BLACKROOM_WORKER_STATE_PATH);
const lockPath = path.join(projectDir, BLACKROOM_WORKER_LOCK_PATH);
const logPath = path.join(projectDir, "clippers_workspace/blackroom/agent/worker.log");
const codexPath = process.env.BLACKROOM_CODEX_PATH || "/Applications/ChatGPT.app/Contents/Resources/codex";
const pollMs = Math.max(5_000, Number(process.env.BLACKROOM_WORKER_POLL_MS || 15_000));
const maxRunMs = Math.max(60_000, Number(process.env.BLACKROOM_WORKER_MAX_RUN_MS || 45 * 60_000));
let activeChild: ReturnType<typeof spawn> | null = null;
let stopping = false;

function waitForChildExit(child: ReturnType<typeof spawn>): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode ?? 1);
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function terminateChildGroup(child: ReturnType<typeof spawn>, graceMs = 5_000): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  const exitPromise = waitForChildExit(child);
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  const ended = await Promise.race([
    exitPromise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (ended) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { return; }
  await exitPromise;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error: any) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function appendLog(message: string): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const handle = await open(logPath, "a");
  try { await handle.write(`${new Date().toISOString()} ${message}\n`); }
  finally { await handle.close(); }
}

async function runCodex(state: BlackRoomLocalWorkerState): Promise<void> {
  const startedAt = new Date().toISOString();
  Object.assign(state, { running: true, pid: null, startedAt, finishedAt: null, lastError: null, runs: state.runs + 1 });
  await writeJson(statePath, state);
  await appendLog("starting one-post Codex cycle");

  const output = await open(logPath, "a");
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const child = spawn(codexPath, [
      "exec", "--ephemeral", "--color", "never", "-a", "never", "-s", "workspace-write", "-C", projectDir, "-",
    ], { cwd: projectDir, detached: true, stdio: ["pipe", output.fd, output.fd] });
    activeChild = child;
    state.pid = child.pid || null;
    await writeJson(statePath, state);
    child.stdin.end(buildBlackRoomWorkerPrompt(projectDir));
    const exitPromise = waitForChildExit(child);
    const outcome = await Promise.race([
      exitPromise.then((exitCode) => ({ timedOut: false as const, exitCode })),
      new Promise<{ timedOut: true; exitCode: 124 }>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true, exitCode: 124 }), maxRunMs);
      }),
    ]);
    if (outcome.timedOut) await terminateChildGroup(child);
    const exitCode = outcome.exitCode;
    clearTimeout(timeout);
    timeout = null;
    Object.assign(state, { running: false, pid: null, finishedAt: new Date().toISOString(), lastExitCode: exitCode });
    if (exitCode !== 0) state.lastError = `Codex terminó con código ${exitCode}`;
  } catch (error) {
    Object.assign(state, { running: false, pid: null, finishedAt: new Date().toISOString(), lastExitCode: 1, lastError: error instanceof Error ? error.message : String(error) });
  } finally {
    if (timeout) clearTimeout(timeout);
    activeChild = null;
    await output.close();
    await writeJson(statePath, state);
  }
}

async function main(): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let lock;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lock = await open(lockPath, "wx");
      await lock.write(String(process.pid));
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existingPid = Number((await readFile(lockPath, "utf8").catch(() => "0")).trim());
      let alive = false;
      if (Number.isInteger(existingPid) && existingPid > 0) {
        try { process.kill(existingPid, 0); alive = true; } catch { alive = false; }
      } else {
        const lockStat = await stat(lockPath).catch(() => null);
        alive = Boolean(lockStat && Date.now() - lockStat.mtimeMs < 30_000);
      }
      if (alive || attempt > 0) return;
      await unlink(lockPath).catch(() => undefined);
    }
  }
  if (!lock) return;
  const state = await readJson(statePath, createBlackRoomLocalWorkerState());
  state.workerPid = process.pid;
  await writeJson(statePath, state);
  const stop = async (interrupted = false) => {
    if (stopping) return;
    stopping = true;
    if (activeChild?.pid) {
      await terminateChildGroup(activeChild);
    }
    state.workerPid = null;
    if (interrupted) Object.assign(state, { running: false, pid: null, finishedAt: new Date().toISOString(), lastError: "Pausado por el usuario" });
    await writeJson(statePath, state).catch(() => undefined);
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  };
  process.once("SIGTERM", () => void stop(true).finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop(true).finally(() => process.exit(0)));
  try {
    while (true) {
      const queue = await readJson<{ enabled?: boolean; jobs?: Array<{ status?: string; notBefore?: string }> }>(queuePath, {});
      if (!shouldRunBlackRoomWorker(queue)) break;
      await runCodex(state);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally { await stop(false); }
}

main().catch(async (error) => {
  await appendLog(`fatal: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
  process.exitCode = 1;
});
