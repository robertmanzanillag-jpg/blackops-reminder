import { z } from "zod";

export * from "./ai-media-studio-scripts";

export const AI_MEDIA_STUDIO_API_BASE = "/api/ai-media-studio" as const;
export const AI_MEDIA_STUDIO_ROUTE = "/ai-media-studio" as const;

export const mediaJobStatusSchema = z.enum(["pending", "rendering", "completed", "failed", "cancelled"]);
export const providerHealthStatusSchema = z.enum(["healthy", "degraded", "offline", "unconfigured"]);

export const mediaJobSchema = z.object({
  id: z.string().trim().min(1).max(128),
  generationId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  influencerName: z.string().trim().max(120).default(""),
  status: mediaJobStatusSchema,
  stage: z.string().trim().max(120).default("queued"),
  progress: z.number().min(0).max(100),
  aspectRatio: z.literal("9:16"),
  language: z.string().trim().min(2).max(35),
  estimatedCostUsd: z.number().nonnegative(),
  actualCostUsd: z.number().nonnegative().optional(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  estimatedCompletionAt: z.string().datetime().optional(),
  error: z.string().trim().max(1_000).optional(),
  asset: z.object({
    id: z.string().trim().min(1).max(128).optional(),
    url: z.string().url().optional(),
    thumbnailUrl: z.string().url().optional(),
    mimeType: z.string().trim().max(120).optional(),
  }).optional(),
});

export const providerStatusSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  label: z.string().trim().min(1).max(120),
  status: providerHealthStatusSchema,
  capabilities: z.array(z.string().trim().min(1).max(80)).max(50),
  lastCheckedAt: z.string().datetime().nullable(),
});

export const dashboardResponseSchema = z.object({
  summary: z.object({
    generatedToday: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    avgGenerationMs: z.number().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }),
  providers: z.array(providerStatusSchema),
  queue: z.object({
    pending: z.number().int().nonnegative(),
    rendering: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
  recentActivity: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    type: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(500),
    createdAt: z.string().datetime(),
  })).max(100),
});

export const influencerOptionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  categories: z.array(z.string().trim().min(1).max(80)).max(30),
  language: z.string().trim().min(2).max(35),
  voiceId: z.string().trim().min(1).max(128),
  status: z.string().trim().min(1).max(40),
});

export const voiceOptionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(35),
  accent: z.string().trim().max(80),
});

export const languageOptionSchema = z.object({
  code: z.string().trim().min(2).max(35),
  label: z.string().trim().min(1).max(120),
});

export const mediaStudioOptionsResponseSchema = z.object({
  influencers: z.array(influencerOptionSchema),
  voices: z.array(voiceOptionSchema),
  languages: z.array(languageOptionSchema),
});

export const createGenerationRequestSchema = z.object({
  influencerId: z.string().trim().min(1).max(128),
  script: z.string().trim().min(1).max(5_000),
  voiceId: z.string().trim().min(1).max(128),
  language: z.string().trim().min(2).max(35),
  aspectRatio: z.literal("9:16"),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/),
});

export const createGenerationResponseSchema = z.object({
  generationId: z.string().trim().min(1).max(128),
  jobId: z.string().trim().min(1).max(128),
  job: mediaJobSchema,
});

export const mediaJobResponseSchema = z.object({ job: mediaJobSchema });
export const mediaJobsResponseSchema = z.object({ jobs: z.array(mediaJobSchema) });

export type MediaJobStatus = z.infer<typeof mediaJobStatusSchema>;
export type ProviderHealthStatus = z.infer<typeof providerHealthStatusSchema>;
export type MediaJob = z.infer<typeof mediaJobSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type AiMediaStudioDashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type AiMediaStudioOptionsResponse = z.infer<typeof mediaStudioOptionsResponseSchema>;
export type CreateGenerationRequest = z.infer<typeof createGenerationRequestSchema>;
export type CreateGenerationResponse = z.infer<typeof createGenerationResponseSchema>;
export type MediaJobResponse = z.infer<typeof mediaJobResponseSchema>;
export type MediaJobsResponse = z.infer<typeof mediaJobsResponseSchema>;
