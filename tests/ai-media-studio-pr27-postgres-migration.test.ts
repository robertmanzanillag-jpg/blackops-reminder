import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after, before } from "node:test";
import { Pool } from "pg";

const TEMP_PREFIX="ams-pr21-pg-",DATABASE="ams_pr21_test";
function ownedUrl():string{
  const value=process.env.TEST_DATABASE_URL?.trim();
  if(!value||process.env.DATABASE_URL?.trim())throw new Error("PR27 migration test requires only owned TEST_DATABASE_URL");
  const parsed=new URL(value);assert.equal(parsed.protocol,"postgresql:");assert.equal(parsed.hostname,"localhost");
  assert.equal(parsed.username,"postgres");assert.equal(parsed.password,"");assert.equal(parsed.pathname,`/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"),"55432");const socket=parsed.searchParams.get("host");assert.ok(socket);
  const resolvedSocket=realpathSync(socket),resolvedRoot=realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot),realpathSync(process.platform==="darwin"?"/private/tmp":tmpdir()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX));assert.equal(basename(resolvedSocket),"socket");return value;
}
const enabled=Boolean(process.env.TEST_DATABASE_URL?.trim()),integrationTest=enabled?test:test.skip;
const pool=new Pool({connectionString:enabled?ownedUrl():"postgresql://postgres@localhost/pr27_disabled",allowExitOnIdle:true});
const fixture=readFileSync(new URL("./fixtures/ai-media-studio-pr21-prerequisite.sql",import.meta.url),"utf8");
const migration=(name:string)=>readFileSync(new URL(`../migrations/ai-media-studio/${name}`,import.meta.url),"utf8");
const forwards=["20260720_pr4_assets_forward.sql","20260721_pr19_daily_admission_forward.sql","20260721_pr20_launch_authorities_forward.sql",
  "20260721_pr22_launch_intents_forward.sql","20260721_pr23_admission_held_handoff_forward.sql",
  "20260721_pr24_held_activation_forward.sql","20260721_pr25_admitted_worker_forward.sql",
  "20260721_pr26_db_capability_forward.sql","20260721_pr27_heygen_terminal_forward.sql"].map(migration);
const rollback=migration("20260721_pr27_heygen_terminal_rollback.sql");

before(async()=>{if(!enabled)return;await pool.query(`DO $roles$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_media_admitted_fn_owner') THEN
    CREATE ROLE ai_media_admitted_fn_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ai_media_admitted_submit_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ai_media_admitted_reconcile_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $roles$`);await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  await pool.query(fixture);await pool.query(`CREATE TABLE public.ai_media_assets(
    id uuid PRIMARY KEY,owner_user_id text NOT NULL,workspace_id text NOT NULL,kind text NOT NULL,
    checksum text,deleted_at timestamptz)`);for(const forward of forwards)await pool.query(forward);
});
after(async()=>{await pool.end();});

integrationTest("PR27 DDL installs on exact PR26 and exposes only three reconciler entrypoints",async()=>{
  const surfaces=await pool.query<{checks:boolean;events:boolean;record:boolean;claim:boolean;release:boolean}>(`SELECT
    to_regclass('public.ai_media_provider_terminal_checks') IS NOT NULL checks,
    to_regclass('public.ai_media_provider_terminal_events') IS NOT NULL events,
    to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NOT NULL record,
    to_regprocedure('ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer)') IS NOT NULL claim,
    to_regprocedure('ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint)') IS NOT NULL release`);
  assert.deepEqual(surfaces.rows,[{checks:true,events:true,record:true,claim:true,release:true}]);
  for(const table of ["ai_media_provider_terminal_checks","ai_media_provider_terminal_events","ai_media_asset_ingest_jobs"]){
    const acl=await pool.query<{submit:boolean;reconcile:boolean}>(`SELECT
      has_table_privilege('ai_media_admitted_submit_executor',$1,'SELECT,INSERT,UPDATE,DELETE') submit,
      has_table_privilege('ai_media_admitted_reconcile_executor',$1,'SELECT,INSERT,UPDATE,DELETE') reconcile`,[`public.${table}`]);
    assert.deepEqual(acl.rows[0],{submit:false,reconcile:false});
  }
  const unsafe=await pool.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='ai_media_worker_api' AND p.proname LIKE '%terminal%'
      AND p.prosecdef AND NOT (p.proconfig @> ARRAY['search_path=pg_catalog']::text[])`);
  assert.equal(unsafe.rowCount,0);
});

integrationTest("PR27 exact tenant render FK rejects cross-workspace ingest",async()=>{
  const constraint=await pool.query<{validated:boolean}>(`SELECT convalidated validated FROM pg_constraint
    WHERE conname='ai_media_asset_ingest_jobs_exact_render_fk'`);
  assert.deepEqual(constraint.rows,[{validated:true}]);
});

integrationTest("PR27 rollback removes mutation entrypoints but retains empty evidence schema",async()=>{
  await pool.query(rollback);
  const retained=await pool.query<{checks:boolean;events:boolean;record:boolean;ingest_fk:boolean}>(`SELECT
    to_regclass('public.ai_media_provider_terminal_checks') IS NOT NULL checks,
    to_regclass('public.ai_media_provider_terminal_events') IS NOT NULL events,
    to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NOT NULL record,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ai_media_asset_ingest_jobs_exact_render_fk') ingest_fk`);
  assert.deepEqual(retained.rows,[{checks:true,events:true,record:false,ingest_fk:true}]);
});
