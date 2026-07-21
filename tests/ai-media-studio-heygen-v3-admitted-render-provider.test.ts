import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import {
  HeyGenV3AdmittedRenderProvider,
  HeyGenV3ProviderArtifactResolver,
} from "../server/ai-media-studio/providers/heygen-v3-admitted-render-provider";
import type { ExactAdmittedProviderCapability } from "../server/ai-media-studio/workers/admitted-render-contracts";

const SECRET = "heygen-secret-that-must-never-appear-in-evidence";
const NOW = new Date("2026-07-21T21:00:00.000Z");
const authorizationDigest = `sha256:${"a".repeat(64)}` as Sha256Digest;

function capability(overrides: Partial<{
  ownerUserId: string;
  workspaceId: string;
  providerAccountId: string;
  providerKey: string;
  providerCredentialVersion: number;
  authorizationDigest: Sha256Digest;
}> = {}): ExactAdmittedProviderCapability {
  return {
    scope: {
      ownerUserId: overrides.ownerUserId ?? "owner-1",
      workspaceId: overrides.workspaceId ?? "workspace-1",
    },
    providerAccountId: overrides.providerAccountId ?? "account-1",
    providerKey: overrides.providerKey ?? "heygen",
    providerCredentialVersion: overrides.providerCredentialVersion ?? 7,
    authorizationDigest: overrides.authorizationDigest ?? authorizationDigest,
  } as unknown as ExactAdmittedProviderCapability;
}

function provider(fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return new HeyGenV3AdmittedRenderProvider({
    apiKey: SECRET,
    providerAccountId: "account-1",
    providerCredentialVersion: 7,
    fetchImpl,
    timeoutMs: 1_000,
    now: () => NOW,
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("V3 submission binds the exact account, credential, resources and idempotency key", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const adapter = provider(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse({ data: { video_id: "video-123", status: "pending", output_format: "mp4" } }, 200, {
      "x-request-id": "request-123",
    });
  });
  const outcome = await adapter.submit({ script: "A safe script", aspectRatio: "9:16" }, {
    ...capability(),
    providerIdempotencyKey: "admit:slot-1:attempt-1",
    avatarExternalResourceId: "avatar-123",
    voiceExternalResourceId: "voice-123",
  });

  assert.equal(capturedUrl, "https://api.heygen.com/v3/videos");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], SECRET);
  assert.equal(headers["idempotency-key"], "admit:slot-1:attempt-1");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    type: "avatar",
    avatar_id: "avatar-123",
    aspect_ratio: "9:16",
    output_format: "mp4",
    script: "A safe script",
    voice_id: "voice-123",
  });
  assert.deepEqual(outcome.kind, "confirmed");
  if (outcome.kind !== "confirmed") return;
  assert.equal(outcome.providerJobId, "video-123");
  assert.equal(outcome.providerRequestId, "request-123");
  assert.match(outcome.evidenceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(!JSON.stringify(outcome).includes(SECRET));
});

test("timeouts, malformed success bodies and 409 remain ambiguous; reconciliation never resubmits", async (t) => {
  const submitContext = {
    ...capability(),
    providerIdempotencyKey: "admit:slot-2:attempt-1",
    avatarExternalResourceId: "avatar-123",
    voiceExternalResourceId: "voice-123",
  };

  await t.test("transport timeout", async () => {
    const secretInThrownMessage = `${SECRET}: socket timed out`;
    const outcome = await provider(async () => {
      throw new DOMException(secretInThrownMessage, "TimeoutError");
    }).submit({ script: "Hello", aspectRatio: "9:16" }, submitContext);
    assert.equal(outcome.kind, "ambiguous");
    assert.ok(!JSON.stringify(outcome).includes(SECRET));
  });

  await t.test("invalid JSON", async () => {
    const outcome = await provider(async () => new Response("{not-json", { status: 200 }))
      .submit({ script: "Hello", aspectRatio: "9:16" }, submitContext);
    assert.equal(outcome.kind, "ambiguous");
  });

  await t.test("concurrent idempotency request", async () => {
    const outcome = await provider(async () => jsonResponse({
      error: { code: "request_in_progress", message: "Retry shortly" },
    }, 409)).submit({ script: "Hello", aspectRatio: "9:16" }, submitContext);
    assert.equal(outcome.kind, "ambiguous");
  });

  await t.test("read-only reconciliation cannot mint exact negative finality", async () => {
    let networkCalls = 0;
    const outcome = await provider(async () => {
      networkCalls += 1;
      return jsonResponse({});
    }).reconcile({ ...capability(), providerIdempotencyKey: "admit:slot-2:attempt-1" });
    assert.deepEqual(outcome, { kind: "unknown" });
    assert.equal(networkCalls, 0);
    assert.ok(!("finality" in outcome));
  });
});

test("chunked responses are cancelled as soon as the incremental 256 KiB bound is exceeded", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(150 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const outcome = await provider(async () => new Response(body, { status: 200 }))
    .submit({ script: "Hello", aspectRatio: "9:16" }, {
      ...capability(),
      providerIdempotencyKey: "admit:chunked:attempt-1",
      avatarExternalResourceId: "avatar-123",
      voiceExternalResourceId: "voice-123",
    });
  assert.equal(outcome.kind, "ambiguous");
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3, "the adapter must not continue buffering an unbounded response");
});

test("authoritative GET distinguishes processing, completed, failed and unknown", async (t) => {
  const terminalContext = { ...capability(), providerJobId: "video-123" };

  await t.test("processing", async () => {
    const result = await provider(async () => jsonResponse({ data: { id: "video-123", status: "processing" } }))
      .observeTerminal(terminalContext);
    assert.equal(result.kind, "processing");
    assert.equal(result.observedAt, NOW.toISOString());
  });

  await t.test("completed has durable identity and explicitly ephemeral HTTPS MP4 delivery", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const result = await provider(async (input, init) => {
      capturedUrl = String(input);
      capturedMethod = String(init?.method);
      return jsonResponse({ data: {
        id: "video-123",
        status: "completed",
        video_url: "https://files.heygen.ai/video/video-123.mp4?temporary=signature",
        duration: 30.5,
      } });
    }).observeTerminal(terminalContext);
    assert.equal(capturedUrl, "https://api.heygen.com/v3/videos/video-123");
    assert.equal(capturedMethod, "GET");
    assert.equal(result.kind, "completed");
    if (result.kind !== "completed") return;
    assert.equal(result.remoteArtifactRef, "video-123");
    assert.equal(result.sourceUrlPolicy, "ephemeral_refresh_via_provider_get");
    assert.equal(result.mediaType, "video/mp4");
    assert.equal(result.durationSeconds, 30.5);
    assert.equal(result.sourceUrl, "https://files.heygen.ai/video/video-123.mp4?temporary=signature");
  });

  await t.test("failed redacts provider failure text", async () => {
    const rawFailure = `${SECRET}: customer script must not be persisted as failure text`;
    const result = await provider(async () => jsonResponse({ data: {
      id: "video-123",
      status: "failed",
      failure_code: "rendering_failed",
      failure_message: rawFailure,
    } })).observeTerminal(terminalContext);
    assert.equal(result.kind, "failed");
    if (result.kind !== "failed") return;
    assert.equal(result.failureCode, "rendering_failed");
    assert.match(result.failureMessageDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
    assert.ok(!JSON.stringify(result).includes(rawFailure));
    assert.ok(!JSON.stringify(result).includes(SECRET));
  });

  await t.test("unrecognized status", async () => {
    const result = await provider(async () => jsonResponse({ data: { id: "video-123", status: "future_state" } }))
      .observeTerminal(terminalContext);
    assert.equal(result.kind, "unknown");
  });
});

test("completed accepts only credential-free HTTPS MP4 URLs", async (t) => {
  for (const invalidUrl of [
    "http://files.heygen.ai/video/video-123.mp4",
    "https://files.heygen.ai/video/video-123.mov",
    "https://user:password@files.heygen.ai/video/video-123.mp4",
    "https://files.heygen.ai/video/video-123.mp4#fragment",
  ]) {
    await t.test(invalidUrl, async () => {
      const result = await provider(async () => jsonResponse({ data: {
        id: "video-123",
        status: "completed",
        video_url: invalidUrl,
      } })).observeTerminal({ ...capability(), providerJobId: "video-123" });
      assert.equal(result.kind, "unknown");
      assert.ok(!JSON.stringify(result).includes(invalidUrl));
    });
  }
});

test("account or credential rotation mismatch blocks before provider I/O", async () => {
  let networkCalls = 0;
  const adapter = provider(async () => {
    networkCalls += 1;
    return jsonResponse({ data: { video_id: "video-123" } });
  });
  await assert.rejects(() => adapter.submit({ script: "Hello", aspectRatio: "9:16" }, {
    ...capability({ providerCredentialVersion: 8 }),
    providerIdempotencyKey: "admit:slot-3:attempt-1",
    avatarExternalResourceId: "avatar-123",
    voiceExternalResourceId: "voice-123",
  }), /capability does not match/u);
  await assert.rejects(() => adapter.observeTerminal({
    ...capability({ providerAccountId: "account-2" }),
    providerJobId: "video-123",
  }), /capability does not match/u);
  assert.equal(networkCalls, 0);
});

test("HeyGen artifact resolver uses an exact binding and refreshes through authoritative GET", async () => {
  let networkCalls = 0;
  const adapter = provider(async (input, init) => {
    networkCalls += 1;
    assert.equal(String(input), "https://api.heygen.com/v3/videos/video-123");
    assert.equal(init?.method, "GET");
    return jsonResponse({ data: {
      id: "video-123",
      status: "completed",
      video_url: "https://files.heygen.ai/video/video-123.mp4?fresh=signature",
    } });
  });
  const remoteArtifactRef = "provider-artifact://ai-media-studio/render-terminal/v1/stable";
  const resolver = new HeyGenV3ProviderArtifactResolver({
    provider: adapter,
    async resolveBinding(request) {
      assert.equal(request.remoteArtifactRef, remoteArtifactRef);
      return {
        jobId: request.jobId,
        tenantId: request.tenantId,
        renderJobId: request.renderJobId,
        remoteArtifactRef,
        providerJobId: "video-123",
        capability: capability(),
      };
    },
  });
  const resolution = await resolver.resolveArtifact({
    jobId: "ingest-1",
    tenantId: "tenant-1",
    renderJobId: "render-1",
    remoteArtifactRef,
    expectedMimeType: "video/mp4",
  });
  assert.deepEqual(resolution, {
    remoteArtifactRef,
    sourceUrl: "https://files.heygen.ai/video/video-123.mp4?fresh=signature",
    mediaType: "video/mp4",
    sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
  });
  assert.equal(networkCalls, 1);
});

test("HeyGen artifact resolution rejects a cross-tenant binding before GET", async () => {
  let networkCalls = 0;
  const adapter = provider(async () => {
    networkCalls += 1;
    return jsonResponse({});
  });
  const resolver = new HeyGenV3ProviderArtifactResolver({
    provider: adapter,
    async resolveBinding(request) {
      return {
        jobId: request.jobId,
        tenantId: "another-tenant",
        renderJobId: request.renderJobId,
        remoteArtifactRef: request.remoteArtifactRef,
        providerJobId: "video-123",
        capability: capability(),
      };
    },
  });
  await assert.rejects(() => resolver.resolveArtifact({
    jobId: "ingest-1",
    tenantId: "tenant-1",
    renderJobId: "render-1",
    remoteArtifactRef: "provider-artifact://stable",
    expectedMimeType: "video/mp4",
  }), /binding mismatch/u);
  assert.equal(networkCalls, 0);
});
