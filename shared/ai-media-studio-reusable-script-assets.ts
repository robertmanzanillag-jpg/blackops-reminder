import { z } from "zod";
import { sourceAutomationCategorySchema } from "./ai-media-studio-operations";
import { sourceScriptPreviewRequestSchema } from "./ai-media-studio-source-to-script";
import { scriptVariantSchema } from "./ai-media-studio-scripts";

const canonicalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });

export const reusableScriptAssetSaveRequestSchema = z
  .object({
    previewRequest: sourceScriptPreviewRequestSchema,
    expectedSourceContentHash: sha256DigestSchema,
    expectedPreviewDigest: sha256DigestSchema,
    selectedVariantId: canonicalIdSchema,
    saveIdempotencyKey: canonicalIdSchema,
  })
  .strict();

export const reusableScriptAssetVariantSchema = scriptVariantSchema
  .omit({ id: true })
  .extend({
    id: uuidSchema,
    version: z.number().int().min(1).max(5),
    checksum: sha256DigestSchema,
  })
  .strict();

export const reusableScriptAssetSchema = z
  .object({
    id: uuidSchema,
    title: z.string().trim().min(1).max(200),
    source: z
      .object({
        id: canonicalIdSchema,
        category: sourceAutomationCategorySchema,
        contentHash: sha256DigestSchema,
      })
      .strict(),
    influencerId: canonicalIdSchema.optional(),
    language: z.string().trim().min(2).max(35),
    status: z.enum(["draft", "approved", "archived"]),
    currentVariantId: uuidSchema,
    variants: z.array(reusableScriptAssetVariantSchema).min(1).max(5),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export const reusableScriptAssetEffectsSchema = z
  .object({
    sourceRead: z.literal(true),
    scriptPreviewGenerated: z.literal(true),
    scriptPersisted: z.literal(true),
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

export const reusableScriptAssetSaveResponseSchema = z
  .object({
    asset: reusableScriptAssetSchema,
    replayed: z.boolean(),
    downstreamState: z.literal("blocked_before_render_admission"),
    effects: reusableScriptAssetEffectsSchema,
  })
  .strict();

export const reusableScriptAssetListRequestSchema = z
  .object({
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(["draft", "approved", "archived"]).optional(),
  })
  .strict();

export const reusableScriptAssetListResponseSchema = z
  .object({
    items: z.array(reusableScriptAssetSchema).max(100),
    nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export type ReusableScriptAssetSaveRequest = z.infer<typeof reusableScriptAssetSaveRequestSchema>;
export type ReusableScriptAsset = z.infer<typeof reusableScriptAssetSchema>;
export type ReusableScriptAssetVariant = z.infer<typeof reusableScriptAssetVariantSchema>;
export type ReusableScriptAssetSaveResponse = z.infer<typeof reusableScriptAssetSaveResponseSchema>;
export type ReusableScriptAssetListRequest = z.output<typeof reusableScriptAssetListRequestSchema>;
export type ReusableScriptAssetListResponse = z.infer<typeof reusableScriptAssetListResponseSchema>;
