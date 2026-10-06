import { performance } from "node:perf_hooks";
import { summarizeDatabaseError, type DatabasePoolCounts } from "./db-pool";

type Timer = ReturnType<typeof setInterval>;

export interface ProjectMonitorEvent {
  event: "cycle_completed" | "cycle_failed" | "cycle_skipped";
  durationMs: number;
  pool: DatabasePoolCounts;
  reason?: string;
  code?: string;
}

export function createProjectMonitor(deps: {
  run: () => Promise<void>;
  getPoolCounts: () => DatabasePoolCounts;
  report?: (event: ProjectMonitorEvent) => void;
  now?: () => number;
  schedule?: (callback: () => void, intervalMs: number) => Timer;
  cancel?: (timer: Timer) => void;
}, intervalMs = 60_000) {
  const now = deps.now || (() => performance.now());
  const schedule = deps.schedule || globalThis.setInterval;
  const cancel = deps.cancel || globalThis.clearInterval;
  const reporter = deps.report || (event => console.log("[project-monitor]", event));
  let timer: Timer | null = null;
  let running = false;
  let startedAt = 0;

  function report(event: ProjectMonitorEvent["event"], error?: unknown) {
    try {
      reporter({
        event,
        durationMs: Math.max(0, Math.round(now() - startedAt)),
        pool: deps.getPoolCounts(),
        ...(error ? summarizeDatabaseError(error) : {}),
      });
    } catch { /* telemetry must not hold the monitor lock */ }
  }

  async function runNow(): Promise<boolean> {
    if (running) {
      report("cycle_skipped");
      return false;
    }
    running = true;
    startedAt = now();
    try {
      await deps.run();
      report("cycle_completed");
    } catch (error) {
      report("cycle_failed", error);
    } finally {
      running = false;
    }
    return true;
  }

  return {
    runNow,
    start(): void {
      if (timer !== null) return;
      timer = schedule(() => { void runNow(); }, intervalMs);
      void runNow();
    },
    stop(): void {
      if (timer === null) return;
      cancel(timer);
      timer = null;
    },
  };
}
