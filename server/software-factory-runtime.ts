import { createHash } from "node:crypto";
import { FACTORY_POLICY } from "./software-factory";
import { createFactoryPipeline, type FactoryPipelineDependencies, type FactoryPipelineState } from "./software-factory-pipeline";
import { factoryJobKinds, type FactoryJob } from "./software-factory-store";
import { configuredSoftwareFactoryStore as softwareFactoryStore } from "./software-factory-store-provider";
import type { FactoryAdapter, FactoryWorkerOptions } from "./software-factory-worker";

export type TrustedFactoryStages = Required<Pick<FactoryPipelineDependencies, typeof factoryJobKinds[number]>>;
export interface FactoryRuntimeOptions {
  owner: string;
  stages: TrustedFactoryStages;
  reservations: FactoryPipelineDependencies["reservations"];
  store?: typeof softwareFactoryStore & { releaseHistory?(owner: string, projectId: string): Promise<FactoryJob[]> };
  promoteLearning?: FactoryPipelineDependencies["promoteLearning"];
  now?: () => Date;
}

/** Owner-scoped recent history only; ambiguous or superseded releases are not current. */
export function currentFactoryProductionDeployment(jobs: readonly FactoryJob[], projectId: string): FactoryJob | undefined {
  const releases = jobs.slice(0, 100).filter(job => job.projectId === projectId && ["deploy", "rollback"].includes(job.kind));
  if (new Set(releases.map(job => job.ownerKey)).size > 1 || releases.some(job => ["running", "unknown"].includes(job.status))) return undefined;
  const state = (job: FactoryJob) => (job.result as { evidence?: { pipelineState?: FactoryPipelineState } } | undefined)?.evidence?.pipelineState;
  const completed = releases.filter(job => job.status === "completed");
  if (completed.some(job => !state(job) || !Number.isFinite(Date.parse(job.completedAt ?? "")))) return undefined;
  const production = completed.filter(job => state(job)?.target === "production").sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!));
  const latest = production[0];
  if (!latest || latest.kind !== "deploy" || (production[1] && Date.parse(latest.completedAt!) === Date.parse(production[1].completedAt!))) return undefined;
  const s = state(latest)!;
  if (s.projectId !== projectId || s.candidate?.projectId !== projectId || !s.deployment?.id || s.deployment.target !== "production" || s.deployment.headSha !== latest.headSha || s.candidate.headSha !== latest.headSha) return undefined;
  return latest;
}

/** Compose operator-installed callbacks only. This does not supply providers,
 * migrate storage, authorize release, initialize costs, or unpause the factory. */
export async function createTrustedFactoryWorkerOptions(options: FactoryRuntimeOptions): Promise<FactoryWorkerOptions> {
  if (typeof options.owner !== "string" || !options.owner.trim()) throw new Error("FACTORY_OWNER_REQUIRED");
  const owner = options.owner;
  const expectedKey = createHash("sha256").update(owner).digest("hex");
  const scope = (key: string) => { if (key !== expectedKey) throw new Error("FACTORY_RUNTIME_OWNER_MISMATCH"); };
  const stages = { ...options.stages };
  const reservations = { ...options.reservations };
  for (const kind of factoryJobKinds) {
    if (typeof stages[kind] !== "function") throw new Error(`FACTORY_STAGE_REQUIRED:${kind}`);
    if (!Number.isSafeInteger(reservations[kind]) || reservations[kind] < 1 || reservations[kind] > FACTORY_POLICY.monthlyLimitCents) throw new Error(`FACTORY_RESERVATION_INVALID:${kind}`);
  }
  if (reservations.deploy + reservations.verify + reservations.rollback > FACTORY_POLICY.monthlyLimitCents) throw new Error("FACTORY_RECOVERY_RESERVATION_INVALID");
  if (options.promoteLearning !== undefined && typeof options.promoteLearning !== "function") throw new Error("FACTORY_LEARNING_ADAPTER_INVALID");
  Object.freeze(reservations);
  const store: NonNullable<FactoryRuntimeOptions["store"]> = options.store ?? softwareFactoryStore;
  const status = await store.status(owner);
  if (!status.configured) throw new Error("FACTORY_FIXED_COST_RESERVATION_REQUIRED");
  if (status.limitCents !== FACTORY_POLICY.monthlyLimitCents || ![status.fixedCents, status.spentCents, status.reservedCents].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("FACTORY_BUDGET_UNVERIFIED");
  const pipeline = createFactoryPipeline({
    ...stages, reservations, now: options.now, promoteLearning: options.promoteLearning,
    project: async (key, id) => { scope(key); return store.projectByOwnerKey(key, id); },
    previous: async (key, id) => { scope(key); return store.getCompletedJob(key, id); },
    isCurrentDeployment: async (key, projectId, deployJobId) => {
      scope(key);
      if (!store.releaseHistory) return false;
      const jobs = await store.releaseHistory(owner, projectId);
      if (jobs.some(job => job.ownerKey !== key)) return false;
      return currentFactoryProductionDeployment(jobs, projectId)?.id === deployJobId;
    },
    claimFinding: async (key, projectId, findingKey, jobId) => { scope(key); return store.claimFinding(key, projectId, findingKey, jobId); },
    recordValidation: async (key, projectId, jobId) => { scope(key); await store.recordValidation(key, projectId, jobId); },
  });
  if (!pipeline.readiness().ready) throw new Error("FACTORY_PIPELINE_UNAVAILABLE");
  return {
    store, scheduleOwner: owner, discoveryReservationCents: reservations.discover, now: options.now,
    adapters: Object.fromEntries(factoryJobKinds.map(kind => [kind, {
      execute: async (...[job, context]: Parameters<FactoryAdapter["execute"]>) => {
        scope(job.ownerKey);
        return pipeline.adapters![kind]!.execute(job, context);
      },
    }])) as FactoryWorkerOptions["adapters"],
    releaseContext: async job => { scope(job.ownerKey); return pipeline.releaseContext!(job); },
  };
}


/** Entry-point guard for any operator-installed module, including custom ones. */
export function validateFactoryWorkerOptions(config: unknown): asserts config is FactoryWorkerOptions {
  if (config === null || typeof config !== "object") throw new Error("FACTORY_WORKER_CONFIGURATION_REQUIRED");
  const value = config as Record<string, unknown>;
  if (value.adapters === null || typeof value.adapters !== "object") throw new Error("FACTORY_EXECUTORS_UNAVAILABLE");
  const adapters = value.adapters as Record<string, unknown>;
  for (const kind of factoryJobKinds) {
    const adapter = adapters[kind];
    if (adapter === null || typeof adapter !== "object" || typeof (adapter as Record<string, unknown>).execute !== "function") throw new Error(`FACTORY_STAGE_REQUIRED:${kind}`);
  }
  if (typeof value.releaseContext !== "function") throw new Error("FACTORY_TRUSTED_RELEASE_EVIDENCE_UNAVAILABLE");
  const reserve = value.discoveryReservationCents;
  if (typeof reserve !== "number" || !Number.isSafeInteger(reserve) || reserve < 1 || reserve > FACTORY_POLICY.monthlyLimitCents) throw new Error("FACTORY_DISCOVERY_COST_REQUIRED");
}
