import { randomUUID } from "node:crypto";
import { softwareFactoryStore, type FactoryJob, type FactoryJobInput, type FactoryOutcome } from "./software-factory-store";
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
  now?: () => Date;
}
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
  let busy = false; let quarantined = false; let active: AbortController | undefined; let deadline = 0;
  return {
    async maintain() { await store.expire(); if (busy && now().getTime() >= deadline) { quarantined=true; active?.abort(); } if (!quarantined) await store.heartbeat(workerId,Object.fromEntries(Object.entries(options.adapters || {}).map(([kind,adapter])=>[kind,typeof adapter?.execute === "function"]))); },
    async schedule() {
      if (!options.scheduleOwner || !options.adapters?.discover) return;
      const reserve = options.discoveryReservationCents;
      if (!Number.isSafeInteger(reserve) || reserve! <= 0) throw new Error("FACTORY_DISCOVERY_COST_REQUIRED");
      const state = await store.status(options.scheduleOwner); if (state.paused || !state.configured) return;
      for (const project of await store.projects(options.scheduleOwner)) {
        await store.enqueue(options.scheduleOwner,{key:`daily:${project.id}:${now().toISOString().slice(0,10)}`,projectId:project.id,kind:"discover",reservedCents:reserve!,payload:{source:"daily"}});
      }
    },
    async tick() {
      if (busy || quarantined) return; busy=true; deadline=now().getTime()+30000;
      try {
        await store.expire(); const job = await store.claim(workerId);
        if (now().getTime() >= deadline) { quarantined=true; return; }
        if (!job) return;
        deadline=Date.parse(job.leaseExpiresAt || ""); if (!Number.isFinite(deadline) || deadline <= now().getTime()) {quarantined=true; return;}
        let requiredRollbackCents: number | undefined;
        const adapter = options.adapters?.[job.kind];
        if (!adapter) { await store.complete(job,{status:"blocked",costCents:0,reason:`FACTORY_ADAPTER_UNAVAILABLE:${job.kind}`}); return; }
        if (job.kind === "deploy") {
          if (!options.releaseContext) { await store.complete(job,{status:"blocked",costCents:0,reason:"FACTORY_TRUSTED_RELEASE_EVIDENCE_UNAVAILABLE"}); return; }
          const context=await options.releaseContext(job); const gate=(context.target === "staging" ? rehearsalGate : releaseGate)(context.project,context.candidate,context.evidence,now().getTime());
          if (!gate.allowed || context.candidate.headSha !== job.headSha || context.project.id !== job.projectId) { await store.complete(job,{status:"blocked",costCents:0,reason:gate.reasons.join(",") || "FACTORY_RELEASE_IDENTITY_MISMATCH"}); return; }
          const recovery=context.recoveryBudget;
          requiredRollbackCents=recovery?.rollbackCents;
          if(!recovery || ![recovery.verifyCents,recovery.rollbackCents].every(x=>Number.isSafeInteger(x)&&x>0) || job.recoveryCents!==recovery.verifyCents+recovery.rollbackCents || job.reservedCents<=job.recoveryCents) {
            await store.complete(job,{status:"blocked",costCents:0,reason:"FACTORY_RECOVERY_ESCROW_UNAVAILABLE"});return;
          }
        }
        active=new AbortController(); const controller=active;
        const timeout=setTimeout(() => {quarantined=true;controller.abort();},Math.max(1,deadline-now().getTime())); timeout.unref?.();
        try {
          let result: FactoryAdapterResult;
          try { result=await adapter.execute(job,{signal:controller.signal,maxCostCents:job.reservedCents-(job.recoveryCents || 0)}); }
          catch { result={status:"unknown",costCents:0,reason:"FACTORY_EXECUTION_UNCONFIRMED"}; }
          if (quarantined || controller.signal.aborted) { await store.expire(); return; }
          try { validateFactoryTransition(job,result); if(job.kind==="deploy" && result.status==="completed" && result.next?.recoveryCents!==requiredRollbackCents)throw new Error("FACTORY_ROLLBACK_ESCROW_REQUIRED"); }
          catch { result={status:"unknown",costCents:0,reason:"FACTORY_INVALID_ADAPTER_RESULT"}; }
          const {next,...outcome}=result;
          if (!await store.complete(job,outcome,next)) quarantined=true;
          if (outcome.status === "unknown") quarantined=true;
        } finally {clearTimeout(timeout);active=undefined;}
      } finally {busy=false;}
    },
    stop() { quarantined=true; active?.abort(); },
  };
}
