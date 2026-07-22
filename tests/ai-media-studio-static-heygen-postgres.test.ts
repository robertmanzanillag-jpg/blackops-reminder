import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { Pool } from "pg";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};

const DATABASE = "ams_static_heygen_test";
const TEMP_PREFIX = "ams-static-heygen-pg-";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8")) as Manifest;
const pendingForward = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_forward.sql", import.meta.url), "utf8");
const pendingRollback = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_rollback.sql", import.meta.url), "utf8");

function ownedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("static HeyGen PostgreSQL test requires only owned TEST_DATABASE_URL");
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:"); assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres"); assert.equal(parsed.password, ""); assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), "55437");
  const socket = parsed.searchParams.get("host"); assert.ok(socket);
  const resolvedSocket = realpathSync(socket); const root = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(root), realpathSync(process.platform === "darwin" ? "/private/tmp" : "/tmp"));
  assert.ok(basename(root).startsWith(TEMP_PREFIX)); assert.equal(basename(resolvedSocket), "socket");
  return value;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest = enabled ? test : test.skip;
const pool = new Pool({ connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/disabled", max: 1, allowExitOnIdle: true });
after(async () => pool.end());

function reviewedForward(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  return bytes.toString("utf8");
}

integrationTest("PG16 exact PR1-PR27 chain accepts pending static HeyGen binding, rotation, and guarded rollback", async () => {
  assert.equal(manifest.migrations.length, 22);
  for (const entry of manifest.migrations) {
    if (entry.pullRequest === "PR26") {
      for (const role of manifest.pr26.requiredRoles) {
        assert.equal(role.login, false); assert.equal(role.inherit, false);
        await pool.query(`CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    await pool.query(reviewedForward(entry.forward));
  }
  await pool.query(pendingForward);
  const accountId = "10000000-0000-4000-8000-000000000001";
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,'owner-a','personal','heygen','HeyGen','disconnected','unverified',0,'not_bound')`, [accountId]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO ai_media_static_credential_bindings
      (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
       expected_credential_version,target_credential_version,secret_ref,idempotency_key,request_digest)
      VALUES ('20000000-0000-4000-8000-000000000001','owner-a','personal','owner-a',$1,'heygen',0,1,
       'env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY','bind-static-0001',$2)`, [accountId, `sha256:${"a".repeat(64)}`]);
    await client.query(`UPDATE ai_media_provider_accounts SET credential_source='static_api_key',
      secret_ref='env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY',credential_version=1,
      credential_actor_user_id='owner-a' WHERE id=$1`, [accountId]);
    await client.query("COMMIT");

    await client.query("BEGIN");
    await client.query(`UPDATE ai_media_static_credential_bindings SET lifecycle_state='superseded',
      superseded_at=clock_timestamp(),updated_at=clock_timestamp() WHERE provider_account_id=$1 AND lifecycle_state='pending'`, [accountId]);
    await client.query(`INSERT INTO ai_media_static_credential_bindings
      (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
       expected_credential_version,target_credential_version,secret_ref,idempotency_key,request_digest)
      VALUES ('20000000-0000-4000-8000-000000000002','owner-a','personal','owner-a',$1,'heygen',1,2,
       'env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2','bind-static-0002',$2)`, [accountId, `sha256:${"b".repeat(64)}`]);
    await client.query(`UPDATE ai_media_provider_accounts SET
      secret_ref='env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2',credential_version=2 WHERE id=$1`, [accountId]);
    await client.query("COMMIT");
  } finally { client.release(); }

  const graph = await pool.query(`SELECT accounts.credential_source,accounts.credential_status,accounts.status,
    accounts.credential_version,bindings.target_credential_version,bindings.lifecycle_state,bindings.verification_state
    FROM ai_media_provider_accounts accounts JOIN ai_media_static_credential_bindings bindings
      ON bindings.owner_user_id=accounts.owner_user_id AND bindings.workspace_id=accounts.workspace_id
      AND bindings.provider_account_id=accounts.id AND bindings.secret_ref=accounts.secret_ref
    WHERE accounts.id=$1 AND bindings.lifecycle_state='pending'`, [accountId]);
  assert.deepEqual(graph.rows, [{ credential_source: "static_api_key", credential_status: "unverified",
    status: "disconnected", credential_version: 2, target_credential_version: 2,
    lifecycle_state: "pending", verification_state: "unverified" }]);

  await assert.rejects(pool.query(pendingRollback), /rollback preserves static credential evidence; stop and forward-fix/u);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM ai_media_static_credential_bindings")).rows[0]?.count, 2);
});
