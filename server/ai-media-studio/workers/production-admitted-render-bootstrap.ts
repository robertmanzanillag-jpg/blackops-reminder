import type { AssetIngestDatabase } from "../assets/drizzle-ingest-repository";
import type {
  AvailableProductionAssetRuntime,
  ProductionAssetEnvironment,
} from "../assets/production-runtime";
import type { AssetIngestRepository } from "../assets/contracts";
import type { AdmittedProviderArtifactBindingDatabase } from "../assets/drizzle-admitted-artifact-binding-loader";
import type { VerifiedStaticHeyGenRuntimeCredentialDatabase } from "../provider-credentials/verified-static-heygen-runtime-credential";
import type { AssetIngestWorkerHooks } from "../assets/worker";
import type { AdmittedRenderTransactionalDatabase } from "./drizzle-admitted-render-repository";
import type { ProductionAdmittedRenderRuntime } from "./production-admitted-render-runtime";
import type {
  VerifiedStaticHeyGenProductionRuntimeFactoryInput,
} from "./verified-static-heygen-production-runtime-factory";

const CONFIG = {
  ownerUserId: "AI_MEDIA_STUDIO_ADMITTED_OWNER_USER_ID",
  workspaceId: "AI_MEDIA_STUDIO_ADMITTED_WORKSPACE_ID",
  submitDatabaseUrl: "AI_MEDIA_STUDIO_ADMITTED_SUBMIT_DATABASE_URL",
  reconcileDatabaseUrl: "AI_MEDIA_STUDIO_ADMITTED_RECONCILE_DATABASE_URL",
  submitCapabilityId: "AI_MEDIA_STUDIO_ADMITTED_SUBMIT_CAPABILITY_ID",
  reconcileCapabilityId: "AI_MEDIA_STUDIO_ADMITTED_RECONCILE_CAPABILITY_ID",
  terminalCapabilityId: "AI_MEDIA_STUDIO_ADMITTED_TERMINAL_CAPABILITY_ID",
  submitWorkerId: "AI_MEDIA_STUDIO_ADMITTED_SUBMIT_WORKER_ID",
  terminalWorkerId: "AI_MEDIA_STUDIO_ADMITTED_TERMINAL_WORKER_ID",
  assetIngestWorkerId: "AI_MEDIA_STUDIO_ADMITTED_ASSET_INGEST_WORKER_ID",
  leaseDurationMs: "AI_MEDIA_STUDIO_ADMITTED_LEASE_DURATION_MS",
} as const;

const KNOWN_CONFIG = new Set<string>(Object.values(CONFIG));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/u;

type ApplicationDatabase = AssetIngestDatabase
  & VerifiedStaticHeyGenRuntimeCredentialDatabase
  & AdmittedProviderArtifactBindingDatabase;

export interface ProductionAdmittedRenderBootstrapAdapters {
  readonly applicationDatabase: ApplicationDatabase;
  createDatabaseLane(connectionString: string): AdmittedRenderTransactionalDatabase;
  createAssetRepository(database: ApplicationDatabase): AssetIngestRepository;
  createAssetRuntime(environment: ProductionAssetEnvironment): AvailableProductionAssetRuntime | undefined;
  createRuntimeFactory(
    input: VerifiedStaticHeyGenProductionRuntimeFactoryInput,
  ): (runtimeInput: Readonly<{ assetHooks: AssetIngestWorkerHooks }>) => ProductionAdmittedRenderRuntime;
}

export interface ProductionAdmittedRenderBootstrapDependencies {
  readonly productionAssetEnvironment: ProductionAssetEnvironment;
  readonly createProductionAdmittedRenderRuntime?: (input: Readonly<{
    assetHooks: AssetIngestWorkerHooks;
  }>) => ProductionAdmittedRenderRuntime;
}

interface ParsedConfiguration {
  ownerUserId: string;
  workspaceId: string;
  submitDatabaseUrl: string;
  reconcileDatabaseUrl: string;
  submitCapabilityId: string;
  reconcileCapabilityId: string;
  terminalCapabilityId: string;
  submitWorkerId: string;
  terminalWorkerId: string;
  assetIngestWorkerId: string;
  leaseDurationMs: number;
}

/**
 * All-or-nothing production bootstrap. Missing, partial, unknown, or malformed
 * admitted configuration leaves the runtime absent. Construction opens no
 * database connection, reads no HeyGen secret, invokes no worker, and performs
 * no provider, DNS, object-storage, or artifact I/O.
 */
export function createProductionAdmittedRenderBootstrapDependencies(
  environment: ProductionAssetEnvironment,
  adapters: ProductionAdmittedRenderBootstrapAdapters,
): ProductionAdmittedRenderBootstrapDependencies {
  const assetRuntime = safeAssetRuntime(environment, adapters);
  const productionAssetEnvironment = assetRuntime ? environment : {};
  const configuration = parseConfiguration(environment);
  if (!configuration || !assetRuntime) return Object.freeze({ productionAssetEnvironment });

  try {
    const submitLane = adapters.createDatabaseLane(configuration.submitDatabaseUrl);
    const reconcileLane = adapters.createDatabaseLane(configuration.reconcileDatabaseUrl);
    if (submitLane === reconcileLane) return Object.freeze({ productionAssetEnvironment });
    const factory = adapters.createRuntimeFactory({
      runtime: {
        databaseLanes: { submit: submitLane, reconcile: reconcileLane },
        databaseCapabilities: {
          scope: {
            ownerUserId: configuration.ownerUserId,
            workspaceId: configuration.workspaceId,
          },
          submitCapabilityId: configuration.submitCapabilityId,
          reconcileCapabilityId: configuration.reconcileCapabilityId,
          terminalCapabilityId: configuration.terminalCapabilityId,
        },
        assetRepository: adapters.createAssetRepository(adapters.applicationDatabase),
        assetRuntime,
        workerIds: {
          submit: configuration.submitWorkerId,
          terminal: configuration.terminalWorkerId,
          assetIngest: configuration.assetIngestWorkerId,
        },
        leaseDurationMs: configuration.leaseDurationMs,
      },
      credentialDatabase: adapters.applicationDatabase,
      artifactBindingDatabase: adapters.applicationDatabase,
      secretResolverOptions: { env: environment },
    });
    return Object.freeze({
      productionAssetEnvironment,
      createProductionAdmittedRenderRuntime: factory,
    });
  } catch {
    return Object.freeze({ productionAssetEnvironment });
  }
}

function parseConfiguration(environment: ProductionAssetEnvironment): ParsedConfiguration | undefined {
  const configured = Object.keys(environment)
    .filter((name) => name.startsWith("AI_MEDIA_STUDIO_ADMITTED_") && environment[name] !== undefined);
  if (configured.length === 0 || configured.length !== KNOWN_CONFIG.size
    || configured.some((name) => !KNOWN_CONFIG.has(name))) return undefined;
  try {
    const ownerUserId = exactPart(environment[CONFIG.ownerUserId], 255);
    const workspaceId = exactPart(environment[CONFIG.workspaceId], 255);
    const submitDatabase = databaseIdentity(environment[CONFIG.submitDatabaseUrl]);
    const reconcileDatabase = databaseIdentity(environment[CONFIG.reconcileDatabaseUrl]);
    const applicationDatabase = databaseIdentity(environment.DATABASE_URL);
    const capabilityIds = [
      exactUuid(environment[CONFIG.submitCapabilityId]),
      exactUuid(environment[CONFIG.reconcileCapabilityId]),
      exactUuid(environment[CONFIG.terminalCapabilityId]),
    ];
    const workerIds = [
      exactWorkerId(environment[CONFIG.submitWorkerId]),
      exactWorkerId(environment[CONFIG.terminalWorkerId]),
      exactWorkerId(environment[CONFIG.assetIngestWorkerId]),
    ];
    const leaseDurationMs = exactInteger(environment[CONFIG.leaseDurationMs], 1, 300_000);
    if (new Set(capabilityIds).size !== capabilityIds.length
      || new Set(workerIds).size !== workerIds.length
      || new Set([
        applicationDatabase.username,
        submitDatabase.username,
        reconcileDatabase.username,
      ]).size !== 3
      || submitDatabase.connectionString === reconcileDatabase.connectionString) return undefined;
    return {
      ownerUserId,
      workspaceId,
      submitDatabaseUrl: submitDatabase.connectionString,
      reconcileDatabaseUrl: reconcileDatabase.connectionString,
      submitCapabilityId: capabilityIds[0]!,
      reconcileCapabilityId: capabilityIds[1]!,
      terminalCapabilityId: capabilityIds[2]!,
      submitWorkerId: workerIds[0]!,
      terminalWorkerId: workerIds[1]!,
      assetIngestWorkerId: workerIds[2]!,
      leaseDurationMs,
    };
  } catch {
    return undefined;
  }
}

function safeAssetRuntime(
  environment: ProductionAssetEnvironment,
  adapters: ProductionAdmittedRenderBootstrapAdapters,
): AvailableProductionAssetRuntime | undefined {
  try {
    return adapters.createAssetRuntime(environment);
  } catch {
    return undefined;
  }
}

function databaseIdentity(raw: string | undefined): { connectionString: string; username: string } {
  const connectionString = exactPart(raw, 8_192);
  const parsed = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)
    || !parsed.username || !parsed.pathname || parsed.pathname === "/") throw new Error("invalid");
  return { connectionString, username: decodeURIComponent(parsed.username) };
}

function exactUuid(value: string | undefined): string {
  const parsed = exactPart(value, 36).toLowerCase();
  if (!UUID.test(parsed)) throw new Error("invalid");
  return parsed;
}

function exactWorkerId(value: string | undefined): string {
  const parsed = exactPart(value, 120);
  if (!WORKER_ID.test(parsed)) throw new Error("invalid");
  return parsed;
}

function exactPart(value: string | undefined, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("invalid");
  return value;
}

function exactInteger(value: string | undefined, minimum: number, maximum: number): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) throw new Error("invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("invalid");
  return parsed;
}
