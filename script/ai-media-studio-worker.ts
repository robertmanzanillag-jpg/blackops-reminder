import { pathToFileURL } from "node:url";
import { WorkerLoop, type WorkerLoopOptions } from "../server/ai-media-studio/workers/worker-loop";

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
  if (mode === "loop" && !configPath) throw new Error("Continuous loops require explicit --config <path>");
  return { mode, dryRun: !live, configPath };
}

export async function runWorkerCli(
  argv: readonly string[],
  dependencies: { createLoop(options: WorkerCliOptions): WorkerLoop; signal?: AbortSignal; write?(value: string): void },
): Promise<void> {
  const options = parseWorkerCliArgs(argv);
  const write = dependencies.write ?? ((value) => process.stdout.write(`${value}\n`));
  write(JSON.stringify({ component: "ai-media-studio-worker", ...options }));
  if (options.dryRun) return;
  const loop = dependencies.createLoop(options);
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
    createLoop: () => new WorkerLoop({
      concurrency: 1, idleBackoffMs: 1_000, reconciliationIntervalMs: 30_000,
      runOne: async () => "idle",
    } satisfies WorkerLoopOptions),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
