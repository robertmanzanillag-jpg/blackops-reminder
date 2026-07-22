import { z } from "zod";
import { productionBatchSchema } from "./ai-media-studio-production-batches";

function plainObject(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype ? value : Symbol("not-plain-object");
}

export const sourceToBatchAutomationRequestSchema = z.preprocess(plainObject, z.object({}).strict());

export const sourceToBatchAutomationResponseSchema = z.object({
  outcome: z.enum(["prepared", "already_prepared", "already_approved"]),
  batch: productionBatchSchema,
  downstreamState: z.literal("blocked_before_render_admission"),
  effects: z.object({
    productionBatchRead: z.literal(true),
    eligibleSourcesConsumed: z.boolean(),
    scriptsPersisted: z.boolean(),
    scriptApprovalRecorded: z.literal(false),
    renderQueued: z.literal(false),
    outboxCreated: z.literal(false),
    videoProviderCalled: z.literal(false),
    secretResolved: z.literal(false),
    spendCommitted: z.literal(false),
    publishingCreated: z.literal(false),
    migrationApplied: z.literal(false),
    deploymentPerformed: z.literal(false),
  }).strict(),
}).strict().superRefine((response, context) => {
  const newlyPrepared = response.outcome === "prepared";
  const expectedStatus = response.outcome === "already_approved" ? "approved_ready" : "draft_ready";
  if (newlyPrepared !== response.effects.eligibleSourcesConsumed
    || newlyPrepared !== response.effects.scriptsPersisted
    || response.batch.status !== expectedStatus
    || response.batch.canGenerate !== false
    || response.batch.noSpend !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "source-to-batch automation effects must match the safe batch state",
    });
  }
});

export type SourceToBatchAutomationRequest = z.infer<typeof sourceToBatchAutomationRequestSchema>;
export type SourceToBatchAutomationResponse = z.infer<typeof sourceToBatchAutomationResponseSchema>;
