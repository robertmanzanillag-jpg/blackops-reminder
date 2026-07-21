export type AssetIngestState = "queued" | "leased" | "retry_wait" | "completed" | "dead_letter";

export interface AssetIngestJob {
  id: string;
  tenantId: string;
  renderJobId: string;
  sourceUrl: string;
  expectedMimeType: "video/mp4";
  state: AssetIngestState;
  attempt: number;
  maxAttempts: number;
  leaseRecoveries: number;
  maxLeaseRecoveries: number;
  availableAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAtMs?: number;
  ownedObjectKey?: string;
  sha256?: string;
  sizeBytes?: number;
  mediaAssetId?: string;
  lastErrorCode?: AssetIngestErrorCode;
  deadLetteredAtMs?: number;
}

export interface EnqueueAssetIngest {
  id: string;
  tenantId: string;
  renderJobId: string;
  sourceUrl: string;
  expectedMimeType?: "video/mp4";
  maxAttempts: number;
  maxLeaseRecoveries?: number;
  availableAtMs?: number;
}

export interface ClaimedAssetIngest {
  job: AssetIngestJob;
  leaseToken: string;
}

export interface AssetLeaseRecovery {
  jobId: string;
  previousOwner: string;
  deadLettered: boolean;
}

export interface AssetIngestFailureResult {
  job: AssetIngestJob;
  deadLettered: boolean;
}

/** Durable implementations must make claims and every fenced mutation atomic. */
export interface AssetIngestRepository {
  enqueue(input: EnqueueAssetIngest, nowMs: number): Promise<AssetIngestJob>;
  getForTenant(tenantId: string, jobId: string): Promise<AssetIngestJob | undefined>;
  findByRenderJob(tenantId: string, renderJobId: string): Promise<AssetIngestJob | undefined>;
  claimDue(input: { workerId: string; nowMs: number; leaseDurationMs: number }): Promise<ClaimedAssetIngest | undefined>;
  complete(input: {
    jobId: string;
    leaseToken: string;
    ownedObjectKey: string;
    sha256: string;
    sizeBytes: number;
    nowMs: number;
  }): Promise<AssetIngestJob | undefined>;
  attachMediaAsset(input: {
    tenantId: string;
    jobId: string;
    mediaAssetId: string;
    nowMs: number;
  }): Promise<AssetIngestJob | undefined>;
  /** Internal reconciliation scan; durable implementations must enforce a bounded limit. */
  listCompletedUnlinked(limit: number): Promise<AssetIngestJob[]>;
  fail(input: {
    jobId: string;
    leaseToken: string;
    errorCode: AssetIngestErrorCode;
    retryable: boolean;
    retryAtMs: number;
    nowMs: number;
  }): Promise<AssetIngestFailureResult | undefined>;
  reconcileExpiredLeases(nowMs: number): Promise<AssetLeaseRecovery[]>;
  listDeadLetters(tenantId: string): Promise<AssetIngestJob[]>;
}

export interface ExactHostSsrfPolicy {
  /** Lowercase exact hostnames only; suffix/wildcard matching is forbidden. */
  allowedHosts: ReadonlySet<string>;
  requireHttps: true;
  requireStandardPort: true;
  maxRedirects: number;
  /** Resolve every redirect target and reject private, reserved, loopback, and link-local addresses. */
  resolvePublicAddresses(hostname: string): Promise<readonly string[]>;
}

export interface ArtifactReadRequest {
  url: string;
  policy: ExactHostSsrfPolicy;
  maxBytes: number;
  maxChunkBytes: number;
}

export interface ArtifactReadStream {
  finalUrl: string;
  mimeType: string;
  declaredSizeBytes?: number;
  chunks: AsyncIterable<Uint8Array>;
  /** Immediately releases the underlying response when a consumer rejects before or during iteration. */
  abort(): void;
}

/** Implementations must pin approved DNS addresses, validate every redirect, and stop at both bounds. */
export interface BoundedArtifactReader {
  open(request: ArtifactReadRequest): Promise<ArtifactReadStream>;
}

export interface OwnedObjectUpload {
  write(chunk: Uint8Array): Promise<void>;
  /** Atomically promotes to a tenant-scoped content-addressed key, or reuses the identical object. */
  commit(metadata: { mimeType: "video/mp4"; sizeBytes: number; sha256: string }): Promise<{
    finalObjectKey: string;
    reused: boolean;
  }>;
  abort(): Promise<void>;
}

/** Temporary uploads must never become delivery-visible before content-addressed commit. */
export interface OwnedObjectStorage {
  beginUpload(input: { tenantId: string; temporaryObjectKey: string }): Promise<OwnedObjectUpload>;
}

export interface AssetDeliverySigner {
  sign(input: { tenantId: string; objectKey: string; expiresInSeconds: number }): Promise<string>;
}

export type AssetIngestErrorCode =
  | "source_rejected"
  | "source_unavailable"
  | "mime_rejected"
  | "size_exceeded"
  | "chunk_exceeded"
  | "invalid_mp4"
  | "storage_failed"
  | "ingest_failed";

export class AssetIngestFailure extends Error {
  constructor(
    readonly code: AssetIngestErrorCode,
    readonly retryable: boolean,
    message: string = code,
  ) {
    super(message);
    this.name = "AssetIngestFailure";
  }
}
