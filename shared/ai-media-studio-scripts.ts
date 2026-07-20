import { z } from "zod";

export const mediaSourceTypeSchema = z.enum([
  "events",
  "restaurants",
  "hotels",
  "nightclubs",
  "deals",
  "travel_packages",
  "beach_clubs",
  "experiences",
]);

export const mediaSourceSnapshotSchema = z.object({
  type: mediaSourceTypeSchema,
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4_000),
  language: z.string().trim().min(2).max(35).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  url: z.string().url().optional(),
  facts: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
});

export const scriptVariantSchema = z.object({
  id: z.string().trim().min(1).max(128),
  angle: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  hook: z.string().trim().min(1).max(500),
  script: z.string().trim().min(1).max(5_000),
  cta: z.string().trim().min(1).max(500),
  caption: z.string().trim().min(1).max(2_200),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30),
  seoKeywords: z.array(z.string().trim().min(1).max(120)).max(50),
});

export const generateScriptVariantsRequestSchema = z.object({
  source: mediaSourceSnapshotSchema,
  influencerId: z.string().trim().min(1).max(128).optional(),
  language: z.string().trim().min(2).max(35),
  angle: z.string().trim().min(1).max(120).optional(),
  variantCount: z.number().int().min(1).max(5).default(3),
});

export const scriptSetSchema = scriptVariantSchema.omit({ id: true }).extend({
  id: z.string().trim().min(1).max(128),
  source: mediaSourceSnapshotSchema.pick({ type: true, id: true, title: true }),
  influencerId: z.string().trim().min(1).max(128).optional(),
  language: z.string().trim().min(2).max(35),
  variants: z.array(scriptVariantSchema).min(1).max(5),
});

export const generateScriptVariantsResponseSchema = z.object({
  scriptSet: scriptSetSchema,
  generation: z.object({
    mode: z.enum(["deterministic", "strong_model"]),
    estimatedCostUsd: z.number().nonnegative(),
    generatedAt: z.string().datetime(),
  }),
});

export type MediaSourceType = z.infer<typeof mediaSourceTypeSchema>;
export type MediaSourceSnapshot = z.infer<typeof mediaSourceSnapshotSchema>;
export type ScriptVariant = z.infer<typeof scriptVariantSchema>;
export type GenerateScriptVariantsRequest = z.input<typeof generateScriptVariantsRequestSchema>;
export type ParsedGenerateScriptVariantsRequest = z.output<typeof generateScriptVariantsRequestSchema>;
export type ScriptSet = z.infer<typeof scriptSetSchema>;
export type GenerateScriptVariantsResponse = z.infer<typeof generateScriptVariantsResponseSchema>;
