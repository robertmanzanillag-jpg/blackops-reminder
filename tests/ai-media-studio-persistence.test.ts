import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { mapRenderJobRow } from "../server/ai-media-studio/persistence/mapping";

const schemaSource = readFileSync(
  resolve(process.cwd(), "shared/models/ai-media-studio-db.ts"),
  "utf8",
);

const expectedTableExports = [
  "aiMediaInfluencers",
  "aiMediaScripts",
  "aiMediaScriptVariants",
  "aiMediaVideoProjects",
  "aiMediaVideos",
  "aiMediaProviderAccounts",
  "aiMediaProviderResources",
  "aiMediaRenderJobs",
  "aiMediaWebhookEvents",
  "aiMediaMediaAssets",
  "aiMediaAssetIngestJobs",
  "aiMediaPublishingJobs",
  "aiMediaPublications",
  "aiMediaAnalyticsSnapshots",
  "aiMediaAnalyticsEvents",
  "aiMediaGenerationHistory",
  "aiMediaCostLedger",
  "aiMediaSourceItems",
  "aiMediaOrchestrationRuns",
  "aiMediaOutbox",
] as const;

test("AI Media Studio exports the complete durable table set", () => {
  for (const tableExport of expectedTableExports) {
    assert.match(schemaSource, new RegExp(`export const ${tableExport} = pgTable\\(`));
  }
  assert.equal((schemaSource.match(/export const aiMedia[A-Za-z]+ = pgTable\(/g) ?? []).length, 20);
});

test("every durable table is owner and workspace scoped", () => {
  assert.match(schemaSource, /const tenantColumns = \(\) => \(\{[\s\S]*ownerUserId: text\("owner_user_id"\)\.notNull\(\)[\s\S]*workspaceId: text\("workspace_id"\)\.notNull\(\)/);
  assert.equal((schemaSource.match(/\.\.\.tenantColumns\(\)/g) ?? []).length, 20);
});

test("provider accounts persist only a secret reference", () => {
  const providerAccountBlock = schemaSource.slice(
    schemaSource.indexOf("export const aiMediaProviderAccounts"),
    schemaSource.indexOf("export const aiMediaProviderResources"),
  );
  assert.match(providerAccountBlock, /secretRef: text\("secret_ref"\)/);
  assert.doesNotMatch(providerAccountBlock, /text\("(?:secret|api_key|access_token|refresh_token|password|credential)"\)/);
});

test("critical delivery paths have unique idempotency constraints", () => {
  for (const indexName of [
    "ai_media_render_jobs_owner_workspace_idempotency_uq",
    "ai_media_webhook_events_provider_event_uq",
    "ai_media_cost_ledger_owner_workspace_idempotency_uq",
    "ai_media_outbox_owner_workspace_idempotency_uq",
  ]) {
    assert.match(schemaSource, new RegExp(`uniqueIndex\\("${indexName}"\\)`));
  }
});

test("render rows map to the existing repository domain contract", () => {
  const createdAt = new Date("2026-07-20T12:00:00.000Z");
  const completedAt = new Date("2026-07-20T12:02:00.000Z");
  const mapped = mapRenderJobRow({
    id: "0c4938f8-7dc4-4ed3-bf85-94d4cecb717b",
    ownerUserId: "owner-1",
    workspaceId: "workspace-1",
    generationId: "9f62adab-0cac-46d6-8a52-9109952ab65e",
    projectId: null,
    providerAccountId: null,
    providerKey: "fake",
    providerJobId: "provider-job-1",
    idempotencyKey: "request-1",
    title: "Launch script",
    status: "completed",
    stage: "completed",
    progress: 100,
    attempts: 1,
    retryCount: 0,
    maxAttempts: 3,
    request: {
      influencerId: "influencer-1",
      script: "Launch script",
      voiceId: "voice-1",
      language: "en",
      aspectRatio: "9:16",
      idempotencyKey: "request-1",
    },
    result: { actualCostUsd: 0.12, influencerName: "Ava" },
    outputUrl: "https://media.example/video.mp4",
    outputMediaAssetId: "cae78fd4-d7c0-4a80-af54-20f6b50a2260",
    errorCode: null,
    errorMessage: null,
    queuedAt: createdAt,
    startedAt: createdAt,
    completedAt,
    nextAttemptAt: null,
    createdAt,
    updatedAt: completedAt,
  });

  assert.equal(mapped.status, "completed");
  assert.equal(mapped.providerName, "fake");
  assert.equal(mapped.actualCostUsd, 0.12);
  assert.equal(mapped.influencerName, "Ava");
  assert.equal(mapped.outputAssetId, "cae78fd4-d7c0-4a80-af54-20f6b50a2260");
  assert.equal(mapped.request.aspectRatio, "9:16");
  assert.equal(mapped.completedAt, "2026-07-20T12:02:00.000Z");
});
