import { z } from "zod";

export const AI_MEDIA_OAUTH_PLATFORMS = [
  "tiktok",
  "instagram",
  "facebook",
  "youtube_shorts",
] as const;

export const aiMediaOAuthPlatformSchema = z.enum(AI_MEDIA_OAUTH_PLATFORMS);
export const aiMediaOAuthOutcomeSchema = z.enum(["authorized", "denied", "error"]);
export const AI_MEDIA_OAUTH_EXCHANGE_STATUSES = [
  "not_started", "ready", "in_progress", "succeeded", "not_required", "failed",
  "indeterminate", "legacy_authorized_unbound",
] as const;
export const aiMediaOAuthExchangeStatusSchema = z.enum(AI_MEDIA_OAUTH_EXCHANGE_STATUSES);
export const AI_MEDIA_OAUTH_PKCE_MODES = ["required_s256", "none"] as const;
export const aiMediaOAuthPkceModeSchema = z.enum(AI_MEDIA_OAUTH_PKCE_MODES);

const scopeSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/);

export const aiMediaOAuthStartRequestSchema = z.object({
  providerAccountId: z.string().uuid(),
  platform: aiMediaOAuthPlatformSchema,
}).strict();

/** Safe transient response. State is returned once and only its digest is persisted. */
export const aiMediaOAuthStartResponseSchema = z.object({
  sessionId: z.string().uuid(),
  platform: aiMediaOAuthPlatformSchema,
  state: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  codeChallengeMethod: z.literal("S256").optional(),
  redirectUri: z.string().url(),
  requestedScopes: z.array(scopeSchema).min(1).max(50),
  expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if ((value.codeChallenge === undefined) !== (value.codeChallengeMethod === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PKCE response fields must be returned together" });
  }
});

export const aiMediaOAuthCallbackResponseSchema = z.object({
  sessionId: z.string().uuid(),
  platform: aiMediaOAuthPlatformSchema,
  outcome: aiMediaOAuthOutcomeSchema,
  consumedAt: z.string().datetime(),
}).strict();

export type AiMediaOAuthPlatform = z.infer<typeof aiMediaOAuthPlatformSchema>;
export type AiMediaOAuthOutcome = z.infer<typeof aiMediaOAuthOutcomeSchema>;
export type AiMediaOAuthExchangeStatus = z.infer<typeof aiMediaOAuthExchangeStatusSchema>;
export type AiMediaOAuthPkceMode = z.infer<typeof aiMediaOAuthPkceModeSchema>;
export type AiMediaOAuthStartRequest = z.infer<typeof aiMediaOAuthStartRequestSchema>;
export type AiMediaOAuthStartResponse = z.infer<typeof aiMediaOAuthStartResponseSchema>;
export type AiMediaOAuthCallbackResponse = z.infer<typeof aiMediaOAuthCallbackResponseSchema>;
