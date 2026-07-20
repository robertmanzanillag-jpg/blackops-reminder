import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkerLoop } from "../server/ai-media-studio/workers/worker-loop";

export interface WorkerCliOptions {
  mode: "run-once" | "loop";
  dryRun: boolean;
  configPath?: string;
}

export function parseWorkerCliArgs(argv: readonly string[]): WorkerCliOptions {
  const mode = argv.includes("--loop") ? "loop" : "run-once";
  const live = argv.includes("--live");
  const configIndex = argv.indexOf("--config");
  const configPath = configIndex >= 0 ? argv[configIndex + 1] : undefined;
  if (configIndex >= 0 && !configPath) throw new Error("--config requires a path");
  if (live && !configPath) throw new Error("Live workers require explicit --config <path>");
  return { mode, dryRun: !live, configPath };
}

type WorkerCompositionModule = {
  createWorkerLoop: () => WorkerLoop | Promise<WorkerLoop>;
};

type ImportModule = (specifier: string) => Promise<unknown>;

function isWorkerCompositionModule(value: unknown): value is WorkerCompositionModule {
  return typeof value === "object"
    && value !== null
    && typeof (value as { createWorkerLoop?: unknown }).createWorkerLoop === "function";
}

/**
 * Loads an explicitly selected, local composition module. Importing the module
 * is the only composition mechanism: there is deliberately no default worker
 * and no fallback to idle work.
 */
export async function loadWorkerLoop(
  configPath: string,
  importModule: ImportModule = (specifier) => import(specifier),
): Promise<WorkerLoop> {
  if (!configPath.trim() || configPath.includes("\0")) throw new Error("Worker config path is invalid");
  if (/^[a-z][a-z\d+.-]*:/i.test(configPath)) {
    throw new Error("Worker config must be a local filesystem path");
  }
  const specifier = pathToFileURL(path.resolve(configPath)).href;
  const loaded = await importModule(specifier);
  if (!isWorkerCompositionModule(loaded)) {
    throw new Error("Worker config must export createWorkerLoop()");
  }
  const loop = await loaded.createWorkerLoop();
  if (!(loop instanceof WorkerLoop)) {
    throw new Error("Worker config createWorkerLoop() must return a WorkerLoop");
  }
  return loop;
}

export async function runWorkerCli(
  argv: readonly string[],
  dependencies: {
    createLoop(options: WorkerCliOptions): WorkerLoop | Promise<WorkerLoop>;
    signal?: AbortSignal;
    write?(value: string): void;
  },
): Promise<void> {
  const options = parseWorkerCliArgs(argv);
  const write = dependencies.write ?? ((value) => process.stdout.write(`${value}\n`));
  write(JSON.stringify({ component: "ai-media-studio-worker", ...options }));
  if (options.dryRun) return;
  const loop = await dependencies.createLoop(options);
  if (options.mode === "run-once") { await loop.runOnce(dependencies.signal); return; }
  if (!dependencies.signal) throw new Error("Continuous loops require an AbortSignal for graceful shutdown");
  await loop.run(dependencies.signal);
}

export function signalController(): AbortController {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  return controller;
}

async function main(): Promise<void> {
  const controller = signalController();
  await runWorkerCli(process.argv.slice(2), {
    signal: controller.signal,
    createLoop: (options) => loadWorkerLoop(options.configPath!),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
