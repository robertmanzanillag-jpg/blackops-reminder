import assert from "node:assert/strict";
import test from "node:test";
import {
  InfluencerService,
  InfluencerSlugConflictError,
  type CreateInfluencerInput,
} from "../server/ai-media-studio/core/influencer-domain";
import {
  InMemoryCanonicalResourceRepository,
  InMemoryInfluencerRepository,
} from "../server/ai-media-studio/core/in-memory-core-repositories";
import {
  CanonicalResourceService,
  CoreDomainNotFoundError,
  CoreDomainValidationError,
  type TenantScope,
} from "../server/ai-media-studio/core/resource-domain";

const fixedNow = () => new Date("2026-07-20T16:00:00.000Z");

function sequentialIds(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

async function createHarness() {
  const influencerRepository = new InMemoryInfluencerRepository();
  const resourceRepository = new InMemoryCanonicalResourceRepository();
  const resources = new CanonicalResourceService(resourceRepository, {
    idFactory: sequentialIds("resource"),
    now: fixedNow,
  });
  const influencers = new InfluencerService(influencerRepository, resourceRepository, {
    idFactory: sequentialIds("influencer"),
    now: fixedNow,
  });
  const tenant: TenantScope = { ownerUserId: "owner-a", workspaceId: "miami" };
  const avatar = await resources.create(tenant, {
    kind: "avatar",
    name: "Emily — Natural Studio",
    language: null,
    accent: null,
    gender: "female",
    previewUrl: "https://media.example.com/emily-avatar.mp4",
    thumbnailUrl: "https://media.example.com/emily-avatar.jpg",
  });
  const voice = await resources.create(tenant, {
    kind: "voice",
    name: "Emily — Warm English",
    language: "en-US",
    accent: "Miami English",
    gender: "female",
    previewUrl: "https://media.example.com/emily-voice.mp3",
    thumbnailUrl: null,
  });
  const brief: CreateInfluencerInput = {
    name: "Emily Eats",
    avatarResourceId: avatar.id,
    voiceResourceId: voice.id,
    accent: "Miami English",
    language: "en-US",
    gender: "female",
    ageRange: { minimum: 25, maximum: 34 },
    personality: ["curious", "credible", "welcoming"],
    tone: ["warm", "polished"],
    speakingStyle: "Short conversational sentences with sensory details.",
    categories: ["Food", "Restaurants", "Brunch", "Coffee"],
    intro: "Hey Miami, Emily here with a place worth adding to your list.",
    outro: "Save this for the weekend and follow for the next local find.",
    energyLevel: 7,
    facialExpressions: ["natural smile", "curious", "delighted"],
    brandColors: ["#111111", "#ffb000"],
    status: "active",
  };
  return { influencerRepository, resourceRepository, resources, influencers, tenant, avatar, voice, brief };
}

test("stores the complete influencer brief with canonical avatar and voice links", async () => {
  const { influencers, tenant, avatar, voice, brief } = await createHarness();
  const created = await influencers.create(tenant, brief);

  assert.equal(created.id, "influencer-1");
  assert.equal(created.avatarResourceId, avatar.id);
  assert.equal(created.voiceResourceId, voice.id);
  assert.equal(created.name, brief.name);
  assert.equal(created.slug, "emily-eats");
  assert.equal(created.accent, brief.accent);
  assert.equal(created.language, brief.language);
  assert.equal(created.gender, brief.gender);
  assert.deepEqual(created.ageRange, brief.ageRange);
  assert.deepEqual(created.personality, brief.personality);
  assert.deepEqual(created.tone, brief.tone);
  assert.equal(created.speakingStyle, brief.speakingStyle);
  assert.deepEqual(created.categories, ["Food", "Restaurants", "Brunch", "Coffee"]);
  assert.deepEqual(created.facialExpressions, brief.facialExpressions);
  assert.deepEqual(created.brandColors, ["#111111", "#FFB000"]);
  assert.equal(created.intro, brief.intro);
  assert.equal(created.outro, brief.outro);
  assert.equal(created.energyLevel, 7);
  assert.equal(created.status, "active");
});

test("enforces owner/workspace isolation while allowing the same slug in another tenant", async () => {
  const { influencers, resources, tenant, brief } = await createHarness();
  const created = await influencers.create(tenant, brief);
  const otherTenant = { ownerUserId: "owner-a", workspaceId: "new-york" };

  assert.deepEqual(await influencers.list(otherTenant), []);
  await assert.rejects(() => influencers.get(otherTenant, created.id), CoreDomainNotFoundError);

  const otherAvatar = await resources.create(otherTenant, {
    kind: "avatar", name: "NY avatar", language: null, accent: null, gender: null, previewUrl: null, thumbnailUrl: null,
  });
  const otherVoice = await resources.create(otherTenant, {
    kind: "voice", name: "NY voice", language: "en-US", accent: null, gender: null, previewUrl: null, thumbnailUrl: null,
  });
  const other = await influencers.create(otherTenant, {
    ...brief,
    avatarResourceId: otherAvatar.id,
    voiceResourceId: otherVoice.id,
  });
  assert.equal(other.slug, "emily-eats");
  assert.notEqual(other.id, created.id);
});

test("keeps influencer slugs unique for an owner/workspace, including after archive", async () => {
  const { influencers, tenant, brief } = await createHarness();
  const first = await influencers.create(tenant, brief);

  await assert.rejects(() => influencers.create(tenant, brief), InfluencerSlugConflictError);
  await influencers.archive(tenant, first.id);
  await assert.rejects(() => influencers.create(tenant, brief), InfluencerSlugConflictError);
});

test("allows canonical resources to remain unassigned only while an influencer is a draft", async () => {
  const { influencers, tenant, brief } = await createHarness();
  const draft = await influencers.create(tenant, {
    ...brief,
    name: "Unassigned Draft",
    avatarResourceId: null,
    voiceResourceId: null,
    status: "draft",
  });
  assert.equal(draft.avatarResourceId, null);
  assert.equal(draft.voiceResourceId, null);
  await assert.rejects(() => influencers.update(tenant, draft.id, { status: "active" }), /require canonical avatar and voice/i);
  await assert.rejects(() => influencers.create(tenant, {
    ...brief,
    name: "Invalid Active",
    avatarResourceId: null,
    voiceResourceId: null,
  }), /require canonical avatar and voice/i);
});

test("updates and archives influencers without exposing archived records as options", async () => {
  const { influencers, tenant, brief } = await createHarness();
  const created = await influencers.create(tenant, brief);
  const updated = await influencers.update(tenant, created.id, {
    tone: ["energetic", "premium"],
    categories: ["Restaurants", "Nightlife"],
    status: "paused",
  });
  assert.deepEqual(updated.tone, ["energetic", "premium"]);
  assert.deepEqual(updated.categories, ["Restaurants", "Nightlife"]);
  assert.equal(updated.status, "paused");

  const reactivated = await influencers.update(tenant, created.id, { status: "active" });
  assert.equal((await influencers.options(tenant))[0]?.id, reactivated.id);
  const archived = await influencers.archive(tenant, created.id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedAt, "2026-07-20T16:00:00.000Z");
  assert.deepEqual(await influencers.list(tenant), []);
  assert.equal((await influencers.list(tenant, { includeArchived: true })).length, 1);
  assert.deepEqual(await influencers.options(tenant), []);
  await assert.rejects(() => influencers.update(tenant, created.id, { tone: ["changed"] }), /archived/i);
});

test("validates statuses and rejects provider identifiers or secrets in public DTOs", async () => {
  const { influencers, resources, tenant, brief } = await createHarness();

  await assert.rejects(
    () => influencers.create(tenant, { ...brief, status: "completed" as never }),
    CoreDomainValidationError,
  );
  await assert.rejects(
    () => influencers.create(tenant, { ...brief, providerAvatarId: "raw-heygen-id" } as CreateInfluencerInput),
    /forbidden or unknown field: providerAvatarId/i,
  );
  await assert.rejects(
    () => resources.create(tenant, {
      kind: "voice", name: "Unsafe", language: "en-US", accent: null, gender: null,
      previewUrl: null, thumbnailUrl: null, apiKey: "secret",
    } as never),
    /forbidden or unknown field: apiKey/i,
  );
  await assert.rejects(
    () => resources.update(tenant, "resource-1", { externalResourceId: "provider-123" } as never),
    /forbidden or unknown field: externalResourceId/i,
  );
});

test("requires canonical, active, correctly typed resources from the same tenant", async () => {
  const { influencers, resources, tenant, avatar, voice, brief } = await createHarness();
  const otherTenant = { ownerUserId: "owner-b", workspaceId: "miami" };
  const foreignAvatar = await resources.create(otherTenant, {
    kind: "avatar", name: "Foreign avatar", language: null, accent: null, gender: null,
    previewUrl: null, thumbnailUrl: null,
  });

  await assert.rejects(
    () => influencers.create(tenant, { ...brief, avatarResourceId: foreignAvatar.id }),
    /canonical avatar in this workspace/i,
  );
  await assert.rejects(
    () => influencers.create(tenant, { ...brief, avatarResourceId: voice.id }),
    /canonical avatar/i,
  );
  await resources.update(tenant, avatar.id, { status: "inactive" });
  await assert.rejects(
    () => influencers.create(tenant, brief),
    /avatar resource must be active/i,
  );
});

test("derives avatar, voice, and influencer options from repositories", async () => {
  const { influencers, resources, tenant, avatar, voice, brief } = await createHarness();
  const created = await influencers.create(tenant, brief);
  const resourceOptions = await resources.options(tenant);
  const influencerOptions = await influencers.options(tenant);

  assert.deepEqual(resourceOptions.avatars.map((item) => item.id), [avatar.id]);
  assert.deepEqual(resourceOptions.voices.map((item) => item.id), [voice.id]);
  assert.deepEqual(influencerOptions, [{
    id: created.id,
    name: "Emily Eats",
    categories: ["Food", "Restaurants", "Brunch", "Coffee"],
    language: "en-US",
    voiceId: voice.id,
    avatarId: avatar.id,
    status: "active",
  }]);

  await resources.archive(tenant, voice.id);
  assert.deepEqual((await resources.options(tenant)).voices, []);
  assert.deepEqual(await influencers.options(tenant), []);
});

test("does not impose a repository-level cap on influencer personalities", async () => {
  const { influencers, tenant, brief } = await createHarness();
  for (let index = 0; index < 150; index += 1) {
    await influencers.create(tenant, {
      ...brief,
      name: `Influencer ${index}`,
    });
  }
  assert.equal((await influencers.list(tenant)).length, 150);
});
