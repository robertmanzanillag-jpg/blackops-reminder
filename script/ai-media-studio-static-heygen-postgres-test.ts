import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";

const TEMP_PREFIX = "ams-static-heygen-pg-";
const DATABASE = "ams_static_heygen_test";
const PORT = "55437";
const temporaryDirectory = (): string => process.platform === "darwin" ? "/private/tmp" : tmpdir();

async function run(command: string, args: readonly string[], env = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve()
      : reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`)));
  });
}

async function waitUntilReady(socketDirectory: string, postgres: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (postgres.exitCode !== null) throw new Error(`isolated PostgreSQL exited with ${postgres.exitCode}`);
    try { await run("pg_isready", ["-q", "-h", socketDirectory, "-p", PORT, "-U", "postgres"]); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error("isolated PostgreSQL did not become ready");
}

async function ownedRoot(root: string): Promise<string> {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(temporaryDirectory())]);
  if (dirname(resolved) !== temporary || !basename(resolved).startsWith(TEMP_PREFIX)) {
    throw new Error("refusing to clean an unowned PostgreSQL directory");
  }
  return resolved;
}

async function stop(dataDirectory: string, postgres: ChildProcess | undefined): Promise<void> {
  if (!postgres || postgres.exitCode !== null) return;
  try { await run("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "-w", "stop"]); }
  catch { postgres.kill("SIGKILL"); }
  finally {
    await new Promise<void>((resolve) => postgres.exitCode !== null ? resolve() : postgres.once("exit", () => resolve()));
  }
}

async function main(): Promise<void> {
  if (process.env.DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim()) {
    throw new Error("static HeyGen harness refuses DATABASE_URL and external TEST_DATABASE_URL");
  }
  const root = await mkdtemp(join(temporaryDirectory(), TEMP_PREFIX));
  const dataDirectory = join(root, "data"); const socketDirectory = join(root, "socket");
  const logPath = join(root, "postgres.log"); let postgres: ChildProcess | undefined;
  let logDescriptor: number | undefined; let testStarted = false;
  try {
    await mkdir(socketDirectory, { mode: 0o700 });
    await run("initdb", ["-D", dataDirectory, "--username=postgres", "--no-locale", "--encoding=UTF8",
      "--auth-local=trust", "--auth-host=reject", "--no-instructions"]);
    logDescriptor = openSync(logPath, "a", 0o600);
    postgres = spawn("postgres", ["-D", dataDirectory, "-c", "listen_addresses=",
      "-c", `unix_socket_directories=${socketDirectory}`, "-c", "unix_socket_permissions=0700", "-p", PORT,
      "-c", "fsync=off", "-c", "full_page_writes=off", "-c", "synchronous_commit=off"],
    { stdio: ["ignore", logDescriptor, logDescriptor] });
    await waitUntilReady(socketDirectory, postgres);
    await run("createdb", ["-h", socketDirectory, "-p", PORT, "-U", "postgres", "-T", "template0",
      "--encoding=UTF8", "--locale=C", DATABASE]);
    const testUrl = `postgresql://postgres@localhost/${DATABASE}?host=${encodeURIComponent(socketDirectory)}&port=${PORT}`;
    const { DATABASE_URL: _database, TEST_DATABASE_URL: _external, ...safeEnvironment } = process.env;
    testStarted = true;
    await run("node", ["--import", "tsx", "--test", "--test-concurrency=1",
      "tests/ai-media-studio-static-heygen-postgres.test.ts"], { ...safeEnvironment, TEST_DATABASE_URL: testUrl });
  } catch (error) {
    const log = testStarted ? "" : await readFile(logPath, "utf8").catch(() => "");
    if (log) process.stderr.write(`Isolated PostgreSQL log:\n${log}`);
    throw error;
  } finally {
    await stop(dataDirectory, postgres);
    if (logDescriptor !== undefined) closeSync(logDescriptor);
    await rm(await ownedRoot(root), { recursive: true, force: true, maxRetries: 3 });
  }
}

await main();
