import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaInfluencers,
  aiMediaScripts,
  aiMediaScriptVariants,
  aiMediaSourceItems,
} from "../../../shared/models/ai-media-studio-db";
import {
  PRODUCTION_BATCH_FIXED_BLOCKERS,
  productionBatchCreativeReviewSchema,
  productionBatchSchema,
  type ProductionBatch,
} from "../../../shared/ai-media-studio-production-batches";
import { SOURCE_CATEGORIES, type SourceCategory } from "../sources/contracts";
import {
  ProductionBatchError,
  type ApproveProductionBatchInput,
  type PrepareProductionBatchInput,
  type ProductionBatchRepository,
} from "./contracts";
import {
  productionApprovalInputDigest,
  productionCreativeDigest,
  readProductionApproval,
  readProductionBatchEnvelope,
  readProductionVariantMetadata,
  type ProductionBatchApprovalEnvelope,
  type ProductionBatchEnvelope,
} from "./metadata-integrity";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type ProductionBatchExecutor = { execute(query: SQL): Promise<ExecuteResult> };
export type ProductionBatchDatabase = ProductionBatchExecutor & {
  transaction<T>(callback: (tx: ProductionBatchExecutor) => Promise<T>): Promise<T>;
};

type Envelope = ProductionBatchEnvelope;
type CreativeReview = ReturnType<typeof productionBatchCreativeReviewSchema.parse>;
type StoredCreativeReview = Readonly<CreativeReview & { creativeDigest: string }>;
type ApprovalEnvelope = ProductionBatchApprovalEnvelope;

function rows(result: ExecuteResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : result.rows;
  return Array.isArray(values) ? values as Record<string, unknown>[] : [];
}

function value(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function text(row: Record<string, unknown>, camel: string, snake: string): string {
  return String(value(row, camel, snake) ?? "");
}

function integer(row: Record<string, unknown>, camel: string, snake: string): number {
  return Number(value(row, camel, snake));
}

function iso(input: unknown): string {
  const date = input instanceof Date ? input : new Date(String(input));
  if (!Number.isFinite(date.getTime())) throw new ProductionBatchError("BATCH_UNAVAILABLE");
  return date.toISOString();
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function digest(input: unknown): string {
  return `sha256:${hash(JSON.stringify(input))}`;
}

function approvalInputDigest(input: ApproveProductionBatchInput): string {
  return productionApprovalInputDigest({
    ownerUserId: input.scope.ownerUserId,
    workspaceId: input.scope.workspaceId,
    planId: input.planId,
    expectedBatchId: input.expectedBatchId,
    idempotencyKey: input.idempotencyKey,
  });
}

function creativeReviewDigest(creative: CreativeReview): string {
  return productionCreativeDigest(creative);
}

function publicKey(prefix: "batch" | "script" | "variant", seed: string): string {
  return `${prefix}_${hash(seed).slice(0, 24)}`;
}

function validEnvelope(input: unknown): Envelope | undefined {
  return readProductionBatchEnvelope(input);
}

function validVariantEnvelope(input: unknown, base: Envelope, index: number): { creative: CreativeReview; creativeDigest: string } | undefined {
  return readProductionVariantMetadata(input, base, index);
}

function validApproval(input: unknown, base: Envelope, scope: ApproveProductionBatchInput["scope"],
  selectedChecksum: string, selectedCreativeDigest: string): ApprovalEnvelope | undefined {
  return readProductionApproval(input, base, scope, selectedChecksum, selectedCreativeDigest);
}

function category(row: Record<string, unknown>): SourceCategory | undefined {
  const candidate = text(row, "sourceCategory", "source_category");
  return SOURCE_CATEGORIES.includes(candidate as SourceCategory) ? candidate as SourceCategory : undefined;
}

function blockers(status: ProductionBatch["status"]): ProductionBatch["blockers"] {
  if (status === "approved_ready") return [...PRODUCTION_BATCH_FIXED_BLOCKERS];
  return [status === "not_started" ? "script_batch_required"
    : status === "draft_ready" ? "script_approval_required" : "script_refresh_required",
  ...PRODUCTION_BATCH_FIXED_BLOCKERS];
}

export class DrizzleProductionBatchRepository implements ProductionBatchRepository {
  constructor(private readonly db: ProductionBatchDatabase) {}

  async getCurrent(scope: PrepareProductionBatchInput["scope"]): Promise<ProductionBatch | undefined> {
    const plans = rows(await this.db.execute(sql`
      SELECT public_plan_key
      FROM ${aiMediaDailyPlans}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND status IN ('blocked','planned') AND planned_slot_count BETWEEN 50 AND 100
      ORDER BY created_at DESC, id DESC LIMIT 2
    `));
    if (plans.length === 0) return undefined;
    if (plans.length > 1 && text(plans[0], "publicPlanKey", "public_plan_key") === text(plans[1], "publicPlanKey", "public_plan_key")) {
      throw new ProductionBatchError("BATCH_UNAVAILABLE");
    }
    return this.load(this.db, scope, text(plans[0], "publicPlanKey", "public_plan_key"));
  }

  async prepare(input: PrepareProductionBatchInput): Promise<ProductionBatch> {
    return this.db.transaction(async (tx) => {
      const plan = rows(await tx.execute(sql`
        SELECT id, public_plan_key, plan_digest, planned_slot_count
        FROM ${aiMediaDailyPlans}
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND public_plan_key=${input.planId} AND status='blocked'
        FOR UPDATE
      `));
      if (plan.length !== 1) throw new ProductionBatchError("NOT_FOUND");
      const lockedSlots = rows(await tx.execute(sql`
        SELECT slots.id, slots.public_slot_key, slots.source_member_key, slots.influencer_id,
          slots.script_variant_id, slots.video_number, slots.status AS slot_status, slots.slot_digest,
          slots.state_version, influencers.name AS creator_name, influencers.language
        FROM ${aiMediaDailyPlanSlots} slots
        INNER JOIN ${aiMediaInfluencers} influencers
          ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
          AND influencers.id=slots.influencer_id
        WHERE slots.owner_user_id=${input.scope.ownerUserId} AND slots.workspace_id=${input.scope.workspaceId}
          AND slots.daily_plan_id=${text(plan[0], "id", "id")} AND slots.status='blocked'
        ORDER BY slots.source_member_key ASC, slots.video_number ASC
        FOR UPDATE OF slots
      `));
      this.assertSlotShape(lockedSlots, integer(plan[0], "plannedSlotCount", "planned_slot_count"));
      const boundCount = lockedSlots.filter((slot) => text(slot, "scriptVariantId", "script_variant_id")).length;
      if (boundCount !== 0) {
        if (boundCount !== lockedSlots.length) throw new ProductionBatchError("BATCH_UNAVAILABLE");
        const lockedReplaySources = rows(await tx.execute(sql`
          SELECT slots.public_slot_key,scripts.metadata AS script_metadata,
            sources.content_hash AS current_source_hash,sources.content AS current_source_content
          FROM ${aiMediaDailyPlanSlots} slots
          INNER JOIN ${aiMediaScriptVariants} variants
            ON variants.owner_user_id=slots.owner_user_id AND variants.workspace_id=slots.workspace_id
            AND variants.id=slots.script_variant_id
          INNER JOIN ${aiMediaScripts} scripts
            ON scripts.owner_user_id=variants.owner_user_id AND scripts.workspace_id=variants.workspace_id
            AND scripts.id=variants.script_id AND scripts.current_variant_id=variants.id
          INNER JOIN ${aiMediaSourceItems} sources
            ON sources.owner_user_id=scripts.owner_user_id AND sources.workspace_id=scripts.workspace_id
            AND sources.id=scripts.source_item_id AND sources.source_type=scripts.source_type
          WHERE slots.owner_user_id=${input.scope.ownerUserId} AND slots.workspace_id=${input.scope.workspaceId}
            AND slots.daily_plan_id=${text(plan[0], "id", "id")} AND slots.status='blocked'
            AND sources.status IN ('accepted','ready') AND sources.moderation_status='approved'
            AND sources.rights_status IN ('owned','licensed')
          ORDER BY slots.source_member_key ASC,slots.video_number ASC
          FOR UPDATE OF sources
        `));
        if (lockedReplaySources.length !== lockedSlots.length) throw new ProductionBatchError("SOURCE_REFRESHED");
        const envelopes = lockedReplaySources.map((row) => validEnvelope(value(row, "scriptMetadata", "script_metadata")));
        if (envelopes.some((envelope, index) => !envelope
          || envelope.slotId !== text(lockedReplaySources[index]!, "publicSlotKey", "public_slot_key"))) {
          throw new ProductionBatchError("BATCH_UNAVAILABLE");
        }
        const envelope = envelopes[0]!;
        if (envelope.idempotencyKey !== input.idempotencyKey || envelope.variantCount !== input.variantCount
          || envelope.generatorVersion !== input.generator.version) throw new ProductionBatchError("IDEMPOTENCY_CONFLICT");
        if (envelopes.some((candidate, index) => candidate!.batchId !== envelope.batchId
          || candidate!.inputDigest !== envelope.inputDigest
          || text(lockedReplaySources[index]!, "currentSourceHash", "current_source_hash") !== candidate!.sourceContentHash
          || hash(text(lockedReplaySources[index]!, "currentSourceContent", "current_source_content")) !== candidate!.sourceContentChecksum)) {
          throw new ProductionBatchError("SOURCE_REFRESHED");
        }
        return this.load(tx, input.scope, input.planId);
      }

      const sources = rows(await tx.execute(sql`
        SELECT id, title, content, content_hash, source_type AS source_category
        FROM ${aiMediaSourceItems}
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND status IN ('accepted','ready') AND moderation_status='approved'
          AND rights_status IN ('owned','licensed')
          AND title IS NOT NULL AND length(btrim(title)) BETWEEN 1 AND 200
          AND title=btrim(title) AND title !~ '[[:cntrl:]]'
          AND content IS NOT NULL AND length(btrim(content)) BETWEEN 1 AND 4000
          AND content_hash ~ '^sha256:[a-f0-9]{64}$'
          AND source_type IN ('events','restaurants','hotels','nightclubs','deals','travel_packages','beach_clubs','experiences')
        ORDER BY created_at ASC, id ASC LIMIT 10
        FOR UPDATE
      `));
      if (sources.length !== 10 || sources.some((source) => !category(source))) {
        throw new ProductionBatchError("SOURCE_INELIGIBLE");
      }
      const clock = rows(await tx.execute(sql`SELECT transaction_timestamp() AS observed_at`))[0];
      if (!clock) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const preparedAt = iso(value(clock, "observedAt", "observed_at"));
      const batchId = publicKey("batch", `${input.scope.ownerUserId}\0${input.scope.workspaceId}\0${input.planId}\0${input.idempotencyKey}`);
      const inputDigest = digest({
        planId: input.planId,
        planDigest: text(plan[0], "planDigest", "plan_digest"),
        idempotencyKey: input.idempotencyKey,
        variantCount: input.variantCount,
        generatorVersion: input.generator.version,
        slots: lockedSlots.map((slot) => ({
          slotId: text(slot, "publicSlotKey", "public_slot_key"),
          slotDigest: text(slot, "slotDigest", "slot_digest"),
          stateVersion: integer(slot, "stateVersion", "state_version"),
        })),
        sources: sources.map((source) => ({
          contentHash: text(source, "contentHash", "content_hash"), category: category(source),
        })),
      });

      for (const slot of lockedSlots) {
        const videoNumber = integer(slot, "videoNumber", "video_number");
        const source = sources[videoNumber - 1];
        const sourceCategory = source && category(source);
        if (!source || !sourceCategory) throw new ProductionBatchError("SOURCE_INELIGIBLE");
        const slotId = text(slot, "publicSlotKey", "public_slot_key");
        const scriptKey = publicKey("script", `${batchId}\0${slotId}`);
        const envelope: Envelope = {
          version: 1, batchId, planId: input.planId, slotId, scriptKey,
          idempotencyKey: input.idempotencyKey, inputDigest,
          sourceContentHash: text(source, "contentHash", "content_hash"),
          sourceContentChecksum: hash(text(source, "content", "content")),
          sourceTitle: text(source, "title", "title"), sourceCategory,
          generatorVersion: input.generator.version, variantCount: input.variantCount, preparedAt,
        };
        const generated = input.generator.generate({
          source: {
            type: sourceCategory,
            id: `source_${hash(`${input.scope.ownerUserId}\0${input.scope.workspaceId}\0${text(source, "id", "id")}`).slice(0, 24)}`,
            title: envelope.sourceTitle,
            summary: text(source, "content", "content"),
          },
          influencerId: text(slot, "sourceMemberKey", "source_member_key"),
          language: text(slot, "language", "language") || "en",
          variantCount: input.variantCount,
        });
        if (generated.generation.mode !== "deterministic" || generated.generation.estimatedCostUsd !== 0
          || generated.scriptSet.variants.length !== input.variantCount) throw new ProductionBatchError("BATCH_UNAVAILABLE");
        const scriptUuid = randomUUID();
        const variantUuids = generated.scriptSet.variants.map(() => randomUUID());
        const insertedScript = rows(await tx.execute(sql`
          INSERT INTO ${aiMediaScripts} (
            id, owner_user_id, workspace_id, influencer_id, title, source_type, source_item_id,
            language, status, current_variant_id, metadata, created_at, updated_at
          ) VALUES (
            ${scriptUuid}, ${input.scope.ownerUserId}, ${input.scope.workspaceId},
            ${text(slot, "influencerId", "influencer_id")}, ${generated.scriptSet.title}, ${sourceCategory},
            ${text(source, "id", "id")}, ${generated.scriptSet.language}, 'draft', NULL,
            ${JSON.stringify({ productionBatchV1: envelope })}::jsonb,
            ${preparedAt}::timestamptz, ${preparedAt}::timestamptz
          ) RETURNING id
        `));
        if (insertedScript.length !== 1) throw new ProductionBatchError("BATCH_UNAVAILABLE");
        for (const [index, variant] of generated.scriptSet.variants.entries()) {
          const variantMetadata = {
            ...envelope,
            variantKey: publicKey("variant", `${scriptKey}\0${index + 1}`),
            variantIndex: index,
            selected: index === 0,
          };
          const creative = {
            title: variant.title, angle: variant.angle, hook: variant.hook, script: variant.script, cta: variant.cta,
            caption: variant.caption, hashtags: variant.hashtags, seoKeywords: variant.seoKeywords,
          };
          const storedCreative: StoredCreativeReview = { ...creative, creativeDigest: creativeReviewDigest(creative) };
          const insertedVariant = rows(await tx.execute(sql`
            INSERT INTO ${aiMediaScriptVariants} (
              id, owner_user_id, workspace_id, script_id, version, label, content, status,
              checksum, metadata, created_at, updated_at
            ) VALUES (
              ${variantUuids[index]}, ${input.scope.ownerUserId}, ${input.scope.workspaceId}, ${scriptUuid},
              ${index + 1}, ${variant.title}, ${variant.script}, 'draft', ${hash(variant.script)},
              ${JSON.stringify({ productionBatchV1: variantMetadata, productionCreativeV1: storedCreative })}::jsonb,
              ${preparedAt}::timestamptz, ${preparedAt}::timestamptz
            ) RETURNING id
          `));
          if (insertedVariant.length !== 1) throw new ProductionBatchError("BATCH_UNAVAILABLE");
        }
        const selectedVariantId = variantUuids[0]!;
        const selected = rows(await tx.execute(sql`
          UPDATE ${aiMediaScripts}
          SET current_variant_id=${selectedVariantId}, updated_at=${preparedAt}::timestamptz
          WHERE id=${scriptUuid} AND owner_user_id=${input.scope.ownerUserId}
            AND workspace_id=${input.scope.workspaceId} AND current_variant_id IS NULL
          RETURNING id
        `));
        const bound = rows(await tx.execute(sql`
          UPDATE ${aiMediaDailyPlanSlots}
          SET script_variant_id=${selectedVariantId}, state_version=state_version+1,
            updated_at=${preparedAt}::timestamptz
          WHERE id=${text(slot, "id", "id")} AND owner_user_id=${input.scope.ownerUserId}
            AND workspace_id=${input.scope.workspaceId} AND script_variant_id IS NULL
            AND state_version=${integer(slot, "stateVersion", "state_version")}
            AND status='blocked' AND slot_digest=${text(slot, "slotDigest", "slot_digest")}
          RETURNING id
        `));
        if (selected.length !== 1 || bound.length !== 1) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      }
      return this.load(tx, input.scope, input.planId);
    });
  }

  async approve(input: ApproveProductionBatchInput): Promise<ProductionBatch> {
    const approvalDigest = approvalInputDigest(input);
    return this.db.transaction(async (tx) => {
      const plans = rows(await tx.execute(sql`
        SELECT id,public_plan_key,status,planned_slot_count
        FROM ${aiMediaDailyPlans}
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND public_plan_key=${input.planId} AND status IN ('blocked','planned')
        FOR UPDATE
      `));
      if (plans.length !== 1) throw new ProductionBatchError("NOT_FOUND");
      const plan = plans[0]!;
      const locked = rows(await tx.execute(sql`
        SELECT slots.id AS slot_id,slots.public_slot_key,slots.source_member_key,slots.video_number,
          slots.status AS slot_status,slots.state_version,slots.script_variant_id,
          scripts.id AS script_id,scripts.status AS script_status,scripts.current_variant_id,
          scripts.metadata AS script_metadata,selected.checksum AS selected_variant_checksum,
          selected.metadata AS selected_variant_metadata,
          variants.id AS variant_id,variants.status AS variant_status,variants.version AS variant_version,
          variants.content AS variant_content,variants.checksum AS variant_checksum,variants.metadata AS variant_metadata,
          sources.content_hash AS current_source_hash,sources.content AS current_source_content,
          sources.status AS source_status,sources.rights_status,sources.moderation_status
        FROM ${aiMediaDailyPlanSlots} slots
        INNER JOIN ${aiMediaScriptVariants} selected
          ON selected.owner_user_id=slots.owner_user_id AND selected.workspace_id=slots.workspace_id
          AND selected.id=slots.script_variant_id
        INNER JOIN ${aiMediaScripts} scripts
          ON scripts.owner_user_id=selected.owner_user_id AND scripts.workspace_id=selected.workspace_id
          AND scripts.id=selected.script_id AND scripts.current_variant_id=selected.id
        INNER JOIN ${aiMediaScriptVariants} variants
          ON variants.owner_user_id=scripts.owner_user_id AND variants.workspace_id=scripts.workspace_id
          AND variants.script_id=scripts.id
        INNER JOIN ${aiMediaSourceItems} sources
          ON sources.owner_user_id=scripts.owner_user_id AND sources.workspace_id=scripts.workspace_id
          AND sources.id=scripts.source_item_id AND sources.source_type=scripts.source_type
        WHERE slots.owner_user_id=${input.scope.ownerUserId} AND slots.workspace_id=${input.scope.workspaceId}
          AND slots.daily_plan_id=${text(plan, "id", "id")} AND slots.status=${text(plan, "status", "status")}
        ORDER BY slots.source_member_key,slots.video_number,variants.version
        FOR UPDATE OF slots,scripts,selected,variants,sources
      `));
      const uniqueSlots = new Map(locked.map((row) => [text(row, "publicSlotKey", "public_slot_key"), row]));
      this.assertSlotShape([...uniqueSlots.values()], integer(plan, "plannedSlotCount", "planned_slot_count"), text(plan, "status", "status"));
      if ([...uniqueSlots.values()].some((row) => !["accepted", "ready"].includes(text(row, "sourceStatus", "source_status"))
        || !["owned", "licensed"].includes(text(row, "rightsStatus", "rights_status"))
        || text(row, "moderationStatus", "moderation_status") !== "approved")) {
        throw new ProductionBatchError("SOURCE_INELIGIBLE");
      }
      const batch = await this.load(tx, input.scope, input.planId);
      if (batch.batchId !== input.expectedBatchId) throw new ProductionBatchError("IDEMPOTENCY_CONFLICT");
      if (text(plan, "status", "status") === "planned") {
        const first = locked[0];
        const envelope = first && validEnvelope(value(first, "scriptMetadata", "script_metadata"));
        const selectedCreative = envelope && validVariantEnvelope(
          value(first!, "selectedVariantMetadata", "selected_variant_metadata"), envelope, 0);
        const approval = envelope && validApproval(value(first!, "scriptMetadata", "script_metadata"), envelope,
          input.scope, text(first!, "selectedVariantChecksum", "selected_variant_checksum"),
          selectedCreative?.creativeDigest ?? "");
        if (!approval || approval.idempotencyKey !== input.idempotencyKey
          || approval.inputDigest !== approvalDigest) throw new ProductionBatchError("IDEMPOTENCY_CONFLICT");
        return batch;
      }
      if (batch.status === "stale") throw new ProductionBatchError("SOURCE_REFRESHED");
      if (batch.status !== "draft_ready" || locked.length < batch.plannedVideoCount) {
        throw new ProductionBatchError("BATCH_UNAVAILABLE");
      }
      const observed = rows(await tx.execute(sql`SELECT transaction_timestamp() AS observed_at`))[0];
      if (!observed) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const approvedAt = iso(value(observed, "observedAt", "observed_at"));
      const scripts = rows(await tx.execute(sql`
        UPDATE ${aiMediaScripts} scripts SET
          status='approved',updated_at=${approvedAt}::timestamptz,
          metadata=scripts.metadata || jsonb_build_object('productionBatchApprovalV1',jsonb_build_object(
            'version',1,'ownerUserId',scripts.owner_user_id,'workspaceId',scripts.workspace_id,
            'batchId',scripts.metadata->'productionBatchV1'->>'batchId',
            'planId',scripts.metadata->'productionBatchV1'->>'planId',
            'slotId',scripts.metadata->'productionBatchV1'->>'slotId',
            'scriptKey',scripts.metadata->'productionBatchV1'->>'scriptKey',
            'selectedVariantChecksum',selected.checksum,
            'selectedCreativeDigest',selected.metadata->'productionCreativeV1'->>'creativeDigest',
            'inputDigest',${approvalDigest}::text,
            'idempotencyKey',${input.idempotencyKey}::text,'approvedAt',${approvedAt}::text
          ))
        FROM ${aiMediaScriptVariants} selected,${aiMediaDailyPlanSlots} slots
        WHERE scripts.owner_user_id=${input.scope.ownerUserId} AND scripts.workspace_id=${input.scope.workspaceId}
          AND selected.owner_user_id=scripts.owner_user_id AND selected.workspace_id=scripts.workspace_id
          AND selected.id=scripts.current_variant_id AND slots.owner_user_id=scripts.owner_user_id
          AND slots.workspace_id=scripts.workspace_id AND slots.script_variant_id=selected.id
          AND slots.daily_plan_id=${text(plan, "id", "id")} AND slots.status='blocked'
          AND scripts.status='draft' AND scripts.metadata->'productionBatchV1'->>'batchId'=${input.expectedBatchId}
        RETURNING scripts.id
      `));
      if (scripts.length !== batch.plannedVideoCount) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const variants = rows(await tx.execute(sql`
        UPDATE ${aiMediaScriptVariants} variants SET
          status='approved',updated_at=${approvedAt}::timestamptz,
          metadata=variants.metadata || jsonb_build_object(
            'productionBatchApprovalV1',scripts.metadata->'productionBatchApprovalV1')
        FROM ${aiMediaScripts} scripts
        WHERE variants.owner_user_id=${input.scope.ownerUserId} AND variants.workspace_id=${input.scope.workspaceId}
          AND scripts.owner_user_id=variants.owner_user_id AND scripts.workspace_id=variants.workspace_id
          AND scripts.id=variants.script_id AND scripts.current_variant_id=variants.id
          AND scripts.status='approved' AND variants.status='draft'
          AND scripts.metadata->'productionBatchV1'->>'batchId'=${input.expectedBatchId}
        RETURNING variants.id
      `));
      if (variants.length !== batch.plannedVideoCount) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const slots = rows(await tx.execute(sql`
        UPDATE ${aiMediaDailyPlanSlots} SET status='planned',state_version=state_version+1,
          updated_at=${approvedAt}::timestamptz
        WHERE owner_user_id=${input.scope.ownerUserId} AND workspace_id=${input.scope.workspaceId}
          AND daily_plan_id=${text(plan, "id", "id")} AND status='blocked'
        RETURNING id
      `));
      if (slots.length !== batch.plannedVideoCount) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const promoted = rows(await tx.execute(sql`
        UPDATE ${aiMediaDailyPlans} SET status='planned',updated_at=${approvedAt}::timestamptz
        WHERE id=${text(plan, "id", "id")} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND status='blocked'
        RETURNING id
      `));
      if (promoted.length !== 1) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      return this.load(tx, input.scope, input.planId);
    });
  }

  private async readRows(executor: ProductionBatchExecutor, scope: PrepareProductionBatchInput["scope"], planId: string) {
    return rows(await executor.execute(sql`
      SELECT plans.public_plan_key, plans.status AS plan_status, plans.planned_slot_count,
        slots.public_slot_key, slots.source_member_key, slots.video_number, slots.status AS slot_status,
        slots.script_variant_id, influencers.name AS creator_name,
        scripts.title AS script_title, scripts.status AS script_status, scripts.current_variant_id,
        scripts.metadata AS script_metadata, sources.content_hash AS current_source_hash,
        sources.content AS current_source_content,sources.status AS source_status,
        sources.rights_status,sources.moderation_status,
        variants.id AS variant_id, variants.version AS variant_version, variants.label AS variant_label,
        variants.content AS variant_content,
        variants.status AS variant_status, variants.checksum AS variant_checksum,
        variants.metadata AS variant_metadata
      FROM ${aiMediaDailyPlans} plans
      INNER JOIN ${aiMediaDailyPlanSlots} slots
        ON slots.owner_user_id=plans.owner_user_id AND slots.workspace_id=plans.workspace_id
        AND slots.daily_plan_id=plans.id
      INNER JOIN ${aiMediaInfluencers} influencers
        ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
        AND influencers.id=slots.influencer_id
      LEFT JOIN ${aiMediaScriptVariants} selected
        ON selected.owner_user_id=slots.owner_user_id AND selected.workspace_id=slots.workspace_id
        AND selected.id=slots.script_variant_id
      LEFT JOIN ${aiMediaScripts} scripts
        ON scripts.owner_user_id=selected.owner_user_id AND scripts.workspace_id=selected.workspace_id
        AND scripts.id=selected.script_id
      LEFT JOIN ${aiMediaSourceItems} sources
        ON sources.owner_user_id=scripts.owner_user_id AND sources.workspace_id=scripts.workspace_id
        AND sources.id=scripts.source_item_id AND sources.source_type=scripts.source_type
      LEFT JOIN ${aiMediaScriptVariants} variants
        ON variants.owner_user_id=scripts.owner_user_id AND variants.workspace_id=scripts.workspace_id
        AND variants.script_id=scripts.id
      WHERE plans.owner_user_id=${scope.ownerUserId} AND plans.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${planId} AND plans.status IN ('blocked','planned')
        AND slots.status=plans.status
      ORDER BY slots.source_member_key ASC, slots.video_number ASC, variants.version ASC NULLS FIRST
    `));
  }

  private async load(executor: ProductionBatchExecutor, scope: PrepareProductionBatchInput["scope"], planId: string): Promise<ProductionBatch> {
    const result = await this.readRows(executor, scope, planId);
    if (result.length === 0) throw new ProductionBatchError("NOT_FOUND");
    const bySlot = new Map<string, Record<string, unknown>[]>();
    for (const row of result) {
      const slotId = text(row, "publicSlotKey", "public_slot_key");
      const slotRows = bySlot.get(slotId) ?? [];
      slotRows.push(row);
      bySlot.set(slotId, slotRows);
    }
    const slotRows = [...bySlot.values()].map((entry) => entry[0]!);
    const planStatus = text(result[0]!, "planStatus", "plan_status");
    if (planStatus !== "blocked" && planStatus !== "planned") throw new ProductionBatchError("BATCH_UNAVAILABLE");
    this.assertSlotShape(slotRows, integer(result[0]!, "plannedSlotCount", "planned_slot_count"), planStatus);
    const boundCount = slotRows.filter((row) => text(row, "scriptVariantId", "script_variant_id")).length;
    if (boundCount !== 0 && boundCount !== slotRows.length) throw new ProductionBatchError("BATCH_UNAVAILABLE");
    if (boundCount === 0) {
      const groups = this.group(slotRows.map((row) => ({ row })));
      return productionBatchSchema.parse({
        batchId: publicKey("batch", `${scope.ownerUserId}\0${scope.workspaceId}\0${planId}\0not-started`),
        planId, status: "not_started", avatarCount: groups.length, videosPerAvatar: 10,
        plannedVideoCount: slotRows.length, canGenerate: false, noSpend: true, preparedAt: null,
        approvedAt: null,
        blockers: blockers("not_started"), groups,
      });
    }
    let batchEnvelope: Envelope | undefined;
    let batchApproval: ApprovalEnvelope | undefined;
    let stale = false;
    const verified = [...bySlot.values()].map((entries) => {
      const row = entries[0]!;
      const envelope = validEnvelope(value(row, "scriptMetadata", "script_metadata"));
      const expectedScriptStatus = planStatus === "planned" ? "approved" : "draft";
      const selectedVariantId = text(entries[0]!, "variantId", "variant_id");
      if (!envelope || envelope.planId !== planId || envelope.slotId !== text(row, "publicSlotKey", "public_slot_key")
        || text(row, "scriptStatus", "script_status") !== expectedScriptStatus
        || text(row, "scriptVariantId", "script_variant_id") !== text(row, "currentVariantId", "current_variant_id")
        || text(row, "scriptVariantId", "script_variant_id") !== selectedVariantId
        || entries.length !== envelope.variantCount) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      if (batchEnvelope && (batchEnvelope.batchId !== envelope.batchId
        || batchEnvelope.inputDigest !== envelope.inputDigest
        || batchEnvelope.idempotencyKey !== envelope.idempotencyKey
        || batchEnvelope.preparedAt !== envelope.preparedAt)) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      batchEnvelope ??= envelope;
      let selectedCreative: CreativeReview | undefined;
      const selectedChecksum = text(entries[0]!, "variantChecksum", "variant_checksum");
      const selectedVariantEnvelope = validVariantEnvelope(
        value(entries[0]!, "variantMetadata", "variant_metadata"), envelope, 0);
      if (!selectedVariantEnvelope) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const scriptApproval = validApproval(value(row, "scriptMetadata", "script_metadata"), envelope, scope,
        selectedChecksum, selectedVariantEnvelope.creativeDigest);
      if (planStatus === "planned") {
        if (!scriptApproval || (batchApproval && (scriptApproval.idempotencyKey !== batchApproval.idempotencyKey
          || scriptApproval.inputDigest !== batchApproval.inputDigest
          || scriptApproval.approvedAt !== batchApproval.approvedAt))) throw new ProductionBatchError("BATCH_UNAVAILABLE");
        batchApproval ??= scriptApproval;
      } else if (scriptApproval) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      for (const [index, variantRow] of entries.entries()) {
        const content = text(variantRow, "variantContent", "variant_content");
        const variantEnvelope = validVariantEnvelope(value(variantRow, "variantMetadata", "variant_metadata"), envelope, index);
        const variantApproval = validApproval(value(variantRow, "variantMetadata", "variant_metadata"), envelope, scope,
          selectedChecksum, selectedVariantEnvelope.creativeDigest);
        const selected = index === 0;
        const expectedVariantStatus = planStatus === "planned" && selected ? "approved" : "draft";
        if (integer(variantRow, "variantVersion", "variant_version") !== index + 1
          || text(variantRow, "variantStatus", "variant_status") !== expectedVariantStatus
          || text(variantRow, "variantChecksum", "variant_checksum") !== hash(content)
          || !variantEnvelope
          || variantEnvelope.creative.title !== text(variantRow, "variantLabel", "variant_label")
          || variantEnvelope.creative.script !== content
          || (planStatus === "planned" && selected ? !variantApproval
            || variantApproval.idempotencyKey !== scriptApproval!.idempotencyKey
            || variantApproval.approvedAt !== scriptApproval!.approvedAt : Boolean(variantApproval))) {
          throw new ProductionBatchError("BATCH_UNAVAILABLE");
        }
        if (index === 0) selectedCreative = variantEnvelope.creative;
      }
      if (!selectedCreative || selectedCreative.title !== text(row, "scriptTitle", "script_title")) {
        throw new ProductionBatchError("BATCH_UNAVAILABLE");
      }
      if (text(row, "currentSourceHash", "current_source_hash") !== envelope.sourceContentHash
        || hash(text(row, "currentSourceContent", "current_source_content")) !== envelope.sourceContentChecksum) stale = true;
      const sourceEligible = ["accepted", "ready"].includes(text(row, "sourceStatus", "source_status"))
        && ["owned", "licensed"].includes(text(row, "rightsStatus", "rights_status"))
        && text(row, "moderationStatus", "moderation_status") === "approved";
      if (!sourceEligible) {
        if (planStatus === "planned") throw new ProductionBatchError("SOURCE_INELIGIBLE");
        stale = true;
      }
      return { row, envelope, selectedCreative };
    });
    if (!batchEnvelope) throw new ProductionBatchError("BATCH_UNAVAILABLE");
    if (planStatus === "planned" && stale) throw new ProductionBatchError("SOURCE_REFRESHED");
    const status = planStatus === "planned" ? "approved_ready" as const
      : stale ? "stale" as const : "draft_ready" as const;
    const groups = this.group(verified);
    return productionBatchSchema.parse({
      batchId: batchEnvelope.batchId, planId, status, avatarCount: groups.length, videosPerAvatar: 10,
      plannedVideoCount: verified.length, canGenerate: false, noSpend: true,
      preparedAt: batchEnvelope.preparedAt, approvedAt: batchApproval?.approvedAt ?? null,
      blockers: blockers(status), groups,
    });
  }

  private assertSlotShape(slots: Record<string, unknown>[], planned: number, expectedStatus = "blocked"): void {
    const members = new Map<string, Set<number>>();
    for (const slot of slots) {
      const memberId = text(slot, "sourceMemberKey", "source_member_key");
      const videoNumber = integer(slot, "videoNumber", "video_number");
      const numbers = members.get(memberId) ?? new Set<number>();
      numbers.add(videoNumber);
      members.set(memberId, numbers);
      if (!/^member_[a-f0-9]{24}$/u.test(memberId) || !/^slot_[a-f0-9]{24}$/u.test(text(slot, "publicSlotKey", "public_slot_key"))
        || videoNumber < 1 || videoNumber > 10 || text(slot, "slotStatus", "slot_status") !== expectedStatus) {
        throw new ProductionBatchError("BATCH_UNAVAILABLE");
      }
    }
    if (slots.length !== planned || planned < 50 || planned > 100 || members.size < 5 || members.size > 10
      || [...members.values()].some((numbers) => numbers.size !== 10) || planned !== members.size * 10) {
      throw new ProductionBatchError("BATCH_UNAVAILABLE");
    }
  }

  private group(values: Array<{ row: Record<string, unknown>; envelope?: Envelope; selectedCreative?: CreativeReview }>): ProductionBatch["groups"] {
    const groups = new Map<string, ProductionBatch["groups"][number]>();
    for (const { row, envelope, selectedCreative } of values) {
      if (envelope && !selectedCreative) throw new ProductionBatchError("BATCH_UNAVAILABLE");
      const memberId = text(row, "sourceMemberKey", "source_member_key");
      const group = groups.get(memberId) ?? { memberId, creatorName: text(row, "creatorName", "creator_name"), items: [] };
      group.items.push({
        slotId: text(row, "publicSlotKey", "public_slot_key"),
        videoNumber: integer(row, "videoNumber", "video_number"),
        ...(envelope ? {
          preparation: "draft" as const,
          source: { title: envelope.sourceTitle, category: envelope.sourceCategory },
          script: {
            key: envelope.scriptKey, title: text(row, "scriptTitle", "script_title"),
            status: (text(row, "scriptStatus", "script_status") === "approved" ? "approved" : "draft") as "approved" | "draft",
            variantCount: envelope.variantCount,
            selectedVariant: selectedCreative!,
          },
        } : { preparation: "pending" as const, source: null, script: null }),
      });
      groups.set(memberId, group);
    }
    return [...groups.values()].map((group) => ({ ...group, items: group.items.sort((a, b) => a.videoNumber - b.videoNumber) }));
  }
}
