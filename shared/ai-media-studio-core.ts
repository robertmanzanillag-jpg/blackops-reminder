import { z } from "zod";

/**
 * Provider-neutral public contracts for the AI Media Studio core catalog.
 *
 * IDs in this module are Kong-owned canonical IDs. Provider-native identifiers
 * and credentials intentionally have no representation in these DTOs.
 */

const canonicalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const isoDateSchema = z.string().datetime({ offset: true });
const shortLabelSchema = z.string().trim().min(1).max(120);
const categorySchema = z.string().trim().min(1).max(80);
const languageCodeSchema = z.string().trim().min(2).max(35);
const hexColorSchema = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Use a six-digit hex color");

export const influencerStatusSchema = z.enum(["draft", "active", "paused", "archived"]);
export const influencerGenderSchema = z.enum(["female", "male", "non_binary", "unspecified"]);
export const providerResourceKindSchema = z.enum(["avatar", "voice"]);
export const providerResourceStatusSchema = z.enum(["active", "inactive", "archived"]);
export const mediaAssetKindSchema = z.enum([
  "video",
  "script",
  "voice",
  "b_roll",
  "image",
  "music",
  "logo",
  "subtitle",
  "thumbnail",
]);
export const mediaAssetStatusSchema = z.enum(["processing", "ready", "failed", "archived"]);

export const influencerAgeRangeSchema = z
  .object({
    minimum: z.number().int().min(18).max(120),
    maximum: z.number().int().min(18).max(120),
  })
  .strict()
  .refine(({ minimum, maximum }) => minimum <= maximum, {
    message: "minimum age must not exceed maximum age",
    path: ["maximum"],
  });

export const influencerCoreFieldsSchema = z
  .object({
    name: shortLabelSchema,
    avatarResourceId: canonicalIdSchema.nullable(),
    voiceResourceId: canonicalIdSchema.nullable(),
    accent: z.string().trim().min(1).max(80),
    language: languageCodeSchema,
    gender: influencerGenderSchema,
    ageRange: influencerAgeRangeSchema,
    personality: z.array(categorySchema).min(1).max(20),
    tone: z.array(categorySchema).min(1).max(12),
    speakingStyle: z.string().trim().min(1).max(500),
    categories: z.array(categorySchema).min(1).max(30),
    intro: z.string().trim().min(1).max(1_000),
    outro: z.string().trim().min(1).max(1_000),
    energyLevel: z.number().int().min(1).max(10),
    facialExpressions: z.array(categorySchema).min(1).max(20),
    brandColors: z.array(hexColorSchema).min(1).max(12),
    status: influencerStatusSchema,
  })
  .strict();

export const createInfluencerRequestSchema = influencerCoreFieldsSchema;

export const updateInfluencerRequestSchema = influencerCoreFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one influencer field is required");

export const influencerSchema = influencerCoreFieldsSchema
  .extend({
    id: canonicalIdSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export const influencerResponseSchema = z.object({ influencer: influencerSchema }).strict();
export const influencerListRequestSchema = z
  .object({
    status: influencerStatusSchema.optional(),
    category: categorySchema.optional(),
    language: languageCodeSchema.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    cursor: canonicalIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const influencerListResponseSchema = z
  .object({
    influencers: z.array(influencerSchema).max(100),
    nextCursor: canonicalIdSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const providerResourceSchema = z
  .object({
    id: canonicalIdSchema,
    kind: providerResourceKindSchema,
    name: shortLabelSchema,
    status: providerResourceStatusSchema,
    language: languageCodeSchema.nullable(),
    accent: z.string().trim().max(80).nullable(),
    gender: influencerGenderSchema.nullable(),
    previewUrl: z.string().url().startsWith("https://").nullable(),
    thumbnailUrl: z.string().url().startsWith("https://").nullable(),
    synchronizedAt: isoDateSchema.nullable(),
  })
  .strict();

export const providerResourceListRequestSchema = z
  .object({
    kind: providerResourceKindSchema.optional(),
    status: providerResourceStatusSchema.optional(),
    language: languageCodeSchema.optional(),
    cursor: canonicalIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const providerResourceListResponseSchema = z
  .object({
    resources: z.array(providerResourceSchema).max(100),
    nextCursor: canonicalIdSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const mediaAssetSchema = z
  .object({
    id: canonicalIdSchema,
    kind: mediaAssetKindSchema,
    name: z.string().trim().min(1).max(240),
    status: mediaAssetStatusSchema,
    mimeType: z.string().trim().min(1).max(120),
    byteSize: z.number().int().nonnegative().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    checksum: z.string().trim().min(16).max(256).nullable(),
    deliveryUrl: z.string().url().startsWith("https://").nullable(),
    thumbnailUrl: z.string().url().startsWith("https://").nullable(),
    influencerId: canonicalIdSchema.nullable(),
    projectId: canonicalIdSchema.nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export const mediaLibraryRequestSchema = z
  .object({
    kinds: z.array(mediaAssetKindSchema).min(1).max(mediaAssetKindSchema.options.length).optional(),
    status: mediaAssetStatusSchema.optional(),
    influencerId: canonicalIdSchema.optional(),
    projectId: canonicalIdSchema.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    cursor: canonicalIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const mediaLibraryResponseSchema = z
  .object({
    assets: z.array(mediaAssetSchema).max(100),
    nextCursor: canonicalIdSchema.nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const assetDeliverySchema = z.object({
  url: z.string().url().startsWith("https://"),
  expiresAt: isoDateSchema,
}).strict();

export type InfluencerStatus = z.infer<typeof influencerStatusSchema>;
export type InfluencerGender = z.infer<typeof influencerGenderSchema>;
export type InfluencerAgeRange = z.infer<typeof influencerAgeRangeSchema>;
export type CreateInfluencerRequest = z.infer<typeof createInfluencerRequestSchema>;
export type UpdateInfluencerRequest = z.infer<typeof updateInfluencerRequestSchema>;
export type Influencer = z.infer<typeof influencerSchema>;
export type InfluencerListRequest = z.infer<typeof influencerListRequestSchema>;
export type InfluencerListResponse = z.infer<typeof influencerListResponseSchema>;
export type ProviderResource = z.infer<typeof providerResourceSchema>;
export type ProviderResourceListRequest = z.infer<typeof providerResourceListRequestSchema>;
export type ProviderResourceListResponse = z.infer<typeof providerResourceListResponseSchema>;
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaLibraryRequest = z.infer<typeof mediaLibraryRequestSchema>;
export type MediaLibraryResponse = z.infer<typeof mediaLibraryResponseSchema>;
export type AssetDelivery = z.infer<typeof assetDeliverySchema>;
