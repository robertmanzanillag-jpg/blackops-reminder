import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";
import {
  SourceToScriptPreviewError,
  SourceToScriptPreviewService,
} from "../server/ai-media-studio/sources/source-to-script-preview-service";
import type { CanonicalSourceItem } from "../server/ai-media-studio/sources/contracts";
import { sourceScriptPreviewResponseSchema } from "../shared/ai-media-studio-source-to-script";

const scopeA = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const scopeB = { ownerUserId: "owner-b", workspaceId: "personal" } as const;

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function seed(repository: InMemorySourceRepository, overrides: Partial<CanonicalSourceItem> = {}) {
  return (await repository.upsertByContentHash(scopeA, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-id",
    category: "events",
    canonicalUrl: "https://kong.example/events/private",
    title: "Weekend guide",
    content: "Owned Kong event details for a safe local source-to-script preview.",
    contentHash: digest("Owned Kong event details for a safe local source-to-script preview."),
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: { providerSecretMetadata: "must-not-leak" },
    ...overrides,
  })).item;
}

test("source-to-script preview reads one eligible tenant source and creates only a blocked deterministic preview", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceToScriptPreviewService(repository);
  const first = sourceScriptPreviewResponseSchema.parse(await service.preview(scopeA, {
    sourceItemId: source.id,
    idempotencyKey: "source-script-preview-001",
    language: "en",
    variantCount: 3,
  }));
  const replay = sourceScriptPreviewResponseSchema.parse(await service.preview(scopeA, {
    sourceItemId: source.id,
    idempotencyKey: "source-script-preview-001",
    language: "en",
    variantCount: 3,
  }));

  assert.equal(first.previewDigest, replay.previewDigest);
  assert.equal(first.source.id, source.id);
  assert.equal(first.source.rightsStatus, "owned");
  assert.equal(first.source.moderationStatus, "approved");
  assert.equal(first.downstreamState, "blocked_before_render_admission");
  assert.equal(first.generation.estimatedCostUsd, 0);
  assert.deepEqual(first.effects, {
    sourceRead: true,
    scriptPreviewGenerated: true,
    scriptPersisted: false,
    orchestrationRunCreated: false,
    renderQueued: false,
    outboxCreated: false,
    videoProviderCalled: false,
    secretResolved: false,
    spendCommitted: false,
    publishingCreated: false,
    migrationApplied: false,
    deploymentPerformed: false,
  });
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /private-event-id|providerSecretMetadata|kong\.example/u);
  assert.equal((await repository.list(scopeA)).length, 1);
});

test("source-to-script preview rejects cross-tenant and ineligible sources", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceToScriptPreviewService(repository);
  await assert.rejects(service.preview(scopeB, {
    sourceItemId: source.id,
    idempotencyKey: "source-script-preview-001",
    language: "en",
    variantCount: 3,
  }), (error: unknown) => error instanceof SourceToScriptPreviewError && error.code === "NOT_FOUND");

  for (const overrides of [
    { rightsStatus: "unknown" as const },
    { rightsStatus: "restricted" as const },
    { moderationStatus: "pending" as const },
    { status: "discovered" as const },
    { content: undefined },
  ]) {
    const isolated = new InMemorySourceRepository();
    const candidate = await seed(isolated, overrides);
    const isolatedService = new SourceToScriptPreviewService(isolated);
    await assert.rejects(isolatedService.preview(scopeA, {
      sourceItemId: candidate.id,
      idempotencyKey: "source-script-preview-001",
      language: "en",
      variantCount: 3,
    }), (error: unknown) => error instanceof SourceToScriptPreviewError && error.code === "SOURCE_INELIGIBLE");
  }
});

test("source-to-script repository failures are normalized and redacted", async () => {
  const service = new SourceToScriptPreviewService({
    async get() {
      throw new Error("postgres-private-token https://private.example/source");
    },
  });
  const error = await service.preview(scopeA, {
    sourceItemId: "source_abc123",
    idempotencyKey: "source-script-preview-001",
    language: "en",
    variantCount: 3,
  }).then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof SourceToScriptPreviewError);
  assert.equal(error.code, "SOURCE_UNAVAILABLE");
  assert.doesNotMatch(error.message, /postgres-private-token|private\.example/u);
});

test("source-to-script preview independently rejects a repository row from another tenant", async () => {
  const repository = new InMemorySourceRepository();
  const otherTenantSource = await seed(repository);
  const service = new SourceToScriptPreviewService({
    async get() { return { ...otherTenantSource, ownerUserId: "owner-b" }; },
  });
  await assert.rejects(service.preview(scopeA, {
    sourceItemId: otherTenantSource.id,
    idempotencyKey: "source-script-preview-tenant-defense",
    language: "en",
    variantCount: 3,
  }), (error: unknown) => error instanceof SourceToScriptPreviewError && error.code === "SOURCE_INELIGIBLE");
});
