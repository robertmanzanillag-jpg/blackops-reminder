import assert from "node:assert/strict";
import test from "node:test";
import { mediaStudioCoreApi } from "../client/src/features/ai-media-studio/core/api.ts";

function publicKey(prefix: string, value: number): string {
  return `${prefix}_${value.toString(16).padStart(24, "0")}`;
}

function productionBatchResponse(status: "not_started" | "draft_ready" | "stale" = "draft_ready") {
  const avatarCount = 5;
  const groups = Array.from({ length: avatarCount }, (_, groupIndex) => ({
    memberId: publicKey("member", groupIndex + 1),
    creatorName: `Creator ${groupIndex + 1}`,
    items: Array.from({ length: 10 }, (_, itemIndex) => {
      const position = groupIndex * 10 + itemIndex + 1;
      return status === "not_started" ? {
        slotId: publicKey("slot", position),
        videoNumber: itemIndex + 1,
        preparation: "pending",
        source: null,
        script: null,
      } : {
        slotId: publicKey("slot", position),
        videoNumber: itemIndex + 1,
        preparation: "draft",
        source: { title: `Source ${position}`, category: "experiences" },
        script: {
          key: publicKey("script", position),
          title: `Draft ${position}`,
          status: "draft",
          variantCount: 3,
        },
      };
    }),
  }));

  return {
    batch: {
      batchId: publicKey("batch", 1),
      planId: publicKey("plan", 1),
      status,
      avatarCount,
      videosPerAvatar: 10,
      plannedVideoCount: 50,
      canGenerate: false,
      noSpend: true,
      preparedAt: status === "not_started" ? null : "2026-07-21T12:00:00.000Z",
      blockers: [
        status === "not_started" ? "script_batch_required" : status === "draft_ready" ? "script_approval_required" : "script_refresh_required",
        "governance_approval_required",
        "budget_reservation_required",
        "sandbox_generation_required",
        "human_launch_approval_required",
      ],
      groups,
    },
  };
}

test("current production batch is fetched with credentials and validated", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify(productionBatchResponse()), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await mediaStudioCoreApi.productionBatch();
    assert.equal(request?.input, "/api/ai-media-studio/production-batches/current");
    assert.equal(request?.init?.credentials, "include");
    assert.equal(response?.batch.groups.length, 5);
    assert.equal(response?.batch.plannedVideoCount, 50);
    assert.equal(response?.batch.canGenerate, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing current production batch is an explicit empty state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
  try {
    assert.equal(await mediaStudioCoreApi.productionBatch(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("current production batch preserves safe server error text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: "AI Media Studio production batch persistence is unavailable" }),
    { status: 503, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  try {
    await assert.rejects(
      mediaStudioCoreApi.productionBatch(),
      /production batch persistence is unavailable/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production batch preparation sends only idempotency and variant count", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify(productionBatchResponse()), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await mediaStudioCoreApi.prepareProductionBatchScripts({
      planId: "plan_000000000000000000000001",
      input: {
        idempotencyKey: "production-batch-00000000-0000-4000-8000-000000000001",
        variantCount: 3,
      },
    });
    assert.equal(request?.input, "/api/ai-media-studio/production-batches/plan_000000000000000000000001/prepare-scripts");
    assert.equal(request?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      idempotencyKey: "production-batch-00000000-0000-4000-8000-000000000001",
      variantCount: 3,
    });
    assert.equal(response.batch.status, "draft_ready");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful-looking unsafe or private batch responses are rejected", async () => {
  const originalFetch = globalThis.fetch;
  const unsafe = productionBatchResponse();
  const unsafeBatch = unsafe.batch as typeof unsafe.batch & { providerAccountId?: string };
  unsafeBatch.providerAccountId = "must-not-cross-boundary";
  globalThis.fetch = (async () => new Response(JSON.stringify(unsafe), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(mediaStudioCoreApi.productionBatch());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("not-started batches carry honest pending slots without invented content", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(productionBatchResponse("not_started")), { status: 200 })) as typeof fetch;
  try {
    const response = await mediaStudioCoreApi.productionBatch();
    const first = response?.batch.groups[0]?.items[0];
    assert.equal(first?.preparation, "pending");
    assert.equal(first?.source, null);
    assert.equal(first?.script, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
