import { z } from "zod";

export const AI_MEDIA_OAUTH_PLATFORMS = [
  "tiktok",
  "instagram",
  "facebook",
  "youtube_shorts",
] as const;

export const aiMediaOAuthPlatformSchema = z.enum(AI_MEDIA_OAUTH_PLATFORMS);
export const aiMediaOAuthOutcomeSchema = z.enum(["authorized", "denied", "error"]);

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
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeChallengeMethod: z.literal("S256"),
  redirectUri: z.string().url(),
  requestedScopes: z.array(scopeSchema).min(1).max(50),
  expiresAt: z.string().datetime(),
}).strict();

export const aiMediaOAuthCallbackResponseSchema = z.object({
  sessionId: z.string().uuid(),
  platform: aiMediaOAuthPlatformSchema,
  outcome: aiMediaOAuthOutcomeSchema,
  consumedAt: z.string().datetime(),
}).strict();

export type AiMediaOAuthPlatform = z.infer<typeof aiMediaOAuthPlatformSchema>;
export type AiMediaOAuthOutcome = z.infer<typeof aiMediaOAuthOutcomeSchema>;
export type AiMediaOAuthStartRequest = z.infer<typeof aiMediaOAuthStartRequestSchema>;
export type AiMediaOAuthStartResponse = z.infer<typeof aiMediaOAuthStartResponseSchema>;
export type AiMediaOAuthCallbackResponse = z.infer<typeof aiMediaOAuthCallbackResponseSchema>;
