import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { mediaStudioCoreApi } from "../client/src/features/ai-media-studio/core/api.ts";
import { archiveDialogReducer, initialArchiveDialogState } from "../client/src/features/ai-media-studio/core/archive-dialog-state.ts";
import { eligibleGenerationInfluencers, reconcileGenerationInfluencer } from "../client/src/features/ai-media-studio/core/influencer-selection.ts";
import { selectableProviderResources } from "../client/src/features/ai-media-studio/core/provider-resource-selection.ts";
import { commaList, emptyInfluencerForm, toInfluencerRequest } from "../client/src/features/ai-media-studio/core/types.ts";

const repositoryRoot = process.cwd();

async function source(name: string) {
  return readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core", name), "utf8");
}

test("influencer form covers the complete provider-neutral creator profile", async () => {
  const form = await source("influencer-form.tsx");
  for (const field of [
    "name", "avatarResourceId", "voiceResourceId", "accent", "language", "gender",
    "minimumAge", "maximumAge", "personality", "tone", "speakingStyle", "categories",
    "intro", "outro", "energyLevel", "facialExpressions", "brandColors", "status",
  ]) {
    assert.match(form, new RegExp(`register\\(\\"${field}\\"`), `missing ${field}`);
  }
  assert.match(form, /aria-required/);
  assert.match(form, /role="alert"/);
  assert.match(form, /motion-reduce:animate-none/);
});

test("influencer form never offers unverified provider resources as selectable", async () => {
  const form = await source("influencer-form.tsx");
  const resource = (id: string, status: "active" | "inactive") => ({ id, kind: "avatar" as const, name: id, status, language: null, accent: null, gender: null, previewUrl: null, thumbnailUrl: null, synchronizedAt: null });
  assert.deepEqual(selectableProviderResources([resource("active-avatar", "active"), resource("pending-avatar", "inactive")], "pending-avatar"), {
    active: [resource("active-avatar", "active")],
    selectedUnavailable: true,
  });
  assert.equal(selectableProviderResources([resource("active-avatar", "active")], "missing-avatar").selectedUnavailable, true);
  assert.equal(selectableProviderResources([resource("active-avatar", "active")], "active-avatar").selectedUnavailable, false);
  assert.match(form, /selectedAvatarUnavailable.*disabled/s);
  assert.match(form, /selectedVoiceUnavailable.*disabled/s);
  assert.match(form, /not verified or is not loaded/);
});

test("core API boundary is limited to catalog routes and includes no publishing mutation", async () => {
  const api = await source("api.ts");
  assert.match(api, /\/influencers/);
  assert.match(api, /\/provider-resources/);
  assert.match(api, /\/media-assets/);
  assert.doesNotMatch(api, /publish|schedule|social-account/i);
  assert.match(api, /credentials: "include"/);
  assert.match(api, /encodeURIComponent\(id\)/);
});

test("media library exposes all reusable asset classes and safe view-only links", async () => {
  const library = await source("media-library.tsx");
  for (const kind of ["video", "script", "voice", "b_roll", "image", "music", "logo", "subtitle", "thumbnail"]) {
    assert.match(library, new RegExp(`value: \\"${kind}\\"`), `missing ${kind}`);
  }
  assert.match(library, /rel="noreferrer"/);
  assert.match(library, /No publishing action|does not publish content/i);
  assert.match(library, /LoadingPanel/);
  assert.match(library, /ErrorPanel/);
  assert.match(library, /EmptyPanel/);
});

test("production batch exposes durable preparation without a generation action", async () => {
  const workbench = await source("production-batch-workbench.tsx");
  assert.match(workbench, /Prepare script batch — no credits/);
  assert.match(workbench, /Preparation only · Generation disabled · No credits can be spent/);
  assert.match(workbench, /<details/);
  assert.match(workbench, /<summary/);
  assert.doesNotMatch(workbench, /createGeneration|Queue video preview|retryJob/);
});

test("form conversion normalizes repeatable values and preserves canonical resource IDs", () => {
  assert.deepEqual(commaList("food, brunch, food, coffee"), ["food", "brunch", "coffee"]);
  const request = toInfluencerRequest({
    ...emptyInfluencerForm,
    name: " Emily ",
    avatarResourceId: "avatar-kong-1",
    voiceResourceId: "voice-kong-1",
    personality: "warm, curious",
    tone: "friendly",
    speakingStyle: "Natural and direct",
    categories: "food, restaurants",
    intro: "Let's find your next favorite place.",
    outro: "Save this for later.",
    facialExpressions: "warm smile",
  });
  assert.equal(request.name, "Emily");
  assert.equal(request.avatarResourceId, "avatar-kong-1");
  assert.equal(request.voiceResourceId, "voice-kong-1");
  assert.deepEqual(request.categories, ["food", "restaurants"]);
  assert.deepEqual(request.ageRange, { minimum: 25, maximum: 34 });
});

test("archive confirmation remains open through pending and failure, then closes only on success", () => {
  const opened = archiveDialogReducer(initialArchiveDialogState, { type: "open" });
  const pending = archiveDialogReducer(opened, { type: "confirm" });
  assert.deepEqual(pending, { open: true, phase: "pending", error: "" });
  assert.equal(archiveDialogReducer(pending, { type: "close" }).open, true);
  const failed = archiveDialogReducer(pending, { type: "failure", message: "Network unavailable" });
  assert.deepEqual(failed, { open: true, phase: "error", error: "Network unavailable" });
  assert.deepEqual(archiveDialogReducer(pending, { type: "success" }), initialArchiveDialogState);
});

test("archive UI prevents automatic close and exposes persistent pending and error states", async () => {
  const workspace = await source("influencer-workspace.tsx");
  assert.match(workspace, /event\.preventDefault\(\)/);
  assert.match(workspace, /dispatch\(\{ type: "confirm" \}\)/);
  assert.match(workspace, /onSuccess: \(\) => dispatch\(\{ type: "success" \}\)/);
  assert.match(workspace, /onError: \(error\) => dispatch\(\{ type: "failure"/);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /aria-busy=\{pending\}/);
});

test("catalog API preserves cursor metadata and emits cursor-aware requests", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    requested.push(String(input));
    if (String(input).includes("provider-resources")) return new Response(JSON.stringify({ resources: [], nextCursor: "resource-next", hasMore: true }), { status: 200 });
    if (String(input).includes("media-assets")) return new Response(JSON.stringify({ assets: [], nextCursor: "asset-next", hasMore: true }), { status: 200 });
    return new Response(JSON.stringify({ influencers: [], nextCursor: "influencer-next", hasMore: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const influencers = await mediaStudioCoreApi.influencers({ cursor: "influencer-cursor", limit: 25 });
    const resources = await mediaStudioCoreApi.providerResources({ kind: "avatar", status: "active", cursor: "resource-cursor", limit: 25 });
    const assets = await mediaStudioCoreApi.mediaAssets({ kinds: ["video", "image"], cursor: "asset-cursor", limit: 25 });
    assert.deepEqual([influencers.nextCursor, resources.nextCursor, assets.nextCursor], ["influencer-next", "resource-next", "asset-next"]);
    assert.ok(influencers.hasMore && resources.hasMore && assets.hasMore);
    assert.match(requested[0], /cursor=influencer-cursor/);
    assert.match(requested[1], /cursor=resource-cursor/);
    assert.match(requested[2], /kinds=video&kinds=image/);
    assert.match(requested[2], /cursor=asset-cursor/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("all paginated catalogs expose load-more controls without silent client caps", async () => {
  const hooks = await source("hooks.ts");
  const workspace = await source("influencer-workspace.tsx");
  const form = await source("influencer-form.tsx");
  const library = await source("media-library.tsx");
  assert.equal((hooks.match(/useInfiniteQuery/g) ?? []).length, 4);
  assert.equal((hooks.match(/getNextPageParam/g) ?? []).length, 3);
  assert.match(workspace, /Load more influencers/);
  assert.match(form, /Load more avatars/);
  assert.match(form, /Load more voices/);
  assert.match(library, /Load more assets/);
});

test("form exposes field-level accessible errors and reserves archive for confirmation", async () => {
  const form = await source("influencer-form.tsx");
  for (const field of ["personality", "tone", "categories", "facialExpressions", "speakingStyle", "intro", "outro"]) {
    assert.match(form, new RegExp(`errors\\.${field}\\?\\.message`), `missing accessible error for ${field}`);
  }
  assert.match(form, /aria-describedby=\{errorId\}/);
  assert.doesNotMatch(form, /<option value="archived">/);
  assert.match(form, /Archiving requires a separate confirmation/);
});

test("global refresh covers all studio queries and fallback keeps dashboard anchors valid", async () => {
  const page = await readFile(resolve(repositoryRoot, "client/src/pages/ai-media-studio.tsx"), "utf8");
  assert.match(page, /invalidateQueries\(\{ queryKey: \["ai-media-studio"\], refetchType: "active" \}\)/);
  assert.match(page, /Refresh all studio data/);
  for (const id of ["overview", "providers", "activity"]) assert.match(page, new RegExp(`id=\\"${id}\\"`));
  assert.match(page, /DashboardFallback/);
});

test("dashboard labels persisted provider configuration without claiming live health", async () => {
  const dashboard = await readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/dashboard-overview.tsx"), "utf8");
  const navigation = await readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/navigation.ts"), "utf8");
  const page = await readFile(resolve(repositoryRoot, "client/src/pages/ai-media-studio.tsx"), "utf8");
  assert.match(dashboard, /Local provider configuration/);
  assert.match(dashboard, /Observed locally/);
  assert.match(dashboard, /not a live provider health check/);
  assert.doesNotMatch(dashboard, />Provider health</);
  assert.match(navigation, /href: "#heygen-setup", label: "HeyGen setup"/);
  assert.doesNotMatch(navigation, /Provider health/);
  assert.match(page, /Provider configuration/);
  assert.doesNotMatch(page, /Provider health/);
  assert.doesNotMatch(dashboard, />Checked /);
});

test("influencer mutations refresh both roster and generation options", async () => {
  const hooks = await source("hooks.ts");
  assert.match(hooks, /queryKey: coreStudioKeys\.influencers/);
  assert.match(hooks, /queryKey: \["ai-media-studio", "options"\]/);
  assert.match(hooks, /Promise\.all/);
});

test("load-more failures preserve loaded data and expose accessible retry", async () => {
  const workspace = await source("influencer-workspace.tsx");
  const library = await source("media-library.tsx");
  const feedback = await source("pagination-feedback.tsx");
  assert.match(workspace, /isFetchNextPageError/);
  assert.match(workspace, /avatarPaginationError/);
  assert.match(workspace, /voicePaginationError/);
  assert.match(library, /assetsQuery\.isError && !assetsQuery\.data/);
  assert.match(library, /assetsQuery\.isFetchNextPageError/);
  assert.match(feedback, /role="alert"/);
  assert.match(feedback, /Retry loading more/);
  assert.match(feedback, /onClick=\{onRetry\}/);
});

test("generation selection replaces an archived stale ID and preserves a valid active choice", () => {
  const options = [
    { id: "archived-emily", status: "archived", language: "en-US", voiceId: "voice-old" },
    { id: "active-alex", status: "active", language: "es-MX", voiceId: "voice-alex" },
    { id: "ready-sofia", status: "ready", language: "pt-BR", voiceId: "voice-sofia" },
  ];
  assert.deepEqual(eligibleGenerationInfluencers(options).map((item) => item.id), ["active-alex", "ready-sofia"]);
  assert.equal(reconcileGenerationInfluencer(options, "archived-emily")?.id, "active-alex");
  assert.equal(reconcileGenerationInfluencer(options, "ready-sofia")?.id, "ready-sofia");
  assert.equal(reconcileGenerationInfluencer(options.slice(0, 1), "archived-emily"), undefined);
});

test("production workbench retries only the safe preparation with one secure attempt key", async () => {
  const workbench = await source("production-batch-workbench.tsx");
  assert.match(workbench, /crypto\.randomUUID/);
  assert.match(workbench, /attemptRef\.current \?\?=/);
  assert.match(workbench, /planId: batch\.planId/);
  assert.match(workbench, /variantCount: 3/);
  assert.match(workbench, /usePrepareProductionBatchScripts/);
  assert.doesNotMatch(workbench, /providerAccount|avatarResource|voiceResource|native/);
});
