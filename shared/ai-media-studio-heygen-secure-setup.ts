import { z } from "zod";

const plainObject = (value: unknown): unknown => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  ? value
  : Symbol.for("ai-media-studio.invalid-plain-object");

const idempotencyKeySchema = z.string().trim().min(8).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u);

export const registerHeyGenCredentialReferenceRequestSchema = z.preprocess(
  plainObject,
  z.object({ idempotencyKey: idempotencyKeySchema }).strict(),
);

export const registerHeyGenCredentialReferenceResponseSchema = z.object({
  outcome: z.enum(["created", "replayed"]),
  credentialReference: z.object({
    providerKey: z.literal("heygen"),
    state: z.literal("registered"),
    credentialVersion: z.number().int().min(1),
  }).strict(),
}).strict();

export const runHeyGenLiveVerificationRequestSchema = z.preprocess(
  plainObject,
  z.object({ idempotencyKey: idempotencyKeySchema }).strict(),
);

export const runHeyGenLiveVerificationResponseSchema = z.object({
  outcome: z.enum(["recorded", "replayed"]),
  verification: z.object({
    providerKey: z.literal("heygen"),
    state: z.literal("verified"),
    avatarCount: z.number().int().min(5).max(10),
    voiceCount: z.number().int().min(1).max(10),
    observedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  }).strict(),
  effects: z.object({
    providerNetworkCall: z.boolean(),
    liveVerification: z.boolean(),
    generation: z.literal(false),
    admission: z.literal(false),
    spend: z.literal(false),
    deployment: z.literal(false),
    migrationApply: z.literal(false),
    publishing: z.literal(false),
  }).strict(),
}).strict().superRefine((value, context) => {
  const calledProvider = value.outcome === "recorded";
  if (value.effects.providerNetworkCall !== calledProvider || value.effects.liveVerification !== calledProvider) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Verification effects do not match the outcome" });
  }
});

export const runHeyGenLiveVerificationFailureResponseSchema = z.object({
  outcome: z.literal("provider_failed"),
  providerKey: z.literal("heygen"),
  failureCode: z.enum([
    "invalid_request",
    "account_unavailable",
    "avatar_look_unavailable",
    "avatar_group_unavailable",
    "voice_unavailable",
    "provider_response_untrusted",
    "provider_rate_limited",
    "provider_unauthorized",
    "provider_forbidden",
    "provider_not_found",
    "provider_timeout",
    "provider_transport_error",
  ]),
  observedAt: z.string().datetime({ offset: true }),
  effects: z.object({
    providerNetworkCall: z.literal(true),
    liveVerification: z.literal(false),
    generation: z.literal(false),
    admission: z.literal(false),
    spend: z.literal(false),
    deployment: z.literal(false),
    migrationApply: z.literal(false),
    publishing: z.literal(false),
  }).strict(),
}).strict();

export type RegisterHeyGenCredentialReferenceRequest = z.infer<typeof registerHeyGenCredentialReferenceRequestSchema>;
export type RegisterHeyGenCredentialReferenceResponse = z.infer<typeof registerHeyGenCredentialReferenceResponseSchema>;
export type RunHeyGenLiveVerificationRequest = z.infer<typeof runHeyGenLiveVerificationRequestSchema>;
export type RunHeyGenLiveVerificationResponse = z.infer<typeof runHeyGenLiveVerificationResponseSchema>;
export type RunHeyGenLiveVerificationFailureResponse = z.infer<typeof runHeyGenLiveVerificationFailureResponseSchema>;
