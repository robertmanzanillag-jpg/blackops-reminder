import { z } from "zod";
import { INITIAL_CREATOR_CANARY_PROFILE } from "./ai-media-studio-launch-plan-profile";
import { mediaSourceTypeSchema } from "./ai-media-studio-scripts";

export const PRODUCTION_BATCH_MIN_AVATARS = INITIAL_CREATOR_CANARY_PROFILE.creators.minimum;
export const PRODUCTION_BATCH_MAX_AVATARS = INITIAL_CREATOR_CANARY_PROFILE.creators.maximum;
export const PRODUCTION_BATCH_VIDEOS_PER_AVATAR = INITIAL_CREATOR_CANARY_PROFILE.creators.videosPerCreator;
export const PRODUCTION_BATCH_SOURCE_TOPIC_COUNT = INITIAL_CREATOR_CANARY_PROFILE.contentDeck.topicCount;
export const PRODUCTION_BATCH_MIN_VIDEOS = INITIAL_CREATOR_CANARY_PROFILE.slots.minimum;
export const PRODUCTION_BATCH_MAX_VIDEOS = INITIAL_CREATOR_CANARY_PROFILE.slots.maximum;
export const PRODUCTION_BATCH_CONTENT_PLAN_STRATEGY = INITIAL_CREATOR_CANARY_PROFILE.contentDeck.strategy;

export const PRODUCTION_BATCH_GENERATOR_VERSION = "deterministic-script-v1" as const;
export const PRODUCTION_BATCH_FIXED_BLOCKERS = [
  "governance_approval_required",
  "budget_reservation_required",
  "sandbox_generation_required",
  "human_launch_approval_required",
] as const;
export const productionBatchPreparationBlockerSchema = z.enum([
  "script_batch_required",
  "script_approval_required",
  "script_refresh_required",
]);
export const productionBatchBlockerSchema = z.union([
  productionBatchPreparationBlockerSchema,
  z.enum(PRODUCTION_BATCH_FIXED_BLOCKERS),
]);

const publicKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u"));
const cleanText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const exactBlockers = z.array(productionBatchBlockerSchema).length(5).superRefine((blockers, context) => {
  if (!productionBatchPreparationBlockerSchema.safeParse(blockers[0]).success
    || blockers.slice(1).some((blocker, index) => blocker !== PRODUCTION_BATCH_FIXED_BLOCKERS[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Production batch blockers must match the launch gates" });
  }
});

function plainObject(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype ? value : Symbol("not-plain-object");
}

export const prepareProductionBatchRequestSchema = z.preprocess(plainObject, z.object({
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/u),
  variantCount: z.number().int().min(1).max(5).optional(),
}).strict());

export const approveProductionBatchRequestSchema = z.preprocess(plainObject, z.object({
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/u),
  expectedBatchId: publicKey("batch"),
}).strict());

export const productionBatchCreativeReviewSchema = z.object({
  title: cleanText(200),
  angle: cleanText(120),
  hook: cleanText(500),
  script: cleanText(5_000),
  cta: cleanText(500),
  caption: cleanText(2_200),
  hashtags: z.array(cleanText(80)).max(30),
  seoKeywords: z.array(cleanText(120)).max(50),
}).strict();

export const productionBatchContentPlanSchema = z.object({
  strategy: z.literal(PRODUCTION_BATCH_CONTENT_PLAN_STRATEGY),
  sourceTopicCount: z.literal(PRODUCTION_BATCH_SOURCE_TOPIC_COUNT),
  slotCount: z.number().int().min(PRODUCTION_BATCH_MIN_VIDEOS).max(PRODUCTION_BATCH_MAX_VIDEOS),
  reuseAcrossCreators: z.literal(INITIAL_CREATOR_CANARY_PROFILE.contentDeck.reuseAcrossCreators),
}).strict();

const productionBatchSlotIdentitySchema = z.object({
  slotId: publicKey("slot"),
  videoNumber: z.number().int().min(1).max(PRODUCTION_BATCH_VIDEOS_PER_AVATAR),
}).strict();
export const productionBatchItemSchema = z.discriminatedUnion("preparation", [
  productionBatchSlotIdentitySchema.extend({
    preparation: z.literal("pending"),
    source: z.null(),
    script: z.null(),
  }).strict(),
  productionBatchSlotIdentitySchema.extend({
    preparation: z.literal("draft"),
    source: z.object({
      title: cleanText(200),
      category: mediaSourceTypeSchema,
    }).strict(),
    script: z.object({
      key: publicKey("script"),
      title: cleanText(200),
      status: z.enum(["draft", "approved"]),
      variantCount: z.number().int().min(1).max(5),
      selectedVariant: productionBatchCreativeReviewSchema,
    }).strict(),
  }).strict(),
]);

export const productionBatchGroupSchema = z.object({
  memberId: publicKey("member"),
  creatorName: cleanText(120),
  items: z.array(productionBatchItemSchema).length(PRODUCTION_BATCH_VIDEOS_PER_AVATAR),
}).strict().superRefine((group, context) => {
  if (new Set(group.items.map((item) => item.slotId)).size !== group.items.length
    || new Set(group.items.map((item) => item.videoNumber)).size !== PRODUCTION_BATCH_VIDEOS_PER_AVATAR) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Production group slots are inconsistent" });
  }
});

export const productionBatchSchema = z.object({
  batchId: publicKey("batch"),
  planId: publicKey("plan"),
  status: z.enum(["not_started", "draft_ready", "approved_ready", "stale"]),
  avatarCount: z.number().int().min(PRODUCTION_BATCH_MIN_AVATARS).max(PRODUCTION_BATCH_MAX_AVATARS),
  videosPerAvatar: z.literal(PRODUCTION_BATCH_VIDEOS_PER_AVATAR),
  plannedVideoCount: z.number().int().min(PRODUCTION_BATCH_MIN_VIDEOS).max(PRODUCTION_BATCH_MAX_VIDEOS),
  contentPlan: productionBatchContentPlanSchema,
  canGenerate: z.literal(INITIAL_CREATOR_CANARY_PROFILE.safety.canGenerate),
  noSpend: z.literal(INITIAL_CREATOR_CANARY_PROFILE.safety.noSpend),
  preparedAt: z.string().datetime({ offset: true }).nullable(),
  approvedAt: z.string().datetime({ offset: true }).nullable(),
  blockers: z.union([exactBlockers, z.tuple([
    z.literal("governance_approval_required"),
    z.literal("budget_reservation_required"),
    z.literal("sandbox_generation_required"),
    z.literal("human_launch_approval_required"),
  ])]),
  groups: z.array(productionBatchGroupSchema).min(PRODUCTION_BATCH_MIN_AVATARS).max(PRODUCTION_BATCH_MAX_AVATARS),
}).strict().superRefine((batch, context) => {
  const expectedPreparationBlocker = batch.status === "not_started" ? "script_batch_required"
    : batch.status === "draft_ready" ? "script_approval_required"
      : batch.status === "stale" ? "script_refresh_required" : undefined;
  const approved = batch.status === "approved_ready";
  if (batch.groups.length !== batch.avatarCount
    || batch.plannedVideoCount !== batch.avatarCount * PRODUCTION_BATCH_VIDEOS_PER_AVATAR
    || batch.contentPlan.slotCount !== batch.plannedVideoCount
    || batch.groups.reduce((total, group) => total + group.items.length, 0) !== batch.plannedVideoCount
    || (approved ? batch.blockers.length !== 4 : batch.blockers[0] !== expectedPreparationBlocker)
    || (batch.status === "not_started") !== (batch.preparedAt === null)
    || approved !== Boolean(batch.approvedAt)
    || batch.groups.flatMap((group) => group.items).some((item) =>
      batch.status === "not_started" ? item.preparation !== "pending"
        : item.preparation !== "draft" || item.script?.status !== (approved ? "approved" : "draft"))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Production batch totals or readiness are inconsistent" });
  }
});

export const productionBatchResponseSchema = z.object({ batch: productionBatchSchema }).strict();

export type PrepareProductionBatchRequest = z.infer<typeof prepareProductionBatchRequestSchema>;
export type ApproveProductionBatchRequest = z.infer<typeof approveProductionBatchRequestSchema>;
export type ProductionBatch = z.infer<typeof productionBatchSchema>;
export type ProductionBatchResponse = z.infer<typeof productionBatchResponseSchema>;
