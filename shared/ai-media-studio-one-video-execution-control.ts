import { z } from "zod";

const publicKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u"));
const cleanLabel = z.string().trim().min(1).max(200).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const instant = z.string().datetime({ offset: true });

export const oneVideoExecutionReasonCodes = [
  "binding_stale", "binding_invalid", "provider_verification_not_requested",
  "provider_verification_failed", "provider_verification_stale", "provider_verification_unavailable",
  "maximum_quote_missing", "maximum_quote_declined", "maximum_quote_expired", "maximum_quote_stale",
  "maximum_quote_unavailable", "human_approval_not_requested", "human_approval_rejected",
  "human_approval_revoked", "human_approval_expired", "human_approval_stale", "human_approval_unavailable",
  "one_shot_executor_not_installed",
] as const;

const resourceSchema = z.object({ key: publicKey("resource"), label: cleanLabel }).strict();
const providerVerificationSchema = z.object({
  state: z.enum(["not_requested", "verified", "failed", "stale", "unavailable"]),
  evidenceKey: publicKey("evidence").optional(), observedAt: instant.optional(), expiresAt: instant.optional(),
}).strict();
const maximumQuoteSchema = z.object({
  state: z.enum(["missing", "quoted", "declined", "expired", "stale", "unavailable"]),
  amountMicroUsd: z.string().regex(/^[1-9][0-9]{0,15}$/u).optional(), currency: z.literal("USD").optional(),
  evidenceKey: publicKey("evidence").optional(), observedAt: instant.optional(), expiresAt: instant.optional(),
}).strict();
const humanApprovalSchema = z.object({
  state: z.enum(["not_requested", "approved", "rejected", "revoked", "expired", "stale", "unavailable"]),
  evidenceKey: publicKey("evidence").optional(), observedAt: instant.optional(), expiresAt: instant.optional(),
}).strict();

export const oneVideoExecutionControlSchema = z.object({
  version: z.literal(1), source: z.literal("postgresql_read_only"),
  subject: z.object({
    planId: publicKey("plan"), batchId: publicKey("batch"), slotId: publicKey("slot"),
    slotAttempt: z.number().int().min(1),
  }).strict(),
  observedAt: instant,
  selection: z.object({
    selectionKey: publicKey("selection"), creator: z.object({ label: cleanLabel }).strict(),
    avatar: resourceSchema, voice: resourceSchema,
  }).strict(),
  format: z.object({ aspectRatio: z.literal("9:16"), container: z.literal("mp4") }).strict(),
  binding: z.object({
    state: z.enum(["current", "stale", "invalid"]), credentialVersion: z.number().int().min(1),
  }).strict(),
  providerVerification: providerVerificationSchema,
  maximumQuote: maximumQuoteSchema,
  humanApproval: humanApprovalSchema,
  execute: z.object({
    state: z.literal("disabled"), postAvailable: z.literal(false),
    reasonCodes: z.array(z.enum(oneVideoExecutionReasonCodes)).min(1),
  }).strict(),
  effects: z.object({
    providerCalled: z.literal(false), secretResolved: z.literal(false), verificationPerformed: z.literal(false),
    quoteRequested: z.literal(false), approvalRecorded: z.literal(false), reservationCreated: z.literal(false),
    renderCreated: z.literal(false), outboxCreated: z.literal(false), spendCommitted: z.literal(false),
    publishingCreated: z.literal(false),
  }).strict(),
  authoritativeForAdmission: z.literal(false), canGenerate: z.literal(false), spendAuthorized: z.literal(false),
}).strict().superRefine((packet, context) => {
  const quoteHasMoney = packet.maximumQuote.amountMicroUsd !== undefined || packet.maximumQuote.currency !== undefined;
  const quoteHasEvidence = packet.maximumQuote.evidenceKey !== undefined;
  const humanHasEvidence = packet.humanApproval.evidenceKey !== undefined;
  const verificationHasEvidence = packet.providerVerification.evidenceKey !== undefined;
  const currentEvidenceAllowed = packet.binding.state === "current" && packet.providerVerification.state === "verified";
  if ((packet.maximumQuote.state === "quoted") !== quoteHasMoney
    || (packet.maximumQuote.state !== "missing" && packet.maximumQuote.state !== "unavailable") !== quoteHasEvidence
    || (packet.humanApproval.state !== "not_requested" && packet.humanApproval.state !== "unavailable") !== humanHasEvidence
    || (packet.providerVerification.state === "verified") !== verificationHasEvidence
    || (packet.providerVerification.state === "verified"
      && (!packet.providerVerification.observedAt || !packet.providerVerification.expiresAt))
    || (["quoted", "declined", "expired"].includes(packet.maximumQuote.state) && !currentEvidenceAllowed)
    || (["approved", "rejected", "revoked", "expired"].includes(packet.humanApproval.state) && !currentEvidenceAllowed)
    || (packet.humanApproval.state === "approved" && packet.maximumQuote.state !== "quoted")
    || !packet.execute.reasonCodes.includes("one_shot_executor_not_installed")
    || Object.values(packet.effects).some(Boolean)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "One-video execution-control invariants are inconsistent" });
  }
});

export const oneVideoExecutionControlResponseSchema = z.object({
  executionControl: oneVideoExecutionControlSchema,
}).strict();

export type OneVideoExecutionControl = z.infer<typeof oneVideoExecutionControlSchema>;
