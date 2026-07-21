import type { ProviderArtifactResolutionRequest, ProviderArtifactResolver } from "../assets/contracts";
import type { AvailableProductionAssetRuntime } from "../assets/production-runtime";
import { createProductionAssetIngestWorker } from "../assets/production-runtime";
import type { AssetIngestRepository } from "../assets/contracts";
import type { AssetIngestWorker } from "../assets/worker";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import {
  HeyGenV3AdmittedRenderProvider,
  HeyGenV3ProviderArtifactResolver,
  type HeyGenV3AdmittedProviderOptions,
} from "../providers/heygen-v3-admitted-render-provider";
import type {
  AdmittedAuthorizedIdentity,
  AdmittedProviderResolver,
  ExactAdmittedProviderCapability,
} from "./admitted-render-contracts";
import {
  AdmittedRenderTerminalWorker,
  type AdmittedTerminalClaim,
  type AdmittedTerminalProviderResolver,
} from "./admitted-render-terminal-worker";
import { AdmittedRenderWorker } from "./admitted-render-worker";
import {
  DrizzleAdmittedRenderRepository,
  type AdmittedWorkerDatabaseCapabilities,
  type AdmittedWorkerDatabaseLanes,
} from "./drizzle-admitted-render-repository";
import { DrizzleAdmittedRenderTerminalRepository } from "./drizzle-admitted-render-terminal-repository";

const HEYGEN_PROVIDER_KEY = "heygen" as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export interface ProductionHeyGenV3ArtifactBinding {
  jobId: string;
  tenantId: string;
  renderJobId: string;
  remoteArtifactRef: string;
  providerJobId: string;
  scope: TenantScope;
  providerAccountId: string;
  providerKey: typeof HEYGEN_PROVIDER_KEY;
  providerCredentialVersion: number;
  authorizationDigest: Sha256Digest;
}

export interface CreateProductionAdmittedRenderRuntimeInput {
  databaseLanes: AdmittedWorkerDatabaseLanes;
  databaseCapabilities: AdmittedWorkerDatabaseCapabilities;
  assetRepository: AssetIngestRepository;
  assetRuntime: AvailableProductionAssetRuntime;
  heyGen: HeyGenV3AdmittedProviderOptions;
  workerIds: Readonly<{
    submit: string;
    terminal: string;
    assetIngest: string;
  }>;
  leaseDurationMs: number;
  resolveArtifactBinding(request: ProviderArtifactResolutionRequest): Promise<ProductionHeyGenV3ArtifactBinding>;
}

export interface ProductionAdmittedRenderRuntime {
  readonly configured: true;
  readonly providerKey: typeof HEYGEN_PROVIDER_KEY;
  readonly autostart: false;
  readonly submitWorker: AdmittedRenderWorker;
  readonly terminalWorker: AdmittedRenderTerminalWorker;
  readonly assetIngestWorker: AssetIngestWorker;
  readonly providerResolver: AdmittedProviderResolver;
  readonly terminalProviderResolver: AdmittedTerminalProviderResolver;
  readonly artifactResolver: ProviderArtifactResolver;
}

/**
 * Composes the reviewed admitted HeyGen V3 path without starting it.
 * Construction validates configuration only; all database, provider, storage,
 * DNS and artifact-binding I/O remains behind explicit worker method calls.
 */
export function createProductionAdmittedRenderRuntime(
  input: CreateProductionAdmittedRenderRuntimeInput,
): ProductionAdmittedRenderRuntime {
  assertCompositionInput(input);

  const provider = new HeyGenV3AdmittedRenderProvider(input.heyGen);
  const providerResolver: AdmittedProviderResolver = {
    async resolve(authorization) {
      assertConfiguredIdentity(authorization, input.heyGen, input.databaseCapabilities.scope);
      return { provider, capability: mintExactCapability(authorization) };
    },
  };
  const terminalProviderResolver: AdmittedTerminalProviderResolver = {
    async resolveTerminal(claim) {
      assertConfiguredIdentity(claim, input.heyGen, input.databaseCapabilities.scope);
      return { provider, capability: mintExactCapability(claim) };
    },
  };
  const artifactResolver = new HeyGenV3ProviderArtifactResolver({
    provider,
    async resolveBinding(request) {
      const binding = await input.resolveArtifactBinding(request);
      assertArtifactBinding(request, binding, input.heyGen, input.databaseCapabilities.scope);
      return {
        jobId: binding.jobId,
        tenantId: binding.tenantId,
        renderJobId: binding.renderJobId,
        remoteArtifactRef: binding.remoteArtifactRef,
        providerJobId: binding.providerJobId,
        capability: mintExactCapability(binding),
      };
    },
  });

  const repository = new DrizzleAdmittedRenderRepository(
    input.databaseLanes,
    input.databaseCapabilities,
  );
  const terminalRepository = new DrizzleAdmittedRenderTerminalRepository(
    { reconcile: input.databaseLanes.reconcile },
    {
      scope: input.databaseCapabilities.scope,
      reconcileCapabilityId: input.databaseCapabilities.reconcileCapabilityId,
    },
  );

  return {
    configured: true,
    providerKey: HEYGEN_PROVIDER_KEY,
    autostart: false,
    providerResolver,
    terminalProviderResolver,
    artifactResolver,
    submitWorker: new AdmittedRenderWorker({
      workerId: input.workerIds.submit,
      leaseDurationMs: input.leaseDurationMs,
      repository,
      providerResolver,
    }),
    terminalWorker: new AdmittedRenderTerminalWorker({
      workerId: input.workerIds.terminal,
      leaseDurationMs: input.leaseDurationMs,
      repository: terminalRepository,
      providerResolver: terminalProviderResolver,
    }),
    assetIngestWorker: createProductionAssetIngestWorker({
      workerId: input.workerIds.assetIngest,
      repository: input.assetRepository,
      productionRuntime: input.assetRuntime,
      providerArtifactResolver: artifactResolver,
    }),
  };
}

function assertCompositionInput(input: CreateProductionAdmittedRenderRuntimeInput): void {
  const workerIds = [input.workerIds.submit, input.workerIds.terminal, input.workerIds.assetIngest];
  if (workerIds.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/u.test(value))
    || new Set(workerIds).size !== workerIds.length
    || !Number.isInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 300_000
    || typeof input.resolveArtifactBinding !== "function"
    || input.assetRuntime.available !== true) {
    throw new Error("AI Media Studio admitted production composition is invalid");
  }
}

function assertConfiguredIdentity(
  identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim, "scope" | "providerAccountId" | "providerKey" | "providerCredentialVersion" | "authorizationDigest">,
  configuration: HeyGenV3AdmittedProviderOptions,
  expectedScope: TenantScope,
): void {
  if (identity.providerKey !== HEYGEN_PROVIDER_KEY
    || identity.providerAccountId !== configuration.providerAccountId
    || identity.providerCredentialVersion !== configuration.providerCredentialVersion
    || identity.scope.ownerUserId !== expectedScope.ownerUserId
    || identity.scope.workspaceId !== expectedScope.workspaceId
    || !identity.scope.ownerUserId.trim()
    || !identity.scope.workspaceId.trim()
    || !DIGEST.test(identity.authorizationDigest)) {
    throw new Error("HeyGen production binding does not match the admitted authorization");
  }
}

function assertArtifactBinding(
  request: ProviderArtifactResolutionRequest,
  binding: ProductionHeyGenV3ArtifactBinding,
  configuration: HeyGenV3AdmittedProviderOptions,
  expectedScope: TenantScope,
): void {
  if (binding.jobId !== request.jobId
    || binding.tenantId !== request.tenantId
    || binding.renderJobId !== request.renderJobId
    || binding.remoteArtifactRef !== request.remoteArtifactRef
    || !structuredTenantMatchesScope(binding.tenantId, binding.scope)
    || !binding.providerJobId.trim()
    || binding.providerJobId.length > 500) {
    throw new Error("HeyGen production artifact binding does not match the ingest job");
  }
  assertConfiguredIdentity(binding, configuration, expectedScope);
}

function structuredTenantMatchesScope(tenantId: string, scope: TenantScope): boolean {
  try {
    const value: unknown = JSON.parse(tenantId);
    return Array.isArray(value)
      && value.length === 2
      && value[0] === scope.workspaceId
      && value[1] === scope.ownerUserId;
  } catch {
    return false;
  }
}

function mintExactCapability(
  identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim | ProductionHeyGenV3ArtifactBinding, "scope" | "providerAccountId" | "providerKey" | "providerCredentialVersion" | "authorizationDigest">,
): ExactAdmittedProviderCapability {
  return Object.freeze({
    scope: Object.freeze({ ...identity.scope }),
    providerAccountId: identity.providerAccountId,
    providerKey: identity.providerKey,
    providerCredentialVersion: identity.providerCredentialVersion,
    authorizationDigest: identity.authorizationDigest,
  }) as unknown as ExactAdmittedProviderCapability;
}
