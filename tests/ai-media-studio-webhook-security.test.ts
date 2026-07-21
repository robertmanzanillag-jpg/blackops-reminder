import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  deriveVerifiedWebhookEnvelope,
  verifyHeyGenWebhookWithRotation,
} from "../server/ai-media-studio/webhook-security";
import {
  isResolvedWebhookAccountValid,
  isSafeProviderKey,
  isSafeProviderWebhookEndpointKey,
} from "../server/ai-media-studio/provider-webhooks";

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test("verifies active and unexpired previous raw-body secrets without accepting expired rotation", () => {
  const rawBody = Buffer.from('{"event_id":"evt-rotation"}');
  const nowMs = Date.parse("2026-07-20T15:00:00.000Z");
  const candidates = [
    { value: "new-secret", state: "active" as const },
    { value: "old-secret", state: "previous" as const, expiresAt: "2026-07-20T15:05:00.000Z" },
  ];
  assert.equal(verifyHeyGenWebhookWithRotation({ rawBody, signature: sign(rawBody, "new-secret"), secrets: candidates, nowMs }), true);
  assert.equal(verifyHeyGenWebhookWithRotation({ rawBody, signature: sign(rawBody, "old-secret"), secrets: candidates, nowMs }), true);
  assert.equal(verifyHeyGenWebhookWithRotation({ rawBody, signature: sign(rawBody, "old-secret"), secrets: candidates, nowMs: nowMs + 6 * 60_000 }), false);
  assert.equal(verifyHeyGenWebhookWithRotation({ rawBody: Buffer.from("changed"), signature: sign(rawBody, "new-secret"), secrets: candidates, nowMs }), false);
});

test("derives replay identity only from signed payload or stable raw-body digest", () => {
  const receivedAtMs = Date.parse("2026-07-20T15:00:00.000Z");
  const bodyWithId = Buffer.from('{"event_id":"signed-event","occurred_at":"2026-07-20T14:59:00.000Z"}');
  assert.deepEqual(deriveVerifiedWebhookEnvelope(JSON.parse(bodyWithId.toString()), bodyWithId, receivedAtMs), {
    eventId: "signed-event",
    occurredAt: "2026-07-20T14:59:00.000Z",
    bodyDigest: "sha256:4192fffe2318d000fbb5e7089911f9cac986765ade0c7a86501eb26d343a53ca",
  });

  const bodyWithoutId = Buffer.from('{"event_type":"avatar_video.success"}');
  const first = deriveVerifiedWebhookEnvelope(JSON.parse(bodyWithoutId.toString()), bodyWithoutId, receivedAtMs);
  const replayWithChangedHeaders = deriveVerifiedWebhookEnvelope(JSON.parse(bodyWithoutId.toString()), bodyWithoutId, receivedAtMs + 60_000);
  assert.equal(first.eventId, replayWithChangedHeaders.eventId);
  assert.match(first.eventId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.occurredAt, "2026-07-20T15:00:00.000Z");
});

test("validates endpoint binding including the runtime workspace", () => {
  const account = {
    providerKey: "heygen",
    endpointKey: "endpoint_123",
    providerAccountId: "account-1",
    tenant: { ownerUserId: "owner-1", workspaceId: "workspace-1" },
    secrets: [{ value: "runtime-secret", state: "active" as const }],
  };
  assert.equal(isSafeProviderKey("heygen"), true);
  assert.equal(isSafeProviderWebhookEndpointKey("endpoint_123456789012345"), true);
  assert.equal(isSafeProviderWebhookEndpointKey("short"), false);
  assert.equal(isSafeProviderWebhookEndpointKey("../endpoint-123456789012"), false);
  assert.equal(isResolvedWebhookAccountValid(account, { providerKey: "heygen", endpointKey: "endpoint_123", workspaceId: "workspace-1" }), true);
  assert.equal(isResolvedWebhookAccountValid(account, { providerKey: "heygen", endpointKey: "endpoint_123", workspaceId: "other" }), false);
});
