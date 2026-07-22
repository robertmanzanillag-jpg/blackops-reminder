import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime, type AiMediaStudioDependencies } from "../server/ai-media-studio/routes";
import type {
  PreparedSecureHeyGenSetup,
  SecureHeyGenSetupRepository,
} from "../server/ai-media-studio/provider-credentials/secure-heygen-setup-contracts";

const accountId = "11111111-1111-4111-8111-111111111111";

async function harness(overrides: Partial<AiMediaStudioDependencies>) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.get("x-test-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    runtimeEnvironment: "test",
    operations: { runtimeEnvironment: "test" },
    ...overrides,
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
      else process.env.ALLOW_DEV_USER_FALLBACK = previous;
    },
  };
}

test("secure setup routes are auth-first, strict, tenant-bound and redacted", async (t) => {
  const setupCalls: PreparedSecureHeyGenSetup[] = [];
  const setupRepository: SecureHeyGenSetupRepository = {
    async setup(input) {
      setupCalls.push(input);
      return {
        outcome: "created",
        providerAccountId: accountId,
        bindingId: input.bindingId,
        credentialVersion: 1,
        verificationState: "unverified",
      };
    },
  };
  const verificationCalls: unknown[] = [];
  const server = await harness({
    secureHeyGenSetupRepository: setupRepository,
    staticHeyGenLiveVerificationCoordinator: {
      async run(input) {
        verificationCalls.push(input);
        return {
          outcome: "recorded",
          verification: {
            verificationKey: "verification_public",
            evidenceKey: "evidence_public",
            providerKey: "heygen",
            providerCredentialVersion: 1,
            verifiedAt: "2026-07-22T12:00:00.000Z",
            expiresAt: "2026-07-22T18:00:00.000Z",
            avatarCount: 5,
            voiceCount: 3,
          },
          effects: {
            providerNetworkCall: true,
            liveVerification: true,
            generation: false,
            admission: false,
            spend: false,
            deployment: false,
            migrationApply: false,
            publishing: false,
          },
        };
      },
    },
  });
  t.after(server.close);
  const headers = { "content-type": "application/json", "x-test-user": "owner-a" };
  const referenceUrl = `${server.base}/api/ai-media-studio/provider-configurations/heygen/static-credential-reference`;
  const verificationUrl = `${server.base}/api/ai-media-studio/provider-configurations/heygen/live-verification`;

  assert.equal((await fetch(referenceUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  const reference = await fetch(referenceUrl, {
    method: "POST", headers, body: JSON.stringify({ idempotencyKey: "heygen-reference-0001" }),
  });
  assert.equal(reference.status, 201);
  assert.equal(reference.headers.get("cache-control"), "private, no-store");
  const referenceBody = await reference.text();
  assert.deepEqual(JSON.parse(referenceBody), {
    outcome: "created",
    credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 },
  });
  assert.doesNotMatch(referenceBody, /apiKey|secretRef|providerAccountId|bindingId|owner-a/iu);
  assert.equal(setupCalls.length, 1);

  const crossSite = await fetch(referenceUrl, {
    method: "POST",
    headers: { ...headers, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: JSON.stringify({ idempotencyKey: "heygen-reference-cross-site" }),
  });
  assert.equal(crossSite.status, 403);
  const formPost = await fetch(referenceUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-test-user": "owner-a" },
    body: "idempotencyKey=heygen-reference-form",
  });
  assert.equal(formPost.status, 415);
  assert.equal(setupCalls.length, 1);
  assert.deepEqual(setupCalls[0]?.scope, { ownerUserId: "owner-a", workspaceId: "personal" });
  assert.equal(setupCalls[0]?.actorUserId, "owner-a");

  for (const body of [
    { idempotencyKey: "heygen-reference-0002", apiKey: "secret" },
    { idempotencyKey: "heygen-reference-0002", secretRef: "env://attacker" },
    { idempotencyKey: "heygen-reference-0002", providerAccountId: accountId },
  ]) {
    const response = await fetch(referenceUrl, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /secret|attacker|11111111/iu);
  }
  assert.equal((await fetch(`${referenceUrl}?secretRef=attacker`, {
    method: "POST", headers, body: JSON.stringify({ idempotencyKey: "heygen-reference-0003" }),
  })).status, 400);
  assert.equal(setupCalls.length, 1);

  assert.equal((await fetch(verificationUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  const verified = await fetch(verificationUrl, {
    method: "POST", headers, body: JSON.stringify({ idempotencyKey: "heygen-verify-0001" }),
  });
  assert.equal(verified.status, 201);
  const verifiedBody = await verified.text();
  assert.match(verifiedBody, /"state":"verified"/u);
  assert.match(verifiedBody, /"spend":false/u);
  assert.doesNotMatch(verifiedBody, /apiKey|secretRef|providerAccountId|avatarLookId|voiceId|evidence_public/iu);
  assert.equal(verificationCalls.length, 1);

  const unsafeVerification = await fetch(verificationUrl, {
    method: "POST", headers, body: JSON.stringify({ idempotencyKey: "heygen-verify-0002", avatarLookId: "attacker" }),
  });
  assert.equal(unsafeVerification.status, 400);
  assert.equal(verificationCalls.length, 1);
});

test("live verification route is unavailable without a separate authorizer/coordinator", async (t) => {
  const server = await harness({});
  t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/provider-configurations/heygen/live-verification`;
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": "owner-a" },
    body: JSON.stringify({ idempotencyKey: "heygen-verify-0003" }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Live HeyGen verification persistence unavailable",
    code: "persistence_unavailable",
  });
});
