import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleOAuthSessionRepository, createDrizzleOAuthAccountBindingVerifier, type OAuthDatabase } from "../server/ai-media-studio/oauth/drizzle-repository";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };

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
  const result = await repository.consume({
    stateDigest: "a".repeat(64), platform: "tiktok",
    outcome: "authorized", now: "2026-07-21T12:00:00.000Z",
  });
  assert.equal(result, undefined);
  const normalized = calls[0].sql.replace(/\s+/g, " ").trim();
  assert.match(normalized, /^update .*"?ai_media_oauth_sessions"?/i);
  for (const column of ["state_digest", "platform", "status", "consumed_at", "expires_at"]) {
    assert.match(normalized, new RegExp(column));
  }
  for (const untrusted of ["owner_user_id", "workspace_id", "actor_user_id", "provider_account_id", "redirect_uri", "requested_scopes"]) {
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
