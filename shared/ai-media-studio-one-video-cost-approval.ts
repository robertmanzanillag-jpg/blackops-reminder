import { z } from "zod";

const publicKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u"));
const idempotencyKey = z.string().trim().min(8).max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const oneVideoCostApprovalPathSchema = z.object({
  planId: publicKey("plan"),
  slotId: publicKey("slot"),
}).strict();

export const oneVideoCostApprovalRequestSchema = z.object({
  expectedBatchId: publicKey("batch"),
  expectedQuoteKey: publicKey("quote"),
  decision: z.enum(["approved", "rejected", "revoked"]),
  idempotencyKey,
}).strict();

const noSideEffectsSchema = z.object({
  providerCalled: z.literal(false),
  secretResolved: z.literal(false),
  verificationPerformed: z.literal(false),
  quoteRequested: z.literal(false),
  approvalRecorded: z.boolean(),
  reservationCreated: z.literal(false),
  renderCreated: z.literal(false),
  outboxCreated: z.literal(false),
  spendCommitted: z.literal(false),
  publishingCreated: z.literal(false),
}).strict();

export const oneVideoCostApprovalResponseSchema = z.object({
  outcome: z.enum(["recorded", "replayed"]),
  approval: z.object({
    planId: publicKey("plan"),
    batchId: publicKey("batch"),
    slotId: publicKey("slot"),
    decision: z.enum(["approved", "rejected", "revoked"]),
    approvedQuoteKey: publicKey("quote"),
    renderSpecKey: publicKey("render_spec"),
  }).strict(),
  effects: noSideEffectsSchema,
  canGenerate: z.literal(false),
  spendAuthorized: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.effects.approvalRecorded !== (value.outcome === "recorded")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Approval outcome and effects are inconsistent" });
  }
});

export type OneVideoCostApprovalRequest = z.infer<typeof oneVideoCostApprovalRequestSchema>;
export type OneVideoCostApprovalResponse = z.infer<typeof oneVideoCostApprovalResponseSchema>;
