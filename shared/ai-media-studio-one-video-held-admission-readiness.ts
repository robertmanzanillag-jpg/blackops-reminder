import { z } from "zod";

const publicKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u"));
const instant = z.string().datetime({ offset: true });
const microUsd = z.string().regex(/^[1-9]\d{0,15}$/u)
  .refine((value) => BigInt(value) <= 9_000_000_000_000_000n, "maximum quote exceeds the supported bound");

export const oneVideoHeldAdmissionReadinessReasonCodes = [
  "batch_not_approved",
  "batch_changed",
  "slot_not_approved",
  "slot_attempt_changed",
  "launch_intent_missing",
  "launch_intent_stale",
  "content_approval_missing",
  "content_approval_stale",
  "sandbox_proof_missing",
  "sandbox_proof_stale",
  "policy_inactive",
  "policy_stale",
  "kill_switch_active",
  "governance_stale",
  "credential_stale",
  "source_stale",
  "provider_verification_missing",
  "provider_verification_stale",
  "maximum_quote_missing",
  "maximum_quote_stale",
  "human_approval_missing",
  "human_approval_stale",
  "authority_snapshot_missing",
  "authority_snapshot_stale",
  "budget_unavailable",
  "concurrency_unavailable",
  "existing_attempt",
  "observation_unavailable",
] as const;

const subjectSchema = z.object({
  planId: publicKey("plan"),
  batchId: publicKey("batch"),
  slotId: publicKey("slot"),
  slotAttempt: z.number().int().positive().max(1_000_000),
}).strict();

const casSchema = z.object({
  expectedBatchId: publicKey("batch"),
  expectedQuoteKey: publicKey("quote"),
  expectedRenderSpecKey: publicKey("render_spec"),
  expectedSlotAttempt: z.number().int().positive().max(1_000_000),
}).strict();

const currentReservationSchema = z.object({
  reservationKey: publicKey("reservation"),
  maximumQuoteMicroUsd: microUsd,
  currency: z.literal("USD"),
  expiresAt: instant,
  state: z.enum(["held", "expired"]),
}).strict();

const readinessEffectsSchema = z.object({
  providerCalled: z.literal(false),
  secretResolved: z.literal(false),
  externalSpendCommitted: z.literal(false),
  renderArtifactCreated: z.literal(false),
  publishingCreated: z.literal(false),
}).strict();

export const oneVideoHeldAdmissionReadinessSchema = z.object({
  version: z.literal(1),
  source: z.literal("postgresql_read_only"),
  subject: subjectSchema,
  observedAt: instant,
  state: z.enum(["available", "blocked", "held", "expired"]),
  postAvailable: z.boolean(),
  reasonCodes: z.array(z.enum(oneVideoHeldAdmissionReadinessReasonCodes)),
  cas: casSchema.optional(),
  currentReservation: currentReservationSchema.optional(),
  effects: readinessEffectsSchema,
  canGenerate: z.literal(false),
  spendAuthorized: z.literal(false),
}).strict().superRefine((value, context) => {
  const available = value.state === "available";
  const blocked = value.state === "blocked";
  const hasCurrentReservation = value.state === "held" || value.state === "expired";
  const reservationStateMatches = value.currentReservation?.state === value.state;
  const casMatchesSubject = value.cas?.expectedBatchId === value.subject.batchId
    && value.cas?.expectedSlotAttempt === value.subject.slotAttempt;

  if (value.postAvailable !== available
    || (value.cas !== undefined) !== available
    || (available && !casMatchesSubject)
    || (value.reasonCodes.length > 0) !== blocked
    || (value.currentReservation !== undefined) !== hasCurrentReservation
    || (hasCurrentReservation && !reservationStateMatches)
    || Object.values(value.effects).some(Boolean)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Held-admission readiness invariants are inconsistent",
    });
  }
});

export const oneVideoHeldAdmissionReadinessResponseSchema = z.object({
  readiness: oneVideoHeldAdmissionReadinessSchema,
}).strict();

export type OneVideoHeldAdmissionReadiness = z.infer<typeof oneVideoHeldAdmissionReadinessSchema>;
