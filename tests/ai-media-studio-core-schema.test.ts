import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createInfluencerRequestSchema,
  influencerListRequestSchema,
  influencerSchema,
  mediaAssetSchema,
  mediaAssetKindSchema,
  mediaLibraryRequestSchema,
  providerResourceSchema,
  updateInfluencerRequestSchema,
} from "../shared/ai-media-studio-core";

const validInfluencer = {
  name: "Emily",
  avatarResourceId: "avatar_01",
  voiceResourceId: "voice_01",
  accent: "Miami English",
  language: "en-US",
  gender: "female" as const,
  ageRange: { minimum: 25, maximum: 34 },
  personality: ["curious", "warm"],
  tone: ["confident", "conversational"],
  speakingStyle: "Natural, concise, and enthusiastic",
  categories: ["food", "restaurants", "brunch", "coffee"],
  intro: "Hey, it's Emily with today's hidden gem.",
  outro: "Save this and follow Kong for the next spot.",
  energyLevel: 7,
  facialExpressions: ["warm smile", "curious eyebrow raise"],
  brandColors: ["#111827", "#F59E0B"],
  status: "active" as const,
};

test("influencer CRUD contracts cover every required persona field", () => {
  assert.deepEqual(createInfluencerRequestSchema.parse(validInfluencer), validInfluencer);
  assert.deepEqual(updateInfluencerRequestSchema.parse({ tone: ["luxury"], energyLevel: 5 }), {
    tone: ["luxury"],
    energyLevel: 5,
  });
  assert.throws(() => updateInfluencerRequestSchema.parse({}));
  assert.throws(() => createInfluencerRequestSchema.parse({ ...validInfluencer, ageRange: { minimum: 40, maximum: 30 } }));

  const saved = influencerSchema.parse({
    ...validInfluencer,
    id: "inf_01",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
  });
  assert.equal(saved.categories.length, 4);
  assert.deepEqual(influencerListRequestSchema.parse({ category: "food" }), {
    category: "food",
    limit: 25,
  });
});

test("public provider resources expose canonical IDs and reject provider internals", () => {
  const safeResource = {
    id: "voice_01",
    kind: "voice" as const,
    name: "Warm US English",
    status: "active" as const,
    language: "en-US",
    accent: "US",
    gender: "female" as const,
    previewUrl: "https://media.kong.example/previews/voice_01.mp3",
    thumbnailUrl: null,
    synchronizedAt: "2026-07-20T12:00:00.000Z",
  };
  assert.deepEqual(providerResourceSchema.parse(safeResource), safeResource);

  for (const unsafeField of ["externalResourceId", "apiKey", "secretRef", "accessToken"]) {
    assert.equal(providerResourceSchema.safeParse({ ...safeResource, [unsafeField]: "must-not-leak" }).success, false);
  }
});

test("media library supports every asset type and bounded cursor pagination", () => {
  assert.deepEqual(mediaAssetKindSchema.options, [
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
  assert.deepEqual(mediaLibraryRequestSchema.parse({ kinds: ["video", "b_roll"], cursor: "asset_10" }), {
    kinds: ["video", "b_roll"],
    cursor: "asset_10",
    limit: 25,
  });
  assert.equal(mediaLibraryRequestSchema.safeParse({ limit: 101 }).success, false);
  for (const status of ["processing", "failed", "archived"] as const) {
    const asset = mediaAssetSchema.parse({
      id: `asset_${status}`,
      kind: "video",
      name: `${status} asset`,
      status,
      mimeType: "video/mp4",
      byteSize: null,
      width: null,
      height: null,
      durationMs: null,
      checksum: null,
      deliveryUrl: null,
      thumbnailUrl: null,
      influencerId: "influencer_1",
      projectId: "project_1",
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
    });
    assert.equal(asset.status, status);
  }
});

test("durable catalog tables are tenant-safe and render jobs are leaseable", () => {
  const source = readFileSync(resolve(process.cwd(), "shared/models/ai-media-studio-db.ts"), "utf8");

  for (const column of [
    "accent",
    "language",
    "gender",
    "ageRange",
    "personality",
    "tone",
    "speakingStyle",
    "categories",
    "intro",
    "outro",
    "energyLevel",
    "facialExpressions",
    "brandColors",
  ]) {
    assert.match(source, new RegExp(`${column}:`));
  }

  assert.match(source, /defaultVoiceResourceId:[\s\S]*references\([\s\S]*aiMediaProviderResources\.id/);
  assert.match(source, /defaultAvatarResourceId:[\s\S]*references\([\s\S]*aiMediaProviderResources\.id/);
  assert.match(source, /providerResourceId:[\s\S]*references\([\s\S]*aiMediaProviderResources\.id/);
  assert.match(source, /ai_media_provider_resources_owner_workspace_canonical_uq/);
  assert.match(source, /ai_media_assets_owner_workspace_library_idx/);
  assert.match(source, /thumbnailUrl: text\("thumbnail_url"\)/);

  for (const leaseField of ["availableAt", "leaseOwner", "leaseExpiresAt", "deadLetterAt"]) {
    assert.match(source, new RegExp(`${leaseField}:`));
  }
  assert.match(source, /ai_media_render_jobs_owner_workspace_lease_idx/);
  assert.match(source, /ai_media_render_jobs_dead_letter_idx/);

  const resourceUnique = source.slice(
    source.indexOf('uniqueIndex("ai_media_provider_resources_provider_external_uq")'),
    source.indexOf('uniqueIndex("ai_media_provider_resources_owner_workspace_canonical_uq")'),
  );
  assert.match(resourceUnique, /table\.ownerUserId/);
  assert.match(resourceUnique, /table\.workspaceId/);

  const assetUnique = source.slice(
    source.indexOf('uniqueIndex("ai_media_assets_storage_object_uq")'),
    source.indexOf('index("ai_media_assets_owner_workspace_project_idx")'),
  );
  assert.match(assetUnique, /table\.ownerUserId/);
  assert.match(assetUnique, /table\.workspaceId/);
});
