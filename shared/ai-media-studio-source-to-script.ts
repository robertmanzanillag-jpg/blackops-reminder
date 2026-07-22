import { z } from "zod";
import {
  moderationStatusSchema,
  sourceAutomationCategorySchema,
  sourceRightsStatusSchema,
} from "./ai-media-studio-operations";
import { scriptSetSchema } from "./ai-media-studio-scripts";

const canonicalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const sourceScriptPreviewRequestSchema = z
  .object({
    sourceItemId: canonicalIdSchema,
    idempotencyKey: canonicalIdSchema,
    influencerId: canonicalIdSchema.optional(),
    language: z.string().trim().min(2).max(35).default("en"),
    angle: z.string().trim().min(1).max(120).optional(),
    variantCount: z.number().int().min(1).max(5).default(3),
  })
  .strict();

export const sourceScriptPreviewSourceSchema = z
  .object({
    id: canonicalIdSchema,
    category: sourceAutomationCategorySchema,
    title: z.string().trim().min(1).max(500),
    contentHash: sha256DigestSchema,
    status: z.enum(["accepted", "ready"]),
    rightsStatus: sourceRightsStatusSchema.refine((value) => value === "owned" || value === "licensed"),
    moderationStatus: moderationStatusSchema.refine((value) => value === "approved"),
  })
  .strict();

export const sourceScriptPreviewEffectsSchema = z
  .object({
    sourceRead: z.literal(true),
    scriptPreviewGenerated: z.literal(true),
    scriptPersisted: z.literal(false),
    orchestrationRunCreated: z.literal(false),
    renderQueued: z.literal(false),
    outboxCreated: z.literal(false),
    videoProviderCalled: z.literal(false),
    secretResolved: z.literal(false),
    spendCommitted: z.literal(false),
    publishingCreated: z.literal(false),
    migrationApplied: z.literal(false),
    deploymentPerformed: z.literal(false),
  })
  .strict();

export const sourceScriptPreviewResponseSchema = z
  .object({
    source: sourceScriptPreviewSourceSchema,
    scriptSet: scriptSetSchema,
    previewDigest: sha256DigestSchema,
    downstreamState: z.literal("blocked_before_render_admission"),
    generation: z
      .object({
        mode: z.literal("deterministic"),
        estimatedCostUsd: z.literal(0),
        generatedAt: isoDateSchema,
      })
      .strict(),
    effects: sourceScriptPreviewEffectsSchema,
  })
  .strict();

export type SourceScriptPreviewRequest = z.input<typeof sourceScriptPreviewRequestSchema>;
export type ParsedSourceScriptPreviewRequest = z.output<typeof sourceScriptPreviewRequestSchema>;
export type SourceScriptPreviewResponse = z.infer<typeof sourceScriptPreviewResponseSchema>;
