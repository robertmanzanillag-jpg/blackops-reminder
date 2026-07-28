import { spawnSync } from "node:child_process";
import { mkdir, open, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PAID_AI_ENV = /(?:^|_)(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE_GENERATIVE_AI|MISTRAL|COHERE|REPLICATE|FAL|TOGETHER|GROQ|PERPLEXITY)(?:_|$)/i;

function localOnlyEnv(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !PAID_AI_ENV.test(key)));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8", timeout: 30 * 60_000 });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    stdout: "",
    stderr: result.status === 0 ? "" : "Subprocess failed; output omitted to prevent credential leakage.",
  };
}

export async function runClipperFreeLocalWorker(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(projectRoot, "clippers_workspace"));
  const stateDir = path.join(workspaceRoot, "reports", "free-local-worker");
  const lockPath = path.join(stateDir, "worker.lock");
  const reportPath = path.join(stateDir, "latest.json");
  await mkdir(stateDir, { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      const lockAgeMs = Date.now() - (await stat(lockPath)).mtimeMs;
      if (lockAgeMs <= 2 * 60 * 60_000) return { status: "skipped", reason: "already_running", reportPath };
      await unlink(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
    if (!lock) throw error;
  }
  const startedAt = new Date().toISOString();
  const env = { ...localOnlyEnv(process.env), CLIPPERS_WORKSPACE_ROOT: workspaceRoot, CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "false", CLIPPERS_TARGET_DAILY_CLIPS: "15" };
  const execute = options.run || run;
  try {
    const planning = execute("npm", ["run", "clippers:streamer-growth-ceo"], { cwd: projectRoot, env });
    const executeCleanup = process.env.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE === "true";
    const cleanup = planning.status === 0
      ? execute("node", ["script/clippers-cleanup-published-vyro-media.mjs", ...(executeCleanup ? ["--execute"] : [])], { cwd: projectRoot, env })
      : { command: "cleanup skipped", status: null, signal: null, stdout: "", stderr: "CEO planning failed" };
    const report = { status: planning.status === 0 && cleanup.status === 0 ? "completed" : "blocked", startedAt, finishedAt: new Date().toISOString(), paidAiUsed: false, paidAiCredentialsPassed: false, paidSpendAllowed: false, publishingSurface: "metricool", metricoolDeliveryEnabled: false, cleanupExecuteEnabled: executeCleanup, planning, cleanup, note: "Deterministic local worker. Metricool upload remains blocked until final media has a Metricool-downloadable URL." };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { ...report, reportPath };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runClipperFreeLocalWorker();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
}
