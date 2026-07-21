import { randomUUID } from "node:crypto";
import type {
  AssetIngestFailureResult,
  AssetIngestJob,
  AssetIngestRepository,
  AssetLeaseRecovery,
  ClaimedAssetIngest,
  EnqueueAssetIngest,
} from "./contracts";

const clone = (job: AssetIngestJob): AssetIngestJob => ({ ...job });

export class InMemoryAssetIngestRepository implements AssetIngestRepository {
  private readonly jobs = new Map<string, AssetIngestJob>();
  private readonly renderKeys = new Map<string, string>();

  async enqueue(input: EnqueueAssetIngest, nowMs: number): Promise<AssetIngestJob> {
    if (!input.id || !input.tenantId || !input.renderJobId) throw new Error("Asset ingest identity is required");
    if (input.remoteArtifactRef !== undefined
      && (input.remoteArtifactRef.length < 1 || input.remoteArtifactRef.length > 1_000
        || input.remoteArtifactRef !== input.remoteArtifactRef.trim()
        || /[\u0000-\u001f\u007f-\u009f]/u.test(input.remoteArtifactRef))) {
      throw new Error("Asset ingest remote artifact identity is invalid");
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error("maxAttempts must be positive");
    const renderKey = `${input.tenantId}\0${input.renderJobId}`;
    const existingId = this.renderKeys.get(renderKey);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      if (existing.sourceUrl !== input.sourceUrl || existing.remoteArtifactRef !== input.remoteArtifactRef
        || existing.expectedMimeType !== (input.expectedMimeType ?? "video/mp4")) {
        throw new Error("renderJobId is already associated with different ingest input");
      }
      return clone(existing);
    }
    if (this.jobs.has(input.id)) throw new Error("Asset ingest id already exists");
    const job: AssetIngestJob = {
      id: input.id,
      tenantId: input.tenantId,
      renderJobId: input.renderJobId,
      ...(input.remoteArtifactRef ? { remoteArtifactRef: input.remoteArtifactRef } : {}),
      sourceUrl: input.sourceUrl,
      expectedMimeType: input.expectedMimeType ?? "video/mp4",
      state: "queued",
      attempt: 0,
      maxAttempts: input.maxAttempts,
      leaseRecoveries: 0,
      maxLeaseRecoveries: input.maxLeaseRecoveries ?? input.maxAttempts,
      availableAtMs: input.availableAtMs ?? nowMs,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    this.jobs.set(job.id, job);
    this.renderKeys.set(renderKey, job.id);
    return clone(job);
  }

  async getForTenant(tenantId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    return job?.tenantId === tenantId ? clone(job) : undefined;
  }

  async findByRenderJob(tenantId: string, renderJobId: string) {
    const id = this.renderKeys.get(`${tenantId}\0${renderJobId}`);
    return id ? clone(this.jobs.get(id)!) : undefined;
  }

  async claimDue(input: { workerId: string; nowMs: number; leaseDurationMs: number }): Promise<ClaimedAssetIngest | undefined> {
    if (!input.workerId || input.leaseDurationMs <= 0) throw new Error("Valid worker lease settings are required");
    const job = [...this.jobs.values()]
      .filter((candidate) => (candidate.state === "queued" || candidate.state === "retry_wait") && candidate.availableAtMs <= input.nowMs)
      .sort((left, right) => left.availableAtMs - right.availableAtMs || left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id))[0];
    if (!job) return undefined;
    const leaseToken = randomUUID();
    job.state = "leased";
    job.attempt += 1;
    job.leaseOwner = input.workerId;
    job.leaseToken = leaseToken;
    job.leaseExpiresAtMs = input.nowMs + input.leaseDurationMs;
    job.updatedAtMs = input.nowMs;
    return { job: clone(job), leaseToken };
  }

  async complete(input: { jobId: string; leaseToken: string; ownedObjectKey: string; sha256: string; sizeBytes: number; nowMs: number }) {
    const job = this.activeLease(input.jobId, input.leaseToken, input.nowMs);
    if (!job) return undefined;
    Object.assign(job, {
      state: "completed" as const,
      ownedObjectKey: input.ownedObjectKey,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      updatedAtMs: input.nowMs,
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAtMs: undefined,
      lastErrorCode: undefined,
    });
    return clone(job);
  }

  async attachMediaAsset(input: { tenantId: string; jobId: string; mediaAssetId: string; nowMs: number }) {
    if (!input.mediaAssetId) throw new Error("mediaAssetId is required");
    const job = this.jobs.get(input.jobId);
    if (!job || job.tenantId !== input.tenantId || job.state !== "completed") return undefined;
    if (job.mediaAssetId && job.mediaAssetId !== input.mediaAssetId) throw new Error("Asset ingest job is already linked to a different media asset");
    if (!job.mediaAssetId) {
      job.mediaAssetId = input.mediaAssetId;
      job.updatedAtMs = input.nowMs;
    }
    return clone(job);
  }

  async listCompletedUnlinked(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Completed-unlinked limit must be between 1 and 100");
    return [...this.jobs.values()]
      .filter((job) => job.state === "completed" && !job.mediaAssetId)
      .sort((left, right) => left.updatedAtMs - right.updatedAtMs || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(clone);
  }

  async fail(input: { jobId: string; leaseToken: string; errorCode: AssetIngestJob["lastErrorCode"]; retryable: boolean; retryAtMs: number; nowMs: number }): Promise<AssetIngestFailureResult | undefined> {
    const job = this.activeLease(input.jobId, input.leaseToken, input.nowMs);
    if (!job || !input.errorCode) return undefined;
    const deadLettered = !input.retryable || job.attempt >= job.maxAttempts;
    Object.assign(job, {
      state: deadLettered ? "dead_letter" as const : "retry_wait" as const,
      availableAtMs: input.retryAtMs,
      updatedAtMs: input.nowMs,
      lastErrorCode: input.errorCode,
      deadLetteredAtMs: deadLettered ? input.nowMs : undefined,
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAtMs: undefined,
    });
    return { job: clone(job), deadLettered };
  }

  async reconcileExpiredLeases(nowMs: number): Promise<AssetLeaseRecovery[]> {
    const recovered: AssetLeaseRecovery[] = [];
    for (const job of this.jobs.values()) {
      if (job.state !== "leased" || job.leaseExpiresAtMs === undefined || job.leaseExpiresAtMs > nowMs) continue;
      const previousOwner = job.leaseOwner ?? "unknown";
      job.leaseRecoveries += 1;
      const deadLettered = job.leaseRecoveries >= job.maxLeaseRecoveries;
      Object.assign(job, {
        state: deadLettered ? "dead_letter" as const : "queued" as const,
        availableAtMs: nowMs,
        updatedAtMs: nowMs,
        lastErrorCode: deadLettered ? "ingest_failed" as const : job.lastErrorCode,
        deadLetteredAtMs: deadLettered ? nowMs : undefined,
        leaseOwner: undefined,
        leaseToken: undefined,
        leaseExpiresAtMs: undefined,
      });
      recovered.push({ jobId: job.id, previousOwner, deadLettered });
    }
    return recovered;
  }

  async listDeadLetters(tenantId: string) {
    return [...this.jobs.values()].filter((job) => job.tenantId === tenantId && job.state === "dead_letter").map(clone);
  }

  private activeLease(id: string, token: string, nowMs: number) {
    const job = this.jobs.get(id);
    if (!job || job.state !== "leased" || job.leaseToken !== token || (job.leaseExpiresAtMs ?? 0) <= nowMs) return undefined;
    return job;
  }
}
