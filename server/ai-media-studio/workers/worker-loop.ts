export type WorkIterationResult = "worked" | "idle";

export interface WorkerLoopOptions {
  concurrency: number;
  idleBackoffMs: number;
  reconciliationIntervalMs: number;
  runOne(signal: AbortSignal): Promise<WorkIterationResult>;
  reconcile?(signal: AbortSignal): Promise<void>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface WorkerLoopRunResult { worked: number; idle: number; reconciled: boolean }

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted || ms <= 0) { resolve(); return; }
  const timeout = setTimeout(done, ms);
  function done() { clearTimeout(timeout); signal.removeEventListener("abort", done); resolve(); }
  signal.addEventListener("abort", done, { once: true });
});

/** Reusable, no-autostart loop. Aborting stops new work and drains already-started promises. */
export class WorkerLoop {
  private lastReconciledAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: WorkerLoopOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("concurrency must be a positive integer");
    if (options.idleBackoffMs < 0 || options.reconciliationIntervalMs < 0) throw new Error("loop intervals cannot be negative");
  }

  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<WorkerLoopRunResult> {
    if (signal.aborted) return { worked: 0, idle: 0, reconciled: false };
    const now = (this.options.now ?? Date.now)();
    let reconciled = false;
    if (this.options.reconcile && now - this.lastReconciledAtMs >= this.options.reconciliationIntervalMs) {
      await this.options.reconcile(signal);
      this.lastReconciledAtMs = now;
      reconciled = true;
    }
    if (signal.aborted) return { worked: 0, idle: 0, reconciled };
    const settled = await Promise.all(Array.from({ length: this.options.concurrency }, async () => {
      if (signal.aborted) return "idle" as const;
      return this.options.runOne(signal);
    }));
    return {
      worked: settled.filter((result) => result === "worked").length,
      idle: settled.filter((result) => result === "idle").length,
      reconciled,
    };
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.options.sleep ?? defaultSleep;
    while (!signal.aborted) {
      const result = await this.runOnce(signal);
      if (signal.aborted) break;
      if (result.worked === 0) await sleep(this.options.idleBackoffMs, signal);
    }
  }
}
