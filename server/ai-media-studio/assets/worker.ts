import { createHash } from "node:crypto";
import { storageTenantSegment } from "./object-keys";
import type {
  AssetIngestErrorCode,
  AssetIngestJob,
  AssetIngestRepository,
  BoundedArtifactReader,
  ExactHostSsrfPolicy,
  OwnedObjectStorage,
  ArtifactReadStream,
  ProviderArtifactResolver,
} from "./contracts";
import { AssetIngestFailure } from "./contracts";

export interface AssetIngestWorkerOptions {
  workerId: string;
  repository: AssetIngestRepository;
  reader: BoundedArtifactReader;
  providerArtifactResolver?: ProviderArtifactResolver;
  sourcePolicy: ExactHostSsrfPolicy;
  storage: OwnedObjectStorage;
  leaseDurationMs: number;
  maxArtifactBytes: number;
  maxChunkBytes: number;
  retry: { baseDelayMs: number; maxDelayMs: number };
  clock?: { now(): number };
  hooks?: AssetIngestWorkerHooks;
}

export interface AssetIngestWorkerHooks {
  /** Idempotently materializes or reuses the canonical media asset after fenced job completion. */
  onCompleted?(job: AssetIngestJob): void | { mediaAssetId: string } | Promise<void | { mediaAssetId: string }>;
  onFailed?(job: AssetIngestJob): void | Promise<void>;
  onLeaseLost?(job: AssetIngestJob): void | Promise<void>;
}

export type AssetIngestWorkerResult =
  | { outcome: "idle" }
  | { outcome: "completed" | "completed_unlinked" | "retry_scheduled" | "dead_letter" | "lease_lost"; job: AssetIngestJob };

const clock = { now: () => Date.now() };

export class AssetIngestWorker {
  private readonly now: { now(): number };
  constructor(private readonly options: AssetIngestWorkerOptions) {
    if (!options.workerId || options.leaseDurationMs <= 0) throw new Error("Valid worker lease settings are required");
    if (options.maxArtifactBytes <= 0 || options.maxChunkBytes <= 0 || options.maxChunkBytes > options.maxArtifactBytes) throw new Error("Invalid ingest byte bounds");
    if (options.retry.baseDelayMs < 0 || options.retry.maxDelayMs < options.retry.baseDelayMs) throw new Error("Invalid retry bounds");
    validateSourcePolicy(options.sourcePolicy);
    this.now = options.clock ?? clock;
  }

  async runNext(): Promise<AssetIngestWorkerResult> {
    await this.options.repository.reconcileExpiredLeases(this.now.now());
    const claim = await this.options.repository.claimDue({ workerId: this.options.workerId, nowMs: this.now.now(), leaseDurationMs: this.options.leaseDurationMs });
    if (!claim) return { outcome: "idle" };
    const temporaryObjectKey = temporaryAssetKey(claim.job);
    let upload: Awaited<ReturnType<OwnedObjectStorage["beginUpload"]>> | undefined;
    let artifact: ArtifactReadStream | undefined;
    try {
      const sourceUrl = await this.resolveSourceUrl(claim.job);
      artifact = await this.options.reader.open({
        url: sourceUrl,
        policy: this.options.sourcePolicy,
        maxBytes: this.options.maxArtifactBytes,
        maxChunkBytes: this.options.maxChunkBytes,
      });
      if (normalizeMime(artifact.mimeType) !== claim.job.expectedMimeType) throw new AssetIngestFailure("mime_rejected", false);
      if (artifact.declaredSizeBytes !== undefined && (!Number.isSafeInteger(artifact.declaredSizeBytes) || artifact.declaredSizeBytes < 0 || artifact.declaredSizeBytes > this.options.maxArtifactBytes)) {
        throw new AssetIngestFailure("size_exceeded", false);
      }
      upload = await storageCall(() => this.options.storage.beginUpload({ tenantId: claim.job.tenantId, temporaryObjectKey }));
      const digest = createHash("sha256");
      let sizeBytes = 0;
      let prefix = new Uint8Array();
      for await (const chunk of artifact.chunks) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) continue;
        if (chunk.byteLength > this.options.maxChunkBytes) throw new AssetIngestFailure("chunk_exceeded", false);
        sizeBytes += chunk.byteLength;
        if (sizeBytes > this.options.maxArtifactBytes) throw new AssetIngestFailure("size_exceeded", false);
        if (prefix.byteLength < 12) prefix = appendPrefix(prefix, chunk, 12);
        digest.update(chunk);
        await storageCall(() => upload!.write(chunk));
      }
      if (artifact.declaredSizeBytes !== undefined && artifact.declaredSizeBytes !== sizeBytes) throw new AssetIngestFailure("size_exceeded", false);
      if (!hasMp4FileTypeBox(prefix)) throw new AssetIngestFailure("invalid_mp4", false);
      const sha256 = digest.digest("hex");
      const committed = await storageCall(() => upload!.commit({ mimeType: "video/mp4", sizeBytes, sha256 }));
      upload = undefined;
      if (!committed.finalObjectKey) throw new AssetIngestFailure("storage_failed", true);
      const completed = await this.options.repository.complete({
        jobId: claim.job.id,
        leaseToken: claim.leaseToken,
        ownedObjectKey: committed.finalObjectKey,
        sha256,
        sizeBytes,
        nowMs: this.now.now(),
      });
      if (!completed) {
        await this.options.hooks?.onLeaseLost?.(claim.job);
        return { outcome: "lease_lost", job: claim.job };
      }
      if (!this.options.hooks?.onCompleted) return { outcome: "completed", job: completed };
      try {
        const materialized = await this.options.hooks.onCompleted(completed);
        if (!materialized || !materialized.mediaAssetId) return { outcome: "completed_unlinked", job: completed };
        const linked = await this.options.repository.attachMediaAsset({
          tenantId: completed.tenantId,
          jobId: completed.id,
          mediaAssetId: materialized.mediaAssetId,
          nowMs: this.now.now(),
        });
        return linked ? { outcome: "completed", job: linked } : { outcome: "completed_unlinked", job: completed };
      } catch {
        // The completed job remains discoverable by listCompletedUnlinked for reconciliation.
        return { outcome: "completed_unlinked", job: completed };
      }
    } catch (error) {
      try {
        artifact?.abort();
      } catch {
        // The primary safe ingest failure must not be replaced by a transport cleanup error.
      }
      await upload?.abort().catch(() => undefined);
      const failure = classifyFailure(error);
      const failed = await this.options.repository.fail({
        jobId: claim.job.id,
        leaseToken: claim.leaseToken,
        errorCode: failure.code,
        retryable: failure.retryable,
        retryAtMs: this.now.now() + retryDelay(claim.job.attempt, this.options.retry),
        nowMs: this.now.now(),
      });
      if (!failed) {
        await this.options.hooks?.onLeaseLost?.(claim.job);
        return { outcome: "lease_lost", job: claim.job };
      }
      await this.options.hooks?.onFailed?.(failed.job);
      return { outcome: failed.deadLettered ? "dead_letter" : "retry_scheduled", job: failed.job };
    }
  }

  private async resolveSourceUrl(job: AssetIngestJob): Promise<string> {
    if (!job.remoteArtifactRef) return job.sourceUrl;
    const resolver = this.options.providerArtifactResolver;
    if (!resolver) throw new AssetIngestFailure("source_unavailable", true);
    let resolution;
    try {
      resolution = await resolver.resolveArtifact({
        jobId: job.id,
        tenantId: job.tenantId,
        renderJobId: job.renderJobId,
        remoteArtifactRef: job.remoteArtifactRef,
        expectedMimeType: job.expectedMimeType,
      });
    } catch {
      throw new AssetIngestFailure("source_unavailable", true);
    }
    if (resolution.remoteArtifactRef !== job.remoteArtifactRef
      || resolution.mediaType !== job.expectedMimeType
      || resolution.sourceUrlPolicy !== "ephemeral_refresh_via_provider_get"
      || !safeEphemeralSourceUrl(resolution.sourceUrl)) {
      throw new AssetIngestFailure("source_unavailable", true);
    }
    return resolution.sourceUrl;
  }

  async reconcileCompletedUnlinked(limit = 100): Promise<{ linked: number; remaining: number }> {
    const jobs = await this.options.repository.listCompletedUnlinked(limit);
    if (!this.options.hooks?.onCompleted) return { linked: 0, remaining: jobs.length };
    let linked = 0;
    for (const job of jobs) {
      try {
        const materialized = await this.options.hooks.onCompleted(job);
        if (!materialized || !materialized.mediaAssetId) continue;
        const attached = await this.options.repository.attachMediaAsset({
          tenantId: job.tenantId,
          jobId: job.id,
          mediaAssetId: materialized.mediaAssetId,
          nowMs: this.now.now(),
        });
        if (attached?.mediaAssetId === materialized.mediaAssetId) linked += 1;
      } catch {
        // Safe codes and bounded scans keep the next reconciliation pass retryable.
      }
    }
    return { linked, remaining: jobs.length - linked };
  }
}

export function temporaryAssetKey(job: Pick<AssetIngestJob, "tenantId" | "renderJobId" | "id">) {
  const safe = (value: string) => encodeURIComponent(value).replaceAll("%", "_");
  let tenantSegment: string;
  try {
    tenantSegment = storageTenantSegment(job.tenantId);
  } catch {
    // Legacy in-memory repositories may still use a plain tenant key. Production S3
    // validates structured tenants and fails closed if such a key reaches its boundary.
    tenantSegment = safe(job.tenantId);
  }
  return `ai-media-studio/${tenantSegment}/ingest/${safe(job.renderJobId)}-${safe(job.id)}.tmp`;
}

function normalizeMime(value: string) { return value.split(";", 1)[0].trim().toLowerCase(); }

function safeEphemeralSourceUrl(value: string): boolean {
  if (!value || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname) && !url.hash;
  } catch {
    return false;
  }
}

function appendPrefix(current: Uint8Array, chunk: Uint8Array, limit: number) {
  const take = Math.min(limit - current.byteLength, chunk.byteLength);
  const output = new Uint8Array(current.byteLength + take);
  output.set(current);
  output.set(chunk.subarray(0, take), current.byteLength);
  return output;
}

/** ISO BMFF begins with a bounded-size ftyp box; accepted compatible brands remain provider-neutral. */
export function hasMp4FileTypeBox(prefix: Uint8Array) {
  if (prefix.byteLength < 12) return false;
  const boxSize = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(0, false);
  if (boxSize < 8 || boxSize > 16_777_216) return false;
  if (String.fromCharCode(...prefix.subarray(4, 8)) !== "ftyp") return false;
  const majorBrand = String.fromCharCode(...prefix.subarray(8, 12));
  return new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "MSNV", "3gp4", "3gp5", "3g2a"]).has(majorBrand);
}

function validateSourcePolicy(policy: ExactHostSsrfPolicy) {
  if (!policy.requireHttps || !policy.requireStandardPort) throw new Error("Artifact source policy must require HTTPS on the standard port");
  if (!Number.isInteger(policy.maxRedirects) || policy.maxRedirects < 0 || policy.maxRedirects > 10) throw new Error("Artifact source redirect bound is invalid");
  if (policy.allowedHosts.size === 0) throw new Error("At least one exact artifact host is required");
  for (const host of policy.allowedHosts) {
    if (!host || host !== host.toLowerCase() || host.includes("*") || host.includes("/") || host.includes(":")) {
      throw new Error("Artifact source hosts must be exact lowercase hostnames");
    }
  }
}

function retryDelay(attempt: number, retry: { baseDelayMs: number; maxDelayMs: number }) {
  return Math.min(retry.maxDelayMs, retry.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

async function storageCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new AssetIngestFailure("storage_failed", true);
  }
}

/** Never persists raw provider errors, URLs, query strings, credentials, or response bodies. */
function classifyFailure(error: unknown): { code: AssetIngestErrorCode; retryable: boolean } {
  if (error instanceof AssetIngestFailure) return { code: error.code, retryable: error.retryable };
  return { code: "ingest_failed", retryable: true };
}
