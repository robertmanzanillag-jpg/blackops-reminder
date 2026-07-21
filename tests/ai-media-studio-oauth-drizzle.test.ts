import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleOAuthAuthorizationSagaRepository, DrizzleOAuthSessionRepository, createDrizzleOAuthAccountBindingVerifier, type OAuthDatabase, type OAuthTransactionalDatabase } from "../server/ai-media-studio/oauth/drizzle-repository";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };

function sagaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222", owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId, actor_user_id: "actor-1",
    provider_account_id: "11111111-1111-4111-8111-111111111111", platform: "tiktok",
    state_digest: "a".repeat(64), redirect_uri: "https://app.example.com/oauth/callback",
    requested_scopes: ["video.publish"], pkce_mode: "none", code_challenge: null,
    code_challenge_method: null, pkce_verifier_ref: null, status: "processing",
    exchange_status: "in_progress", lease_token: "33333333-3333-4333-8333-333333333333",
    lease_owner: "worker-1", lease_expires_at: new Date("2026-07-21T12:02:00.000Z"),
    lease_fencing: 1, authorization_code_digest: "b".repeat(64),
    authorization_code_ref: "vault://ai-media-studio/oauth-code/v1/44444444-4444-4444-8444-444444444444",
    expected_credential_version: 2, target_credential_version: 3,
    token_binding_id: "55555555-5555-4555-8555-555555555555", failure_code: null,
    outcome: null, expires_at: new Date("2026-07-21T12:10:00.000Z"), consumed_at: null,
    created_at: new Date("2026-07-21T12:00:00.000Z"), updated_at: new Date("2026-07-21T12:01:00.000Z"),
    ...overrides,
  };
}

test("create persists and maps none and required_s256 PKCE snapshots including null fields", async () => {
  for (const snapshot of [
    { pkceMode: "none" as const, codeChallenge: null, codeChallengeMethod: null, pkceVerifierRef: null },
    {
      pkceMode: "required_s256" as const,
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256" as const,
      pkceVerifierRef: "vault://ai-media-studio/oauth-pkce/v1/11111111-1111-4111-8111-111111111111",
    },
  ]) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const row = {
      id: "22222222-2222-4222-8222-222222222222",
      owner_user_id: scope.ownerUserId,
      workspace_id: scope.workspaceId,
      actor_user_id: "actor-1",
      provider_account_id: "33333333-3333-4333-8333-333333333333",
      platform: "tiktok",
      state_digest: "a".repeat(64),
      redirect_uri: "https://app.example.com/oauth/tiktok/callback",
      requested_scopes: ["video.publish"],
      pkce_mode: snapshot.pkceMode,
      code_challenge: snapshot.codeChallenge,
      code_challenge_method: snapshot.codeChallengeMethod,
      pkce_verifier_ref: snapshot.pkceVerifierRef,
      status: "pending",
      exchange_status: "not_started", lease_token: null, lease_owner: null, lease_expires_at: null,
      lease_fencing: 0, authorization_code_digest: null, authorization_code_ref: null,
      expected_credential_version: null, target_credential_version: null, token_binding_id: null, failure_code: null,
      outcome: null,
      expires_at: new Date("2026-07-21T12:10:00.000Z"),
      consumed_at: null,
      created_at: new Date("2026-07-21T12:00:00.000Z"),
      updated_at: new Date("2026-07-21T12:00:00.000Z"),
    };
    const db: OAuthDatabase = {
      async execute(query) { calls.push(dialect.sqlToQuery(query)); return { rows: [row] }; },
    };
    const created = await new DrizzleOAuthSessionRepository(db).create({
      id: row.id,
      scope,
      actorUserId: row.actor_user_id,
      providerAccountId: row.provider_account_id,
      platform: "tiktok",
      stateDigest: row.state_digest,
      redirectUri: row.redirect_uri,
      requestedScopes: row.requested_scopes,
      ...snapshot,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    });
    assert.equal(created.pkceMode, snapshot.pkceMode);
    assert.equal(created.codeChallenge, snapshot.codeChallenge);
    assert.equal(created.codeChallengeMethod, snapshot.codeChallengeMethod);
    assert.equal(created.pkceVerifierRef, snapshot.pkceVerifierRef);
    assert.match(calls[0].sql.replace(/\s+/g, " "), /requested_scopes, pkce_mode, code_challenge/i);
    assert.ok(calls[0].params.includes(snapshot.pkceMode));
    if (snapshot.pkceMode === "none") assert.ok(calls[0].params.filter((value) => value === null).length >= 3);
  }
});

test("row mapping rejects an unknown PKCE snapshot or challenge method", async () => {
  for (const invalid of [
    { pkce_mode: "future_mode", code_challenge_method: null },
    { pkce_mode: "required_s256", code_challenge_method: "plain" },
  ]) {
    const db: OAuthDatabase = { async execute() { return { rows: [{
      id: "22222222-2222-4222-8222-222222222222",
      owner_user_id: "owner-1", workspace_id: "workspace-1", actor_user_id: "actor-1",
      provider_account_id: "33333333-3333-4333-8333-333333333333", platform: "tiktok",
      state_digest: "a".repeat(64), redirect_uri: "https://app.example.com/callback",
      requested_scopes: ["video.publish"], code_challenge: null, pkce_verifier_ref: null,
      status: "pending", outcome: null, expires_at: new Date("2026-07-21T12:10:00.000Z"),
      consumed_at: null, created_at: new Date("2026-07-21T12:00:00.000Z"),
      updated_at: new Date("2026-07-21T12:00:00.000Z"), ...invalid,
    }] }; } };
    await assert.rejects(new DrizzleOAuthSessionRepository(db).create({
      id: "22222222-2222-4222-8222-222222222222", scope, actorUserId: "actor-1",
      providerAccountId: "33333333-3333-4333-8333-333333333333", platform: "tiktok",
      stateDigest: "a".repeat(64), redirectUri: "https://app.example.com/callback",
      requestedScopes: ["video.publish"], pkceMode: "none", codeChallenge: null,
      codeChallengeMethod: null, pkceVerifierRef: null, expiresAt: "2026-07-21T12:10:00.000Z",
      createdAt: "2026-07-21T12:00:00.000Z",
    }), /Invalid OAuth PKCE snapshot/);
  }
});

test("atomic consume resolves only digest plus platform fence and requires pending/unexpired state", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: OAuthDatabase = { async execute(query) { calls.push(dialect.sqlToQuery(query)); return { rows: [] }; } };
  const repository = new DrizzleOAuthSessionRepository(db);
  const result = await repository.consumeDeniedOrError({
    stateDigest: "a".repeat(64), platform: "tiktok",
    outcome: "error", now: "2026-07-21T12:00:00.000Z",
  });
  assert.equal(result, undefined);
  const normalized = calls[0].sql.replace(/\s+/g, " ").trim();
  assert.match(normalized, /^with consumed as \(update .*"?ai_media_oauth_sessions"?/i);
  assert.match(normalized, /update .*"?ai_media_oauth_vault_operations"?/i);
  for (const column of ["state_digest", "platform", "status", "consumed_at", "expires_at"]) {
    assert.match(normalized, new RegExp(column));
  }
  for (const untrusted of ["actor_user_id", "provider_account_id", "redirect_uri", "requested_scopes"]) {
    assert.doesNotMatch(normalized, new RegExp(untrusted));
  }
  assert.match(normalized, /status = .*consumed/i);
  assert.match(normalized, /status = .*pending/i);
  assert.match(normalized, /expires_at.*>/i);
  assert.match(normalized, /returning/i);
  assert.equal(calls.length, 1);
});

test("account verifier scopes exact tenant/account/platform without selecting secrets", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: OAuthDatabase = { async execute(query) { calls.push(dialect.sqlToQuery(query)); return { rows: [{ id: "account-1" }] }; } };
  await createDrizzleOAuthAccountBindingVerifier(db).assertConnectable({
    scope, actorUserId: "actor-1", providerAccountId: "11111111-1111-4111-8111-111111111111", platform: "tiktok",
  });
  const normalized = calls[0].sql.replace(/\s+/g, " ").trim();
  assert.match(normalized, /owner_user_id/);
  assert.match(normalized, /workspace_id/);
  assert.match(normalized, /provider_key/);
  assert.doesNotMatch(normalized, /secret_ref|access_token|refresh_token|configuration/);
});

test("account verifier fails closed when exact account binding is absent", async () => {
  const db: OAuthDatabase = { async execute() { return { rows: [] }; } };
  await assert.rejects(createDrizzleOAuthAccountBindingVerifier(db).assertConnectable({
    scope, actorUserId: "actor-1", providerAccountId: "11111111-1111-4111-8111-111111111111", platform: "tiktok",
  }), /not connectable/);
});

test("authorization saga SQL receives digests and opaque references but never raw code or tokens", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const execute = async (query: Parameters<OAuthDatabase["execute"]>[0]) => {
    calls.push(dialect.sqlToQuery(query)); return { rows: [] };
  };
  const db: OAuthTransactionalDatabase = { execute, async transaction(callback) { return callback({ execute }); } };
  const repository = new DrizzleOAuthAuthorizationSagaRepository(db);
  await repository.claim({ stateDigest: "a".repeat(64), scope, actorUserId: "actor-1",
    providerAccountId: "11111111-1111-4111-8111-111111111111", platform: "tiktok",
    codeDigest: "b".repeat(64), leaseToken: "22222222-2222-4222-8222-222222222222", leaseOwner: "worker-1",
    leaseExpiresAt: "2026-07-21T12:02:00.000Z", now: "2026-07-21T12:01:00.000Z" });
  const rendered = JSON.stringify(calls);
  for (const secret of ["authorization-code-sentinel", "access-token-sentinel", "refresh-token-sentinel"]) {
    assert.equal(rendered.includes(secret), false);
  }
  assert.equal(rendered.includes("a".repeat(64)), true);
  assert.equal(rendered.includes("b".repeat(64)), true);
});

test("authorization finalize runs account-version CAS and session completion in one short transaction", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let transactionCalls = 0;
  let step = 0;
  const execute = async (query: Parameters<OAuthDatabase["execute"]>[0]) => {
    calls.push(dialect.sqlToQuery(query));
    step += 1;
    if (step === 1) return { rows: [sagaRow()] };
    if (step === 2) return { rows: [{ id: accountId }] };
    return { rows: [sagaRow({ status: "consumed", exchange_status: "succeeded", outcome: "authorized",
      lease_token: null, lease_owner: null, lease_expires_at: null,
      consumed_at: new Date("2026-07-21T12:01:10.000Z"), updated_at: new Date("2026-07-21T12:01:10.000Z") })] };
  };
  const accountId = "11111111-1111-4111-8111-111111111111";
  const db: OAuthTransactionalDatabase = {
    execute,
    async transaction(callback) { transactionCalls += 1; return callback({ execute }); },
  };
  const completed = await new DrizzleOAuthAuthorizationSagaRepository(db).finalizeAuthorized({
    sessionId: "22222222-2222-4222-8222-222222222222", scope, actorUserId: "actor-1",
    providerAccountId: accountId, platform: "tiktok", leaseToken: "33333333-3333-4333-8333-333333333333",
    leaseFencing: 1, now: "2026-07-21T12:01:10.000Z",
    tokenReference: "vault://ai-media-studio/oauth-token/v1/66666666-6666-4666-8666-666666666666",
    descriptor: { tokenBindingId: "55555555-5555-4555-8555-555555555555", platform: "tiktok",
      externalAccountId: "external-1", scopes: ["video.publish"], capabilities: ["publish_video"],
      accessTokenExpiresAt: "2026-07-22T12:00:00.000Z", refreshTokenExpiresAt: null,
      tokenKind: "Bearer", manifestRevision: "tiktok-v1" },
    consumedAt: "2026-07-21T12:01:10.000Z",
  });
  assert.equal(transactionCalls, 1);
  assert.equal(completed?.outcome, "authorized");
  assert.equal(calls.length, 3);
  const accountSql = calls[1].sql.replace(/\s+/g, " ");
  assert.match(accountSql, /credential_version.*external_account_id|external_account_id.*credential_version/i);
  assert.match(accountSql, /credential_source_session_id/i);
  assert.match(accountSql, /credential_version\s*=/i);
  const completionSql = calls[2].sql.replace(/\s+/g, " ");
  assert.match(completionSql, /exchange_status.*succeeded/i);
  assert.match(completionSql, /lease_token.*lease_fencing/i);
});

test("authorization finalize stops before consuming the session when the account version CAS loses", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let step = 0;
  const execute = async (query: Parameters<OAuthDatabase["execute"]>[0]) => {
    calls.push(dialect.sqlToQuery(query)); step += 1;
    return step === 1 ? { rows: [sagaRow()] } : { rows: [] };
  };
  const db: OAuthTransactionalDatabase = { execute, async transaction(callback) { return callback({ execute }); } };
  const result = await new DrizzleOAuthAuthorizationSagaRepository(db).finalizeAuthorized({
    sessionId: "22222222-2222-4222-8222-222222222222", scope, actorUserId: "actor-1",
    providerAccountId: "11111111-1111-4111-8111-111111111111", platform: "tiktok",
    leaseToken: "33333333-3333-4333-8333-333333333333", leaseFencing: 1,
    now: "2026-07-21T12:01:10.000Z", consumedAt: "2026-07-21T12:01:10.000Z",
    tokenReference: "vault://ai-media-studio/oauth-token/v1/66666666-6666-4666-8666-666666666666",
    descriptor: { tokenBindingId: "55555555-5555-4555-8555-555555555555", platform: "tiktok",
      externalAccountId: "external-1", scopes: ["video.publish"], capabilities: ["publish_video"],
      accessTokenExpiresAt: "2026-07-22T12:00:00.000Z", refreshTokenExpiresAt: null,
      tokenKind: "Bearer", manifestRevision: "tiktok-v1" },
  });
  assert.equal(result, undefined);
  assert.equal(calls.length, 2);
});

test("markIndeterminate requires the exact still-live lease and fencing token", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const execute = async (query: Parameters<OAuthDatabase["execute"]>[0]) => {
    calls.push(dialect.sqlToQuery(query)); return { rows: [] };
  };
  const db: OAuthTransactionalDatabase = { execute, async transaction(callback) { return callback({ execute }); } };
  const result = await new DrizzleOAuthAuthorizationSagaRepository(db).markIndeterminate({
    sessionId: "22222222-2222-4222-8222-222222222222", scope, actorUserId: "actor-1",
    providerAccountId: "11111111-1111-4111-8111-111111111111", platform: "tiktok",
    leaseToken: "33333333-3333-4333-8333-333333333333", leaseFencing: 4,
    now: "2026-07-21T12:01:10.000Z", failureCode: "candidate_missing",
  });
  assert.equal(result, undefined);
  const normalized = calls[0].sql.replace(/\s+/g, " ");
  assert.match(normalized, /lease_token\s*=/i);
  assert.match(normalized, /lease_fencing\s*=/i);
  assert.match(normalized, /lease_expires_at\s*>/i);
});
