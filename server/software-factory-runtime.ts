import { createHash } from "node:crypto";
import { FACTORY_POLICY } from "./software-factory";
import { createFactoryPipeline, type FactoryPipelineDependencies } from "./software-factory-pipeline";
import { factoryJobKinds, softwareFactoryStore } from "./software-factory-store";
import type { FactoryAdapter, FactoryWorkerOptions } from "./software-factory-worker";

export type TrustedFactoryStages = Required<Pick<FactoryPipelineDependencies, typeof factoryJobKinds[number]>>;
export interface FactoryRuntimeOptions {
  owner: string;
  stages: TrustedFactoryStages;
  reservations: FactoryPipelineDependencies["reservations"];
  store?: typeof softwareFactoryStore;
  promoteLearning?: FactoryPipelineDependencies["promoteLearning"];
  now?: () => Date;
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
  const store = options.store ?? softwareFactoryStore;
  const status = await store.status(owner);
  if (!status.configured) throw new Error("FACTORY_FIXED_COST_RESERVATION_REQUIRED");
  if (status.limitCents !== FACTORY_POLICY.monthlyLimitCents || ![status.fixedCents, status.spentCents, status.reservedCents].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("FACTORY_BUDGET_UNVERIFIED");
  const pipeline = createFactoryPipeline({
    ...stages, reservations, now: options.now, promoteLearning: options.promoteLearning,
    project: async (key, id) => { scope(key); return store.projectByOwnerKey(key, id); },
    previous: async (key, id) => { scope(key); return store.getCompletedJob(key, id); },
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
