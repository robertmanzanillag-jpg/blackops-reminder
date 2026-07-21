import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const TEMP_PREFIX = "ams-pr21-pg-";
const TEST_DATABASE_NAME = "ams_pr21_test";
const TEST_PORT = "55432";

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function testTemporaryDirectory(): string {
  return process.platform === "darwin" ? "/private/tmp" : tmpdir();
}

async function runCommand(command: string, args: readonly string[], env = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`));
    });
  });
}

async function waitForPostgres(socketDirectory: string, postgres: ChildProcess): Promise<void> {
  const attempts = 100;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (postgres.exitCode !== null) {
      throw new Error(`The isolated PostgreSQL server exited early with code ${postgres.exitCode}`);
    }
    try {
      await runCommand("pg_isready", ["-q", "-h", socketDirectory, "-p", TEST_PORT, "-U", "postgres"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("The isolated PostgreSQL server did not become ready");
}

async function assertOwnedTemporaryRoot(root: string): Promise<string> {
  const [resolvedRoot, resolvedTemporaryDirectory] = await Promise.all([
    realpath(root),
    realpath(testTemporaryDirectory()),
  ]);
  if (dirname(resolvedRoot) !== resolvedTemporaryDirectory || !basename(resolvedRoot).startsWith(TEMP_PREFIX)) {
    throw new Error("Refusing to clean an unowned PostgreSQL directory");
  }
  return resolvedRoot;
}

async function stopPostgres(dataDirectory: string, postgres: ChildProcess | undefined): Promise<void> {
  if (!postgres || postgres.exitCode !== null) return;
  try {
    await runCommand("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "-w", "stop"]);
  } catch {
    postgres.kill("SIGKILL");
  } finally {
    await new Promise<void>((resolve) => {
      if (postgres.exitCode !== null) resolve();
      else postgres.once("exit", () => resolve());
    });
  }
}

async function main(): Promise<void> {
  if (configured(process.env.DATABASE_URL)) {
    throw new Error("Refusing to run while DATABASE_URL is configured; this harness accepts only its owned TEST_DATABASE_URL");
  }
  if (configured(process.env.TEST_DATABASE_URL)) {
    throw new Error("Refusing an external TEST_DATABASE_URL; this harness always creates its own mktemp PostgreSQL cluster");
  }

  const temporaryRoot = await mkdtemp(join(testTemporaryDirectory(), TEMP_PREFIX));
  const dataDirectory = join(temporaryRoot, "data");
  const socketDirectory = join(temporaryRoot, "socket");
  const logPath = join(temporaryRoot, "postgres.log");
  let postgres: ChildProcess | undefined;
  let logDescriptor: number | undefined;
  let testProcessStarted = false;

  try {
    await mkdir(socketDirectory, { mode: 0o700 });
    await runCommand("initdb", [
      "-D", dataDirectory,
      "--username=postgres",
      "--no-locale",
      "--encoding=UTF8",
      "--auth-local=trust",
      "--auth-host=reject",
      "--no-instructions",
    ]);

    logDescriptor = openSync(logPath, "a", 0o600);
    postgres = spawn("postgres", [
      "-D", dataDirectory,
      "-c", "listen_addresses=",
      "-c", `unix_socket_directories=${socketDirectory}`,
      "-c", "unix_socket_permissions=0700",
      "-p", TEST_PORT,
      "-c", "fsync=off",
      "-c", "full_page_writes=off",
      "-c", "synchronous_commit=off",
    ], { stdio: ["ignore", logDescriptor, logDescriptor] });
    postgres.once("error", (error) => {
      process.stderr.write(`Isolated PostgreSQL process failed: ${error.message}\n`);
    });

    await waitForPostgres(socketDirectory, postgres);
    await runCommand("createdb", [
      "-h", socketDirectory,
      "-p", TEST_PORT,
      "-U", "postgres",
      "-T", "template0",
      "--encoding=UTF8",
      "--locale=C",
      TEST_DATABASE_NAME,
    ]);

    const testDatabaseUrl = `postgresql://postgres@localhost/${TEST_DATABASE_NAME}?host=${encodeURIComponent(socketDirectory)}&port=${TEST_PORT}`;
    const { DATABASE_URL: _productionDatabaseUrl, TEST_DATABASE_URL: _externalTestDatabaseUrl, ...safeEnvironment } = process.env;
    const childEnvironment = { ...safeEnvironment, TEST_DATABASE_URL: testDatabaseUrl };
    testProcessStarted = true;
    await runCommand("node", [
      "--import", "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/ai-media-studio-pr21-postgres-integration.test.ts",
    ], childEnvironment);
  } catch (error) {
    const log = testProcessStarted ? "" : await readFile(logPath, "utf8").catch(() => "");
    if (log) process.stderr.write(`Isolated PostgreSQL log:\n${log}`);
    throw error;
  } finally {
    await stopPostgres(dataDirectory, postgres);
    if (logDescriptor !== undefined) closeSync(logDescriptor);
    const ownedRoot = await assertOwnedTemporaryRoot(temporaryRoot);
    await rm(ownedRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

await main();
