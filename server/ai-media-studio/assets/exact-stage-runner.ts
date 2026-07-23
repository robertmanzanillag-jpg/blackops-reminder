import { createHash } from "node:crypto";
import type { ExactOneVideoStageContext, ExactOneVideoStageResult } from "../workers/one-video-run-once-executor";
import { AssetIngestFailure } from "./contracts";
import type {
  ArtifactReadStream,
  AssetIngestErrorCode,
  AssetIngestJob,
  BoundedArtifactReader,
  ExactHostSsrfPolicy,
  OwnedObjectStorage,
  ProviderArtifactResolver,
} from "./contracts";
import type {
  ExactAssetIngestClaim,
  ExactAssetIngestClaimResult,
  ExactAssetIngestFailureResult,
  ExactAssetLinkClaim,
} from "./drizzle-exact-asset-ingest-repository";
import { hasMp4FileTypeBox, temporaryAssetKey } from "./worker";

export interface ExactAssetStageTarget {
  readonly ingestJobId: string;
}

export interface ExactAssetStageTargetLoader {
  loadIngestTarget(context: ExactOneVideoStageContext): Promise<ExactAssetStageTarget | undefined>;
  loadLinkTarget(context: ExactOneVideoStageContext): Promise<ExactAssetStageTarget | undefined>;
}

export interface ExactAssetStageRepository {
  claimExactIngest(
    context: ExactOneVideoStageContext,
    input: { ingestJobId: string; workerId: string; leaseDurationMs: number },
  ): Promise<ExactAssetIngestClaimResult>;
  completeExactIngest(
    context: ExactOneVideoStageContext,
    claim: ExactAssetIngestClaim,
    outcome: { ownedObjectKey: string; sha256: string; sizeBytes: number },
  ): Promise<boolean>;
  failExactIngest(
    context: ExactOneVideoStageContext,
    claim: ExactAssetIngestClaim,
    outcome: { errorCode: AssetIngestErrorCode; retryable: boolean; retryAt: string },
  ): Promise<ExactAssetIngestFailureResult>;
  loadExactLink(
    context: ExactOneVideoStageContext,
    input: { ingestJobId: string },
  ): Promise<ExactAssetLinkClaim | undefined>;
  recordExactLink(
    context: ExactOneVideoStageContext,
    claim: ExactAssetLinkClaim,
    input: { mediaAssetId: string },
  ): Promise<boolean>;
}

export interface ExactAssetStageRunnerHooks {
  /** Idempotently materializes or reuses the canonical media asset for this exact completed owned object. */
  onCompleted?(job: AssetIngestJob): void | { mediaAssetId: string } | Promise<void | { mediaAssetId: string }>;
  onFailed?(job: AssetIngestJob): void | Promise<void>;
  onLeaseLost?(job: AssetIngestJob): void | Promise<void>;
}

export interface ExactAssetStageRunnerOptions {
  workerId: string;
  repository: ExactAssetStageRepository;
  targets: ExactAssetStageTargetLoader;
  reader: BoundedArtifactReader;
  providerArtifactResolver?: ProviderArtifactResolver;
  sourcePolicy: ExactHostSsrfPolicy;
  storage: OwnedObjectStorage;
  leaseDurationMs: number;
  maxArtifactBytes: number;
  maxChunkBytes: number;
  retry: { baseDelayMs: number; maxDelayMs: number };
  clock?: { now(): number };
  hooks?: ExactAssetStageRunnerHooks;
}

const systemClock = { now: () => Date.now() };

/**
 * Exact one-video asset stages.
 *
 * This runner deliberately has no `runNext`, no due-queue scan, no publishing
 * method, no timer/autostart, and no `listCompletedUnlinked` reconciliation.
 * The caller must already hold a PR32 exact-run fence; every repository method
 * receives that full stage context plus one target-bound ingest job id.
 */
export class ExactAssetStageRunner {
  readonly autostart = false;
  readonly publishingAvailable = false;

  private readonly now: { now(): number };

  constructor(private readonly options: ExactAssetStageRunnerOptions) {
    if (!options.workerId || options.workerId !== options.workerId.trim()) {
      throw new Error("Exact asset stage worker id is required");
    }
    if (!Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
      throw new Error("Exact asset stage lease duration is invalid");
    }
    if (!Number.isInteger(options.maxArtifactBytes) || !Number.isInteger(options.maxChunkBytes)
      || options.maxArtifactBytes < 1 || options.maxChunkBytes < 1
      || options.maxChunkBytes > options.maxArtifactBytes) {
      throw new Error("Exact asset stage byte bounds are invalid");
    }
    if (options.retry.baseDelayMs < 0 || options.retry.maxDelayMs < options.retry.baseDelayMs) {
      throw new Error("Exact asset stage retry bounds are invalid");
    }
    validateSourcePolicy(options.sourcePolicy);
    this.now = options.clock ?? systemClock;
  }

  async ingestAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "ingest_asset");
    const target = await this.options.targets.loadIngestTarget(context);
    if (!target) return exactResult(context, "idle");
    const claimed = await this.options.repository.claimExactIngest(context, {
      ingestJobId: target.ingestJobId,
      workerId: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs,
    });
    if (claimed.kind === "idle") return exactResult(context, "idle");
    if (claimed.kind === "dead_letter") return exactResult(context, "dead_letter");
    return this.processClaimedIngest(context, claimed.claim);
  }

  async linkAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "link_asset");
    const target = await this.options.targets.loadLinkTarget(context);
    if (!target) return exactResult(context, "idle");
    const claim = await this.options.repository.loadExactLink(context, { ingestJobId: target.ingestJobId });
    if (!claim) return exactResult(context, "idle");
    if (claim.linkState === "linked") return exactResult(context, "asset_linked");
    if (!this.options.hooks?.onCompleted) return exactResult(context, "asset_completed_unlinked");
    const job = completedJobFromLinkClaim(claim);
    try {
      const materialized = await this.options.hooks.onCompleted(job);
      if (!materialized?.mediaAssetId) return exactResult(context, "asset_completed_unlinked");
      const applied = await this.options.repository.recordExactLink(context, claim, {
        mediaAssetId: materialized.mediaAssetId,
      });
      return exactResult(context, applied ? "asset_linked" : "asset_completed_unlinked");
    } catch {
      return exactResult(context, "asset_completed_unlinked");
    }
  }

  private async processClaimedIngest(
    context: ExactOneVideoStageContext,
    claim: ExactAssetIngestClaim,
  ): Promise<ExactOneVideoStageResult> {
    const job = leasedJobFromClaim(claim);
    const temporaryObjectKey = temporaryAssetKey(job);
    let upload: Awaited<ReturnType<OwnedObjectStorage["beginUpload"]>> | undefined;
    let artifact: ArtifactReadStream | undefined;
    try {
      const sourceUrl = await this.resolveSourceUrl(job);
      artifact = await this.options.reader.open({
        url: sourceUrl,
        policy: this.options.sourcePolicy,
        maxBytes: this.options.maxArtifactBytes,
        maxChunkBytes: this.options.maxChunkBytes,
      });
      if (normalizeMime(artifact.mimeType) !== job.expectedMimeType) {
        throw new AssetIngestFailure("mime_rejected", false);
      }
      if (artifact.declaredSizeBytes !== undefined
        && (!Number.isSafeInteger(artifact.declaredSizeBytes)
          || artifact.declaredSizeBytes < 0
          || artifact.declaredSizeBytes > this.options.maxArtifactBytes)) {
        throw new AssetIngestFailure("size_exceeded", false);
      }
      upload = await storageCall(() => this.options.storage.beginUpload({
        tenantId: job.tenantId,
        temporaryObjectKey,
      }));
      const digest = createHash("sha256");
      let sizeBytes = 0;
      let prefix = new Uint8Array();
      for await (const chunk of artifact.chunks) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) continue;
        if (chunk.byteLength > this.options.maxChunkBytes) {
          throw new AssetIngestFailure("chunk_exceeded", false);
        }
        sizeBytes += chunk.byteLength;
        if (sizeBytes > this.options.maxArtifactBytes) {
          throw new AssetIngestFailure("size_exceeded", false);
        }
        if (prefix.byteLength < 12) prefix = appendPrefix(prefix, chunk, 12);
        digest.update(chunk);
        await storageCall(() => upload!.write(chunk));
      }
      if (artifact.declaredSizeBytes !== undefined && artifact.declaredSizeBytes !== sizeBytes) {
        throw new AssetIngestFailure("size_exceeded", false);
      }
      if (!hasMp4FileTypeBox(prefix)) throw new AssetIngestFailure("invalid_mp4", false);
      const sha256 = digest.digest("hex");
      const committed = await storageCall(() => upload!.commit({
        mimeType: "video/mp4",
        sizeBytes,
        sha256,
      }));
      upload = undefined;
      if (!committed.finalObjectKey) throw new AssetIngestFailure("storage_failed", true);
      const applied = await this.options.repository.completeExactIngest(context, claim, {
        ownedObjectKey: committed.finalObjectKey,
        sha256,
        sizeBytes,
      });
      if (!applied) {
        await this.options.hooks?.onLeaseLost?.(job);
        return exactResult(context, "lease_lost");
      }
      return exactResult(context, "asset_completed_unlinked");
    } catch (error) {
      try {
        artifact?.abort();
      } catch {
        // Cleanup failures must not replace the safe ingest classification.
      }
      await upload?.abort().catch(() => undefined);
      const failure = classifyFailure(error);
      const failed = await this.options.repository.failExactIngest(context, claim, {
        errorCode: failure.code,
        retryable: failure.retryable,
        retryAt: new Date(this.now.now() + retryDelay(job.attempt, this.options.retry)).toISOString(),
      });
      if (!failed.applied) {
        await this.options.hooks?.onLeaseLost?.(job);
        return exactResult(context, "lease_lost");
      }
      const failedJob = {
        ...job,
        state: failed.state,
        lastErrorCode: failure.code,
        updatedAtMs: this.now.now(),
      } as AssetIngestJob;
      await this.options.hooks?.onFailed?.(failedJob);
      return exactResult(context, failed.state === "dead_letter" ? "dead_letter" : "retry_scheduled");
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
}

function leasedJobFromClaim(claim: ExactAssetIngestClaim): AssetIngestJob {
  return {
    id: claim.ingestJobId,
    tenantId: structuredTenantKey(claim.scope),
    renderJobId: claim.renderJobId,
    remoteArtifactRef: claim.remoteArtifactRef,
    sourceUrl: claim.sourceUrl,
    expectedMimeType: claim.expectedMimeType,
    state: "leased",
    attempt: claim.attempt,
    maxAttempts: claim.maxAttempts,
    leaseRecoveries: 0,
    maxLeaseRecoveries: claim.maxAttempts,
    availableAtMs: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    leaseOwner: claim.leaseOwner,
    leaseToken: claim.leaseToken,
    leaseExpiresAtMs: new Date(claim.leaseExpiresAt).getTime(),
  };
}

function completedJobFromLinkClaim(claim: ExactAssetLinkClaim): AssetIngestJob {
  return {
    id: claim.ingestJobId,
    tenantId: structuredTenantKey(claim.scope),
    renderJobId: claim.renderJobId,
    sourceUrl: "https://completed.local/owned-artifact.mp4",
    expectedMimeType: "video/mp4",
    state: "completed",
    attempt: 1,
    maxAttempts: 1,
    leaseRecoveries: 0,
    maxLeaseRecoveries: 1,
    availableAtMs: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    ownedObjectKey: claim.ownedObjectKey,
    sha256: claim.sha256,
    sizeBytes: claim.sizeBytes,
    ...(claim.mediaAssetId ? { mediaAssetId: claim.mediaAssetId } : {}),
  };
}

function structuredTenantKey(scope: { ownerUserId: string; workspaceId: string }) {
  return JSON.stringify([scope.workspaceId, scope.ownerUserId]);
}

function exactResult(
  context: ExactOneVideoStageContext,
  outcome: ExactOneVideoStageResult["outcome"],
): ExactOneVideoStageResult {
  return Object.freeze({ target: context.target, action: context.action, outcome });
}

function assertAction(
  context: ExactOneVideoStageContext,
  action: "ingest_asset" | "link_asset",
): void {
  if (!context || context.action !== action) {
    throw new Error(`Invalid ${action} exact asset stage context`);
  }
}

function normalizeMime(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function safeEphemeralSourceUrl(value: string): boolean {
  if (!value || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && Boolean(url.hostname) && !url.hash;
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

function validateSourcePolicy(policy: ExactHostSsrfPolicy) {
  if (!policy.requireHttps || !policy.requireStandardPort) {
    throw new Error("Exact asset stage source policy must require HTTPS on the standard port");
  }
  if (!Number.isInteger(policy.maxRedirects) || policy.maxRedirects < 0 || policy.maxRedirects > 10) {
    throw new Error("Exact asset stage redirect bound is invalid");
  }
  if (policy.allowedHosts.size === 0) throw new Error("At least one exact artifact host is required");
  for (const host of policy.allowedHosts) {
    if (!host || host !== host.toLowerCase() || host.includes("*") || host.includes("/") || host.includes(":")) {
      throw new Error("Exact asset source hosts must be exact lowercase hostnames");
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
