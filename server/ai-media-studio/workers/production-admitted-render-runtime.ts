import type { ProviderArtifactResolutionRequest, ProviderArtifactResolver } from "../assets/contracts";
import type { AvailableProductionAssetRuntime } from "../assets/production-runtime";
import { createProductionAssetIngestWorker } from "../assets/production-runtime";
import { durableProviderArtifactRef } from "../assets/provider-artifact-identity";
import type { AssetIngestRepository } from "../assets/contracts";
import type { AssetIngestWorker, AssetIngestWorkerHooks } from "../assets/worker";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type { RuntimeProviderCredentialMaterializer } from "../provider-credentials/runtime-provider-credential-contracts";
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

export interface ProductionAdmittedWorkerDatabaseCapabilities extends AdmittedWorkerDatabaseCapabilities {
  /** Separate PR27 capability bound to the terminal worker id. */
  terminalCapabilityId: string;
}

interface ProductionAdmittedRenderRuntimeCommonInput {
  databaseLanes: AdmittedWorkerDatabaseLanes;
  databaseCapabilities: ProductionAdmittedWorkerDatabaseCapabilities;
  assetRepository: AssetIngestRepository;
  assetRuntime: AvailableProductionAssetRuntime;
  assetHooks?: AssetIngestWorkerHooks;
  workerIds: Readonly<{
    submit: string;
    terminal: string;
    assetIngest: string;
  }>;
  leaseDurationMs: number;
  resolveArtifactBinding(request: ProviderArtifactResolutionRequest): Promise<ProductionHeyGenV3ArtifactBinding>;
}

export type CreateProductionAdmittedRenderRuntimeInput = ProductionAdmittedRenderRuntimeCommonInput & (
  | {
      heyGen: HeyGenV3AdmittedProviderOptions;
      heyGenCredentialMaterializer?: never;
    }
  | {
      heyGen?: never;
      heyGenCredentialMaterializer: RuntimeProviderCredentialMaterializer<HeyGenV3AdmittedProviderOptions>;
    }
);

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

  const staticProvider = input.heyGen === undefined
    ? undefined
    : new HeyGenV3AdmittedRenderProvider(input.heyGen);
  const resolveProvider = async (
    identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim | ProductionHeyGenV3ArtifactBinding, "scope" | "providerAccountId" | "providerKey" | "providerCredentialVersion" | "authorizationDigest">,
    assertAdditionalCurrent?: () => Promise<void>,
  ): Promise<HeyGenV3AdmittedRenderProvider> => {
    assertIdentityShapeAndScope(identity, input.databaseCapabilities.scope);
    if (input.heyGen !== undefined && staticProvider !== undefined) {
      assertStaticConfigurationMatchesIdentity(identity, input.heyGen);
      return assertAdditionalCurrent === undefined
        ? staticProvider
        : new HeyGenV3AdmittedRenderProvider({
            ...input.heyGen,
            assertCredentialCurrent: combineCurrentGuards(
              assertAdditionalCurrent,
              input.heyGen.assertCredentialCurrent,
            ),
          });
    }
    try {
      const configuration = await materializeConfiguration(input, identity);
      assertConfigurationMatchesIdentity(identity, configuration);
      return new HeyGenV3AdmittedRenderProvider({
        ...configuration,
        ...(assertAdditionalCurrent === undefined
          ? {}
          : {
              assertCredentialCurrent: combineCurrentGuards(
                assertAdditionalCurrent,
                configuration.assertCredentialCurrent,
              ),
            }),
      });
    } catch {
      throw new Error("HeyGen production credential is unavailable");
    }
  };
  const providerResolver: AdmittedProviderResolver = {
    async resolve(authorization) {
      const provider = await resolveProvider(authorization);
      return { provider, capability: mintExactCapability(authorization) };
    },
  };
  const terminalProviderResolver: AdmittedTerminalProviderResolver = {
    async resolveTerminal(claim) {
      const provider = await resolveProvider(claim);
      return { provider, capability: mintExactCapability(claim) };
    },
  };
  const artifactResolver: ProviderArtifactResolver = {
    async resolveArtifact(request) {
      const binding = await input.resolveArtifactBinding(request);
      assertArtifactBindingRequest(request, binding);
      const provider = await resolveProvider(binding, async () => {
        const current = await input.resolveArtifactBinding(request);
        assertArtifactBindingRequest(request, current);
        assertSameArtifactBinding(binding, current);
      });
      return new HeyGenV3ProviderArtifactResolver({
        provider,
        async resolveBinding() {
          return {
            jobId: binding.jobId,
            tenantId: binding.tenantId,
            renderJobId: binding.renderJobId,
            remoteArtifactRef: binding.remoteArtifactRef,
            providerJobId: binding.providerJobId,
            capability: mintExactCapability(binding),
          };
        },
      }).resolveArtifact(request);
    },
  };

  const repository = new DrizzleAdmittedRenderRepository(
    input.databaseLanes,
    input.databaseCapabilities,
  );
  const terminalRepository = new DrizzleAdmittedRenderTerminalRepository(
    { reconcile: input.databaseLanes.reconcile },
    {
      scope: input.databaseCapabilities.scope,
      reconcileCapabilityId: input.databaseCapabilities.terminalCapabilityId,
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
      ...(input.assetHooks ? { hooks: input.assetHooks } : {}),
    }),
  };
}

function assertCompositionInput(input: CreateProductionAdmittedRenderRuntimeInput): void {
  const workerIds = [input.workerIds.submit, input.workerIds.terminal, input.workerIds.assetIngest];
  const hasStaticConfiguration = input.heyGen !== undefined;
  const hasMaterializer = input.heyGenCredentialMaterializer !== undefined;
  if (hasStaticConfiguration === hasMaterializer
    || (hasMaterializer && typeof input.heyGenCredentialMaterializer?.materialize !== "function")
    || workerIds.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/u.test(value))
    || new Set(workerIds).size !== workerIds.length
    || new Set([input.databaseCapabilities.submitCapabilityId, input.databaseCapabilities.reconcileCapabilityId,
      input.databaseCapabilities.terminalCapabilityId]).size !== 3
    || !Number.isInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 300_000
    || typeof input.resolveArtifactBinding !== "function"
    || input.assetRuntime.available !== true) {
    throw new Error("AI Media Studio admitted production composition is invalid");
  }
}

function assertIdentityShapeAndScope(
  identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim, "scope" | "providerAccountId" | "providerKey" | "providerCredentialVersion" | "authorizationDigest">,
  expectedScope: TenantScope,
): void {
  if (!identity.scope
    || identity.providerKey !== HEYGEN_PROVIDER_KEY
    || !validIdentityPart(identity.providerAccountId)
    || !Number.isSafeInteger(identity.providerCredentialVersion)
    || identity.providerCredentialVersion < 1
    || identity.scope.ownerUserId !== expectedScope.ownerUserId
    || identity.scope.workspaceId !== expectedScope.workspaceId
    || !validIdentityPart(identity.scope.ownerUserId)
    || !validIdentityPart(identity.scope.workspaceId)
    || !DIGEST.test(identity.authorizationDigest)) {
    throw new Error("HeyGen production binding does not match the admitted authorization");
  }
}

async function materializeConfiguration(
  input: CreateProductionAdmittedRenderRuntimeInput,
  identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim | ProductionHeyGenV3ArtifactBinding, "scope" | "providerAccountId" | "providerKey" | "providerCredentialVersion">,
): Promise<HeyGenV3AdmittedProviderOptions> {
  if (input.heyGenCredentialMaterializer === undefined) {
    throw new Error("HeyGen production credential is unavailable");
  }
  try {
    const configuration = await input.heyGenCredentialMaterializer.materialize(Object.freeze({
      scope: Object.freeze({ ...identity.scope }),
      providerAccountId: identity.providerAccountId,
      providerKey: identity.providerKey,
      providerCredentialVersion: identity.providerCredentialVersion,
    }));
    if (configuration === undefined) throw new Error("unavailable");
    return configuration;
  } catch {
    throw new Error("HeyGen production credential is unavailable");
  }
}

function assertStaticConfigurationMatchesIdentity(
  identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim | ProductionHeyGenV3ArtifactBinding, "providerAccountId" | "providerCredentialVersion">,
  configuration: HeyGenV3AdmittedProviderOptions,
): void {
  if (configuration.providerAccountId !== identity.providerAccountId
    || configuration.providerCredentialVersion !== identity.providerCredentialVersion) {
    throw new Error("HeyGen production binding does not match the admitted authorization");
  }
}

function assertConfigurationMatchesIdentity(
  identity: Pick<AdmittedAuthorizedIdentity | AdmittedTerminalClaim | ProductionHeyGenV3ArtifactBinding, "providerAccountId" | "providerCredentialVersion">,
  configuration: HeyGenV3AdmittedProviderOptions,
): void {
  if (!configuration
    || typeof configuration !== "object"
    || configuration.providerAccountId !== identity.providerAccountId
    || configuration.providerCredentialVersion !== identity.providerCredentialVersion
    || typeof configuration.credentialExpiresAt !== "string"
    || !Number.isFinite(Date.parse(configuration.credentialExpiresAt))
    || Date.parse(configuration.credentialExpiresAt) <= Date.now() + 30_000) {
    throw new Error("HeyGen production credential is unavailable");
  }
}

function assertArtifactBindingRequest(
  request: ProviderArtifactResolutionRequest,
  binding: ProductionHeyGenV3ArtifactBinding,
): void {
  if (binding.jobId !== request.jobId
    || binding.tenantId !== request.tenantId
    || binding.renderJobId !== request.renderJobId
    || binding.remoteArtifactRef !== request.remoteArtifactRef
    || binding.providerKey !== HEYGEN_PROVIDER_KEY
    || binding.remoteArtifactRef !== durableProviderArtifactRef(binding)
    || !structuredTenantMatchesScope(binding.tenantId, binding.scope)
    || !binding.providerJobId.trim()
    || binding.providerJobId.length > 500) {
    throw new Error("HeyGen production artifact binding does not match the ingest job");
  }
}

function assertSameArtifactBinding(
  expected: ProductionHeyGenV3ArtifactBinding,
  current: ProductionHeyGenV3ArtifactBinding,
): void {
  if (current.jobId !== expected.jobId
    || current.tenantId !== expected.tenantId
    || current.renderJobId !== expected.renderJobId
    || current.remoteArtifactRef !== expected.remoteArtifactRef
    || current.providerJobId !== expected.providerJobId
    || current.scope.ownerUserId !== expected.scope.ownerUserId
    || current.scope.workspaceId !== expected.scope.workspaceId
    || current.providerAccountId !== expected.providerAccountId
    || current.providerKey !== expected.providerKey
    || current.providerCredentialVersion !== expected.providerCredentialVersion
    || current.authorizationDigest !== expected.authorizationDigest) {
    throw new Error("HeyGen production artifact binding is no longer current");
  }
}

function combineCurrentGuards(
  bindingGuard: () => Promise<void>,
  credentialGuard: (() => Promise<void>) | undefined,
): () => Promise<void> {
  return async () => {
    await bindingGuard();
    await credentialGuard?.();
  };
}

function validIdentityPart(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 255
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
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
