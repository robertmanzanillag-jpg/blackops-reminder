import { z } from "zod";
import {
  moderationStatusSchema,
  sourceAutomationCategorySchema,
  sourceRightsStatusSchema,
} from "./ai-media-studio-operations";

const canonicalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoDateSchema = z.string().datetime({ offset: true });

export const sourceEligibilityReviewRequestSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    expectedContentHash: sha256DigestSchema,
    idempotencyKey: canonicalIdSchema,
    rightsStatus: z.enum(["owned", "licensed"]),
  }).strict(),
  z.object({
    decision: z.literal("reject"),
    expectedContentHash: sha256DigestSchema,
    idempotencyKey: canonicalIdSchema,
    reasonCode: z.enum(["rights_unverified", "moderation_rejected", "source_invalid"]),
  }).strict(),
]);

export const sourceEligibilityReviewResponseSchema = z.object({
  source: z.object({
    id: canonicalIdSchema,
    category: sourceAutomationCategorySchema,
    contentHash: sha256DigestSchema,
    status: z.enum(["accepted", "rejected"]),
    rightsStatus: sourceRightsStatusSchema,
    moderationStatus: moderationStatusSchema,
    updatedAt: isoDateSchema,
  }).strict(),
  review: z.object({
    decision: z.enum(["approve", "reject"]),
    replayed: z.boolean(),
    reviewedAt: isoDateSchema,
  }).strict(),
  downstreamState: z.enum(["eligible_for_script_batch", "blocked"]),
  effects: z.object({
    sourceReviewPersisted: z.literal(true),
    scriptsGenerated: z.literal(false),
    renderQueued: z.literal(false),
    outboxCreated: z.literal(false),
    videoProviderCalled: z.literal(false),
    secretResolved: z.literal(false),
    spendCommitted: z.literal(false),
    publishingCreated: z.literal(false),
    migrationApplied: z.literal(false),
    deploymentPerformed: z.literal(false),
  }).strict(),
}).strict().superRefine(({ source, review, downstreamState }, context) => {
  const eligible = review.decision === "approve"
    && source.status === "accepted"
    && (source.rightsStatus === "owned" || source.rightsStatus === "licensed")
    && source.moderationStatus === "approved";
  if (eligible !== (downstreamState === "eligible_for_script_batch")) {
    context.addIssue({ code: "custom", message: "downstream state must match source eligibility" });
  }
});

export type SourceEligibilityReviewRequest = z.infer<typeof sourceEligibilityReviewRequestSchema>;
export type SourceEligibilityReviewResponse = z.infer<typeof sourceEligibilityReviewResponseSchema>;
