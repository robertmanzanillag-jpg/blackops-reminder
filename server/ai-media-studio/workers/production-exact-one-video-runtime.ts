import type { AvailableProductionAssetRuntime } from "../assets/production-runtime";
import {
  DrizzleExactAssetIngestRepository,
  type ExactAssetIngestTransactionalDatabase,
} from "../assets/drizzle-exact-asset-ingest-repository";
import { DrizzleExactAssetStageTargetLoader } from "../assets/drizzle-exact-asset-stage-target-loader";
import {
  ExactAssetStageRunner,
  type ExactAssetStageRunnerHooks,
} from "../assets/exact-stage-runner";
import type { ProviderArtifactResolver } from "../assets/contracts";
import type { TenantScope } from "../core/resource-domain";
import type { AdmittedProviderResolver } from "./admitted-render-contracts";
import type { AdmittedTerminalProviderResolver } from "./admitted-render-terminal-worker";
import {
  DrizzleExactOneVideoRunFence,
  type ExactOneVideoRunFenceTransactionalDatabase,
} from "./drizzle-exact-one-video-run-fence";
import {
  DrizzleExactReconcileTerminalRepository,
  type ExactReconcileTerminalTransactionalDatabase,
} from "./drizzle-exact-reconcile-terminal-repository";
import {
  DrizzleExactSubmitRepository,
  type ExactSubmitTransactionalDatabase,
} from "./drizzle-exact-submit-repository";
import { ExactOneVideoProviderStageRunner } from "./exact-provider-stage-runner";
import {
  OneVideoRunOnceExecutor,
} from "./one-video-run-once-executor";
import type { ServerOwnedOneVideoRunAuthorization } from "./server-owned-one-video-run-authorization";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/u;
const SCOPE_PART = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/u;

export type ProductionExactOneVideoDatabase =
  ExactOneVideoRunFenceTransactionalDatabase
  & ExactSubmitTransactionalDatabase
  & ExactReconcileTerminalTransactionalDatabase
  & ExactAssetIngestTransactionalDatabase;

export interface CreateProductionExactOneVideoRuntimeInput {
  database: ProductionExactOneVideoDatabase;
  scope: Readonly<TenantScope>;
  authority: ServerOwnedOneVideoRunAuthorization;
  providerResolver: AdmittedProviderResolver;
  terminalProviderResolver: AdmittedTerminalProviderResolver;
  providerArtifactResolver: ProviderArtifactResolver;
  assetRuntime: AvailableProductionAssetRuntime;
  workerIds: Readonly<{
    provider: string;
    asset: string;
  }>;
  leaseDurationMs: number;
  assetHooks?: ExactAssetStageRunnerHooks;
  clock?: { now(): number };
  now?: () => string;
}

export interface ProductionExactOneVideoRuntime {
  readonly configured: true;
  readonly autostart: false;
  readonly concurrency: 1;
  readonly publishingAvailable: false;
  readonly executor: OneVideoRunOnceExecutor;
}

/**
 * Composes the function-only exact one-video path without mounting or starting
 * it. Construction validates and connects object capabilities only; database,
 * provider, DNS, artifact, and object-storage I/O remains behind an explicit
 * `executor.run(command)` call.
 */
export function createProductionExactOneVideoRuntime(
  input: CreateProductionExactOneVideoRuntimeInput,
): ProductionExactOneVideoRuntime {
  assertCompositionInput(input);

  const assetStages = new ExactAssetStageRunner({
    workerId: input.workerIds.asset,
    repository: new DrizzleExactAssetIngestRepository(input.database, input.scope),
    targets: new DrizzleExactAssetStageTargetLoader(input.database, input.scope),
    reader: input.assetRuntime.reader,
    providerArtifactResolver: input.providerArtifactResolver,
    sourcePolicy: input.assetRuntime.sourcePolicy,
    storage: input.assetRuntime.storage,
    leaseDurationMs: input.assetRuntime.limits.leaseDurationMs,
    maxArtifactBytes: input.assetRuntime.limits.maxArtifactBytes,
    maxChunkBytes: input.assetRuntime.limits.maxChunkBytes,
    retry: {
      baseDelayMs: input.assetRuntime.limits.retryBaseDelayMs,
      maxDelayMs: input.assetRuntime.limits.retryMaxDelayMs,
    },
    ...(input.assetHooks ? { hooks: input.assetHooks } : {}),
    ...(input.clock ? { clock: input.clock } : {}),
  });
  const stages = new ExactOneVideoProviderStageRunner({
    workerId: input.workerIds.provider,
    leaseDurationMs: input.leaseDurationMs,
    submitRepository: new DrizzleExactSubmitRepository(input.database, input.scope),
    reconcileTerminalRepository:
      new DrizzleExactReconcileTerminalRepository(input.database, input.scope),
    providerResolver: input.providerResolver,
    terminalProviderResolver: input.terminalProviderResolver,
    assetDelegate: assetStages,
    ...(input.now ? { now: input.now } : {}),
  });
  const executor = new OneVideoRunOnceExecutor({
    authorization: input.authority.authorization,
    fence: new DrizzleExactOneVideoRunFence(input.database, {
      capabilityId: input.authority.capabilityId,
      scope: input.scope,
      leaseDurationMs: input.leaseDurationMs,
    }),
    stages,
  });

  return Object.freeze({
    configured: true,
    autostart: false,
    concurrency: 1,
    publishingAvailable: false,
    executor,
  });
}

function assertCompositionInput(
  input: CreateProductionExactOneVideoRuntimeInput,
): void {
  if (!input || !input.database
    || typeof input.database.execute !== "function"
    || typeof input.database.transaction !== "function"
    || !input.authority
    || !input.authority.authorization
    || typeof input.authority.authorization.assertAuthorized !== "function"
    || !input.providerResolver
    || typeof input.providerResolver.resolve !== "function"
    || !input.terminalProviderResolver
    || typeof input.terminalProviderResolver.resolveTerminal !== "function"
    || !input.providerArtifactResolver
    || typeof input.providerArtifactResolver.resolveArtifact !== "function"
    || !input.assetRuntime || input.assetRuntime.available !== true
    || !UUID.test(input.authority.capabilityId)
    || input.authority.command.target.scope.ownerUserId !== input.scope?.ownerUserId
    || input.authority.command.target.scope.workspaceId !== input.scope?.workspaceId
    || !validScope(input.scope)
    || !WORKER_ID.test(input.workerIds?.provider ?? "")
    || !WORKER_ID.test(input.workerIds?.asset ?? "")
    || input.workerIds.provider === input.workerIds.asset
    || !Number.isInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 300_000) {
    throw new Error("AI Media Studio exact one-video production composition is invalid");
  }
}

function validScope(scope: Readonly<TenantScope> | undefined): boolean {
  return Boolean(scope
    && SCOPE_PART.test(scope.ownerUserId)
    && SCOPE_PART.test(scope.workspaceId));
}
