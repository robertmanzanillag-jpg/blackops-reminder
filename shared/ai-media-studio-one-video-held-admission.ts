import { z } from "zod";

const publicKey = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u"));
const idempotencyKey = z.string().trim().min(8).max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const microUsd = z.string().regex(/^[1-9]\d{0,15}$/u)
  .refine((value) => /^[1-9]\d{0,15}$/u.test(value)
    && BigInt(value) <= 9_000_000_000_000_000n, "maximum quote exceeds the supported bound");
const instant = z.string().datetime({ offset: true });

export const oneVideoHeldAdmissionPathSchema = z.object({
  planId: publicKey("plan"),
  slotId: publicKey("slot"),
}).strict();

/**
 * Browser-owned compare-and-swap tokens only. Money, provider identity,
 * internal UUIDs, digests, expiry instants and database versions are all
 * intentionally absent and rejected by the strict schema.
 */
export const oneVideoHeldAdmissionRequestSchema = z.object({
  expectedBatchId: publicKey("batch"),
  expectedQuoteKey: publicKey("quote"),
  expectedRenderSpecKey: publicKey("render_spec"),
  expectedSlotAttempt: z.number().int().positive().max(1_000_000),
  idempotencyKey,
}).strict();

const internalEffectsSchema = z.object({
  internalBudgetReserved: z.boolean(),
  heldRenderCreated: z.boolean(),
  heldOutboxCreated: z.boolean(),
}).strict();

const externalEffectsSchema = z.object({
  secretResolved: z.literal(false),
  providerCalled: z.literal(false),
  verificationPerformed: z.literal(false),
  quoteRequested: z.literal(false),
  activationAuthorized: z.literal(false),
  externalSpendCommitted: z.literal(false),
  providerSubmissionStarted: z.literal(false),
  renderSubmitted: z.literal(false),
  renderArtifactCreated: z.literal(false),
  publishingCreated: z.literal(false),
}).strict();

export const oneVideoHeldAdmissionResponseSchema = z.object({
  outcome: z.enum(["admitted", "replayed"]),
  admission: z.object({
    planId: publicKey("plan"),
    batchId: publicKey("batch"),
    slotId: publicKey("slot"),
    slotAttempt: z.number().int().positive().max(1_000_000),
    quoteKey: publicKey("quote"),
    renderSpecKey: publicKey("render_spec"),
    reservationKey: publicKey("reservation"),
    maximumQuoteMicroUsd: microUsd,
    currency: z.literal("USD"),
    reservationExpiresAt: instant,
    state: z.literal("held"),
  }).strict(),
  effects: z.object({
    internal: internalEffectsSchema,
    external: externalEffectsSchema,
  }).strict(),
  canGenerate: z.literal(false),
  spendAuthorized: z.literal(false),
}).strict().superRefine((value, context) => {
  const created = value.outcome === "admitted";
  if (value.effects.internal.internalBudgetReserved !== created
    || value.effects.internal.heldRenderCreated !== created
    || value.effects.internal.heldOutboxCreated !== created) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Held-admission outcome and internal effects are inconsistent",
    });
  }
});

export type OneVideoHeldAdmissionRequest = z.infer<typeof oneVideoHeldAdmissionRequestSchema>;
export type OneVideoHeldAdmissionResponse = z.infer<typeof oneVideoHeldAdmissionResponseSchema>;
