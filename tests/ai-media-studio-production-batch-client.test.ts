import assert from "node:assert/strict";
import test from "node:test";
import { mediaStudioCoreApi } from "../client/src/features/ai-media-studio/core/api.ts";
import { approvalResultMatchesBatch } from "../client/src/features/ai-media-studio/core/production-batch-workbench.tsx";

function publicKey(prefix: string, value: number): string {
  return `${prefix}_${value.toString(16).padStart(24, "0")}`;
}

function productionBatchResponse(
  status: "not_started" | "draft_ready" | "approved_ready" | "stale" = "draft_ready",
  avatarCount = 5,
) {
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
          status: status === "approved_ready" ? "approved" : "draft",
          variantCount: 3,
          selectedVariant: {
            title: `Draft ${position}`,
            angle: `Angle ${position}`,
            hook: `Hook ${position}`,
            script: `Complete script ${position}`,
            cta: `CTA ${position}`,
            caption: `Caption ${position}`,
            hashtags: [`#creator${position}`, "#kong"],
            seoKeywords: [`creator ${position}`, "kong media"],
          },
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
      plannedVideoCount: avatarCount * 10,
      canGenerate: false,
      noSpend: true,
      preparedAt: status === "not_started" ? null : "2026-07-21T12:00:00.000Z",
      approvedAt: status === "approved_ready" ? "2026-07-21T12:05:00.000Z" : null,
      blockers: [
        ...(status === "approved_ready" ? [] : [status === "not_started" ? "script_batch_required" : status === "draft_ready" ? "script_approval_required" : "script_refresh_required"]),
        "governance_approval_required",
        "budget_reservation_required",
        "sandbox_generation_required",
        "human_launch_approval_required",
      ],
      groups,
    },
  };
}

const launchGateCodes = [
  "batch_integrity", "plan_window", "source_eligibility", "provider_binding_local",
  "governance_coverage", "launch_intent", "content_approval", "policy_kill_switch",
  "provider_live_verification", "maximum_quote", "sandbox_proof", "human_launch_approval",
  "authority_snapshot", "budget_admission_capacity",
] as const;

function launchPreflightResponse(avatarCount = 5) {
  const requiredSlots = avatarCount * 10;
  return {
    preflight: {
      version: 1,
      source: "derived_read_only",
      subject: {
        planId: publicKey("plan", 1),
        batchId: publicKey("batch", 1),
        avatarCount,
        videosPerAvatar: 10,
        plannedVideoCount: requiredSlots,
      },
      observedAt: "2026-07-21T12:10:00.000Z",
      status: "ready_at_observation",
      canGenerate: false,
      sandboxExecutionAllowed: false,
      spendAuthorized: false,
      noSpend: true,
      authoritativeForAdmission: false,
      effects: {
        intentCreated: false,
        evidenceCreated: false,
        snapshotCreated: false,
        reservationCreated: false,
        renderCreated: false,
        outboxCreated: false,
        providerCalled: false,
      },
      summary: {
        totalGates: 14,
        passedGates: 14,
        blockedGates: 0,
        pendingExternalGates: 0,
        pendingHumanGates: 0,
        unavailableGates: 0,
        readySlots: requiredSlots,
        requiredSlots,
      },
      gates: launchGateCodes.map((code) => ({
        code,
        state: "passed",
        readySlots: requiredSlots,
        requiredSlots,
        reasonCode: "ready",
        nextActionCode: "none",
      })),
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

test("approved production batch launch preflight is a credentialed read validated against both cache identities", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify(launchPreflightResponse()), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await mediaStudioCoreApi.productionBatchLaunchPreflight({
      planId: publicKey("plan", 1),
      batchId: publicKey("batch", 1),
    });
    assert.equal(request?.input, "/api/ai-media-studio/production-batches/plan_000000000000000000000001/launch-preflight");
    assert.equal(request?.init?.credentials, "include");
    assert.equal(request?.init?.method, undefined);
    assert.equal(request?.init?.body, undefined);
    assert.equal(response.preflight.gates.length, 14);
    assert.equal(response.preflight.noSpend, true);
    assert.equal(response.preflight.authoritativeForAdmission, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production batch and launch preflight boundaries preserve the 10 creator by 10 video shape", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify(productionBatchResponse("approved_ready", 10)), { status: 200 })) as typeof fetch;
    const batch = await mediaStudioCoreApi.productionBatch();
    assert.equal(batch?.batch.avatarCount, 10);
    assert.equal(batch?.batch.groups.length, 10);
    assert.equal(batch?.batch.plannedVideoCount, 100);
    assert.ok(batch?.batch.groups.every((group) => group.items.length === 10));

    globalThis.fetch = (async () => new Response(JSON.stringify(launchPreflightResponse(10)), { status: 200 })) as typeof fetch;
    const observation = await mediaStudioCoreApi.productionBatchLaunchPreflight({
      planId: publicKey("plan", 1),
      batchId: publicKey("batch", 1),
    });
    assert.equal(observation.preflight.subject.avatarCount, 10);
    assert.equal(observation.preflight.summary.readySlots, 100);
    assert.equal(observation.preflight.summary.requiredSlots, 100);
    assert.ok(observation.preflight.gates.every((gate) => gate.requiredSlots === 100));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("launch preflight rejects stale identity and successful-looking private fields", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const stale = launchPreflightResponse();
    stale.preflight.subject.batchId = publicKey("batch", 2);
    globalThis.fetch = (async () => new Response(JSON.stringify(stale), { status: 200 })) as typeof fetch;
    await assert.rejects(
      mediaStudioCoreApi.productionBatchLaunchPreflight({
        planId: publicKey("plan", 1),
        batchId: publicKey("batch", 1),
      }),
      /identity did not match/u,
    );

    const unsafe = launchPreflightResponse();
    const privateResponse = unsafe.preflight as typeof unsafe.preflight & { providerAccountId?: string };
    privateResponse.providerAccountId = "must-not-cross-boundary";
    globalThis.fetch = (async () => new Response(JSON.stringify(unsafe), { status: 200 })) as typeof fetch;
    await assert.rejects(mediaStudioCoreApi.productionBatchLaunchPreflight({
      planId: publicKey("plan", 1),
      batchId: publicKey("batch", 1),
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [status, expected] of [
  [404, "Launch preflight was not found for this approved batch."],
  [409, "Launch preflight is not available for the current batch state."],
  [503, "Launch preflight observation is temporarily unavailable."],
] as const) {
  test(`launch preflight ${status} errors are actionable without exposing server response fields`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "private internal error", providerAccountId: "private-id" }),
      { status },
    )) as typeof fetch;
    try {
      await assert.rejects(
        mediaStudioCoreApi.productionBatchLaunchPreflight({
          planId: publicKey("plan", 1),
          batchId: publicKey("batch", 1),
        }),
        (error: unknown) => error instanceof Error
          && error.message === expected
          && !error.message.includes("private"),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

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

test("atomic production batch approval sends a UUID idempotency key and exact expected batch", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify(productionBatchResponse("approved_ready")), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await mediaStudioCoreApi.approveProductionBatchScripts({
      planId: "plan_000000000000000000000001",
      input: {
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        expectedBatchId: "batch_000000000000000000000001",
      },
    });
    assert.equal(request?.input, "/api/ai-media-studio/production-batches/plan_000000000000000000000001/approve-scripts");
    assert.equal(request?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      expectedBatchId: "batch_000000000000000000000001",
    });
    assert.equal(response.batch.status, "approved_ready");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an approval success belongs only to its exact current batch identity", () => {
  const approved = productionBatchResponse("approved_ready").batch;
  assert.equal(approvalResultMatchesBatch(approved, approved), true);

  const externalBatch = structuredClone(approved);
  externalBatch.batchId = publicKey("batch", 2);
  assert.equal(approvalResultMatchesBatch(approved, externalBatch), false);

  externalBatch.batchId = approved.batchId;
  externalBatch.preparedAt = "2026-07-21T12:01:00.000Z";
  assert.equal(approvalResultMatchesBatch(approved, externalBatch), false);

  externalBatch.preparedAt = approved.preparedAt;
  externalBatch.approvedAt = "2026-07-21T12:06:00.000Z";
  assert.equal(approvalResultMatchesBatch(approved, externalBatch), false);
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
