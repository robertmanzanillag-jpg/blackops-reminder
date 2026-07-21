import type { S3CommandClient, S3CompatiblePresign } from "./s3-compatible-storage";
import {
  S3CompatibleAssetDeliverySigner,
  S3CompatibleOwnedObjectStorage,
} from "./s3-compatible-storage";
import {
  NodeHttpsArtifactReader,
  resolvePublicAddresses,
  type StreamingHttpsTransport,
} from "./http-artifact-reader";
import type {
  AssetDeliverySigner,
  AssetIngestRepository,
  BoundedArtifactReader,
  ExactHostSsrfPolicy,
  OwnedObjectStorage,
  ProviderArtifactResolver,
} from "./contracts";
import { AssetIngestWorker, type AssetIngestWorkerHooks } from "./worker";

const ENV = {
  sourceHosts: "AI_MEDIA_STUDIO_ASSET_HOST_ALLOWLIST",
  bucket: "AI_MEDIA_STUDIO_ASSET_BUCKET",
  region: "AI_MEDIA_STUDIO_ASSET_REGION",
  accessKeyId: "AI_MEDIA_STUDIO_ASSET_ACCESS_KEY_ID",
  secretAccessKey: "AI_MEDIA_STUDIO_ASSET_SECRET_ACCESS_KEY",
  endpoint: "AI_MEDIA_STUDIO_ASSET_ENDPOINT",
  sessionToken: "AI_MEDIA_STUDIO_ASSET_SESSION_TOKEN",
  forcePathStyle: "AI_MEDIA_STUDIO_ASSET_FORCE_PATH_STYLE",
  maxBytes: "AI_MEDIA_STUDIO_ASSET_MAX_BYTES",
  maxChunkBytes: "AI_MEDIA_STUDIO_ASSET_MAX_CHUNK_BYTES",
  maxRedirects: "AI_MEDIA_STUDIO_ASSET_MAX_REDIRECTS",
  requestTimeoutMs: "AI_MEDIA_STUDIO_ASSET_REQUEST_TIMEOUT_MS",
  multipartPartSizeBytes: "AI_MEDIA_STUDIO_ASSET_MULTIPART_PART_SIZE_BYTES",
} as const;

const KNOWN_ENV_NAMES = new Set<string>(Object.values(ENV));
const SAFE_CONFIGURATION_ERROR = "AI Media Studio production asset configuration is invalid";

const DEFAULTS = {
  maxBytes: 512 * 1024 * 1024,
  maxChunkBytes: 8 * 1024 * 1024,
  maxRedirects: 2,
  requestTimeoutMs: 30_000,
  multipartPartSizeBytes: 8 * 1024 * 1024,
  leaseDurationMs: 60_000,
  retryBaseDelayMs: 5_000,
  retryMaxDelayMs: 5 * 60_000,
} as const;

export type ProductionAssetEnvironment = Readonly<Record<string, string | undefined>>;

/** Test seams are transport/client boundaries only; construction never performs I/O. */
export interface ProductionAssetAdapterDependencies {
  s3Client?: S3CommandClient;
  presign?: S3CompatiblePresign;
  httpsTransport?: StreamingHttpsTransport;
  resolvePublicAddresses?: (hostname: string) => Promise<readonly string[]>;
}

export interface AvailableProductionAssetRuntime {
  available: true;
  reader: BoundedArtifactReader;
  storage: OwnedObjectStorage;
  signer: AssetDeliverySigner;
  sourcePolicy: ExactHostSsrfPolicy;
  limits: Readonly<{
    maxArtifactBytes: number;
    maxChunkBytes: number;
    leaseDurationMs: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  }>;
}

export type ProductionAssetRuntime =
  | AvailableProductionAssetRuntime
  | { available: false; reason: "not_configured" };

interface ParsedProductionAssetConfiguration {
  sourceHosts: ReadonlySet<string>;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  sessionToken?: string;
  forcePathStyle: boolean;
  maxBytes: number;
  maxChunkBytes: number;
  maxRedirects: number;
  requestTimeoutMs: number;
  multipartPartSizeBytes: number;
}

/**
 * Selects production adapters only when the entire environment is present and safe.
 * The result deliberately exposes adapter ports and bounded policy, never credentials.
 */
export function createProductionAssetRuntimeFromEnvironment(
  environment: ProductionAssetEnvironment = process.env,
  dependencies: ProductionAssetAdapterDependencies = {},
): ProductionAssetRuntime {
  const config = parseConfiguration(environment);
  if (!config) return { available: false, reason: "not_configured" };

  try {
    const s3Config = {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      },
      forcePathStyle: config.forcePathStyle,
      multipartPartSizeBytes: config.multipartPartSizeBytes,
      ...(dependencies.s3Client ? { client: dependencies.s3Client } : {}),
      ...(dependencies.presign ? { presign: dependencies.presign } : {}),
    };
    const sourcePolicy: ExactHostSsrfPolicy = {
      allowedHosts: config.sourceHosts,
      requireHttps: true,
      requireStandardPort: true,
      maxRedirects: config.maxRedirects,
      resolvePublicAddresses: dependencies.resolvePublicAddresses ?? resolvePublicAddresses,
    };
    return {
      available: true,
      reader: new NodeHttpsArtifactReader({
        requestTimeoutMs: config.requestTimeoutMs,
        ...(dependencies.httpsTransport ? { transport: dependencies.httpsTransport } : {}),
      }),
      storage: new S3CompatibleOwnedObjectStorage(s3Config),
      signer: new S3CompatibleAssetDeliverySigner(s3Config),
      sourcePolicy,
      limits: {
        maxArtifactBytes: config.maxBytes,
        maxChunkBytes: config.maxChunkBytes,
        leaseDurationMs: DEFAULTS.leaseDurationMs,
        retryBaseDelayMs: DEFAULTS.retryBaseDelayMs,
        retryMaxDelayMs: DEFAULTS.retryMaxDelayMs,
      },
    };
  } catch {
    throw invalidConfiguration();
  }
}

export interface CreateProductionAssetIngestWorkerInput {
  workerId: string;
  repository: AssetIngestRepository;
  hooks?: AssetIngestWorkerHooks;
  environment?: ProductionAssetEnvironment;
  adapterDependencies?: ProductionAssetAdapterDependencies;
  productionRuntime?: ProductionAssetRuntime;
  providerArtifactResolver?: ProviderArtifactResolver;
  clock?: { now(): number };
}

/** Builds one run-on-demand worker. It starts no timer, loop, socket, or network request. */
export function createProductionAssetIngestWorker(input: CreateProductionAssetIngestWorkerInput): AssetIngestWorker {
  if (!isSafeWorkerId(input.workerId)) throw new Error("AI Media Studio asset worker configuration is invalid");
  const runtime = input.productionRuntime
    ?? createProductionAssetRuntimeFromEnvironment(input.environment, input.adapterDependencies);
  if (!runtime.available) throw new Error("AI Media Studio production asset storage is unavailable");
  return new AssetIngestWorker({
    workerId: input.workerId,
    repository: input.repository,
    reader: runtime.reader,
    sourcePolicy: runtime.sourcePolicy,
    storage: runtime.storage,
    leaseDurationMs: runtime.limits.leaseDurationMs,
    maxArtifactBytes: runtime.limits.maxArtifactBytes,
    maxChunkBytes: runtime.limits.maxChunkBytes,
    retry: {
      baseDelayMs: runtime.limits.retryBaseDelayMs,
      maxDelayMs: runtime.limits.retryMaxDelayMs,
    },
    ...(input.providerArtifactResolver ? { providerArtifactResolver: input.providerArtifactResolver } : {}),
    ...(input.hooks ? { hooks: input.hooks } : {}),
    ...(input.clock ? { clock: input.clock } : {}),
  });
}

function parseConfiguration(environment: ProductionAssetEnvironment): ParsedProductionAssetConfiguration | undefined {
  try {
    const configuredNames = Object.keys(environment).filter((name) => name.startsWith("AI_MEDIA_STUDIO_ASSET_") && environment[name] !== undefined);
    if (configuredNames.length === 0) return undefined;
    if (configuredNames.some((name) => !KNOWN_ENV_NAMES.has(name))) throw invalidConfiguration();

    const sourceHosts = parseHosts(required(environment, ENV.sourceHosts));
    const bucket = required(environment, ENV.bucket);
    const region = required(environment, ENV.region);
    const accessKeyId = required(environment, ENV.accessKeyId);
    const secretAccessKey = required(environment, ENV.secretAccessKey);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) || bucket.includes("..")) throw invalidConfiguration();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/u.test(region)) throw invalidConfiguration();
    if (accessKeyId.length > 512 || secretAccessKey.length > 4096) throw invalidConfiguration();

    const endpoint = optional(environment, ENV.endpoint);
    if (endpoint) validateEndpoint(endpoint);
    const sessionToken = optional(environment, ENV.sessionToken);
    if (sessionToken && sessionToken.length > 8192) throw invalidConfiguration();
    const forcePathStyle = parseBoolean(optional(environment, ENV.forcePathStyle), false);
    const maxBytes = parseBoundedInteger(optional(environment, ENV.maxBytes), DEFAULTS.maxBytes, 1024 * 1024, 5 * 1024 * 1024 * 1024);
    const maxChunkBytes = parseBoundedInteger(optional(environment, ENV.maxChunkBytes), DEFAULTS.maxChunkBytes, 16 * 1024, 64 * 1024 * 1024);
    const maxRedirects = parseBoundedInteger(optional(environment, ENV.maxRedirects), DEFAULTS.maxRedirects, 0, 5);
    const requestTimeoutMs = parseBoundedInteger(optional(environment, ENV.requestTimeoutMs), DEFAULTS.requestTimeoutMs, 1_000, 120_000);
    const multipartPartSizeBytes = parseBoundedInteger(
      optional(environment, ENV.multipartPartSizeBytes),
      DEFAULTS.multipartPartSizeBytes,
      5 * 1024 * 1024,
      512 * 1024 * 1024,
    );
    if (maxChunkBytes > maxBytes) throw invalidConfiguration();

    return {
      sourceHosts,
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      ...(endpoint ? { endpoint } : {}),
      ...(sessionToken ? { sessionToken } : {}),
      forcePathStyle,
      maxBytes,
      maxChunkBytes,
      maxRedirects,
      requestTimeoutMs,
      multipartPartSizeBytes,
    };
  } catch {
    throw invalidConfiguration();
  }
}

function parseHosts(value: string): ReadonlySet<string> {
  const values = value.split(",").map((host) => host.trim());
  if (values.length < 1 || values.length > 32 || values.some((host) => !isExactHostname(host))) throw invalidConfiguration();
  const unique = new Set(values);
  if (unique.size !== values.length) throw invalidConfiguration();
  return unique;
}

function isExactHostname(host: string): boolean {
  if (host.length > 253 || host !== host.toLowerCase() || host.includes("*") || host.includes("..")) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

function validateEndpoint(value: string): void {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || (endpoint.port && endpoint.port !== "443")
    || endpoint.pathname !== "/"
  ) throw invalidConfiguration();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalidConfiguration();
}

function parseBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/u.test(value)) throw invalidConfiguration();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw invalidConfiguration();
  return parsed;
}

function required(environment: ProductionAssetEnvironment, name: string): string {
  const value = optional(environment, name);
  if (!value) throw invalidConfiguration();
  return value;
}

function optional(environment: ProductionAssetEnvironment, name: string): string | undefined {
  const raw = environment[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value || undefined;
}

function isSafeWorkerId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(value);
}

function invalidConfiguration(): Error {
  return new Error(SAFE_CONFIGURATION_ERROR);
}
