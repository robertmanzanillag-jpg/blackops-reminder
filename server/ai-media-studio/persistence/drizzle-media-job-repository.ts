import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  aiMediaOutbox,
  aiMediaRenderJobs,
  aiMediaWebhookEvents,
  type AiMediaRenderJobRow,
} from "../../../shared/models/ai-media-studio-db";
import { MediaJobStateConflictError, type GenerationRequest, type MediaGenerationJob, type ProviderWebhookEvent } from "../domain";
import type { MediaJobRepository } from "../ports";
import { mapRenderJobRow } from "./mapping";

export interface DrizzleMediaJobRepositoryOptions {
  /** Workspace scoping is explicit now, without changing the current port. */
  workspaceId?: string;
}

// The current application creates Drizzle without its optional relational
// `schema` argument. Using the base database type keeps this adapter directly
// compatible while all queries still reference strongly typed tables.
export type AiMediaStudioDrizzleDatabase = NodePgDatabase;

const DEFAULT_WORKSPACE_ID = "personal";
const UNRESOLVED_WEBHOOK_OWNER = "unresolved:webhook";

function asJsonObject(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function resultFields(job: MediaGenerationJob): Record<string, unknown> {
  return {
    ...(job.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: job.estimatedCostUsd }),
    ...(job.actualCostUsd === undefined ? {} : { actualCostUsd: job.actualCostUsd }),
    ...(job.influencerName === undefined ? {} : { influencerName: job.influencerName }),
    ...(job.estimatedCompletionAt === undefined ? {} : { estimatedCompletionAt: job.estimatedCompletionAt }),
    ...(job.lastProviderEventAt === undefined ? {} : { lastProviderEventAt: job.lastProviderEventAt }),
  };
}

function mapRepositoryRow(row: AiMediaRenderJobRow): MediaGenerationJob {
  return {
    ...mapRenderJobRow(row),
    availableAt: row.availableAt?.toISOString(),
    leaseOwner: row.leaseOwner ?? undefined,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
    deadLetterAt: row.deadLetterAt?.toISOString(),
  };
}

export function durableQueueResetFields(job: MediaGenerationJob, now: Date) {
  if (job.status !== "pending" || job.stage !== "queued") return {};
  return {
    availableAt: now,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    deadLetterAt: null,
    queuedAt: now,
  };
}

/**
 * PostgreSQL/Drizzle implementation of the existing MediaJobRepository port.
 * It remains isolated so the composition root can opt in without coupling the
 * service or providers to a database driver.
 */
export class DrizzleMediaJobRepository implements MediaJobRepository {
  private readonly workspaceId: string;

  constructor(
    private readonly db: AiMediaStudioDrizzleDatabase,
    options: DrizzleMediaJobRepositoryOptions = {},
  ) {
    this.workspaceId = options.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
  }

  async create(ownerUserId: string, request: GenerationRequest): Promise<MediaGenerationJob> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(aiMediaRenderJobs)
        .where(
          and(
            eq(aiMediaRenderJobs.ownerUserId, ownerUserId),
            eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
            eq(aiMediaRenderJobs.idempotencyKey, request.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing[0]) return mapRepositoryRow(existing[0]);

      const now = new Date();
      const id = randomUUID();
      const [created] = await tx
        .insert(aiMediaRenderJobs)
        .values({
          id,
          generationId: randomUUID(),
          ownerUserId,
          workspaceId: this.workspaceId,
          idempotencyKey: request.idempotencyKey,
          title: request.script.trim().slice(0, 80),
          request: asJsonObject(request),
          governanceProfileId: request.governance?.profileId ?? null,
          governanceEvidenceDigest: request.governance?.evidenceDigest ?? null,
          status: "pending",
          stage: "queued",
          progress: 0,
          attempts: 0,
          retryCount: 0,
          maxAttempts: 3,
          queuedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            aiMediaRenderJobs.ownerUserId,
            aiMediaRenderJobs.workspaceId,
            aiMediaRenderJobs.idempotencyKey,
          ],
        })
        .returning();

      if (!created) {
        const [raced] = await tx
          .select()
          .from(aiMediaRenderJobs)
          .where(
            and(
              eq(aiMediaRenderJobs.ownerUserId, ownerUserId),
              eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
              eq(aiMediaRenderJobs.idempotencyKey, request.idempotencyKey),
            ),
          )
          .limit(1);
        if (!raced) throw new Error("Media job idempotency conflict could not be resolved");
        return mapRepositoryRow(raced);
      }

      await tx.insert(aiMediaOutbox).values({
        ownerUserId,
        workspaceId: this.workspaceId,
        idempotencyKey: `render-job.created:${created.id}`,
        aggregateType: "render_job",
        aggregateId: created.id,
        eventType: "ai_media.render_job.created",
        payload: { jobId: created.id, generationId: created.generationId },
      });

      return mapRepositoryRow(created);
    });
  }

  async list(ownerUserId: string): Promise<MediaGenerationJob[]> {
    const rows = await this.db
      .select()
      .from(aiMediaRenderJobs)
      .where(
        and(
          eq(aiMediaRenderJobs.ownerUserId, ownerUserId),
          eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
        ),
      )
      .orderBy(desc(aiMediaRenderJobs.createdAt));
    return rows.map(mapRepositoryRow);
  }

  async get(ownerUserId: string, jobId: string): Promise<MediaGenerationJob | undefined> {
    const [row] = await this.db
      .select()
      .from(aiMediaRenderJobs)
      .where(
        and(
          eq(aiMediaRenderJobs.id, jobId),
          eq(aiMediaRenderJobs.ownerUserId, ownerUserId),
          eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ? mapRepositoryRow(row) : undefined;
  }

  async getByIdempotencyKey(
    ownerUserId: string,
    idempotencyKey: string,
  ): Promise<MediaGenerationJob | undefined> {
    const [row] = await this.db
      .select()
      .from(aiMediaRenderJobs)
      .where(
        and(
          eq(aiMediaRenderJobs.ownerUserId, ownerUserId),
          eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
          eq(aiMediaRenderJobs.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ? mapRepositoryRow(row) : undefined;
  }

  async getByProviderJob(providerKey: string, providerJobId: string): Promise<MediaGenerationJob | undefined> {
    const [row] = await this.db
      .select()
      .from(aiMediaRenderJobs)
      .where(
        and(
          eq(aiMediaRenderJobs.providerKey, providerKey),
          eq(aiMediaRenderJobs.providerJobId, providerJobId),
          eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return row ? mapRepositoryRow(row) : undefined;
  }

  async update(job: MediaGenerationJob): Promise<MediaGenerationJob> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: aiMediaRenderJobs.id,
          result: aiMediaRenderJobs.result,
          status: aiMediaRenderJobs.status,
          stage: aiMediaRenderJobs.stage,
        })
        .from(aiMediaRenderJobs)
        .where(
          and(
            eq(aiMediaRenderJobs.id, job.id),
            eq(aiMediaRenderJobs.ownerUserId, job.ownerUserId),
            eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
          ),
        )
        .limit(1);
      if (!current) throw new Error("Media job not found");

      const now = new Date();
      const isCancellationTransition = job.status === "cancelled" && current.status !== "cancelled";
      const updatePredicates = [
        eq(aiMediaRenderJobs.id, job.id),
        eq(aiMediaRenderJobs.ownerUserId, job.ownerUserId),
        eq(aiMediaRenderJobs.workspaceId, this.workspaceId),
      ];
      if (isCancellationTransition) {
        updatePredicates.push(
          eq(aiMediaRenderJobs.status, "pending"),
          eq(aiMediaRenderJobs.stage, "queued"),
        );
      }
      const [saved] = await tx
        .update(aiMediaRenderJobs)
        .set({
          providerKey: job.providerName ?? null,
          providerJobId: job.providerJobId ?? null,
          status: job.status,
          stage: job.stage ?? job.status,
          progress: job.progress,
          attempts: job.attempts,
          retryCount: job.retryCount,
          maxAttempts: job.maxAttempts,
          outputUrl: job.outputUrl ?? null,
          outputMediaAssetId: job.outputAssetId ?? null,
          errorMessage: job.error ?? null,
          request: asJsonObject(job.request),
          governanceProfileId: job.request.governance?.profileId ?? null,
          governanceEvidenceDigest: job.request.governance?.evidenceDigest ?? null,
          // Queue fencing/recovery metadata shares this JSON document. Domain
          // projection updates must never erase it.
          result: { ...(current.result ?? {}), ...resultFields(job) },
          startedAt: job.startedAt ? new Date(job.startedAt) : null,
          completedAt: job.completedAt ? new Date(job.completedAt) : null,
          ...durableQueueResetFields(job, now),
          updatedAt: now,
        })
        .where(and(...updatePredicates))
        .returning();
      if (!saved) {
        if (isCancellationTransition) throw new MediaJobStateConflictError();
        throw new Error("Media job not found");
      }

      await tx
        .insert(aiMediaOutbox)
        .values({
          ownerUserId: job.ownerUserId,
          workspaceId: this.workspaceId,
          idempotencyKey: `render-job.updated:${saved.id}:${saved.updatedAt.toISOString()}`,
          aggregateType: "render_job",
          aggregateId: saved.id,
          eventType: `ai_media.render_job.${saved.status}`,
          payload: { jobId: saved.id, status: saved.status, progress: saved.progress },
        })
        .onConflictDoNothing();

      return mapRepositoryRow(saved);
    });
  }

  async recordWebhook(event: ProviderWebhookEvent): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({
          id: aiMediaRenderJobs.id,
          ownerUserId: aiMediaRenderJobs.ownerUserId,
          workspaceId: aiMediaRenderJobs.workspaceId,
        })
        .from(aiMediaRenderJobs)
        .where(
          and(
            eq(aiMediaRenderJobs.providerKey, event.providerKey),
            eq(aiMediaRenderJobs.providerJobId, event.providerJobId),
          ),
        )
        .limit(1);

      const [inserted] = await tx
        .insert(aiMediaWebhookEvents)
        .values({
          ownerUserId: job?.ownerUserId ?? UNRESOLVED_WEBHOOK_OWNER,
          workspaceId: job?.workspaceId ?? this.workspaceId,
          providerKey: event.providerKey,
          eventId: event.eventId,
          providerJobId: event.providerJobId,
          renderJobId: job?.id,
          eventType: event.status,
          payload: asJsonObject(event),
          signatureVerified: true,
          status: "received",
          occurredAt: new Date(event.occurredAt),
        })
        .onConflictDoNothing({ target: [aiMediaWebhookEvents.providerKey, aiMediaWebhookEvents.eventId] })
        .returning({ id: aiMediaWebhookEvents.id });

      return Boolean(inserted);
    });
  }

  async parkWebhook(event: ProviderWebhookEvent): Promise<void> {
    await this.db
      .update(aiMediaWebhookEvents)
      .set({ status: "parked", parkedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(aiMediaWebhookEvents.providerKey, event.providerKey),
          eq(aiMediaWebhookEvents.eventId, event.eventId),
        ),
      );
  }

  async takeParkedWebhooks(providerKey: string, providerJobId: string): Promise<ProviderWebhookEvent[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(aiMediaWebhookEvents)
        .where(
          and(
            eq(aiMediaWebhookEvents.providerKey, providerKey),
            eq(aiMediaWebhookEvents.providerJobId, providerJobId),
            eq(aiMediaWebhookEvents.status, "parked"),
          ),
        )
        .orderBy(aiMediaWebhookEvents.occurredAt);

      if (rows.length === 0) return [];

      const [job] = await tx
        .select({
          id: aiMediaRenderJobs.id,
          ownerUserId: aiMediaRenderJobs.ownerUserId,
          workspaceId: aiMediaRenderJobs.workspaceId,
        })
        .from(aiMediaRenderJobs)
        .where(
          and(
            eq(aiMediaRenderJobs.providerKey, providerKey),
            eq(aiMediaRenderJobs.providerJobId, providerJobId),
          ),
        )
        .limit(1);

      const claimed: typeof rows = [];
      for (const row of rows) {
        const [updated] = await tx
          .update(aiMediaWebhookEvents)
          .set({
            status: "consumed",
            processedAt: new Date(),
            renderJobId: job?.id ?? row.renderJobId,
            ownerUserId: job?.ownerUserId ?? row.ownerUserId,
            workspaceId: job?.workspaceId ?? row.workspaceId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(aiMediaWebhookEvents.id, row.id),
              eq(aiMediaWebhookEvents.status, "parked"),
            ),
          )
          .returning();
        if (updated) claimed.push(updated);
      }

      return claimed.map((row) => ({
        eventId: row.eventId,
        providerKey: row.providerKey,
        providerJobId: row.providerJobId,
        status: row.eventType as ProviderWebhookEvent["status"],
        occurredAt: row.occurredAt.toISOString(),
        outputUrl:
          typeof (row.payload as Record<string, unknown>).outputUrl === "string"
            ? String((row.payload as Record<string, unknown>).outputUrl)
            : undefined,
        error:
          typeof (row.payload as Record<string, unknown>).error === "string"
            ? String((row.payload as Record<string, unknown>).error)
            : undefined,
      }));
    });
  }
}
