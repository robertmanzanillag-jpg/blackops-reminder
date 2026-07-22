import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  HEYGEN_DEPLOYMENT_SECRET_NAME,
  HEYGEN_STATIC_CREDENTIAL_REFERENCE_ENDPOINT,
  registerHeyGenCredentialReference,
} from "../client/src/features/ai-media-studio/core/heygen-secure-reference.ts";

const repositoryRoot = process.cwd();

test("guided setup registers only an idempotency key and accepts the redacted reference DTO", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({
      outcome: "created",
      credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await registerHeyGenCredentialReference("heygen-static-reference-11111111-1111-4111-8111-111111111111");
    assert.equal(result.credentialReference.credentialVersion, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, HEYGEN_STATIC_CREDENTIAL_REFERENCE_ENDPOINT);
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.credentials, "include");
    assert.equal(calls[0]?.init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      idempotencyKey: "heygen-static-reference-11111111-1111-4111-8111-111111111111",
    });
    assert.doesNotMatch(String(calls[0]?.init?.body), /api.?key|secret|token|account|credentialVersion/iu);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guided setup rejects unsafe or malformed reference responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [
      {
        outcome: "created",
        credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 },
        secretValue: "must-not-cross-http",
      },
      {
        outcome: "created",
        credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 0 },
      },
    ]) {
      globalThis.fetch = (async () => new Response(JSON.stringify(body), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
      await assert.rejects(registerHeyGenCredentialReference("heygen-static-reference-safe-attempt"));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guided setup exposes the exact safe handoff and keeps later authority controls inert", async () => {
  const [guided, panel, workbench] = await Promise.all([
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/heygen-guided-setup.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/heygen-onboarding-panel.tsx"), "utf8"),
    readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/core/production-batch-workbench.tsx"), "utf8"),
  ]);

  assert.equal(HEYGEN_DEPLOYMENT_SECRET_NAME, "AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY");
  assert.match(guided, /I added the Replit secret — register reference/);
  assert.match(guided, /Registration sends only a random idempotency key/);
  assert.match(guided, /<section aria-labelledby="heygen-robert-handoff-heading"/);
  assert.match(guided, /<h4 id="heygen-robert-handoff-heading"[^>]*>What Robert provides later<\/h4>/);
  assert.match(guided, /The exact deployment variable/);
  assert.match(guided, /its value never belongs in chat, GitHub, or this UI/);
  assert.match(guided, /Five to ten creator display names/);
  assert.match(guided, /One exact HeyGen avatar look ID and the intended HeyGen voice ID for each creator/);
  assert.match(guided, /Language defaults to en-US, accent to Neutral, and gender to Unspecified/);
  assert.match(guided, /each can be adjusted before roster submission/);
  assert.match(guided, /Each avatar plans exactly 10 blocked videos/);
  assert.match(guided, /does not generate video, contact HeyGen, or authorize spend/);
  assert.match(guided, /role="note"/);
  assert.match(guided, /Eight guided HeyGen setup gates/);
  assert.match(guided, /Enter 5–10 avatar look ID and voice ID pairs/);
  assert.match(guided, /Prepare and review 10 scripts per avatar/);
  assert.match(guided, /Approve GET-only HeyGen verification/);
  assert.match(guided, /Obtain a maximum one-video quote/);
  assert.match(guided, /Approve one-video cost/);
  assert.match(guided, /Run one vertical sandbox video/);
  assert.match(guided, /GET-only verification — authorization required/);
  assert.match(guided, /disabled aria-describedby="heygen-live-verification-blocker"/);
  assert.doesNotMatch(guided, /type="password"|name="apiKey"|name="secret"|name="token"/iu);
  assert.ok(panel.indexOf("<HeyGenGuidedSetup") < panel.indexOf("<HeyGenRosterSetup"));
  assert.doesNotMatch(workbench, /<div className="space-y-4" aria-live="polite" aria-atomic="true">/);
  assert.match(workbench, /<p role="status" aria-live="polite" aria-atomic="true" className="sr-only">Execution evidence loaded/);
});
