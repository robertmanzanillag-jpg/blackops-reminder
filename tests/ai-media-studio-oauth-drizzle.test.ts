import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleOAuthSessionRepository, createDrizzleOAuthAccountBindingVerifier, type OAuthDatabase } from "../server/ai-media-studio/oauth/drizzle-repository";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };

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
