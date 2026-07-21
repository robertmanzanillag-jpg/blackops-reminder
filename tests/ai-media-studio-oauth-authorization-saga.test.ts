import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createOAuthAuthorizationSaga } from "../server/ai-media-studio/oauth/authorization-saga";
import type {
  OAuthAuthorizationCodeVault, OAuthProviderConnector, OAuthSafeTokenDescriptor,
  OAuthTokenVault, OAuthTokenVaultContext, OAuthTokenVaultRecord, OAuthVault,
} from "../server/ai-media-studio/oauth/contracts";
import { digestOAuthState } from "../server/ai-media-studio/oauth/crypto";
import { InMemoryOAuthSessionRepository } from "../server/ai-media-studio/oauth/in-memory";

const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
const accountId = "11111111-1111-4111-8111-111111111111";
const state = "s".repeat(64);
const code = "authorization-code-sentinel";
const requestedScopes = ["video.publish", "user.info.basic"];

async function seeded(options: { pkce?: boolean; externalAccountId?: string | null } = {}) {
  const repository = new InMemoryOAuthSessionRepository();
  repository.seedProviderAccount({ scope, id: accountId, platform: "tiktok", credentialVersion: 2,
    externalAccountId: options.externalAccountId ?? null, secretRef: null });
  const id = randomUUID();
  await repository.create({
    id, scope, actorUserId: "actor-1", providerAccountId: accountId, platform: "tiktok",
    stateDigest: digestOAuthState(state), redirectUri: "https://app.example.com/oauth/callback",
    requestedScopes, pkceMode: options.pkce ? "required_s256" : "none",
    codeChallenge: options.pkce ? "c".repeat(43) : null, codeChallengeMethod: options.pkce ? "S256" : null,
    pkceVerifierRef: options.pkce ? `vault://ai-media-studio/oauth-pkce/v1/${id}` : null,
    expiresAt: "2026-07-21T12:10:00.000Z", createdAt: "2026-07-21T12:00:00.000Z",
  });
  return { repository, id };
}

function harness(repository: InMemoryOAuthSessionRepository, clock: { now: Date }) {
  const codes = new Map<string, string>();
  const candidates = new Map<string, OAuthTokenVaultRecord>();
  let connectorCalls = 0;
  let pkceReads = 0;
  let codeDeletes = 0;
  let pkceDeletes = 0;
  let tokenDeletes = 0;
  const codeVault: OAuthAuthorizationCodeVault = {
    async putOnce(value, context) {
      const ref = `vault://ai-media-studio/oauth-code/v1/${context.sessionId}`;
      const prior = codes.get(ref); if (prior !== undefined && prior !== value) throw new Error("binding conflict");
      codes.set(ref, value); return ref;
    },
    async read(ref) { const value = codes.get(ref); if (!value) throw new Error("missing"); return value; },
    async delete(ref) { codeDeletes += 1; codes.delete(ref); },
  };
  const pkceVault: OAuthVault = {
    async put() { throw new Error("unused"); },
    async read() { pkceReads += 1; return "p".repeat(64); },
    async delete() { pkceDeletes += 1; },
  };
  const connector: OAuthProviderConnector = {
    async exchange() {
      connectorCalls += 1;
      return { platform: "tiktok", externalAccountId: "external-1", scopes: requestedScopes,
        capabilities: ["publish_video"], accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        refreshTokenExpiresAt: null, tokenKind: "Bearer", manifestRevision: "tiktok-v1",
        tokenBundle: { accessToken: "access-token-sentinel", refreshToken: "refresh-token-sentinel" } };
    },
  };
  const tokenVault: OAuthTokenVault = {
    async putOnce(input) {
      const ref = `vault://ai-media-studio/oauth-token/v1/${input.context.tokenBindingId}`;
      const record = { reference: ref, descriptor: input.descriptor }; candidates.set(input.context.tokenBindingId, record); return record;
    },
    async find(context) { return candidates.get(context.tokenBindingId); },
    async readDescriptor(ref, context) {
      const found = candidates.get(context.tokenBindingId); if (!found || found.reference !== ref) throw new Error("missing");
      return found.descriptor;
    },
    async delete() { tokenDeletes += 1; },
  };
  const saga = createOAuthAuthorizationSaga({ repository, authorizationCodeVault: codeVault, pkceVault,
    connector, tokenVault, now: () => clock.now });
  const input = { state, authorizationCode: code, scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok" as const, leaseOwner: "worker-1" };
  return { saga, input, candidates, connectorCalls: () => connectorCalls, pkceReads: () => pkceReads,
    codeDeletes: () => codeDeletes, pkceDeletes: () => pkceDeletes,
    tokenDeletes: () => tokenDeletes, codeVault, pkceVault, connector, tokenVault };
}

test("authorization saga claims exactly once, exchanges once, and atomically binds one credential version", async () => {
  const { repository, id } = await seeded();
  const h = harness(repository, { now: new Date("2026-07-21T12:01:00.000Z") });
  const [first, second] = await Promise.allSettled([h.saga.authorize(h.input), h.saga.authorize(h.input)]);
  assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(h.connectorCalls(), 1);
  assert.equal(h.tokenDeletes(), 0);
  assert.equal(repository.getSession(id)?.exchangeStatus, "succeeded");
  assert.equal(repository.getSession(id)?.outcome, "authorized");
  const account = repository.getProviderAccount(scope, accountId, "tiktok");
  assert.equal(account?.credentialVersion, 3);
  assert.match(account?.secretRef ?? "", /^vault:\/\/ai-media-studio\/oauth-token\/v1\//u);
  assert.equal(JSON.stringify(first).includes("access-token-sentinel"), false);
});

test("claim rejects wrong actor, account, platform, code replay, live lease, and stale fence", async () => {
  const { repository, id } = await seeded();
  const base = { stateDigest: digestOAuthState(state), scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok" as const, codeDigest: "a".repeat(64), leaseToken: randomUUID(), leaseOwner: "worker",
    leaseExpiresAt: "2026-07-21T12:02:00.000Z", now: "2026-07-21T12:01:00.000Z" };
  assert.equal(await repository.claim({ ...base, actorUserId: "other" }), undefined);
  assert.equal(await repository.claim({ ...base, providerAccountId: randomUUID() }), undefined);
  assert.equal(await repository.claim({ ...base, platform: "facebook" }), undefined);
  const winner = await repository.claim(base); assert.ok(winner);
  assert.equal(await repository.claim({ ...base, leaseToken: randomUUID() }), undefined);
  const recovered = await repository.claim({ ...base, codeDigest: "b".repeat(64), leaseToken: randomUUID(),
    now: "2026-07-21T12:03:00.000Z", leaseExpiresAt: "2026-07-21T12:04:00.000Z" });
  assert.equal(recovered, undefined);
  assert.equal(await repository.markExchangeStarted({ sessionId: id, scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok", leaseToken: winner.leaseToken, leaseFencing: winner.leaseFencing - 1,
    now: "2026-07-21T12:01:10.000Z" }), undefined);
});

test("expired pre-exchange lease recovers with the same code and PKCE snapshot controls vault reads", async () => {
  for (const pkce of [false, true]) {
    const { repository } = await seeded({ pkce });
    const clock = { now: new Date("2026-07-21T12:01:00.000Z") };
    const h = harness(repository, clock);
    const digest = digestOAuthState(state);
    const claim = await repository.claim({ stateDigest: digest, scope, actorUserId: "actor-1", providerAccountId: accountId,
      platform: "tiktok", codeDigest: createHash("sha256").update(code).digest("hex"), leaseToken: randomUUID(), leaseOwner: "dead-worker",
      leaseExpiresAt: "2026-07-21T12:01:01.000Z", now: "2026-07-21T12:00:59.000Z" });
    assert.ok(claim);
    clock.now = new Date("2026-07-21T12:01:02.000Z");
    assert.equal((await h.saga.authorize(h.input)).outcome, "authorized");
    assert.equal(h.connectorCalls(), 1);
    assert.equal(h.pkceReads(), pkce ? 1 : 0);
  }
});

test("post-exchange recovery finalizes a candidate without a second provider call", async () => {
  const { repository, id } = await seeded();
  const clock = { now: new Date("2026-07-21T12:01:00.000Z") };
  const h = harness(repository, clock);
  const digest = createHash("sha256").update(code).digest("hex");
  const claim = await repository.claim({ stateDigest: digestOAuthState(state), scope, actorUserId: "actor-1",
    providerAccountId: accountId, platform: "tiktok", codeDigest: digest, leaseToken: randomUUID(), leaseOwner: "dead",
    leaseExpiresAt: "2026-07-21T12:01:01.000Z", now: "2026-07-21T12:00:59.000Z" });
  assert.ok(claim);
  const ref = `vault://ai-media-studio/oauth-code/v1/${id}`;
  await h.codeVault.putOnce(code, { purpose: "ai_media_oauth_authorization_code", ...scope, actorUserId: "actor-1",
    providerAccountId: accountId, platform: "tiktok", sessionId: id, tokenBindingId: claim.tokenBindingId,
    codeDigest: digest, expiresAt: claim.session.expiresAt });
  const ready = await repository.attachAuthorizationCode({ sessionId: id, scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok", leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing,
    now: "2026-07-21T12:01:00.000Z", authorizationCodeRef: ref }); assert.ok(ready);
  const started = await repository.markExchangeStarted({ sessionId: id, scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok", leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing, now: "2026-07-21T12:01:00.000Z" }); assert.ok(started);
  const descriptor: OAuthSafeTokenDescriptor = { tokenBindingId: claim.tokenBindingId, platform: "tiktok",
    externalAccountId: "external-1", scopes: requestedScopes, capabilities: ["publish_video"],
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", refreshTokenExpiresAt: null, tokenKind: "Bearer", manifestRevision: "tiktok-v1" };
  const context: OAuthTokenVaultContext = { purpose: "ai_media_oauth_token", ...scope, providerAccountId: accountId,
    platform: "tiktok", sessionId: id, targetCredentialVersion: 3, tokenBindingId: claim.tokenBindingId };
  await h.tokenVault.putOnce({ context, bundle: { accessToken: "candidate-secret" }, descriptor });
  clock.now = new Date("2026-07-21T12:01:02.000Z");
  const result = await h.saga.authorize(h.input);
  assert.equal(result.outcome, "authorized");
  assert.equal(h.connectorCalls(), 0);
});

test("missing post-start candidate becomes terminal indeterminate and is never re-exchanged", async () => {
  const { repository, id } = await seeded();
  const clock = { now: new Date("2026-07-21T12:01:02.000Z") };
  const h = harness(repository, clock);
  const digest = createHash("sha256").update(code).digest("hex");
  const claim = await repository.claim({ stateDigest: digestOAuthState(state), scope, actorUserId: "actor-1",
    providerAccountId: accountId, platform: "tiktok", codeDigest: digest, leaseToken: randomUUID(), leaseOwner: "dead",
    leaseExpiresAt: "2026-07-21T12:01:01.000Z", now: "2026-07-21T12:00:59.000Z" }); assert.ok(claim);
  const ref = `vault://ai-media-studio/oauth-code/v1/${id}`;
  const ready = await repository.attachAuthorizationCode({ sessionId: id, scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok", leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing,
    now: "2026-07-21T12:01:00.000Z", authorizationCodeRef: ref }); assert.ok(ready);
  assert.ok(await repository.markExchangeStarted({ sessionId: id, scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok", leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing, now: "2026-07-21T12:01:00.000Z" }));
  await assert.rejects(h.saga.authorize(h.input), /rejected/);
  assert.equal(h.connectorCalls(), 0);
  assert.equal(repository.getSession(id)?.exchangeStatus, "indeterminate");
  assert.equal(repository.getSession(id)?.failureCode, "candidate_missing");
});

test("identity conflict never overwrites the account and deletes only its terminalized candidate", async () => {
  const { repository } = await seeded({ externalAccountId: "existing-external" });
  const h = harness(repository, { now: new Date("2026-07-21T12:01:00.000Z") });
  await assert.rejects(h.saga.authorize(h.input), /OAuth request was rejected/);
  const account = repository.getProviderAccount(scope, accountId, "tiktok");
  assert.equal(account?.externalAccountId, "existing-external");
  assert.equal(account?.credentialVersion, 2);
  assert.equal(account?.secretRef, null);
  assert.equal(h.connectorCalls(), 1);
  assert.equal(h.candidates.size, 1);
  assert.equal(h.tokenDeletes(), 1);
});

test("a mismatched vault candidate cannot replace the freshly normalized provider identity", async () => {
  const { repository, id } = await seeded();
  const h = harness(repository, { now: new Date("2026-07-21T12:01:00.000Z") });
  h.tokenVault.putOnce = async (input) => {
    const record: OAuthTokenVaultRecord = {
      reference: `vault://ai-media-studio/oauth-token/v1/${input.context.tokenBindingId}`,
      descriptor: { ...input.descriptor, externalAccountId: "substituted-account" },
    };
    h.candidates.set(input.context.tokenBindingId, record);
    return record;
  };

  await assert.rejects(h.saga.authorize(h.input), /rejected/);
  assert.equal(repository.getProviderAccount(scope, accountId, "tiktok")?.credentialVersion, 2);
  assert.equal(repository.getProviderAccount(scope, accountId, "tiktok")?.externalAccountId, null);
  assert.equal(repository.getSession(id)?.exchangeStatus, "indeterminate");
  assert.equal(repository.getSession(id)?.failureCode, "invalid_provider_result");
  assert.equal(h.tokenDeletes(), 1);
});

test("unknown or non-publishing capabilities never activate an OAuth account", async () => {
  for (const capabilities of [["publish"], ["publish_video", "root_admin"]]) {
    const { repository } = await seeded();
    const h = harness(repository, { now: new Date("2026-07-21T12:01:00.000Z") });
    const originalExchange = h.connector.exchange.bind(h.connector);
    h.connector.exchange = async (input) => ({ ...(await originalExchange(input)), capabilities });
    await assert.rejects(h.saga.authorize(h.input), /rejected/);
    assert.equal(repository.getProviderAccount(scope, accountId, "tiktok")?.credentialVersion, 2);
  }
});

test("provider secret sentinels are absent from callback errors and durable session state", async () => {
  const { repository, id } = await seeded();
  const h = harness(repository, { now: new Date("2026-07-21T12:01:00.000Z") });
  h.connector.exchange = async () => { throw new Error("provider leaked access-token-sentinel"); };
  let error: unknown;
  try { await h.saga.authorize(h.input); } catch (caught) { error = caught; }
  assert.equal(error instanceof Error ? error.message : "", "OAuth request was rejected");
  const durable = JSON.stringify(repository.getSession(id));
  for (const secret of [code, "access-token-sentinel", "refresh-token-sentinel"]) assert.equal(durable.includes(secret), false);
});

test("an expired worker cannot terminalize or clean vault material after a new fence wins", async () => {
  const { repository, id } = await seeded({ pkce: true });
  const clock = { now: new Date("2026-07-21T12:01:00.000Z") };
  const h = harness(repository, clock);
  let rejectExchange!: (error: Error) => void;
  let exchangeStarted!: () => void;
  const started = new Promise<void>((resolve) => { exchangeStarted = resolve; });
  h.connector.exchange = async () => {
    exchangeStarted();
    return new Promise<never>((_resolve, reject) => { rejectExchange = reject; });
  };

  const staleWorker = h.saga.authorize(h.input);
  await started;
  clock.now = new Date("2026-07-21T12:02:01.000Z");
  const recovered = await repository.claim({
    stateDigest: digestOAuthState(state), scope, actorUserId: "actor-1", providerAccountId: accountId,
    platform: "tiktok", codeDigest: createHash("sha256").update(code).digest("hex"),
    leaseToken: randomUUID(), leaseOwner: "worker-2", now: clock.now.toISOString(),
    leaseExpiresAt: "2026-07-21T12:03:01.000Z",
  });
  assert.ok(recovered);
  assert.ok(recovered.leaseFencing > 1);
  rejectExchange(new Error("late provider failure"));
  await assert.rejects(staleWorker, /rejected/);
  assert.equal(repository.getSession(id)?.leaseFencing, recovered.leaseFencing);
  assert.equal(repository.getSession(id)?.exchangeStatus, "in_progress");
  assert.equal(h.codeDeletes(), 0);
  assert.equal(h.pkceDeletes(), 0);
});

test("a stale pre-attach worker cannot delete the authorization code owned by a newer fence", async () => {
  const { repository, id } = await seeded();
  const clock = { now: new Date("2026-07-21T12:01:00.000Z") };
  const h = harness(repository, clock);
  const originalPut = h.codeVault.putOnce.bind(h.codeVault);
  let calls = 0;
  let firstPutReached!: () => void;
  let releaseFirst!: () => void;
  const firstReached = new Promise<void>((resolve) => { firstPutReached = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  h.codeVault.putOnce = async (value, context) => {
    const ref = await originalPut(value, context);
    calls += 1;
    if (calls === 1) {
      firstPutReached();
      await firstRelease;
    }
    return ref;
  };

  const staleWorker = h.saga.authorize(h.input);
  await firstReached;
  clock.now = new Date("2026-07-21T12:02:01.000Z");
  const winner = h.saga.authorize({ ...h.input, leaseOwner: "worker-2" });
  assert.equal((await winner).outcome, "authorized");
  releaseFirst();

  await assert.rejects(staleWorker, /rejected/);
  assert.equal(repository.getSession(id)?.exchangeStatus, "succeeded");
  assert.equal(h.codeDeletes(), 1, "only the terminal winner may clean the shared code reference");
});
