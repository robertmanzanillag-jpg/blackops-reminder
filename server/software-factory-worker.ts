import { randomUUID } from "node:crypto";
import type { FactoryJob, FactoryJobInput, FactoryOutcome } from "./software-factory-store";
import { configuredSoftwareFactoryStore as softwareFactoryStore } from "./software-factory-store-provider";
import { releaseGate, rehearsalGate, type FactoryProject, type FactoryCandidate, type FactoryEvidence } from "./software-factory";
export interface FactoryAdapterResult extends FactoryOutcome { next?: FactoryJobInput }
export interface FactoryAdapter { execute(job: FactoryJob, context: { signal: AbortSignal; maxCostCents: number }): Promise<FactoryAdapterResult> }
export interface TrustedReleaseContext { target?: "staging" | "production"; recoveryBudget?: {verifyCents:number;rollbackCents:number}; project: FactoryProject; candidate: FactoryCandidate; evidence: FactoryEvidence[] }
export interface FactoryWorkerOptions {
  store?: typeof softwareFactoryStore; workerId?: string;
  adapters?: Partial<Record<FactoryJob["kind"], FactoryAdapter>>;
  /** Resolves evidence from trusted persisted executor results, never from request payload. */
  releaseContext?: (job: FactoryJob) => Promise<TrustedReleaseContext>;
  scheduleOwner?: string;
  discoveryReservationCents?: number;
  /** Company orders are admitted explicitly through the shared credit gate. */
  discoveryMode?: "daily" | "company-orders-only";
  /** Operator policy, never a job payload. Stops both staging and production. */
  releaseMode?: "review-only" | "enabled";
  now?: () => Date;
}
export type FactoryTickResult = { kind: "progressed" | "idle" | "quarantined" } | { kind: "retry"; delayMs: number };
const transitions: Record<FactoryJob["kind"], FactoryJob["kind"][]> = { discover:["build"],build:["simulate"],simulate:["review","build"],review:["deploy","build"],deploy:["verify"],verify:["evaluate","rollback"],rollback:["evaluate"],evaluate:[] };
export function validateFactoryTransition(job: FactoryJob, result: FactoryAdapterResult) {
  const next = result.next;
  if(result.status==="completed" && job.kind==="deploy" && next?.kind!=="verify")throw new Error("FACTORY_VERIFICATION_REQUIRED");
  if(result.status!=="unknown" && job.recoveryCents>0 && result.costCents>job.reservedCents-job.recoveryCents)throw new Error("FACTORY_RECOVERY_ESCROW_OVERRUN");
  if (!next) return;
  if (result.status !== "completed" || next.projectId !== job.projectId || !transitions[job.kind].includes(next.kind)) throw new Error("FACTORY_INVALID_TRANSITION");
  if (["simulate","review","deploy","verify","rollback","evaluate"].includes(next.kind) && (!next.headSha || (job.kind !== "build" && job.headSha && next.headSha !== job.headSha))) throw new Error("FACTORY_VERSION_CHANGED");
  const attempts = Number(job.payload.repairAttempts ?? 0);
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 2) throw new Error("FACTORY_REPAIR_LIMIT");
  next.payload = { ...next.payload, repairAttempts: next.kind === "build" && job.kind !== "discover" ? attempts + 1 : attempts };
  if (Number(next.payload.repairAttempts) > 2) throw new Error("FACTORY_REPAIR_LIMIT");
}
export function createSoftwareFactoryWorker(options: FactoryWorkerOptions = {}) {
  const store = options.store || softwareFactoryStore;
  const workerId = options.workerId || `factory-${randomUUID()}`;
  const now = options.now || (() => new Date());
  const capabilities = () => Object.fromEntries(Object.entries(options.adapters || {}).map(([kind, adapter]) => [kind,
    typeof adapter?.execute === "function" && !(options.releaseMode === "review-only" && ["deploy", "verify", "rollback", "evaluate"].includes(kind))]));
  let busy = false; let quarantined = false; let active: AbortController | undefined; let deadline = 0;
  return {
    async maintain() {
      if (!busy || quarantined) return;
      if (now().getTime() >= deadline) { quarantined=true; active?.abort(); }
      await store.expire();
      if (!quarantined && active) await store.heartbeat(workerId,capabilities());
    },
    async schedule() {
      if (options.discoveryMode === "company-orders-only") return;
      if (!options.scheduleOwner || !options.adapters?.discover) return;
      const reserve = options.discoveryReservationCents;
      if (!Number.isSafeInteger(reserve) || reserve! <= 0) throw new Error("FACTORY_DISCOVERY_COST_REQUIRED");
      const state = await store.status(options.scheduleOwner); if (state.paused || !state.configured) return;
      for (const project of await store.projects(options.scheduleOwner)) {
        await store.enqueue(options.scheduleOwner,{key:`daily:${project.id}:${now().toISOString().slice(0,10)}`,projectId:project.id,kind:"discover",reservedCents:reserve!,payload:{source:"daily"}});
      }
    },
    async tick(): Promise<FactoryTickResult> {
      if (quarantined) return { kind: "quarantined" };
      if (busy) return { kind: "retry", delayMs: 5000 }; busy=true; deadline=now().getTime()+30000;
      try {
        await store.expire(); const job = await store.claim(workerId);
        if (quarantined || now().getTime() >= deadline) { quarantined=true; return { kind: "quarantined" }; }
        if (!job) {
          // claim(undefined) also means another worker or an unknown outcome owns
          // the global slot. Only a second trusted queue check permits long sleep.
          if (typeof store.idleState !== "function") return { kind: "retry", delayMs: 5000 };
          const state = await store.idleState();
          if (state.kind === "unknown") { quarantined = true; return { kind: "quarantined" }; }
          if (state.kind === "running") {
            const remaining = Date.parse(state.leaseExpiresAt) - now().getTime();
            if (!Number.isFinite(remaining)) { quarantined = true; return { kind: "quarantined" }; }
            return { kind: "retry", delayMs: Math.max(1, Math.min(5000, remaining)) };
          }
          if (state.kind === "pendingRecovery") return { kind: "retry", delayMs: 5000 };
          return { kind: "idle" };
        }
        deadline=Date.parse(job.leaseExpiresAt || ""); if (!Number.isFinite(deadline) || deadline <= now().getTime()) {quarantined=true; return { kind: "quarantined" };}
        await store.heartbeat(workerId,capabilities());
        const block = async (reason: string): Promise<FactoryTickResult> => {
          if (!await store.complete(job, { status: "blocked", costCents: 0, reason })) quarantined = true;
          return { kind: quarantined ? "quarantined" : "progressed" };
        };
        let requiredRollbackCents: number | undefined;
        const adapter = options.adapters?.[job.kind];
        if (options.releaseMode === "review-only" && ["deploy", "verify", "rollback", "evaluate"].includes(job.kind)) return await block("FACTORY_RELEASE_NOT_ENABLED");
        if (!adapter) return await block(`FACTORY_ADAPTER_UNAVAILABLE:${job.kind}`);
        if (job.kind === "deploy") {
          if (!options.releaseContext) return await block("FACTORY_TRUSTED_RELEASE_EVIDENCE_UNAVAILABLE");
          const context=await options.releaseContext(job); const gate=(context.target === "staging" ? rehearsalGate : releaseGate)(context.project,context.candidate,context.evidence,now().getTime());
          if (!gate.allowed || context.candidate.headSha !== job.headSha || context.project.id !== job.projectId) return await block(gate.reasons.join(",") || "FACTORY_RELEASE_IDENTITY_MISMATCH");
          const recovery=context.recoveryBudget;
          requiredRollbackCents=recovery?.rollbackCents;
          if(!recovery || ![recovery.verifyCents,recovery.rollbackCents].every(x=>Number.isSafeInteger(x)&&x>0) || job.recoveryCents!==recovery.verifyCents+recovery.rollbackCents || job.reservedCents<=job.recoveryCents) {
            return await block("FACTORY_RECOVERY_ESCROW_UNAVAILABLE");
          }
        }
        if (quarantined || now().getTime() >= deadline) { quarantined=true; return { kind: "quarantined" }; }
        active=new AbortController(); const controller=active;
        const timeout=setTimeout(() => {quarantined=true;controller.abort();},Math.max(1,deadline-now().getTime())); timeout.unref?.();
        try {
          let result: FactoryAdapterResult;
          try { result=await adapter.execute(job,{signal:controller.signal,maxCostCents:job.reservedCents-(job.recoveryCents || 0)}); }
          catch { result={status:"unknown",costCents:0,reason:"FACTORY_EXECUTION_UNCONFIRMED"}; }
          if (quarantined || controller.signal.aborted) { await store.expire(); return { kind: "quarantined" }; }
          try { validateFactoryTransition(job,result); if(job.kind==="deploy" && result.status==="completed" && result.next?.recoveryCents!==requiredRollbackCents)throw new Error("FACTORY_ROLLBACK_ESCROW_REQUIRED"); }
          catch { result={status:"unknown",costCents:0,reason:"FACTORY_INVALID_ADAPTER_RESULT"}; }
          if (options.releaseMode === "review-only" && job.kind === "review" && result.status === "completed" && result.next?.kind === "deploy") {
            const { next: _release, ...reviewed } = result;
            result = { ...reviewed, reason: "FACTORY_PR_REVIEWED_NOT_DEPLOYED" };
          }
          const {next,...outcome}=result;
          if (!await store.complete(job,outcome,next)) quarantined=true;
          if (outcome.status === "unknown") quarantined=true;
          return { kind: quarantined ? "quarantined" : "progressed" };
        } finally {clearTimeout(timeout);active=undefined;}
      } finally {busy=false;}
    },
    stop() { quarantined=true; active?.abort(); },
  };
}
