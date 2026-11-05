import { randomUUID } from "node:crypto";
import { officeCloudStore, type OfficeCloudRun, type OfficeCloudCompletion, type OfficeWorkerCapabilities } from "./office-cloud-store";
import { createOfficeRuntime, type OfficeRun, officeTaskSchema } from "./office-runtime";
import { OfficeClaudeError, probeOfficeClaude, type OfficeClaudeProbe } from "./office-claude";
import { OfficeKongError, probeOfficeKong } from "./office-kong";

function publicRun(run: OfficeCloudRun): OfficeRun {
  const { result, workerId: _workerId, fence: _fence, leaseExpiresAt: _lease, ...task } = run;
  return {
    ...task,
    ...(result || {}),
    status: run.status === "pending" ? "accepted" : run.status,
  } as OfficeRun;
}

export function createOfficeCloudRuntime(store = officeCloudStore) {
  return {
    async list(userId: string) { return (await store.list(userId)).map(publicRun); },
    async submit(userId: string, input: unknown) {
      // Persist only. The web process never starts a second worker.
      return publicRun(await store.submit(userId, officeTaskSchema.parse(input)));
    },
    async getReview(userId: string, prUrl: string, headSha: string, diffSha256: string) {
      const runs = (await store.list(userId)).map(publicRun);
      const latest = runs.find(run => run.kind === "claude_review" && run.status === "completed" &&
        run.review?.prUrl === prUrl && run.review.headSha === headSha && run.review.diffSha256 === diffSha256);
      const age = latest?.completedAt ? Date.now() - Date.parse(latest.completedAt) : NaN;
      return latest?.review?.verdict === "pass" && latest.review.findings.length === 0 && latest.sessionId &&
        Number.isFinite(age) && age >= 0 && age <= 86_400_000 ? latest : undefined;
    },
  };
}
export const officeCloudRuntime = createOfficeCloudRuntime();

export async function probeOfficeWorker(store: Pick<typeof officeCloudStore, "getHeartbeat"> = officeCloudStore, now = () => new Date()) {
  const checkedAt = now().toISOString();
  const unavailable = (reason: string) => ({ status: "blocked" as const, reason, checkedAt });
  const blocked = (reason: string) => ({ ...unavailable(reason), capabilities: { claude: unavailable(reason), kong: unavailable(reason) } });
  try {
    const heartbeat = await store.getHeartbeat();
    const age = heartbeat ? now().getTime() - Date.parse(heartbeat.lastSeenAt) : NaN;
    if (!Number.isFinite(age) || age < -30_000 || age > 45_000) return blocked("No hay una señal reciente del ejecutor de nube. Las tareas no se consideran en ejecucion.");
    const provider = (probe: OfficeClaudeProbe | undefined) => {
      const age = probe ? now().getTime() - Date.parse(probe.checkedAt) : NaN;
      return probe && Number.isFinite(age) && age >= -30_000 && age <= 90_000
        ? probe : unavailable("El ejecutor de nube no tiene una comprobacion reciente de este proveedor.");
    };
    return {
      status: "ready" as const, reason: "Ejecutor de nube con señal reciente en PostgreSQL.", checkedAt, lastSeenAt: heartbeat!.lastSeenAt,
      capabilities: { claude: provider(heartbeat!.capabilities?.claude), kong: provider(heartbeat!.capabilities?.kong) },
    };
  } catch {
    return blocked("El registro persistente o el ejecutor de nube no estan preparados.");
  }
}

export function createOfficeCloudWorker(options: {
  store?: typeof officeCloudStore;
  execute?: (run: OfficeRun) => Promise<Partial<OfficeRun>>;
  workerId?: string;
  probeClaude?: typeof probeOfficeClaude;
  probeKong?: typeof probeOfficeKong;
  scheduledKongOwner?: string;
  now?: () => Date;
} = {}) {
  const store = options.store || officeCloudStore;
  const execute = options.execute || createOfficeRuntime().executeForCloud;
  const workerId = options.workerId || `office-${randomUUID()}`;
  const now = options.now || (() => new Date());
  let active = false;
  let executionDeadline: number | undefined;
  let quarantined = false;
  let capabilities: OfficeWorkerCapabilities | undefined;
  let checkingCapabilities: Promise<void> | undefined;
  let maintenance: Promise<void> | undefined;
  let lastScheduleCheck: number | undefined;
  const overdue = () => {
    if (active && executionDeadline !== undefined && now().getTime() >= executionDeadline) quarantined = true;
    return quarantined;
  };
  const heartbeat = async () => {
    // Liveness must stop advertising capacity while an unresolved execution
    // has outlived its durable lease. Keep the active guard until it settles.
    if (overdue()) return undefined;
    return store.heartbeat(workerId, capabilities);
  };
  return {
    maintain() {
      // This watchdog runs independently of tick, including when a provider
      // promise hangs. It expires uncertain work without restarting that work.
      return maintenance ||= (async () => {
        await store.markExpiredUnknown();
        await heartbeat();
      })().finally(() => { maintenance = undefined; });
    },
    refreshCapabilities() {
      // Run on this execution host, not in the separate web process. Probes do
      // not run tasks and their original timestamps survive ordinary heartbeats.
      if (overdue()) return Promise.resolve();
      return checkingCapabilities ||= (async () => {
        const [claude, kong] = await Promise.all([
          (options.probeClaude || probeOfficeClaude)(), (options.probeKong || probeOfficeKong)(),
        ]);
        capabilities = {
          claude: { status: claude.status, reason: claude.reason, checkedAt: claude.checkedAt },
          kong: { status: kong.status, reason: kong.reason, checkedAt: kong.checkedAt },
        };
        await heartbeat();
      })().finally(() => { checkingCapabilities = undefined; });
    },
    async tick() {
      if (active || quarantined) return;
      active = true;
      // Database admission itself can stall independently of provider calls.
      // Establish a bound before the first await, not only after a lease exists.
      executionDeadline = now().getTime() + 30_000;
      try {
        await store.markExpiredUnknown();
        if (overdue()) throw new Error("OFFICE_WORKER_PROGRESS_STALLED");
        await heartbeat();
        if (overdue()) throw new Error("OFFICE_WORKER_PROGRESS_STALLED");
        const time = now().getTime();
        const kong = capabilities?.kong;
        const probeAge = kong ? time - Date.parse(kong.checkedAt) : NaN;
        if (options.scheduledKongOwner && kong?.status === "ready" && probeAge >= -30_000 && probeAge <= 90_000 &&
            (lastScheduleCheck === undefined || time - lastScheduleCheck >= 30_000)) {
          lastScheduleCheck = time;
          try { await store.enqueueScheduledKongAudit(options.scheduledKongOwner); }
          catch { console.error("Office worker could not confirm its recurring KONG audit"); }
          if (overdue()) throw new Error("OFFICE_WORKER_PROGRESS_STALLED");
        }
        const claimed = await store.claim(workerId);
        // A late claim may have committed while its response was uncertain.
        // Never replace its expired admission deadline with a new lease budget.
        if (overdue()) throw new Error("OFFICE_WORKER_PROGRESS_STALLED");
        if (!claimed) return;
        executionDeadline = Date.parse(claimed.leaseExpiresAt || "");
        if (!Number.isFinite(executionDeadline) || overdue()) {
          await store.markExpiredUnknown();
          throw new Error("OFFICE_CLAIM_LEASE_UNVERIFIED");
        }
        let result: OfficeCloudCompletion;
        try {
          const output = await execute(publicRun(claimed));
          result = { ...output, status: "completed" } as OfficeCloudCompletion;
        } catch (error) {
          const known = error instanceof OfficeClaudeError || error instanceof OfficeKongError;
          result = { status: known ? "blocked" : "failed", error: { code: known ? error.code : "EXECUTION_FAILED", reason: known ? error.message : "La tarea no produjo un resultado verificable." } };
        }
        if (overdue()) {
          await store.markExpiredUnknown();
          throw new Error("OFFICE_EXECUTION_OUTLIVED_LEASE");
        }
        // Fenced write. An expired or lost outcome cannot become a new retry.
        const committed = await store.complete(claimed.id, workerId, claimed.fence!, result);
        if (!committed) throw new Error("OFFICE_COMPLETION_UNCONFIRMED");
      } finally { active = false; executionDeadline = undefined; }
    },
    heartbeat,
  };
}
