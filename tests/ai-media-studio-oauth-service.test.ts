import assert from "node:assert/strict";
import test from "node:test";
import type {
  OAuthPlatformPolicies,
  OAuthVault,
  OAuthVaultContext,
} from "../server/ai-media-studio/oauth/contracts";
import { InMemoryOAuthSessionRepository } from "../server/ai-media-studio/oauth/in-memory";
import { createOAuthService } from "../server/ai-media-studio/oauth/service";

const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
const providerAccountId = "11111111-1111-4111-8111-111111111111";
const nonePolicies = {
  tiktok: {
    redirectUris: ["https://app.example.com/oauth/tiktok/callback"],
    scopes: ["video.publish", "user.info.basic"],
    pkce: "none",
  },
} as const satisfies OAuthPlatformPolicies;
const requiredPolicies = {
  youtube_shorts: {
    redirectUris: ["https://app.example.com/oauth/youtube/callback"],
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    pkce: "required_s256",
  },
} as const satisfies OAuthPlatformPolicies;

function harness(
  policies: OAuthPlatformPolicies = nonePolicies,
  repository = new InMemoryOAuthSessionRepository(),
  clock = () => new Date("2026-07-21T12:00:00.000Z"),
) {
  const puts: Array<{ value: string; context: OAuthVaultContext }> = [];
  const reads: Array<{ reference: string; context: OAuthVaultContext }> = [];
  const deletes: Array<{ reference: string; context: OAuthVaultContext }> = [];
  const vault: OAuthVault = {
    async put(value, context) {
      puts.push({ value, context });
      return `vault://ai-media-studio/oauth-pkce/v1/${context.sessionId}`;
    },
    async read(reference, context) { reads.push({ reference, context }); return "v".repeat(64); },
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
  return { service, repository, puts, reads, deletes, accountChecks: () => accountChecks };
}

test("pkce none stores an explicit snapshot and performs zero vault calls", async () => {
  const repository = new InMemoryOAuthSessionRepository();
  let created: Parameters<typeof repository.create>[0] | undefined;
  const originalCreate = repository.create.bind(repository);
  repository.create = async (input) => { created = input; return originalCreate(input); };
  const h = harness(nonePolicies, repository);
  const response = await h.service.start({
    scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok",
  });

  assert.match(response.state, /^[A-Za-z0-9_-]{64}$/u);
  assert.equal(response.codeChallenge, undefined);
  assert.equal(response.codeChallengeMethod, undefined);
  assert.equal(response.expiresAt, "2026-07-21T12:10:00.000Z");
  assert.equal(created?.pkceMode, "none");
  assert.equal(created?.codeChallenge, null);
  assert.equal(created?.codeChallengeMethod, null);
  assert.equal(created?.pkceVerifierRef, null);
  assert.equal(h.accountChecks(), 1);
  assert.deepEqual([h.puts.length, h.reads.length, h.deletes.length], [0, 0, 0]);
  assert.equal(JSON.stringify(response).includes("verifier"), false);
  assert.equal(JSON.stringify(response).includes("vault://"), false);
});

test("synthetic required_s256 policy stores a complete PKCE snapshot", async () => {
  const repository = new InMemoryOAuthSessionRepository();
  let created: Parameters<typeof repository.create>[0] | undefined;
  const originalCreate = repository.create.bind(repository);
  repository.create = async (input) => { created = input; return originalCreate(input); };
  const h = harness(requiredPolicies, repository);
  const response = await h.service.start({
    scope, actorUserId: "actor-1", providerAccountId, platform: "youtube_shorts",
  });

  assert.match(response.codeChallenge ?? "", /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(response.codeChallengeMethod, "S256");
  assert.equal(created?.pkceMode, "required_s256");
  assert.equal(created?.codeChallenge, response.codeChallenge);
  assert.equal(created?.codeChallengeMethod, "S256");
  assert.match(created?.pkceVerifierRef ?? "", /^vault:\/\/ai-media-studio\/oauth-pkce\/v1\//u);
  assert.equal(h.puts.length, 1);
  assert.ok(h.puts[0].value.length >= 43);
  assert.equal(h.puts[0].context.actorUserId, "actor-1");
});

test("start captures an immutable PKCE decision before the account verification await", async () => {
  const mutablePolicy = {
    redirectUris: ["https://app.example.com/oauth/tiktok/callback"],
    scopes: ["video.publish"],
    pkce: "none" as "none" | "required_s256",
  };
  let persistedMode: string | undefined;
  let vaultPuts = 0;
  const repository = new InMemoryOAuthSessionRepository();
  const originalCreate = repository.create.bind(repository);
  repository.create = async (input) => { persistedMode = input.pkceMode; return originalCreate(input); };
  const service = createOAuthService({
    repository,
    vault: {
      async put(_value, context) { vaultPuts += 1; return `vault://ai-media-studio/oauth-pkce/v1/${context.sessionId}`; },
      async read() { throw new Error("not used"); },
      async delete() {},
    },
    accounts: { async assertConnectable() { mutablePolicy.pkce = "required_s256"; } },
    policies: { tiktok: mutablePolicy },
    now: () => new Date("2026-07-21T12:00:00.000Z"),
  });

  const response = await service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" });
  assert.equal(persistedMode, "none");
  assert.equal(response.codeChallenge, undefined);
  assert.equal(vaultPuts, 0);
});

test("start fails closed for missing/invalid policy, unsafe redirect, and TTL above 15 minutes", async () => {
  assert.throws(() => createOAuthService({}), /dependencies are not configured/);
  assert.throws(() => createOAuthService({
    repository: new InMemoryOAuthSessionRepository(), vault: {} as OAuthVault,
    accounts: { async assertConnectable() {} }, policies: nonePolicies, ttlMs: 900_001,
  }), /TTL is invalid/);

  for (const unsafeRedirect of [
    "http://unsafe.example/callback",
    "https://user@app.example.com/oauth/callback",
    "https://app.example.com/oauth/callback?next=https://evil.example",
    "https://app.example.com/oauth/callback#fragment",
    "https://app.example.com:8443/oauth/callback",
    "https://localhost/oauth/callback",
    "https://127.1/oauth/callback",
    "https://0x7f000001/oauth/callback",
    "https://0x7f.1/oauth/callback",
    "https://127.0x0.0.1/oauth/callback",
  ]) {
    const unsafePolicies = {
      tiktok: { redirectUris: [unsafeRedirect], scopes: ["video.publish"], pkce: "none" },
    } as const satisfies OAuthPlatformPolicies;
    const unsafe = harness(unsafePolicies).service;
    await assert.rejects(
      unsafe.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" }),
      /redirect is invalid/,
    );
  }

  const invalidMode = harness({
    tiktok: { ...nonePolicies.tiktok, pkce: "unexpected" as "none" },
  }).service;
  await assert.rejects(
    invalidMode.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" }),
    /not configured/,
  );
});

test("required_s256 rejects malformed, noncanonical, or echo vault references and compensates", async () => {
  for (const badReference of [
    "https://vault.example/pkce/secret",
    "vault://ai-media-studio/oauth-pkce/v1/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  ]) {
    const deletes: string[] = [];
    const service = createOAuthService({
      repository: new InMemoryOAuthSessionRepository(),
      vault: {
        put: async () => badReference,
        read: async () => "unused",
        delete: async (reference) => { deletes.push(reference); },
      },
      accounts: { async assertConnectable() {} },
      policies: requiredPolicies,
    });
    await assert.rejects(
      service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "youtube_shorts" }),
      /reference is invalid/,
    );
    assert.deepEqual(deletes, [badReference]);
  }

  let creates = 0;
  const repository = new InMemoryOAuthSessionRepository();
  repository.create = async (session) => { creates += 1; throw new Error(String(session.id)); };
  const echo = createOAuthService({
    repository,
    vault: { put: async (value) => value, read: async () => "unused", delete: async () => undefined },
    accounts: { async assertConnectable() {} },
    policies: requiredPolicies,
  });
  await assert.rejects(
    echo.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "youtube_shorts" }),
    /reference is invalid/,
  );
  assert.equal(creates, 0);
});

test("repository failure compensates only an existing verifier reference", async () => {
  for (const [policies, platform, expectedVaultCalls] of [
    [requiredPolicies, "youtube_shorts", 1],
    [nonePolicies, "tiktok", 0],
  ] as const) {
    const repository = new InMemoryOAuthSessionRepository();
    repository.create = async () => { throw new Error("database rejected"); };
    const h = harness(policies, repository);
    await assert.rejects(h.service.start({
      scope, actorUserId: "actor-1", providerAccountId, platform,
    }), /database rejected/);
    assert.equal(h.puts.length, expectedVaultCalls);
    assert.equal(h.deletes.length, expectedVaultCalls);
  }
});

test("denial and provider error consume once and delete only when a verifier exists", async () => {
  for (const [policies, platform, outcome, expectedDeletes] of [
    [requiredPolicies, "youtube_shorts", "denied", 1],
    [nonePolicies, "tiktok", "error", 0],
  ] as const) {
    const h = harness(policies);
    const started = await h.service.start({ scope, actorUserId: "actor-1", providerAccountId, platform });
    const callback = { state: started.state, platform, outcome };
    const result = await h.service.consume(callback);
    assert.equal(result.outcome, outcome);
    assert.equal(h.deletes.length, expectedDeletes);
    await assert.rejects(h.service.consume(callback), /rejected/);
  }
});

test("authorized callback is rejected before digest, repository mutation, or vault access", async () => {
  const repository = new InMemoryOAuthSessionRepository();
  let consumes = 0;
  repository.consume = async () => { consumes += 1; throw new Error("must not mutate"); };
  const h = harness(nonePolicies, repository);
  await assert.rejects(
    h.service.consume({ state: "not-even-a-valid-state", platform: "tiktok", outcome: "authorized" }),
    /rejected/,
  );
  assert.equal(consumes, 0);
  assert.deepEqual([h.puts.length, h.reads.length, h.deletes.length], [0, 0, 0]);
});

test("expired state cannot be consumed", async () => {
  let current = new Date("2026-07-21T12:00:00.000Z");
  const h = harness(nonePolicies, new InMemoryOAuthSessionRepository(), () => current);
  const started = await h.service.start({ scope, actorUserId: "actor-1", providerAccountId, platform: "tiktok" });
  current = new Date("2026-07-21T12:11:00.000Z");
  await assert.rejects(h.service.consume({ state: started.state, platform: "tiktok", outcome: "error" }), /rejected/);
});
