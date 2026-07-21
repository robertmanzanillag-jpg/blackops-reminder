import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after } from "node:test";
import { Pool } from "pg";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile; rollback: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
  expectedPostForward: { catalogObjectCount: number; catalogSha256: string; aclEntryCount: number; aclSha256: string };
};

const TEMP_PREFIX = "ams-pr21-pg-";
const DATABASE = "ams_pr21_test";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8")) as Manifest;
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("full-chain requires only the owned TEST_DATABASE_URL");
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres");
  assert.equal(parsed.password, "");
  assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), "55432");
  const socket = parsed.searchParams.get("host");
  assert.ok(socket);
  const resolvedSocket = realpathSync(socket);
  const resolvedRoot = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot), realpathSync(process.platform === "darwin" ? "/private/tmp" : tmpdir()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX));
  assert.equal(basename(resolvedSocket), "socket");
  return value;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest = enabled ? test : test.skip;
const pool = new Pool({
  connectionString: enabled ? requireOwnedUrl() : "postgresql://postgres@localhost/ams_pr21_disabled",
  max: 1,
  allowExitOnIdle: true,
});
after(async () => pool.end());

function migration(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(sha256(bytes), file.sha256, `${file.path} differs from the reviewed manifest`);
  return bytes.toString("utf8");
}

async function aiMediaCatalog(): Promise<Array<{ kind: string; identity: string }>> {
  const result = await pool.query<{ kind: string; identity: string }>(`
    SELECT 'relation:'||c.relkind::text AS kind,n.nspname||'.'||c.relname AS identity
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' AND c.relname LIKE 'ai_media_%') OR n.nspname='ai_media_worker_api'
    UNION ALL
    SELECT 'function',n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')'
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname LIKE 'ai_media_%') OR n.nspname='ai_media_worker_api'
    UNION ALL
    SELECT 'schema',nspname FROM pg_catalog.pg_namespace WHERE nspname='ai_media_worker_api'
    UNION ALL
    SELECT 'type:'||t.typtype::text,n.nspname||'.'||t.typname
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE (n.nspname='public' AND t.typname LIKE 'ai_media_%') OR n.nspname='ai_media_worker_api'
    UNION ALL
    SELECT 'constraint:'||constraint_row.contype::text,
      namespace_row.nspname||'.'||relation_row.relname||'.'||constraint_row.conname
    FROM pg_catalog.pg_constraint constraint_row
    JOIN pg_catalog.pg_class relation_row ON relation_row.oid=constraint_row.conrelid
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=relation_row.relnamespace
    WHERE namespace_row.nspname='public' AND relation_row.relname LIKE 'ai_media_%'
    UNION ALL
    SELECT 'trigger',namespace_row.nspname||'.'||relation_row.relname||'.'||trigger_row.tgname
    FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_class relation_row ON relation_row.oid=trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=relation_row.relnamespace
    WHERE namespace_row.nspname='public' AND relation_row.relname LIKE 'ai_media_%'
      AND NOT trigger_row.tgisinternal
    UNION ALL
    SELECT 'policy',namespace_row.nspname||'.'||relation_row.relname||'.'||policy_row.polname
    FROM pg_catalog.pg_policy policy_row
    JOIN pg_catalog.pg_class relation_row ON relation_row.oid=policy_row.polrelid
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=relation_row.relnamespace
    WHERE namespace_row.nspname='public' AND relation_row.relname LIKE 'ai_media_%'
    ORDER BY kind,identity
  `);
  return result.rows;
}

async function aiMediaAclCatalog(): Promise<Array<{ kind: string; identity: string; grantor: string; grantee: string; privilege: string; grantable: boolean }>> {
  const result = await pool.query<{ kind: string; identity: string; grantor: string; grantee: string; privilege: string; grantable: boolean }>(`
    SELECT 'schema' AS kind,namespace_row.nspname AS identity,grantor.rolname AS grantor,
      COALESCE(grantee.rolname,'PUBLIC') AS grantee,acl.privilege_type AS privilege,acl.is_grantable AS grantable
    FROM pg_catalog.pg_namespace namespace_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace_row.nspacl,
      pg_catalog.acldefault('n',namespace_row.nspowner))) acl
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl.grantor
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    WHERE namespace_row.nspname IN ('public','ai_media_worker_api')
    UNION ALL
    SELECT 'relation',namespace_row.nspname||'.'||relation_row.relname,grantor.rolname,
      COALESCE(grantee.rolname,'PUBLIC'),acl.privilege_type,acl.is_grantable
    FROM pg_catalog.pg_class relation_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=relation_row.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation_row.relacl,
      pg_catalog.acldefault(CASE WHEN relation_row.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,
        relation_row.relowner))) acl
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl.grantor
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    WHERE (namespace_row.nspname='public' AND relation_row.relname LIKE 'ai_media_%')
      OR namespace_row.nspname='ai_media_worker_api'
    UNION ALL
    SELECT 'function',namespace_row.nspname||'.'||function_row.proname||'('||
      pg_catalog.pg_get_function_identity_arguments(function_row.oid)||')',grantor.rolname,
      COALESCE(grantee.rolname,'PUBLIC'),acl.privilege_type,acl.is_grantable
    FROM pg_catalog.pg_proc function_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=function_row.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(function_row.proacl,
      pg_catalog.acldefault('f',function_row.proowner))) acl
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl.grantor
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    WHERE (namespace_row.nspname='public' AND function_row.proname LIKE 'ai_media_%')
      OR namespace_row.nspname='ai_media_worker_api'
    ORDER BY kind,identity,grantor,grantee,privilege,grantable
  `);
  return result.rows;
}

integrationTest("PR1 alone rolls back to zero ai_media objects while retaining pgcrypto", async () => {
  assert.deepEqual(await aiMediaCatalog(), []);
  const pr1 = manifest.migrations[0];
  assert.equal(pr1?.pullRequest, "PR1");
  await pool.query(migration(pr1!.forward));
  assert.ok((await aiMediaCatalog()).length > 0);
  await pool.query(migration(pr1!.rollback));
  assert.deepEqual(await aiMediaCatalog(), []);

  const pgcrypto = await pool.query<{ extension_exists: boolean; digest_is_member: boolean }>(`
    SELECT true AS extension_exists,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend dependency
        WHERE dependency.classid='pg_catalog.pg_proc'::regclass
          AND dependency.objid=pg_catalog.to_regprocedure('public.digest(bytea,text)')
          AND dependency.refobjid=extension_row.oid AND dependency.deptype='e'
      ) AS digest_is_member
    FROM pg_catalog.pg_extension extension_row WHERE extension_row.extname='pgcrypto'
  `);
  assert.deepEqual(pgcrypto.rows, [{ extension_exists: true, digest_is_member: true }]);
});

integrationTest("empty database applies the exact PR1 through PR27 forward chain with least-privilege ACL gates", async () => {
  assert.deepEqual(await aiMediaCatalog(), []);
  assert.equal(manifest.migrations.length, 22);

  for (const entry of manifest.migrations) {
    if (entry.pullRequest === "PR26") {
      for (const role of manifest.pr26.requiredRoles) {
        assert.equal(role.login, false);
        assert.equal(role.inherit, false);
        await pool.query(`CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    await pool.query(migration(entry.forward));
  }

  const roles = await pool.query<{
    rolname: string; rolcanlogin: boolean; rolinherit: boolean; rolsuper: boolean; rolcreaterole: boolean;
    rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean;
  }>(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
      FROM pg_catalog.pg_roles WHERE rolname=ANY($1::name[]) ORDER BY rolname`,
    [manifest.pr26.requiredRoles.map((role) => role.name)]);
  assert.equal(roles.rowCount, 3);
  for (const role of roles.rows) assert.deepEqual({
    login: role.rolcanlogin, inherit: role.rolinherit, superuser: role.rolsuper,
    createRole: role.rolcreaterole, createDb: role.rolcreatedb,
    replication: role.rolreplication, bypassRls: role.rolbypassrls,
  }, {
    login: false, inherit: false, superuser: false, createRole: false,
    createDb: false, replication: false, bypassRls: false,
  });

  const crossMembership = await pool.query<{ membership_count: string }>(`
    SELECT count(*)::text AS membership_count FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE granted.rolname=ANY($1::name[]) AND member.rolname=ANY($1::name[])
  `, [manifest.pr26.requiredRoles.map((role) => role.name)]);
  assert.equal(crossMembership.rows[0]?.membership_count, "0");

  const publicCreate = await pool.query<{ allowed: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace namespace_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace_row.nspacl,
        pg_catalog.acldefault('n',namespace_row.nspowner))) acl
      WHERE namespace_row.nspname='public' AND acl.grantee=0 AND acl.privilege_type='CREATE'
    ) AS allowed
  `);
  assert.equal(publicCreate.rows[0]?.allowed, false);
  const workerSchema = await pool.query<{ owner: string; public_usage: boolean }>(`
    SELECT owner_role.rolname AS owner,EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(schema_row.nspacl,
        pg_catalog.acldefault('n',schema_row.nspowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='USAGE'
    ) AS public_usage
    FROM pg_catalog.pg_namespace schema_row
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=schema_row.nspowner
    WHERE schema_row.nspname='ai_media_worker_api'
  `);
  assert.deepEqual(workerSchema.rows, [{ owner: "ai_media_admitted_fn_owner", public_usage: false }]);

  const executorAcl = await pool.query<{ routine: string; submit: boolean; reconcile: boolean; public_execute: boolean }>(`
    SELECT p.proname AS routine,
      pg_catalog.has_function_privilege('ai_media_admitted_submit_executor',p.oid,'EXECUTE') AS submit,
      pg_catalog.has_function_privilege('ai_media_admitted_reconcile_executor',p.oid,'EXECUTE') AS reconcile,
      EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
      ) AS public_execute
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='ai_media_worker_api' AND p.prosecdef
    ORDER BY p.proname
  `);
  assert.ok(executorAcl.rowCount && executorAcl.rowCount >= 10);
  assert.ok(executorAcl.rows.every((row) => !row.public_execute));
  assert.ok(executorAcl.rows.some((row) => row.submit && !row.reconcile));
  assert.ok(executorAcl.rows.some((row) => row.reconcile && !row.submit));

  const directExecutorTableAcl = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM pg_catalog.pg_class relation_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=relation_row.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation_row.relacl,
      pg_catalog.acldefault(CASE WHEN relation_row.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,
        relation_row.relowner))) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    WHERE namespace_row.nspname='public' AND relation_row.relname LIKE 'ai_media_%'
      AND grantee.rolname IN ('ai_media_admitted_submit_executor','ai_media_admitted_reconcile_executor')
  `);
  assert.equal(directExecutorTableAcl.rows[0]?.count, "0");

  const securityDefiners = await pool.query<{ routine: string; owner: string; safe_search_path: boolean; row_security_on: boolean }>(`
    SELECT function_row.proname AS routine,owner_role.rolname AS owner,
      COALESCE('search_path=pg_catalog'=ANY(function_row.proconfig),false) AS safe_search_path,
      COALESCE('row_security=on'=ANY(function_row.proconfig),false) AS row_security_on
    FROM pg_catalog.pg_proc function_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid=function_row.pronamespace
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=function_row.proowner
    WHERE namespace_row.nspname='ai_media_worker_api' AND function_row.prosecdef
  `);
  assert.ok(securityDefiners.rowCount && securityDefiners.rowCount >= 10);
  assert.ok(securityDefiners.rows.every((row) => row.owner === "ai_media_admitted_fn_owner"));
  assert.ok(securityDefiners.rows.every((row) => row.safe_search_path));
  assert.ok(securityDefiners.rows.every((row) => row.row_security_on || row.routine === "sha256_text_v1"));

  const catalog = await aiMediaCatalog();
  const aclCatalog = await aiMediaAclCatalog();
  assert.deepEqual({
    catalogObjectCount: catalog.length,
    catalogSha256: sha256(Buffer.from(JSON.stringify(catalog))),
    aclEntryCount: aclCatalog.length,
    aclSha256: sha256(Buffer.from(JSON.stringify(aclCatalog))),
  }, manifest.expectedPostForward, "the complete catalog or ACL inventory drifted");
  for (const required of [
    "public.ai_media_provider_accounts", "public.ai_media_oauth_sessions",
    "public.ai_media_daily_plans", "public.ai_media_launch_intents",
    "public.ai_media_provider_submission_attempts", "public.ai_media_provider_terminal_checks",
    "ai_media_worker_api",
  ]) assert.ok(catalog.some((entry) => entry.identity === required), `missing ${required}`);
});

integrationTest("reverse rehearsal stops before PR26 when PR27 retains terminal evidence guards", async () => {
  assert.equal(manifest.migrations.length, 22);
  const pr27 = manifest.migrations.at(-1);
  const pr26 = manifest.migrations.at(-2);
  assert.equal(pr27?.pullRequest, "PR27");
  assert.equal(pr26?.pullRequest, "PR26");
  await pool.query(migration(pr27!.rollback));

  const retainedCatalog = await aiMediaCatalog();
  for (const retained of [
    "public.ai_media_provider_terminal_checks",
    "ai_media_worker_api.guard_terminal_check_v1()",
    "ai_media_worker_api.guard_terminal_event_v1()",
    "ai_media_worker_api.guard_terminal_render_projection_v1()",
  ]) {
    assert.ok(retainedCatalog.some((entry) => entry.identity === retained), `rollback unexpectedly removed ${retained}`);
  }

  await assert.rejects(
    pool.query(migration(pr26!.rollback)),
    /PR26 rollback requires zero capability\/capacity evidence and no retained PR27 terminal guards/u,
    "PR26 must fail before mutation instead of deleting PR27's retained terminal evidence",
  );
  assert.deepEqual(await aiMediaCatalog(), retainedCatalog, "failed PR26 rollback must leave the retained catalog unchanged");
});
