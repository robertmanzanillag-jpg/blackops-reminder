import assert from "node:assert/strict";
import test from "node:test";
import type { OAuthVault, OAuthVaultContext } from "../server/ai-media-studio/oauth/contracts";
import { InMemoryOAuthSessionRepository } from "../server/ai-media-studio/oauth/in-memory";
import { createOAuthService } from "../server/ai-media-studio/oauth/service";

const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
const providerAccountId = "11111111-1111-4111-8111-111111111111";
const redirectUri = "https://app.example.com/oauth/tiktok/callback";
const policies = { tiktok: { redirectUris: [redirectUri], scopes: ["video.publish", "user.info.basic"] } } as const;

function harness(repository = new InMemoryOAuthSessionRepository(), clock = () => new Date("2026-07-21T12:00:00.000Z")) {
  const puts: Array<{ value: string; context: OAuthVaultContext }> = [];
  const deletes: Array<{ reference: string; context: OAuthVaultContext }> = [];
  const vault: OAuthVault = {
    async put(value, context) { puts.push({ value, context }); return `vault://ai-media-studio/oauth-pkce/v1/${context.sessionId}`; },
    async read() { throw new Error("not used by foundation service"); },
    async delete(reference, context) { deletes.push({ reference, context }); },
  };
  let accountChecks = 0;
  const service = createOAuthService({
    repository,
    vault,
    accounts: { async assertConnectable() { accountChecks += 1; } },
    policies,
    now: clock,
  });
  return { service, puts, deletes, accountChecks: () => accountChecks };
}

test("start binds tenant, actor, account, redirect and exact scopes while returning no verifier/reference", async () => {
  const h = harness();
  const response = await h.service.start({
    scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok",
  });
  assert.match(response.state, /^[A-Za-z0-9_-]{64}$/);
  assert.match(response.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(response.codeChallengeMethod, "S256");
  assert.equal(response.expiresAt, "2026-07-21T12:10:00.000Z");
  assert.equal(h.accountChecks(), 1);
  assert.equal(h.puts.length, 1);
  assert.ok(h.puts[0].value.length >= 43);
  assert.equal(h.puts[0].context.actorUserId, "actor-1");
  assert.equal(JSON.stringify(response).includes("verifier"), false);
  assert.equal(JSON.stringify(response).includes("vault://"), false);
});

test("start fails closed for unconfigured dependencies, policy redirects, and TTL above 15 minutes", async () => {
  assert.throws(() => createOAuthService({}), /dependencies are not configured/);
  assert.throws(() => createOAuthService({
    repository: new InMemoryOAuthSessionRepository(), vault: {} as OAuthVault,
    accounts: { async assertConnectable() {} }, policies, ttlMs: 900_001,
  }), /TTL is invalid/);
  const bad = createOAuthService({ repository: new InMemoryOAuthSessionRepository(),
    vault: { put: async () => "ref", read: async () => "value", delete: async () => undefined },
    accounts: { async assertConnectable() {} },
    policies: { tiktok: { redirectUris: ["http://unsafe.example/callback"], scopes: ["video.publish"] } },
  });
  await assert.rejects(bad.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" }), /redirect is invalid/);

  for (const unsafeRedirect of [
    "https://user@app.example.com/oauth/callback",
    "https://app.example.com/oauth/callback?next=https://evil.example",
    "https://app.example.com/oauth/callback#fragment",
    "https://app.example.com:8443/oauth/callback",
  ]) {
    const unsafe = createOAuthService({ repository: new InMemoryOAuthSessionRepository(),
      vault: { put: async () => "vault://ai-media-studio/oauth-pkce/v1/11111111-1111-4111-8111-111111111111", read: async () => "value", delete: async () => undefined },
      accounts: { async assertConnectable() {} },
      policies: { tiktok: { redirectUris: [unsafeRedirect], scopes: ["video.publish"] } },
    });
    await assert.rejects(unsafe.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" }), /redirect is invalid/);
  }
});

test("start rejects a malformed or wrong-purpose vault reference and compensates it", async () => {
  const deletes: string[] = [];
  const service = createOAuthService({
    repository: new InMemoryOAuthSessionRepository(),
    vault: {
      put: async () => "https://vault.example/pkce/secret",
      read: async () => "unused",
      delete: async (reference) => { deletes.push(reference); },
    },
    accounts: { async assertConnectable() {} },
    policies,
  });
  await assert.rejects(
    service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" }),
    /reference is invalid/,
  );
  assert.deepEqual(deletes, ["https://vault.example/pkce/secret"]);
});

test("start rejects an echo vault before a raw verifier can reach persistence", async () => {
  let creates = 0;
  const repository = new InMemoryOAuthSessionRepository();
  const originalCreate = repository.create.bind(repository);
  repository.create = async (session) => { creates += 1; return originalCreate(session); };
  const service = createOAuthService({
    repository,
    vault: {
      put: async (value) => value,
      read: async () => "unused",
      delete: async () => undefined,
    },
    accounts: { async assertConnectable() {} },
    policies,
  });

  await assert.rejects(
    service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" }),
    /reference is invalid/,
  );
  assert.equal(creates, 0);
});

test("repository failure compensates the vault write", async () => {
  const repository = new InMemoryOAuthSessionRepository();
  repository.create = async () => { throw new Error("database rejected"); };
  const h = harness(repository);
  await assert.rejects(h.service.start({
    scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok",
  }), /database rejected/);
  assert.equal(h.puts.length, 1);
  assert.equal(h.deletes.length, 1);
  assert.equal(h.deletes[0].reference, `vault://ai-media-studio/oauth-pkce/v1/${h.deletes[0].context.sessionId}`);
});

test("denial consumes once and deletes the verifier; replay and exact-binding mismatch fail closed", async () => {
  const h = harness();
  const started = await h.service.start({
    scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok",
  });
  const callback = { state: started.state, platform: "tiktok" as const, outcome: "denied" as const };
  const result = await h.service.consume(callback);
  assert.equal(result.outcome, "denied");
  assert.equal(h.deletes.length, 1);
  await assert.rejects(h.service.consume(callback), /rejected/);

  const second = await h.service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" });
  await assert.rejects(h.service.consume({ ...callback, state: second.state, platform: "instagram" }), /not configured|rejected/);
});

test("authorized callback consumes once without exposing or prematurely deleting the verifier reference", async () => {
  const h = harness();
  const started = await h.service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" });
  const result = await h.service.consume({ state: started.state, platform: "tiktok", outcome: "authorized" });
  assert.equal(result.outcome, "authorized");
  assert.equal(h.deletes.length, 0);
  assert.equal(JSON.stringify(result).includes("vault"), false);
});

test("expired state cannot be consumed", async () => {
  let current = new Date("2026-07-21T12:00:00.000Z");
  const h = harness(new InMemoryOAuthSessionRepository(), () => current);
  const started = await h.service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" });
  current = new Date("2026-07-21T12:11:00.000Z");
  await assert.rejects(h.service.consume({ state: started.state, platform: "tiktok", outcome: "error" }), /rejected/);
});
