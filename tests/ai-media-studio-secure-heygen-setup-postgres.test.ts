import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  DrizzleSecureHeyGenSetupRepository,
  type SecureHeyGenSetupDatabase,
} from "../server/ai-media-studio/provider-credentials/drizzle-secure-heygen-setup-repository";
import {
  SECURE_HEYGEN_SETUP_SECRET_REF,
  SecureHeyGenSetupError,
} from "../server/ai-media-studio/provider-credentials/secure-heygen-setup-contracts";
import { SecureHeyGenSetupService } from "../server/ai-media-studio/provider-credentials/secure-heygen-setup-service";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};
type Scope = { ownerUserId: string; workspaceId: string };

const DATABASE = "ams_secure_heygen_setup_test";
const TEMP_PREFIX = "ams-secure-heygen-setup-pg-";
const PORT = "55441";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8",
)) as Manifest;
const pr28Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_forward.sql", import.meta.url,
), "utf8");
const pr29Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_forward.sql", import.meta.url,
), "utf8");

function ownedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) {
    throw new Error("secure HeyGen setup PostgreSQL test requires only its owned TEST_DATABASE_URL");
  }
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres");
  assert.equal(parsed.password, "");
  assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), PORT);
  const socket = parsed.searchParams.get("host");
  assert.ok(socket);
  const resolvedSocket = realpathSync(socket);
  const root = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(root), realpathSync(process.platform === "darwin" ? "/private/tmp" : "/tmp"));
  assert.ok(basename(root).startsWith(TEMP_PREFIX));
  assert.equal(basename(resolvedSocket), "socket");
  return value;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest = enabled ? test : test.skip;
const pool = new Pool({
  connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/disabled",
  max: 12,
  allowExitOnIdle: true,
});
after(async () => pool.end());

const rawHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function uuid(seed: string): string {
  const hex = rawHash(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function reviewedForward(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(rawHash(bytes), file.sha256, `${file.path} differs from the reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyExactChain(): Promise<void> {
  assert.equal(manifest.migrations.length, 22);
  for (const entry of manifest.migrations) {
    if (entry.pullRequest === "PR26") {
      for (const role of manifest.pr26.requiredRoles) {
        assert.equal(role.login, false);
        assert.equal(role.inherit, false);
        await pool.query(`CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    await pool.query(reviewedForward(entry.forward));
  }
  await pool.query(pr28Forward);
  await pool.query(pr29Forward);
}

function service(): SecureHeyGenSetupService {
  const database = drizzle(pool) as unknown as SecureHeyGenSetupDatabase;
  return new SecureHeyGenSetupService(new DrizzleSecureHeyGenSetupRepository(database));
}

const setupInput = (scope: Scope, idempotencyKey: string) => ({
  scope,
  actorUserId: scope.ownerUserId,
  idempotencyKey,
});

async function tenantCounts(scope: Scope): Promise<{ accounts: number; bindings: number }> {
  const [accounts, bindings] = await Promise.all([
    pool.query(`SELECT count(*)::integer AS count FROM ai_media_provider_accounts
      WHERE owner_user_id=$1 AND workspace_id=$2 AND provider_key='heygen'`, [scope.ownerUserId, scope.workspaceId]),
    pool.query(`SELECT count(*)::integer AS count FROM ai_media_static_credential_bindings
      WHERE owner_user_id=$1 AND workspace_id=$2 AND provider_key='heygen'`, [scope.ownerUserId, scope.workspaceId]),
  ]);
  return { accounts: accounts.rows[0].count, bindings: bindings.rows[0].count };
}

integrationTest("secure HeyGen setup is exact, tenant-safe and inert on PostgreSQL 16", async () => {
  assert.equal(process.env.AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY, undefined);
  assert.equal(process.env.HEYGEN_API_KEY, undefined);
  await applyExactChain();

  const primaryScope = { ownerUserId: "owner-primary", workspaceId: "workspace-primary" };
  const primaryInput = setupInput(primaryScope, "secure-setup-primary-v1");
  const created = await service().setup(primaryInput);
  assert.deepEqual(created, {
    outcome: "created",
    credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 },
  });
  assert.doesNotMatch(JSON.stringify(created), /env:\/\/|API_KEY|providerAccountId|bindingId/u);

  const replayed = await service().setup(primaryInput);
  assert.deepEqual(replayed, {
    outcome: "replayed",
    credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 },
  });
  assert.deepEqual(await tenantCounts(primaryScope), { accounts: 1, bindings: 1 });

  const primaryGraph = await pool.query(`SELECT accounts.id AS account_id,accounts.status,accounts.credential_status,
      accounts.credential_source,accounts.credential_version,accounts.secret_ref,accounts.capabilities,
      accounts.granted_scopes,bindings.id AS binding_id,bindings.expected_credential_version,
      bindings.target_credential_version,bindings.secret_ref AS binding_secret_ref,bindings.lifecycle_state,
      bindings.verification_state
    FROM ai_media_provider_accounts accounts
    JOIN ai_media_static_credential_bindings bindings
      ON bindings.owner_user_id=accounts.owner_user_id AND bindings.workspace_id=accounts.workspace_id
      AND bindings.provider_account_id=accounts.id AND bindings.provider_key=accounts.provider_key
    WHERE accounts.owner_user_id=$1 AND accounts.workspace_id=$2 AND accounts.provider_key='heygen'`,
  [primaryScope.ownerUserId, primaryScope.workspaceId]);
  assert.equal(primaryGraph.rowCount, 1);
  assert.deepEqual({
    status: primaryGraph.rows[0].status,
    credentialStatus: primaryGraph.rows[0].credential_status,
    credentialSource: primaryGraph.rows[0].credential_source,
    credentialVersion: primaryGraph.rows[0].credential_version,
    accountReference: primaryGraph.rows[0].secret_ref,
    capabilities: primaryGraph.rows[0].capabilities,
    grantedScopes: primaryGraph.rows[0].granted_scopes,
    expectedVersion: primaryGraph.rows[0].expected_credential_version,
    targetVersion: primaryGraph.rows[0].target_credential_version,
    bindingReference: primaryGraph.rows[0].binding_secret_ref,
    lifecycle: primaryGraph.rows[0].lifecycle_state,
    verification: primaryGraph.rows[0].verification_state,
  }, {
    status: "disconnected",
    credentialStatus: "unverified",
    credentialSource: "static_api_key",
    credentialVersion: 1,
    accountReference: SECURE_HEYGEN_SETUP_SECRET_REF,
    capabilities: [],
    grantedScopes: [],
    expectedVersion: 0,
    targetVersion: 1,
    bindingReference: SECURE_HEYGEN_SETUP_SECRET_REF,
    lifecycle: "pending",
    verification: "unverified",
  });
  assert.notEqual(primaryGraph.rows[0].account_id, primaryGraph.rows[0].binding_id);

  await assert.rejects(
    service().setup(setupInput(primaryScope, "secure-setup-primary-v2")),
    (error: unknown) => error instanceof SecureHeyGenSetupError && error.code === "CONFLICT",
  );
  assert.deepEqual(await tenantCounts(primaryScope), { accounts: 1, bindings: 1 });

  const concurrentScope = { ownerUserId: "owner-concurrent", workspaceId: "workspace-concurrent" };
  const concurrentInput = setupInput(concurrentScope, "secure-setup-concurrent-v1");
  const concurrent = await Promise.allSettled([service().setup(concurrentInput), service().setup(concurrentInput)]);
  const fulfilled = concurrent.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<SecureHeyGenSetupService["setup"]>>> => item.status === "fulfilled");
  const rejected = concurrent.filter((item): item is PromiseRejectedResult => item.status === "rejected");
  assert.equal(fulfilled.some((item) => item.value.outcome === "created"), true);
  assert.equal(fulfilled.length + rejected.length, 2);
  assert.ok(rejected.every((item) => item.reason instanceof SecureHeyGenSetupError
    && item.reason.code === "UNAVAILABLE"), "a serialization loser must fail closed with no database detail");
  assert.deepEqual(await tenantCounts(concurrentScope), { accounts: 1, bindings: 1 });
  assert.equal((await service().setup(concurrentInput)).outcome, "replayed");

  const isolatedScopes = [
    { ownerUserId: "owner-isolated-a", workspaceId: "workspace-isolated" },
    { ownerUserId: "owner-isolated-b", workspaceId: "workspace-isolated" },
  ];
  const isolated = [];
  for (const scope of isolatedScopes) {
    isolated.push(await service().setup(setupInput(scope, "secure-setup-shared-idempotency")));
  }
  assert.deepEqual(isolated.map((receipt) => receipt.outcome), ["created", "created"]);
  assert.deepEqual(await tenantCounts(isolatedScopes[0]!), { accounts: 1, bindings: 1 });
  assert.deepEqual(await tenantCounts(isolatedScopes[1]!), { accounts: 1, bindings: 1 });
  const isolatedIds = await pool.query(`SELECT id FROM ai_media_provider_accounts
    WHERE workspace_id='workspace-isolated' ORDER BY owner_user_id`);
  assert.equal(isolatedIds.rowCount, 2);
  assert.notEqual(isolatedIds.rows[0].id, isolatedIds.rows[1].id);

  const ambiguousScope = { ownerUserId: "owner-ambiguous", workspaceId: "workspace-ambiguous" };
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'heygen','HeyGen A','disconnected','unverified',0,'not_bound'),
      ($4,$2,$3,'heygen','HeyGen B','disconnected','unverified',0,'not_bound')`,
  [uuid("ambiguous-a"), ambiguousScope.ownerUserId, ambiguousScope.workspaceId, uuid("ambiguous-b")]);
  await assert.rejects(
    service().setup(setupInput(ambiguousScope, "secure-setup-ambiguous-v1")),
    (error: unknown) => error instanceof SecureHeyGenSetupError && error.code === "AMBIGUOUS",
  );
  assert.deepEqual(await tenantCounts(ambiguousScope), { accounts: 2, bindings: 0 });

  for (const table of [
    "ai_media_daily_plans",
    "ai_media_daily_plan_slots",
    "ai_media_render_jobs",
    "ai_media_outbox",
    "ai_media_publishing_jobs",
  ]) {
    const result = await pool.query(`SELECT count(*)::integer AS count FROM ${table}`);
    assert.equal(result.rows[0].count, 0, `${table} must remain empty`);
  }
});
