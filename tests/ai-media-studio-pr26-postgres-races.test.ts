import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after, before } from "node:test";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  DrizzleDailyAdmissionRepository,
  type DailyAdmissionDatabase,
  type DailyAdmissionTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-daily-admission-repository";
import {
  DrizzleHeldWorkActivationRepository,
  type HeldWorkActivationDatabase,
  type HeldWorkActivationTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-held-work-activation-repository";
import type { TrustedActivationPrincipal } from "../server/ai-media-studio/planning/held-work-activation-domain";

const TEMP_PREFIX="ams-pr21-pg-",DATABASE="ams_pr21_test",OWNER="owner-pr26",WORKSPACE="personal";
const SUBMIT_LOGIN="ams_pr26_submit_login",RECONCILE_LOGIN="ams_pr26_reconcile_login";
const SUBMIT_ROLE="ai_media_admitted_submit_executor",RECONCILE_ROLE="ai_media_admitted_reconcile_executor";
const EXACT_RUN_LOGIN="ams_pr32_exact_run_login",EXACT_RUN_ROLE="ai_media_one_video_run_executor";
const SCRIPT_CONTENT="Approved PR26 PostgreSQL capability race script.";
const SCRIPT_CHECKSUM=createHash("sha256").update(SCRIPT_CONTENT).digest("hex");
const ids={account:"26000000-0000-4000-8000-000000000001",influencer:"26000000-0000-4000-8000-000000000002",
  avatar:"26000000-0000-4000-8000-000000000003",voice:"26000000-0000-4000-8000-000000000004",
  script:"26000000-0000-4000-8000-000000000005",variant:"26000000-0000-4000-8000-000000000006",
  governance:"26000000-0000-4000-8000-000000000007",plan:"26000000-0000-4000-8000-000000000008",
  slot:"26000000-0000-4000-8000-000000000009",bucket:"26000000-0000-4000-8000-00000000000a",
  policy:"26000000-0000-4000-8000-00000000000b",kill:"26000000-0000-4000-8000-00000000000c",
  content:"26000000-0000-4000-8000-00000000000d",human:"26000000-0000-4000-8000-00000000000e",
  sandbox:"26000000-0000-4000-8000-00000000000f",quote:"26000000-0000-4000-8000-000000000010",
  snapshot:"26000000-0000-4000-8000-000000000011",source:"26000000-0000-4000-8000-000000000012",
  intent:"26000000-0000-4000-8000-000000000013",submitCapability:"26000000-0000-4000-8000-000000000014",
  reconcileCapability:"26000000-0000-4000-8000-000000000015",
  exactRunCapability:"26000000-0000-4000-8000-000000000016",
  exactUncertainCapability:"26000000-0000-4000-8000-000000000017",
  exactSubmitCapability:"26000000-0000-4000-8000-000000000018",
  exactReconcileActionCapability:"26000000-0000-4000-8000-00000000001a",
  exactTerminalActionCapability:"26000000-0000-4000-8000-00000000001b",
  exactReconcileWorkerCapability:"26000000-0000-4000-8000-00000000001c"} as const;
const digest=(character:string)=>`sha256:${character.repeat(64)}` as const;
const dialect=new PgDialect();

function requireOwnedUrl():string{
  const value=process.env.TEST_DATABASE_URL?.trim();
  if(!value||process.env.DATABASE_URL?.trim())throw new Error("PR26 races require only the owned TEST_DATABASE_URL");
  const parsed=new URL(value);assert.equal(parsed.protocol,"postgresql:");assert.equal(parsed.hostname,"localhost");
  assert.equal(parsed.username,"postgres");assert.equal(parsed.password,"");assert.equal(parsed.pathname,`/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"),"55432");
  const socket=parsed.searchParams.get("host");assert.ok(socket);
  const resolvedSocket=realpathSync(socket),resolvedRoot=realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot),realpathSync(process.platform==="darwin"?"/private/tmp":tmpdir()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX));assert.equal(basename(resolvedSocket),"socket");
  return value;
}

const enabled=Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest=enabled?test:test.skip;
const databaseUrl=enabled?requireOwnedUrl():"postgresql://postgres@localhost/ams_pr26_disabled";
const adminPool=new Pool({connectionString:databaseUrl,max:20,allowExitOnIdle:true});
const prerequisite=readFileSync(new URL("./fixtures/ai-media-studio-pr21-prerequisite.sql",import.meta.url),"utf8");
const migration=(name:string)=>readFileSync(new URL(`../migrations/ai-media-studio/${name}`,import.meta.url),"utf8");
const forwards=["20260721_pr19_daily_admission_forward.sql","20260721_pr20_launch_authorities_forward.sql",
  "20260721_pr22_launch_intents_forward.sql","20260721_pr23_admission_held_handoff_forward.sql",
  "20260721_pr24_held_activation_forward.sql","20260721_pr25_admitted_worker_forward.sql",
  "20260721_pr26_db_capability_forward.sql"].map(migration);
const pr26Rollback=migration("20260721_pr26_db_capability_rollback.sql");
const pr4Forward=migration("20260720_pr4_assets_forward.sql");
const pr27Forward=migration("20260721_pr27_heygen_terminal_forward.sql");
const pr32Forward=readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr32_exact_one_video_run_fence_forward.sql",import.meta.url,
),"utf8");
const pr32Rollback=readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr32_exact_one_video_run_fence_rollback.sql",import.meta.url,
),"utf8");
const pr33Forward=readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr33_exact_one_video_submit_forward.sql",import.meta.url,
),"utf8");
const pr33Rollback=readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr33_exact_one_video_submit_rollback.sql",import.meta.url,
),"utf8");
const pr34Forward=readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr34_exact_one_video_reconcile_terminal_forward.sql",import.meta.url,
),"utf8");
const pr34Rollback=readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr34_exact_one_video_reconcile_terminal_rollback.sql",import.meta.url,
),"utf8");

class RoleSession{
  readonly pool:Pool;private client?:PoolClient;pid=0;
  constructor(readonly login:string,readonly role:string){const parsed=new URL(databaseUrl);parsed.username=login;
    this.pool=new Pool({connectionString:parsed.toString(),max:1,allowExitOnIdle:true});}
  async connect():Promise<void>{this.client=await this.pool.connect();
    await this.client.query(`SET ROLE ${this.role}`);const result=await this.client.query<{pid:number}>("SELECT pg_backend_pid() pid");
    this.pid=result.rows[0].pid;}
  async query<T extends Record<string,unknown>=Record<string,unknown>>(sql:string,params:unknown[]=[]):Promise<QueryResult<T>>{
    if(!this.client)throw new Error("role session is not connected");return this.client.query<T>(sql,params);}
  async close():Promise<void>{this.client?.release();await this.pool.end();}
}

function postgresRepositoryDb():DailyAdmissionTransactionalDatabase&HeldWorkActivationTransactionalDatabase{return{
  async execute(query:SQL){const rendered=dialect.sqlToQuery(query);return adminPool.query(rendered.sql,rendered.params);},
  async transaction<T>(callback:(tx:DailyAdmissionDatabase&HeldWorkActivationDatabase)=>Promise<T>):Promise<T>{
    const client=await adminPool.connect();try{await client.query("BEGIN");const tx={execute:async(query:SQL)=>{
      const rendered=dialect.sqlToQuery(query);return client.query(rendered.sql,rendered.params);}};
      const result=await callback(tx);await client.query("SET CONSTRAINTS ALL IMMEDIATE");await client.query("COMMIT");return result;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
};}

async function installSchema(provisionCapabilities=true):Promise<void>{
  await adminPool.query(`DO $roles$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_media_admitted_fn_owner') THEN
      CREATE ROLE ai_media_admitted_fn_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE ai_media_admitted_submit_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE ai_media_admitted_reconcile_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE ${SUBMIT_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE ${RECONCILE_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
  END $roles$`);
  await adminPool.query(`GRANT ${SUBMIT_ROLE} TO ${SUBMIT_LOGIN};GRANT ${RECONCILE_ROLE} TO ${RECONCILE_LOGIN}`);
  await adminPool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  await adminPool.query(prerequisite);for(const forward of forwards)await adminPool.query(forward);
  await seedAuthorityGraph();
  if(provisionCapabilities)await adminPool.query(`INSERT INTO public.ai_media_admitted_worker_capabilities
    (id,database_principal,owner_user_id,workspace_id,lane,accounting_time_zone,worker_id,allowed_operations,
     max_lease_ms,max_batch_size,valid_from,expires_at,evidence_digest)
    VALUES ($1,$2,$3,$4,'submit','UTC','submit-worker',ARRAY['claim','authorize','expire_authorized',
      'record_submit_confirmed','record_submit_ambiguous'],300000,10,clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '1 hour',$5),
     ($6,$7,$3,$4,'reconcile','UTC','reconcile-worker',ARRAY['claim_reconciliation',
      'release_reconciliation_unknown','record_reconciled_confirmed','finalize_reconciled_no_submit',
      'release_terminal_capacity'],300000,10,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$8)`,
    [ids.submitCapability,SUBMIT_LOGIN,OWNER,WORKSPACE,digest("1"),ids.reconcileCapability,RECONCILE_LOGIN,digest("2")]);
}

async function resetOwnedSchema(provisionCapabilities=true):Promise<void>{
  await adminPool.query("DROP SCHEMA IF EXISTS ai_media_worker_api CASCADE");
  await adminPool.query("DROP EXTENSION IF EXISTS pgcrypto CASCADE");
  await adminPool.query("DROP SCHEMA public CASCADE;CREATE SCHEMA public AUTHORIZATION postgres");
  await installSchema(provisionCapabilities);
}

async function seedAuthorityGraph():Promise<void>{await adminPool.query(`
  INSERT INTO ai_media_provider_accounts(id,owner_user_id,workspace_id,provider_key,credential_version,status,credential_status)
    VALUES('${ids.account}','${OWNER}','${WORKSPACE}','heygen',1,'active','active');
  INSERT INTO ai_media_provider_resources(id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,status)
    VALUES('${ids.avatar}','${OWNER}','${WORKSPACE}','${ids.account}','heygen','avatar','avatar-pr26','active'),
      ('${ids.voice}','${OWNER}','${WORKSPACE}','${ids.account}','heygen','voice','voice-pr26','active');
  INSERT INTO ai_media_influencers(id,owner_user_id,workspace_id,status) VALUES('${ids.influencer}','${OWNER}','${WORKSPACE}','active');
  INSERT INTO ai_media_source_items(id,owner_user_id,workspace_id,source_type,external_id,content_hash,status,rights_status,moderation_status)
    VALUES('${ids.source}','${OWNER}','${WORKSPACE}','rss','source-pr26','${digest("9")}','ready','owned','approved');
  INSERT INTO ai_media_scripts(id,owner_user_id,workspace_id,influencer_id,source_type,source_item_id,title,language,status,current_variant_id)
    VALUES('${ids.script}','${OWNER}','${WORKSPACE}','${ids.influencer}','rss','${ids.source}','Launch','en','approved','${ids.variant}');
  INSERT INTO ai_media_script_variants(id,owner_user_id,workspace_id,script_id,content,checksum,status)
    VALUES('${ids.variant}','${OWNER}','${WORKSPACE}','${ids.script}','${SCRIPT_CONTENT}','${SCRIPT_CHECKSUM}','approved');
  INSERT INTO ai_media_governance_profiles(id,owner_user_id,workspace_id,influencer_id,avatar_resource_id,voice_resource_id,
    version,evidence_digest,state,valid_from,expires_at,allowed_uses,territories)
    VALUES('${ids.governance}','${OWNER}','${WORKSPACE}','${ids.influencer}','${ids.avatar}','${ids.voice}',1,'${digest("2")}',
      'active',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','["marketing"]','["WORLDWIDE"]');
  INSERT INTO ai_media_daily_plans(id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,
    provider_credential_version,source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,
    planned_slot_count,idempotency_key,input_digest,plan_digest,created_at,updated_at)
    VALUES('${ids.plan}','${OWNER}','${WORKSPACE}','plan_${"3".repeat(24)}','${ids.account}','heygen',1,'roster-pr26',
      '${digest("3")}',(clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC','planned',1,'plan-pr26','${digest("4")}',
      '${digest("5")}',clock_timestamp(),clock_timestamp());
  INSERT INTO ai_media_daily_plan_slots(id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,
    provider_key,provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
    script_variant_id,video_number,status,slot_digest,state_version)
    VALUES('${ids.slot}','${OWNER}','${WORKSPACE}','slot_${"4".repeat(24)}','${ids.plan}','${ids.account}','heygen',1,
      'member-pr26','${ids.influencer}','${ids.avatar}','${ids.voice}','${ids.variant}',1,'planned','${digest("6")}',1);
  INSERT INTO ai_media_admission_policy_revisions(id,owner_user_id,workspace_id,revision,daily_budget_micro_usd,
    total_concurrency,provider_concurrency,tenant_concurrency,allowed_languages,allowed_countries,allowed_time_zones,
    state,valid_from,expires_at,policy_digest,evidence_digest,input_digest,actor_user_id,idempotency_key)
    VALUES('${ids.policy}','${OWNER}','${WORKSPACE}',1,5000000,100,100,100,'["en"]','["US"]','["UTC"]','active',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','${digest("7")}','${digest("8")}',
      '${digest("9")}','actor-pr26','policy-pr26');
  INSERT INTO ai_media_kill_switch_revisions(id,owner_user_id,workspace_id,revision,active,valid_from,expires_at,reason,
    evidence_digest,input_digest,actor_user_id,idempotency_key)
    VALUES('${ids.kill}','${OWNER}','${WORKSPACE}',1,false,clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '1 hour','enabled','${digest("a")}','${digest("b")}','actor-pr26','kill-pr26');
  INSERT INTO ai_media_budget_buckets(id,owner_user_id,workspace_id,budget_date,accounting_time_zone,currency,
    limit_micro_usd,reserved_micro_usd,committed_micro_usd,policy_digest,policy_version,state_version,created_at,updated_at)
    VALUES('${ids.bucket}','${OWNER}','${WORKSPACE}',(clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC','USD',5000000,
      0,0,'${digest("7")}',1,1,clock_timestamp(),clock_timestamp());
  INSERT INTO ai_media_launch_intents(id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,
    source_roster_digest,source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,
    source_item_id,source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
    governance_territory,content_country,launch_subject_digest,launch_intent_digest,actor_user_id,input_digest,idempotency_key)
    VALUES('${ids.intent}','${OWNER}','${WORKSPACE}','${ids.plan}','${ids.slot}',1,'${ids.account}','heygen',1,
      '${digest("5")}','${digest("6")}','roster-pr26','${digest("3")}','member-pr26','${ids.script}','${ids.variant}',
      '${SCRIPT_CHECKSUM}','rss','${ids.source}','${digest("9")}','${ids.governance}','${digest("2")}','marketing',
      'WORLDWIDE','US','${digest("0")}','${digest("9")}','actor-pr26','${digest("8")}','intent-pr26');
`);
  const evidence=[[ids.content,"content_approval","approved",null,null,null,null,digest("c")],
    [ids.human,"human_launch_approval","approved",null,null,null,null,digest("d")],
    [ids.sandbox,"sandbox_proof","passed",null,null,"sandbox-proof-pr26",digest("6"),digest("e")],
    [ids.quote,"maximum_quote","quoted","1250000","USD","quote-proof-pr26",digest("7"),digest("f")]] as const;
  for(const [id,kind,decision,amount,currency,attestation,sourceDigest,evidenceDigest] of evidence)await adminPool.query(`
    INSERT INTO ai_media_launch_evidence(id,owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,
      provider_key,provider_credential_version,slot_attempt,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,
      revision,valid_from,expires_at,actor_user_id,source_kind,source_attestation_id,source_evidence_digest,
      evidence_digest,input_digest,idempotency_key)
    VALUES($1,$2,$3,$4,$5,'heygen',1,1,$6,$7,$8,$9,'marketing','WORLDWIDE','US',$10,$11,$12,$13,$14,$15,$16,1,
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','actor-pr26','pr26-test',$17,$18,$19,$20,$21)`,
    [id,OWNER,WORKSPACE,ids.slot,ids.account,ids.variant,SCRIPT_CHECKSUM,ids.governance,digest("2"),digest("0"),ids.intent,
      digest("9"),kind,decision,amount,currency,attestation,sourceDigest,evidenceDigest,digest("1"),`${kind}-pr26`]);
  await adminPool.query(`INSERT INTO ai_media_launch_authority_snapshots(id,owner_user_id,workspace_id,daily_plan_id,
    plan_digest,daily_plan_slot_id,slot_digest,provider_account_id,provider_key,provider_credential_version,slot_attempt,
    script_variant_id,script_variant_checksum,governance_profile_id,governance_evidence_digest,governance_use,
    governance_territory,content_country,launch_subject_digest,content_approval_evidence_id,launch_intent_id,
    launch_intent_digest,content_approval_evidence_digest,human_launch_approval_evidence_id,
    human_launch_approval_evidence_digest,sandbox_evidence_id,sandbox_evidence_digest,maximum_quote_evidence_id,
    maximum_quote_evidence_digest,policy_revision_id,policy_revision,policy_digest,kill_switch_revision_id,
    kill_switch_revision,kill_switch_evidence_digest,maximum_quote_micro_usd,currency,valid_from,expires_at,
    admission_digest,authority_digest,input_digest,idempotency_key)
    VALUES('${ids.snapshot}','${OWNER}','${WORKSPACE}','${ids.plan}','${digest("5")}','${ids.slot}','${digest("6")}',
      '${ids.account}','heygen',1,1,'${ids.variant}','${SCRIPT_CHECKSUM}','${ids.governance}','${digest("2")}',
      'marketing','WORLDWIDE','US','${digest("0")}','${ids.content}','${ids.intent}','${digest("9")}',
      '${digest("c")}','${ids.human}','${digest("d")}','${ids.sandbox}','${digest("e")}','${ids.quote}',
      '${digest("f")}','${ids.policy}',1,'${digest("7")}','${ids.kill}',1,'${digest("a")}',1250000,'USD',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes','${digest("3")}',
      '${digest("4")}','${digest("5")}','snapshot-pr26')`);
}

async function createActivatedWork():Promise<{reservationId:string;renderJobId:string}>{
  const db=postgresRepositoryDb(),admissionRepository=new DrizzleDailyAdmissionRepository(db,{accountingTimeZone:"UTC"});
  const unsigned={scope:{ownerUserId:OWNER,workspaceId:WORKSPACE},planId:ids.plan,slotId:ids.slot,
    budgetBucketId:ids.bucket,authoritySnapshotId:ids.snapshot,authorityDigest:digest("4"),expectedSlotStateVersion:1,
    expectedBucketStateVersion:1,reservationExpiresAt:new Date(Date.now()+5*60_000).toISOString(),idempotencyKey:"admit-pr26-race"};
  const admission=await admissionRepository.reserveAndAdmit({...unsigned,inputDigest:admissionRepository.inputDigest(unsigned)});
  const activationRepository=new DrizzleHeldWorkActivationRepository(db,{accountingTimeZone:"UTC"});
  const activationUnsigned={scope:unsigned.scope,budgetReservationId:admission.reservation.id,
    workHandoffDigest:admission.reservation.workHandoffDigest,requestedBy:"operator-pr26",idempotencyKey:"activate-pr26-race"};
  await activationRepository.activate({...activationUnsigned,inputDigest:activationRepository.inputDigest(activationUnsigned),
    principal:{capability:"activate-held-work",actorUserId:activationUnsigned.requestedBy} as unknown as TrustedActivationPrincipal});
  return{reservationId:admission.reservation.id,renderJobId:admission.reservation.renderJobId};
}

async function waitForBlocked(pid:number):Promise<void>{
  const deadline=Date.now()+10_000;while(Date.now()<deadline){const result=await adminPool.query<{blocked:boolean}>(
    "SELECT cardinality(pg_blocking_pids($1))>0 blocked",[pid]);if(result.rows[0].blocked)return;
    await new Promise<void>(resolve=>setImmediate(resolve));}
  throw new Error(`backend ${pid} never reached a database lock barrier`);
}

async function waitForExpiredAttempt(attemptId:string,column="lease_expires_at"):Promise<void>{
  assert.ok(["lease_expires_at","reconciliation_lease_expires_at"].includes(column));
  const deadline=Date.now()+10_000;while(Date.now()<deadline){const result=await adminPool.query<{expired:boolean}>(
    `SELECT ${column}<=clock_timestamp() expired FROM ai_media_provider_submission_attempts WHERE id=$1`,[attemptId]);
    if(result.rows[0]?.expired)return;await new Promise<void>(resolve=>setImmediate(resolve));}
  throw new Error(`database lease ${column} did not expire`);
}

async function waitForExpiredExactRun(executionId:string):Promise<void>{
  const deadline=Date.now()+10_000;while(Date.now()<deadline){const result=await adminPool.query<{expired:boolean}>(
    `SELECT lease_expires_at<=clock_timestamp() expired
     FROM ai_media_exact_one_video_run_fences WHERE id=$1`,[executionId]);
    if(result.rows[0]?.expired)return;await new Promise<void>(resolve=>setImmediate(resolve));}
  throw new Error("exact one-video run lease did not expire");
}

before(async()=>{if(enabled)await installSchema();});
after(async()=>{await adminPool.end();});

integrationTest("PR26 roles, ACLs, and SECURITY DEFINER search paths are least privilege",async()=>{
  const roles=await adminPool.query<{rolname:string;rolcanlogin:boolean;rolinherit:boolean;rolsuper:boolean;rolbypassrls:boolean}>(`
    SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls FROM pg_roles
    WHERE rolname IN ('ai_media_admitted_fn_owner','${SUBMIT_ROLE}','${RECONCILE_ROLE}') ORDER BY rolname`);
  assert.equal(roles.rowCount,3);for(const role of roles.rows)assert.deepEqual(
    {login:role.rolcanlogin,inherit:role.rolinherit,super:role.rolsuper,bypass:role.rolbypassrls},
    {login:false,inherit:false,super:false,bypass:false});
  const publicUsage=await adminPool.query<{allowed:boolean}>(
    "SELECT has_schema_privilege('public','ai_media_worker_api','USAGE') allowed");
  assert.equal(publicUsage.rows[0].allowed,false);
  const unsafeFunctions=await adminPool.query<{name:string}>(`SELECT p.proname name FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ai_media_worker_api' AND p.prosecdef
      AND NOT (p.proconfig @> ARRAY['search_path=pg_catalog']::text[])`);
  assert.deepEqual(unsafeFunctions.rows,[]);
  for(const [login,role] of [[SUBMIT_LOGIN,SUBMIT_ROLE],[RECONCILE_LOGIN,RECONCILE_ROLE]] as const){
    const session=new RoleSession(login,role);await session.connect();try{
      const direct=await session.query<{allowed:boolean}>("SELECT has_table_privilege(current_user,'public.ai_media_provider_submission_attempts','SELECT,INSERT,UPDATE,DELETE') allowed");
      assert.equal(direct.rows[0].allowed,false);
    }finally{await session.close();}}
});

integrationTest("an exact capability cannot cross to another owner with the same workspace name",async()=>{
  const session=new RoleSession(SUBMIT_LOGIN,SUBMIT_ROLE);await session.connect();try{
    await assert.rejects(session.query("SELECT * FROM ai_media_worker_api.claim_admitted_v1($1,$2,$3,$4,$5)",
      [ids.submitCapability,"another-owner",WORKSPACE,"submit-worker",60_000]),
    (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="42501");
    const attempts=await adminPool.query("SELECT id FROM ai_media_provider_submission_attempts");assert.equal(attempts.rowCount,0);
  }finally{await session.close();}
});

integrationTest("two concurrent submit sessions produce one exact claim",async()=>{
  const work=await createActivatedWork(),barrier=await adminPool.connect();
  const left=new RoleSession(SUBMIT_LOGIN,SUBMIT_ROLE),right=new RoleSession(SUBMIT_LOGIN,SUBMIT_ROLE);
  await left.connect();await right.connect();try{
    await barrier.query("BEGIN");await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`ai-media:admitted-claim:${OWNER}:${WORKSPACE}`]);
    const params=[ids.submitCapability,OWNER,WORKSPACE,"submit-worker",2_000];
    const leftCall=left.query("SELECT * FROM ai_media_worker_api.claim_admitted_v1($1,$2,$3,$4,$5)",params);
    const rightCall=right.query("SELECT * FROM ai_media_worker_api.claim_admitted_v1($1,$2,$3,$4,$5)",params);
    await waitForBlocked(left.pid);await waitForBlocked(right.pid);await barrier.query("COMMIT");
    const results=await Promise.all([leftCall,rightCall]);assert.deepEqual(results.map(result=>result.rowCount).sort(),[0,1]);
    const ledger=await adminPool.query<{attempts:string;events:string;fence:string;claims:number}>(`
      SELECT count(DISTINCT attempt.id)::text attempts,count(event.id)::text events,
        max(attempt.fencing_token)::text fence,max(attempt.claim_count) claims
      FROM ai_media_provider_submission_attempts attempt JOIN ai_media_provider_submission_events event
        ON event.submission_attempt_id=attempt.id WHERE attempt.budget_reservation_id=$1`,[work.reservationId]);
    assert.deepEqual(ledger.rows[0],{attempts:"1",events:"1",fence:"1",claims:1});
  }finally{await barrier.query("ROLLBACK").catch(()=>undefined);barrier.release();await left.close();await right.close();}
});

integrationTest("an expired claim is replaced by a higher fence and the old lease is durable evidence",async()=>{
  // This test runs after the one-work claim test and exercises that exact durable attempt.
  const first=await adminPool.query<{id:string;budget_reservation_id:string;lease_token:string;sealed_request_digest:string}>(
    "SELECT id,budget_reservation_id,lease_token::text,sealed_request_digest FROM ai_media_provider_submission_attempts ORDER BY created_at LIMIT 1");
  assert.equal(first.rowCount,1);await adminPool.query(
    "UPDATE ai_media_provider_submission_attempts SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=$1",
    [first.rows[0].id]).then(()=>assert.fail("direct lease rewriting must be rejected"),()=>undefined);
  // Use DB-owned expiry rather than mutating protected evidence. The original
  // claim uses a bounded lease; this predicate is the only timing condition.
  await waitForExpiredAttempt(first.rows[0].id);
  const session=new RoleSession(SUBMIT_LOGIN,SUBMIT_ROLE);await session.connect();try{
    const reclaimed=await session.query<{id:string;fencing_token:string;lease_token:string;sealed_request_digest:string}>(
      "SELECT * FROM ai_media_worker_api.claim_admitted_v1($1,$2,$3,$4,$5)",
      [ids.submitCapability,OWNER,WORKSPACE,"submit-worker",60_000]);
    assert.equal(reclaimed.rowCount,1);assert.equal(reclaimed.rows[0].id,first.rows[0].id);
    assert.equal(reclaimed.rows[0].fencing_token,"2");assert.notEqual(reclaimed.rows[0].lease_token,first.rows[0].lease_token);
    const events=await adminPool.query<{sequence:number;event_kind:string;fencing_token:string}>(`
      SELECT sequence,event_kind,fencing_token::text FROM ai_media_provider_submission_events
      WHERE submission_attempt_id=$1 ORDER BY sequence`,[first.rows[0].id]);
    assert.deepEqual(events.rows,[{sequence:1,event_kind:"claimed",fencing_token:"1"},
      {sequence:2,event_kind:"reclaimed",fencing_token:"2"}]);
    const stale=await session.query("SELECT * FROM ai_media_worker_api.authorize_admitted_v1($1,$2,$3,$4,$5,$6,$7,$8)",
      [ids.submitCapability,OWNER,WORKSPACE,first.rows[0].id,first.rows[0].budget_reservation_id,1,
        first.rows[0].lease_token,first.rows[0].sealed_request_digest]);
    assert.equal(stale.rowCount,0,"the pre-reclaim fence must never authorize");
    const authorized=await session.query("SELECT * FROM ai_media_worker_api.authorize_admitted_v1($1,$2,$3,$4,$5,$6,$7,$8)",
      [ids.submitCapability,OWNER,WORKSPACE,reclaimed.rows[0].id,first.rows[0].budget_reservation_id,2,
        reclaimed.rows[0].lease_token,reclaimed.rows[0].sealed_request_digest]);
    assert.equal(authorized.rowCount,1);
    const capacity=await adminPool.query<{state:string}>(
      "SELECT state FROM ai_media_submission_capacity_leases WHERE budget_reservation_id=$1",
      [first.rows[0].budget_reservation_id]);
    assert.deepEqual(capacity.rows,[{state:"held"}]);
  }finally{await session.close();}
});

integrationTest("concurrent definitive no-submit finality refunds and releases capacity exactly once",async()=>{
  const attempt=await adminPool.query<{id:string;budget_reservation_id:string;fencing_token:string;lease_token:string;
    send_authorization_digest:string;provider_account_id:string;provider_key:string;provider_credential_version:number;
    provider_idempotency_key:string}>(`SELECT id,budget_reservation_id,fencing_token::text,lease_token::text,
      send_authorization_digest,provider_account_id,provider_key,provider_credential_version,provider_idempotency_key
      FROM ai_media_provider_submission_attempts WHERE state='authorized'`);
  assert.equal(attempt.rowCount,1);const row=attempt.rows[0];
  const submit=new RoleSession(SUBMIT_LOGIN,SUBMIT_ROLE);await submit.connect();
  const reconciler=new RoleSession(RECONCILE_LOGIN,RECONCILE_ROLE);await reconciler.connect();
  try{
    const ambiguous=await submit.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.record_submit_ambiguous_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.submitCapability,OWNER,WORKSPACE,row.id,row.budget_reservation_id,row.fencing_token,
        row.send_authorization_digest,row.lease_token,"provider-request-ambiguous",digest("3")]);
    assert.deepEqual(ambiguous.rows,[{applied:true}]);
    const firstClaim=await reconciler.query<{reconciliation_lease_token:string;reconciliation_fencing_token:string}>(
      "SELECT * FROM ai_media_worker_api.claim_reconciliation_v1($1,$2,$3,$4,$5)",
      [ids.reconcileCapability,OWNER,WORKSPACE,"reconcile-worker",60_000]);
    assert.equal(firstClaim.rowCount,1);
    const unknownRelease=await reconciler.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.release_reconciliation_unknown_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [ids.reconcileCapability,OWNER,WORKSPACE,row.id,row.budget_reservation_id,row.fencing_token,
        row.send_authorization_digest,firstClaim.rows[0].reconciliation_lease_token,
        firstClaim.rows[0].reconciliation_fencing_token]);
    assert.deepEqual(unknownRelease.rows,[{applied:true}]);
    const claimed=await reconciler.query<{reconciliation_lease_token:string;reconciliation_fencing_token:string}>(
      "SELECT * FROM ai_media_worker_api.claim_reconciliation_v1($1,$2,$3,$4,$5)",
      [ids.reconcileCapability,OWNER,WORKSPACE,"reconcile-worker",60_000]);
    assert.equal(claimed.rowCount,1);const reconciliation=claimed.rows[0];
    assert.equal(reconciliation.reconciliation_fencing_token,"2");
    const barrier=await adminPool.connect(),left=new RoleSession(RECONCILE_LOGIN,RECONCILE_ROLE),
      right=new RoleSession(RECONCILE_LOGIN,RECONCILE_ROLE);await left.connect();await right.connect();
    try{
      await barrier.query("BEGIN");await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`ai-media:admitted-reservation:${OWNER}:${WORKSPACE}:${row.budget_reservation_id}`]);
      const finality=[ids.reconcileCapability,OWNER,WORKSPACE,row.id,row.budget_reservation_id,row.fencing_token,
        row.send_authorization_digest,reconciliation.reconciliation_lease_token,
        reconciliation.reconciliation_fencing_token,"linearizable_not_accepted_and_cannot_later_accept",
        row.provider_account_id,row.provider_key,row.provider_credential_version,row.provider_idempotency_key,
        new Date().toISOString(),digest("4")];
      const leftCall=left.query<{applied:boolean}>(
        "SELECT * FROM ai_media_worker_api.finalize_reconciled_no_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",finality);
      const rightCall=right.query<{applied:boolean}>(
        "SELECT * FROM ai_media_worker_api.finalize_reconciled_no_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",finality);
      await waitForBlocked(left.pid);await waitForBlocked(right.pid);await barrier.query("COMMIT");
      const outcomes=(await Promise.all([leftCall,rightCall])).map(result=>result.rows[0]?.applied).sort();
      assert.deepEqual(outcomes,[false,true]);
    }finally{await barrier.query("ROLLBACK").catch(()=>undefined);barrier.release();await left.close();await right.close();}
    const ledger=await adminPool.query<{attempt_state:string;reservation_state:string;submission_state:string;
      capacity_state:string;capacity_version:string;committed:string;terminal_events:string;
      provider_request_id:string|null;ambiguous_request_id:string|null}>(`
      SELECT attempt.state attempt_state,reservation.state reservation_state,reservation.submission_state,
        capacity.state capacity_state,capacity.state_version::text capacity_version,
        bucket.committed_micro_usd::text committed,attempt.provider_request_id,
        max(event.provider_request_id) FILTER (WHERE event.event_kind='ambiguous') ambiguous_request_id,
        count(event.id) FILTER (WHERE event.event_kind='reconciled_no_submit')::text terminal_events
      FROM ai_media_provider_submission_attempts attempt
      JOIN ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      JOIN ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
      LEFT JOIN ai_media_provider_submission_events event ON event.submission_attempt_id=attempt.id
      WHERE attempt.id=$1 GROUP BY attempt.state,reservation.state,reservation.submission_state,
        capacity.state,capacity.state_version,bucket.committed_micro_usd,attempt.provider_request_id`,[row.id]);
    assert.deepEqual(ledger.rows[0],{attempt_state:"reconciled_no_submit",reservation_state:"released",
      submission_state:"reconciled_no_submit",capacity_state:"released",capacity_version:"2",committed:"0",
      provider_request_id:null,ambiguous_request_id:"provider-request-ambiguous",terminal_events:"1"});
  }finally{await submit.close();await reconciler.close();}
});

integrationTest("confirmed provider terminal evidence releases active capacity once without refunding committed budget",async()=>{
  await resetOwnedSchema();const work=await createActivatedWork();
  const submit=new RoleSession(SUBMIT_LOGIN,SUBMIT_ROLE),reconcile=new RoleSession(RECONCILE_LOGIN,RECONCILE_ROLE);
  await submit.connect();await reconcile.connect();try{
    const claim=await submit.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.claim_admitted_v1($1,$2,$3,$4,$5)",
      [ids.submitCapability,OWNER,WORKSPACE,"submit-worker",60_000]);assert.equal(claim.rowCount,1);
    const claimed=claim.rows[0];
    const authorization=await submit.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.authorize_admitted_v1($1,$2,$3,$4,$5,$6,$7,$8)",
      [ids.submitCapability,OWNER,WORKSPACE,claimed.id,work.reservationId,claimed.fencing_token,
        claimed.lease_token,claimed.sealed_request_digest]);assert.equal(authorization.rowCount,1);
    const auth=authorization.rows[0],providerJobId="provider-job-pr26-terminal";
    const confirmed=await submit.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.record_submit_confirmed_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [ids.submitCapability,OWNER,WORKSPACE,auth.id,work.reservationId,auth.fencing_token,
        auth.send_authorization_digest,auth.lease_token,providerJobId,null,digest("5")]);
    assert.deepEqual(confirmed.rows,[{applied:true}]);
    const releaseParams=[ids.reconcileCapability,OWNER,WORKSPACE,auth.id,work.reservationId,providerJobId,
      "completed",digest("6")];
    const first=await reconcile.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.release_terminal_capacity_v1($1,$2,$3,$4,$5,$6,$7,$8)",releaseParams);
    const replay=await reconcile.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.release_terminal_capacity_v1($1,$2,$3,$4,$5,$6,$7,$8)",releaseParams);
    assert.deepEqual([first.rows[0].applied,replay.rows[0].applied],[true,false]);
    const ledger=await adminPool.query<{state:string;release_kind:string;version:string;committed:string}>(`
      SELECT capacity.state,capacity.release_kind,capacity.state_version::text version,
        bucket.committed_micro_usd::text committed FROM ai_media_submission_capacity_leases capacity
      JOIN ai_media_budget_reservations reservation ON reservation.id=capacity.budget_reservation_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      WHERE capacity.budget_reservation_id=$1`,[work.reservationId]);
    assert.deepEqual(ledger.rows[0],{state:"released",release_kind:"provider_terminal",version:"2",committed:"1250000"});
  }finally{await submit.close();await reconcile.close();}
});

integrationTest("live PR26 rollback preserves evidence, then removes only an unused capability surface",async()=>{
  const before=await adminPool.query<{capabilities:string;capacity:string}>(`SELECT
    (SELECT count(*)::text FROM ai_media_admitted_worker_capabilities) capabilities,
    (SELECT count(*)::text FROM ai_media_submission_capacity_leases) capacity`);
  assert.deepEqual(before.rows[0],{capabilities:"2",capacity:"1"});
  const guardedClient=await adminPool.connect();try{
    await assert.rejects(guardedClient.query(pr26Rollback),(error:unknown)=>
      typeof error==="object"&&error!==null&&"code" in error&&error.code==="P0001");
    await guardedClient.query("ROLLBACK");
  }finally{guardedClient.release();}
  const preserved=await adminPool.query<{capabilities:string;capacity:string;api_schema:boolean}>(`SELECT
    (SELECT count(*)::text FROM ai_media_admitted_worker_capabilities) capabilities,
    (SELECT count(*)::text FROM ai_media_submission_capacity_leases) capacity,
    to_regnamespace('ai_media_worker_api') IS NOT NULL api_schema`);
  assert.deepEqual(preserved.rows[0],{capabilities:"2",capacity:"1",api_schema:true});

  await resetOwnedSchema(false);
  await adminPool.query(pr26Rollback);
  const rollback=await adminPool.query<{capability_table:boolean;capacity_table:boolean;api_schema:boolean;
    submit_table_access:boolean;public_create:boolean;legacy_definer:boolean;legacy_owner:string}>(`SELECT
    to_regclass('public.ai_media_admitted_worker_capabilities') IS NOT NULL capability_table,
    to_regclass('public.ai_media_submission_capacity_leases') IS NOT NULL capacity_table,
    to_regnamespace('ai_media_worker_api') IS NOT NULL api_schema,
    has_table_privilege('${SUBMIT_ROLE}','public.ai_media_provider_submission_attempts','SELECT,INSERT,UPDATE,DELETE') submit_table_access,
    has_schema_privilege('${SUBMIT_ROLE}','public','CREATE') public_create,
    procedure.prosecdef legacy_definer,owner.rolname legacy_owner
    FROM pg_proc procedure JOIN pg_roles owner ON owner.oid=procedure.proowner
    WHERE procedure.oid='public.ai_media_assert_pr25_consistency()'::regprocedure`);
  assert.deepEqual(rollback.rows[0],{capability_table:false,capacity_table:false,api_schema:false,
    submit_table_access:false,public_create:false,legacy_definer:true,legacy_owner:"ai_media_admitted_fn_owner"});
});

integrationTest("pending PR32 exact fence is table-blind, concurrency-one, replay-safe and uncertainty-terminal",async()=>{
  await resetOwnedSchema();
  await adminPool.query(`DO $roles$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${EXACT_RUN_ROLE}') THEN
      CREATE ROLE ${EXACT_RUN_ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE ${EXACT_RUN_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
  END $roles$`);
  await adminPool.query(`GRANT ${EXACT_RUN_ROLE} TO ${EXACT_RUN_LOGIN}`);
  await adminPool.query(`CREATE TABLE public.ai_media_assets(
    id uuid PRIMARY KEY,owner_user_id text NOT NULL,workspace_id text NOT NULL,kind text NOT NULL,
    checksum text,deleted_at timestamptz);
    ALTER TABLE public.ai_media_render_jobs ADD COLUMN output_url text,ADD COLUMN error_code text,
      ADD COLUMN error_message text,ADD COLUMN completed_at timestamptz`);
  await adminPool.query(pr4Forward);
  await adminPool.query(`UPDATE public.ai_media_admitted_worker_capabilities
    SET revoked_at=clock_timestamp() WHERE allowed_operations @> ARRAY['release_terminal_capacity']::text[]`);
  await adminPool.query(pr27Forward);
  const work=await createActivatedWork();
  await adminPool.query(pr32Forward);
  const exact=await adminPool.query<{daily_plan_slot_id:string;attempt:number;work_handoff_digest:string}>(`
    SELECT daily_plan_slot_id,attempt,work_handoff_digest FROM ai_media_budget_reservations
    WHERE owner_user_id=$1 AND workspace_id=$2 AND id=$3 AND render_job_id=$4`,
  [OWNER,WORKSPACE,work.reservationId,work.renderJobId]);
  assert.equal(exact.rowCount,1);const target=exact.rows[0];
  const commandId="exact-run-pr32-submit",commandDigest=digest("6"),uncertainCommandId="exact-run-pr32-terminal",
    uncertainCommandDigest=digest("7");
  await adminPool.query(`INSERT INTO ai_media_exact_one_video_run_capabilities(
    id,database_principal,owner_user_id,workspace_id,actor_user_id,budget_reservation_id,render_job_id,
    daily_plan_slot_id,slot_attempt,work_handoff_digest,action,command_id,command_digest,max_lease_ms,
    valid_from,expires_at,evidence_digest)
    VALUES($1,$2,$3,$4,'robert',$5,$6,$7,$8,$9,'activate_and_submit',$10,$11,300000,
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$12),
    ($13,$2,$3,$4,'robert',$5,$6,$7,$8,$9,'observe_terminal',$14,$15,300000,
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$16)`,
  [ids.exactRunCapability,EXACT_RUN_LOGIN,OWNER,WORKSPACE,work.reservationId,work.renderJobId,
    target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,commandId,commandDigest,digest("8"),
    ids.exactUncertainCapability,uncertainCommandId,uncertainCommandDigest,digest("9")]);
  const tableAccess=await adminPool.query<{subject:string;allowed:boolean}>(`SELECT subject,
    has_table_privilege(subject,'public.ai_media_exact_one_video_run_fences','SELECT,INSERT,UPDATE,DELETE') allowed
    FROM unnest($1::text[]) WITH ORDINALITY subjects(subject,ordinal) ORDER BY ordinal`,[[EXACT_RUN_LOGIN,EXACT_RUN_ROLE]]);
  assert.deepEqual(tableAccess.rows,[
    {subject:EXACT_RUN_LOGIN,allowed:false},{subject:EXACT_RUN_ROLE,allowed:false},
  ]);
  const session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
  try{
    const acquireParams=[ids.exactRunCapability,OWNER,WORKSPACE,work.reservationId,work.renderJobId,
      target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,"activate_and_submit",
      commandId,commandDigest,"robert",1_000];
    const acquired=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      acquireParams);
    assert.equal(acquired.rowCount,1);assert.equal(acquired.rows[0].kind,"acquired");
    const busy=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      acquireParams);
    assert.equal(busy.rows[0].kind,"busy");
    await waitForExpiredExactRun(String(acquired.rows[0].execution_id));
    const reclaimed=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [...acquireParams.slice(0,12),60_000]);
    assert.equal(reclaimed.rows[0].kind,"acquired");
    assert.equal(reclaimed.rows[0].execution_id,acquired.rows[0].execution_id);
    assert.equal(reclaimed.rows[0].fencing_token,"2");
    assert.notEqual(reclaimed.rows[0].lease_token,acquired.rows[0].lease_token);
    const staleCompletion=await session.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.complete_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [ids.exactRunCapability,OWNER,WORKSPACE,acquired.rows[0].execution_id,commandId,commandDigest,
        acquired.rows[0].fencing_token,acquired.rows[0].lease_token,work.reservationId,work.renderJobId,
        target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,"activate_and_submit","confirmed"]);
    assert.deepEqual(staleCompletion.rows,[{applied:false}]);
    const completed=await session.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.complete_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [ids.exactRunCapability,OWNER,WORKSPACE,reclaimed.rows[0].execution_id,commandId,commandDigest,
        reclaimed.rows[0].fencing_token,reclaimed.rows[0].lease_token,work.reservationId,work.renderJobId,
        target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,"activate_and_submit","confirmed"]);
    assert.deepEqual(completed.rows,[{applied:true}]);
    const replay=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      acquireParams);
    assert.equal(replay.rows[0].kind,"replayed");assert.equal(replay.rows[0].outcome,"confirmed");

    const uncertainParams=[ids.exactUncertainCapability,OWNER,WORKSPACE,work.reservationId,work.renderJobId,
      target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,"observe_terminal",
      uncertainCommandId,uncertainCommandDigest,"robert",60_000];
    const uncertainAcquire=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      uncertainParams);
    assert.equal(uncertainAcquire.rows[0].kind,"acquired");
    const sealed=await session.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.seal_exact_one_video_run_uncertain_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [ids.exactUncertainCapability,OWNER,WORKSPACE,uncertainAcquire.rows[0].execution_id,
        uncertainCommandId,uncertainCommandDigest,uncertainAcquire.rows[0].fencing_token,
        uncertainAcquire.rows[0].lease_token,digest("a")]);
    assert.deepEqual(sealed.rows,[{applied:true}]);
    const conflict=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      uncertainParams);
    assert.equal(conflict.rows[0].kind,"conflict");
  }finally{await session.close();}
  const evidence=await adminPool.query<{completed:string;uncertain:string;publishing_surface_absent:boolean}>(`SELECT
    count(*) FILTER (WHERE state='completed')::text completed,
    count(*) FILTER (WHERE state='uncertain')::text uncertain,
    to_regclass('public.ai_media_publishing_jobs') IS NULL publishing_surface_absent
    FROM ai_media_exact_one_video_run_fences`);
  assert.deepEqual(evidence.rows[0],{completed:"1",uncertain:"1",publishing_surface_absent:true});
  const rollbackClient=await adminPool.connect();try{
    await assert.rejects(rollbackClient.query(pr32Rollback),
      /rollback preserves exact one-video authorization and run evidence/u);
    await rollbackClient.query("ROLLBACK");
  }finally{rollbackClient.release();}
});

integrationTest("pending PR33 exact submit claim is table-blind, fenced, replay-safe and lease-expiry safe",async()=>{
  type ExactSetup={work:{reservationId:string;renderJobId:string};target:{daily_plan_slot_id:string;attempt:number;work_handoff_digest:string};
    commandId:string;commandDigest:string;acquired:Record<string,unknown>};
  async function setupExactSubmit(commandId:string,commandDigest:string,leaseMs=60_000):Promise<ExactSetup>{
    await resetOwnedSchema();
    await adminPool.query(`DO $roles$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${EXACT_RUN_ROLE}') THEN
        CREATE ROLE ${EXACT_RUN_ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        CREATE ROLE ${EXACT_RUN_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END $roles$`);
    await adminPool.query(`GRANT ${EXACT_RUN_ROLE} TO ${EXACT_RUN_LOGIN}`);
    await adminPool.query(`CREATE TABLE public.ai_media_assets(
      id uuid PRIMARY KEY,owner_user_id text NOT NULL,workspace_id text NOT NULL,kind text NOT NULL,
      checksum text,deleted_at timestamptz);
      ALTER TABLE public.ai_media_render_jobs ADD COLUMN output_url text,ADD COLUMN error_code text,
        ADD COLUMN error_message text,ADD COLUMN completed_at timestamptz`);
    await adminPool.query(pr4Forward);
    await adminPool.query(`UPDATE public.ai_media_admitted_worker_capabilities
      SET revoked_at=clock_timestamp() WHERE allowed_operations @> ARRAY['release_terminal_capacity']::text[]`);
    await adminPool.query(pr27Forward);
    const work=await createActivatedWork();
    await adminPool.query(pr32Forward);
    await adminPool.query(pr33Forward);
    const exact=await adminPool.query<{daily_plan_slot_id:string;attempt:number;work_handoff_digest:string}>(`
      SELECT daily_plan_slot_id,attempt,work_handoff_digest FROM ai_media_budget_reservations
      WHERE owner_user_id=$1 AND workspace_id=$2 AND id=$3 AND render_job_id=$4`,
    [OWNER,WORKSPACE,work.reservationId,work.renderJobId]);
    assert.equal(exact.rowCount,1);const target=exact.rows[0];
    await adminPool.query(`INSERT INTO ai_media_exact_one_video_run_capabilities(
      id,database_principal,owner_user_id,workspace_id,actor_user_id,budget_reservation_id,render_job_id,
      daily_plan_slot_id,slot_attempt,work_handoff_digest,action,command_id,command_digest,max_lease_ms,
      valid_from,expires_at,evidence_digest)
      VALUES($1,$2,$3,$4,'robert',$5,$6,$7,$8,$9,'activate_and_submit',$10,$11,300000,
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$12)`,
    [ids.exactRunCapability,EXACT_RUN_LOGIN,OWNER,WORKSPACE,work.reservationId,work.renderJobId,
      target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,commandId,commandDigest,digest("8")]);
    await adminPool.query(`INSERT INTO public.ai_media_admitted_worker_capabilities(
      id,database_principal,owner_user_id,workspace_id,lane,accounting_time_zone,worker_id,allowed_operations,
      max_lease_ms,max_batch_size,valid_from,expires_at,evidence_digest)
      VALUES($1,$2,$3,$4,'submit','UTC','exact-submit-worker',
        ARRAY['claim','authorize','record_submit_confirmed','record_submit_ambiguous'],
        300000,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$5)`,
    [ids.exactSubmitCapability,EXACT_RUN_LOGIN,OWNER,WORKSPACE,digest("9")]);
    const tableAccess=await adminPool.query<{subject:string;fence:boolean;attempt:boolean}>(`SELECT subject,
      has_table_privilege(subject,'public.ai_media_exact_one_video_run_fences','SELECT,INSERT,UPDATE,DELETE') fence,
      has_table_privilege(subject,'public.ai_media_provider_submission_attempts','SELECT,INSERT,UPDATE,DELETE') attempt
      FROM unnest($1::text[]) WITH ORDINALITY subjects(subject,ordinal) ORDER BY ordinal`,[[EXACT_RUN_LOGIN,EXACT_RUN_ROLE]]);
    assert.deepEqual(tableAccess.rows,[
      {subject:EXACT_RUN_LOGIN,fence:false,attempt:false},{subject:EXACT_RUN_ROLE,fence:false,attempt:false},
    ]);
    const session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
    try{
      const acquired=await session.query<Record<string,unknown>>(
        "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [ids.exactRunCapability,OWNER,WORKSPACE,work.reservationId,work.renderJobId,target.daily_plan_slot_id,
          target.attempt,target.work_handoff_digest,"activate_and_submit",commandId,commandDigest,"robert",leaseMs]);
      assert.equal(acquired.rowCount,1);assert.equal(acquired.rows[0].kind,"acquired");
      return {work,target,commandId,commandDigest,acquired:acquired.rows[0]};
    }finally{await session.close();}
  }
  const claimSql="SELECT * FROM ai_media_worker_api.claim_exact_one_video_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)";
  const authorizeSql="SELECT * FROM ai_media_worker_api.authorize_exact_one_video_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)";
  const confirmedSql="SELECT * FROM ai_media_worker_api.record_exact_one_video_submit_confirmed_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)";
  const ambiguousSql="SELECT * FROM ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)";

  const staleSetup=await setupExactSubmit("exact-run-pr33-expired-submit",digest("6"),60_000);
  const wrongDailyPlanSlotId="26000000-0000-4000-8000-000000000019";
  assert.notEqual(wrongDailyPlanSlotId,staleSetup.target.daily_plan_slot_id);
  let session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
  try{
    await assert.rejects(session.query(claimSql,[staleSetup.acquired.execution_id,staleSetup.acquired.lease_token,
      staleSetup.acquired.fencing_token,staleSetup.commandDigest,"robert",OWNER,WORKSPACE,staleSetup.work.reservationId,
      staleSetup.work.renderJobId,wrongDailyPlanSlotId,staleSetup.target.attempt,staleSetup.target.work_handoff_digest,
      "exact-submit-worker",1_000]),(error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="42501");
    const unclaimed=await adminPool.query("SELECT id FROM ai_media_provider_submission_attempts WHERE budget_reservation_id=$1",
      [staleSetup.work.reservationId]);
    assert.equal(unclaimed.rowCount,0);
    const claim=await session.query<Record<string,unknown>>(claimSql,[staleSetup.acquired.execution_id,staleSetup.acquired.lease_token,
      staleSetup.acquired.fencing_token,staleSetup.commandDigest,"robert",OWNER,WORKSPACE,staleSetup.work.reservationId,
      staleSetup.work.renderJobId,staleSetup.target.daily_plan_slot_id,staleSetup.target.attempt,
      staleSetup.target.work_handoff_digest,"exact-submit-worker",1_000]);
    assert.equal(claim.rowCount,1);
    const authorized=await session.query<Record<string,unknown>>(authorizeSql,[staleSetup.acquired.execution_id,
      staleSetup.acquired.lease_token,staleSetup.acquired.fencing_token,staleSetup.commandDigest,"robert",
      OWNER,WORKSPACE,staleSetup.work.reservationId,staleSetup.work.renderJobId,staleSetup.target.daily_plan_slot_id,
      staleSetup.target.attempt,staleSetup.target.work_handoff_digest,claim.rows[0].id,claim.rows[0].fencing_token,
      claim.rows[0].lease_token,claim.rows[0].sealed_request_digest]);
    assert.equal(authorized.rowCount,1);
    await waitForExpiredAttempt(String(authorized.rows[0].id));
    const projectionSql=`SELECT attempt.state attempt_state,
      reservation.state reservation_state,reservation.submission_state,job.stage job_stage,outbox.status outbox_status,
      slot.status slot_status,count(event.id)::text events
      FROM ai_media_provider_submission_attempts attempt
      JOIN ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
      JOIN ai_media_render_jobs job ON job.id=attempt.render_job_id
      JOIN ai_media_outbox outbox ON outbox.id=attempt.dispatch_outbox_id
      JOIN ai_media_daily_plan_slots slot ON slot.id=attempt.daily_plan_slot_id
      LEFT JOIN ai_media_provider_submission_events event ON event.submission_attempt_id=attempt.id
      WHERE attempt.id=$1 GROUP BY attempt.state,reservation.state,reservation.submission_state,
        job.stage,outbox.status,slot.status`;
    const before=await adminPool.query<Record<string,unknown>>(projectionSql,[authorized.rows[0].id]);
    const staleConfirmed=await session.query<{execution_id:string;applied:boolean}>(confirmedSql,[staleSetup.acquired.execution_id,
      staleSetup.acquired.lease_token,staleSetup.acquired.fencing_token,staleSetup.commandDigest,"robert",
      OWNER,WORKSPACE,staleSetup.work.reservationId,staleSetup.work.renderJobId,staleSetup.target.daily_plan_slot_id,
      staleSetup.target.attempt,staleSetup.target.work_handoff_digest,authorized.rows[0].id,
      authorized.rows[0].fencing_token,authorized.rows[0].send_authorization_digest,authorized.rows[0].lease_token,
      "provider-job-expired",null,digest("a")]);
    const staleAmbiguous=await session.query<{execution_id:string;applied:boolean}>(ambiguousSql,[staleSetup.acquired.execution_id,
      staleSetup.acquired.lease_token,staleSetup.acquired.fencing_token,staleSetup.commandDigest,"robert",
      OWNER,WORKSPACE,staleSetup.work.reservationId,staleSetup.work.renderJobId,staleSetup.target.daily_plan_slot_id,
      staleSetup.target.attempt,staleSetup.target.work_handoff_digest,authorized.rows[0].id,
      authorized.rows[0].fencing_token,authorized.rows[0].send_authorization_digest,authorized.rows[0].lease_token,
      "provider-request-expired",digest("b")]);
    assert.equal(staleConfirmed.rows[0]?.applied,false);
    assert.equal(staleConfirmed.rows[0]?.execution_id,staleSetup.acquired.execution_id);
    assert.equal(staleAmbiguous.rows[0]?.applied,false);
    assert.equal(staleAmbiguous.rows[0]?.execution_id,staleSetup.acquired.execution_id);
    const after=await adminPool.query<Record<string,unknown>>(projectionSql,[authorized.rows[0].id]);
    assert.deepEqual(after.rows,before.rows);
  }finally{await session.close();}

  const successSetup=await setupExactSubmit("exact-run-pr33-submit",digest("7"),60_000);
  session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
  try{
    const claim=await session.query<Record<string,unknown>>(claimSql,[successSetup.acquired.execution_id,successSetup.acquired.lease_token,
      successSetup.acquired.fencing_token,successSetup.commandDigest,"robert",OWNER,WORKSPACE,successSetup.work.reservationId,
      successSetup.work.renderJobId,successSetup.target.daily_plan_slot_id,successSetup.target.attempt,
      successSetup.target.work_handoff_digest,"exact-submit-worker",60_000]);
    assert.equal(claim.rowCount,1);assert.equal(claim.rows[0].budget_reservation_id,successSetup.work.reservationId);
    const authorized=await session.query<Record<string,unknown>>(authorizeSql,[successSetup.acquired.execution_id,
      successSetup.acquired.lease_token,successSetup.acquired.fencing_token,successSetup.commandDigest,"robert",
      OWNER,WORKSPACE,successSetup.work.reservationId,successSetup.work.renderJobId,successSetup.target.daily_plan_slot_id,
      successSetup.target.attempt,successSetup.target.work_handoff_digest,claim.rows[0].id,claim.rows[0].fencing_token,
      claim.rows[0].lease_token,claim.rows[0].sealed_request_digest]);
    assert.equal(authorized.rowCount,1);
    const ambiguous=await session.query<{execution_id:string;applied:boolean}>(ambiguousSql,[successSetup.acquired.execution_id,
      successSetup.acquired.lease_token,successSetup.acquired.fencing_token,successSetup.commandDigest,"robert",
      OWNER,WORKSPACE,successSetup.work.reservationId,successSetup.work.renderJobId,successSetup.target.daily_plan_slot_id,
      successSetup.target.attempt,successSetup.target.work_handoff_digest,authorized.rows[0].id,
      authorized.rows[0].fencing_token,authorized.rows[0].send_authorization_digest,authorized.rows[0].lease_token,
      "provider-request-ambiguous",digest("c")]);
    assert.equal(ambiguous.rows[0]?.applied,true);
    assert.equal(ambiguous.rows[0]?.execution_id,successSetup.acquired.execution_id);
    const completed=await session.query<{applied:boolean}>(
      "SELECT * FROM ai_media_worker_api.complete_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [ids.exactRunCapability,OWNER,WORKSPACE,successSetup.acquired.execution_id,successSetup.commandId,
        successSetup.commandDigest,successSetup.acquired.fencing_token,successSetup.acquired.lease_token,
        successSetup.work.reservationId,successSetup.work.renderJobId,successSetup.target.daily_plan_slot_id,
        successSetup.target.attempt,successSetup.target.work_handoff_digest,"activate_and_submit","ambiguous"]);
    assert.equal(completed.rows[0]?.applied,true);
    const replay=await session.query<Record<string,unknown>>(
      "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [ids.exactRunCapability,OWNER,WORKSPACE,successSetup.work.reservationId,successSetup.work.renderJobId,
        successSetup.target.daily_plan_slot_id,successSetup.target.attempt,successSetup.target.work_handoff_digest,
        "activate_and_submit",successSetup.commandId,successSetup.commandDigest,"robert",60_000]);
    assert.equal(replay.rows[0].kind,"replayed");assert.equal(replay.rows[0].outcome,"ambiguous");
  }finally{await session.close();}
  const evidence=await adminPool.query<{completed:string;ambiguous:string;publishing_surface_absent:boolean}>(`SELECT
    count(*) FILTER (WHERE fence.state='completed')::text completed,
    count(*) FILTER (WHERE attempt.state='ambiguous')::text ambiguous,
    to_regclass('public.ai_media_publishing_jobs') IS NULL publishing_surface_absent
    FROM ai_media_exact_one_video_run_fences fence
    LEFT JOIN ai_media_provider_submission_attempts attempt ON attempt.budget_reservation_id=fence.budget_reservation_id
      AND attempt.render_job_id=fence.render_job_id AND attempt.daily_plan_slot_id=fence.daily_plan_slot_id
      AND attempt.slot_attempt=fence.slot_attempt AND attempt.work_handoff_digest=fence.work_handoff_digest`);
  assert.deepEqual(evidence.rows[0],{completed:"1",ambiguous:"1",publishing_surface_absent:true});
  const rollbackClient=await adminPool.connect();try{
    await assert.rejects(rollbackClient.query(pr33Rollback),
      /rollback preserves exact one-video submit claim, authorization, and outcome evidence/u);
    await rollbackClient.query("ROLLBACK");
  }finally{rollbackClient.release();}
});

integrationTest("pending PR34 exact reconciliation and terminal observation are target-bound, fenced and replay-safe",async()=>{
  type ExactTarget={daily_plan_slot_id:string;attempt:number;work_handoff_digest:string};
  type ExactScenario={
    work:{reservationId:string;renderJobId:string};target:ExactTarget;actor:string;
    action:"reconcile_submission"|"observe_terminal";actionCapabilityId:string;
    commandId:string;commandDigest:string;acquired:Record<string,unknown>;attempt:Record<string,unknown>;
  };
  const claimSubmitSql=
    "SELECT * FROM ai_media_worker_api.claim_exact_one_video_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)";
  const authorizeSubmitSql=
    "SELECT * FROM ai_media_worker_api.authorize_exact_one_video_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)";
  const ambiguousSubmitSql=
    "SELECT * FROM ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)";
  const confirmedSubmitSql=
    "SELECT * FROM ai_media_worker_api.record_exact_one_video_submit_confirmed_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)";
  const acquireRunSql=
    "SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)";
  const completeRunSql=
    "SELECT * FROM ai_media_worker_api.complete_exact_one_video_run_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)";
  const exactActor=`${EXACT_RUN_LOGIN}:exact-one-video-worker`;
  const assertIdentity=(row:Record<string,unknown>,scenario:ExactScenario):void=>{
    assert.equal(row.execution_id,scenario.acquired.execution_id);
    assert.equal(row.run_lease_token,scenario.acquired.lease_token);
    assert.equal(row.run_fencing_token,scenario.acquired.fencing_token);
    assert.equal(row.command_digest,scenario.commandDigest);
    assert.equal(row.actor_user_id,scenario.actor);
    assert.equal(row.owner_user_id,OWNER);
    assert.equal(row.workspace_id,WORKSPACE);
    assert.equal(row.budget_reservation_id,scenario.work.reservationId);
    assert.equal(row.render_job_id,scenario.work.renderJobId);
    assert.equal(row.daily_plan_slot_id,scenario.target.daily_plan_slot_id);
    assert.equal(row.slot_attempt,scenario.target.attempt);
    assert.equal(row.work_handoff_digest,scenario.target.work_handoff_digest);
  };
  async function setupScenario(
    outcome:"ambiguous"|"confirmed",action:"reconcile_submission"|"observe_terminal",suffix:string,
  ):Promise<ExactScenario>{
    await resetOwnedSchema();
    await adminPool.query(`DO $roles$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${EXACT_RUN_ROLE}') THEN
        CREATE ROLE ${EXACT_RUN_ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        CREATE ROLE ${EXACT_RUN_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END $roles$`);
    await adminPool.query(`GRANT ${EXACT_RUN_ROLE} TO ${EXACT_RUN_LOGIN}`);
    await adminPool.query(`CREATE TABLE public.ai_media_assets(
      id uuid PRIMARY KEY,owner_user_id text NOT NULL,workspace_id text NOT NULL,kind text NOT NULL,
      checksum text,deleted_at timestamptz);
      ALTER TABLE public.ai_media_render_jobs ADD COLUMN output_url text,ADD COLUMN error_code text,
        ADD COLUMN error_message text,ADD COLUMN completed_at timestamptz`);
    await adminPool.query(pr4Forward);
    await adminPool.query(`UPDATE public.ai_media_admitted_worker_capabilities
      SET revoked_at=clock_timestamp() WHERE allowed_operations @> ARRAY['release_terminal_capacity']::text[]`);
    await adminPool.query(pr27Forward);
    const work=await createActivatedWork();
    await adminPool.query(pr32Forward);
    await adminPool.query(pr33Forward);
    await adminPool.query(pr34Forward);
    const exact=await adminPool.query<ExactTarget>(`SELECT daily_plan_slot_id,attempt,work_handoff_digest
      FROM ai_media_budget_reservations WHERE owner_user_id=$1 AND workspace_id=$2 AND id=$3 AND render_job_id=$4`,
    [OWNER,WORKSPACE,work.reservationId,work.renderJobId]);
    assert.equal(exact.rowCount,1);const target=exact.rows[0];
    const submitCommandId=`exact-run-pr34-submit-${suffix}`,submitCommandDigest=digest("1");
    const actionCapabilityId=action==="reconcile_submission"
      ?ids.exactReconcileActionCapability:ids.exactTerminalActionCapability;
    const commandId=`exact-run-pr34-${action}-${suffix}`;
    const commandDigest=action==="reconcile_submission"?digest("2"):digest("3");
    await adminPool.query(`INSERT INTO ai_media_exact_one_video_run_capabilities(
      id,database_principal,owner_user_id,workspace_id,actor_user_id,budget_reservation_id,render_job_id,
      daily_plan_slot_id,slot_attempt,work_handoff_digest,action,command_id,command_digest,max_lease_ms,
      valid_from,expires_at,evidence_digest)
      VALUES($1,$2,$3,$4,$14,$5,$6,$7,$8,$9,'activate_and_submit',$10,$11,300000,
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$12),
       ($13,$2,$3,$4,$14,$5,$6,$7,$8,$9,$15,$16,$17,300000,
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$18)`,
    [ids.exactRunCapability,EXACT_RUN_LOGIN,OWNER,WORKSPACE,work.reservationId,work.renderJobId,
      target.daily_plan_slot_id,target.attempt,target.work_handoff_digest,submitCommandId,submitCommandDigest,digest("4"),
      actionCapabilityId,exactActor,action,commandId,commandDigest,digest("5")]);
    await adminPool.query(`INSERT INTO public.ai_media_admitted_worker_capabilities(
      id,database_principal,owner_user_id,workspace_id,lane,accounting_time_zone,worker_id,allowed_operations,
      max_lease_ms,max_batch_size,valid_from,expires_at,evidence_digest)
      VALUES($1,$2,$3,$4,'submit','UTC','exact-one-video-worker',
        ARRAY['claim','authorize','record_submit_confirmed','record_submit_ambiguous'],
        300000,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$5),
       ($6,$2,$3,$4,'reconcile','UTC','exact-one-video-worker',
        ARRAY['claim_reconciliation','release_reconciliation_unknown','record_reconciled_confirmed',
          'finalize_reconciled_no_submit','claim_terminal_check','release_terminal_check_unknown',
          'record_provider_terminal'],
        300000,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$7)`,
    [ids.exactSubmitCapability,EXACT_RUN_LOGIN,OWNER,WORKSPACE,digest("6"),
      ids.exactReconcileWorkerCapability,digest("7")]);
    const tableAccess=await adminPool.query<{fence:boolean;attempt:boolean;terminal:boolean;event:boolean;ingest:boolean}>(`
      SELECT has_table_privilege($1,'public.ai_media_exact_one_video_run_fences','SELECT,INSERT,UPDATE,DELETE') fence,
        has_table_privilege($1,'public.ai_media_provider_submission_attempts','SELECT,INSERT,UPDATE,DELETE') attempt,
        has_table_privilege($1,'public.ai_media_provider_terminal_checks','SELECT,INSERT,UPDATE,DELETE') terminal,
        has_table_privilege($1,'public.ai_media_provider_terminal_events','SELECT,INSERT,UPDATE,DELETE') event,
        has_table_privilege($1,'public.ai_media_asset_ingest_jobs','SELECT,INSERT,UPDATE,DELETE') ingest`,
    [EXACT_RUN_LOGIN]);
    assert.deepEqual(tableAccess.rows,[{fence:false,attempt:false,terminal:false,event:false,ingest:false}]);
    const session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
    try{
      const submitAcquire=await session.query<Record<string,unknown>>(acquireRunSql,
        [ids.exactRunCapability,OWNER,WORKSPACE,work.reservationId,work.renderJobId,target.daily_plan_slot_id,
          target.attempt,target.work_handoff_digest,"activate_and_submit",submitCommandId,submitCommandDigest,
          exactActor,60_000]);
      assert.equal(submitAcquire.rows[0]?.kind,"acquired");
      const submitPrefix=[submitAcquire.rows[0].execution_id,submitAcquire.rows[0].lease_token,
        submitAcquire.rows[0].fencing_token,submitCommandDigest,exactActor,OWNER,WORKSPACE,work.reservationId,
        work.renderJobId,target.daily_plan_slot_id,target.attempt,target.work_handoff_digest];
      const claim=await session.query<Record<string,unknown>>(claimSubmitSql,
        [...submitPrefix,"exact-one-video-worker",60_000]);
      assert.equal(claim.rowCount,1);
      const authorization=await session.query<Record<string,unknown>>(authorizeSubmitSql,
        [...submitPrefix,claim.rows[0].id,claim.rows[0].fencing_token,claim.rows[0].lease_token,
          claim.rows[0].sealed_request_digest]);
      assert.equal(authorization.rowCount,1);
      const attempt=authorization.rows[0];
      if(outcome==="ambiguous"){
        const result=await session.query<Record<string,unknown>>(ambiguousSubmitSql,
          [...submitPrefix,attempt.id,attempt.fencing_token,attempt.send_authorization_digest,
            attempt.lease_token,`provider-request-${suffix}`,digest("8")]);
        assert.equal(result.rows[0]?.applied,true);
      }else{
        const result=await session.query<Record<string,unknown>>(confirmedSubmitSql,
          [...submitPrefix,attempt.id,attempt.fencing_token,attempt.send_authorization_digest,
            attempt.lease_token,`provider-job-${suffix}`,`provider-request-${suffix}`,digest("9")]);
        assert.equal(result.rows[0]?.applied,true);
      }
      const submitCompleted=await session.query<{applied:boolean}>(completeRunSql,
        [ids.exactRunCapability,OWNER,WORKSPACE,submitAcquire.rows[0].execution_id,submitCommandId,
          submitCommandDigest,submitAcquire.rows[0].fencing_token,submitAcquire.rows[0].lease_token,
          work.reservationId,work.renderJobId,target.daily_plan_slot_id,target.attempt,
          target.work_handoff_digest,"activate_and_submit",outcome]);
      assert.deepEqual(submitCompleted.rows,[{applied:true}]);
      const acquired=await session.query<Record<string,unknown>>(acquireRunSql,
        [actionCapabilityId,OWNER,WORKSPACE,work.reservationId,work.renderJobId,target.daily_plan_slot_id,
          target.attempt,target.work_handoff_digest,action,commandId,commandDigest,exactActor,60_000]);
      assert.equal(acquired.rows[0]?.kind,"acquired");
      return {work,target,actor:exactActor,action,actionCapabilityId,commandId,commandDigest,
        acquired:acquired.rows[0],attempt};
    }finally{await session.close();}
  }
  async function waitForTerminalDue(terminalCheckId:string):Promise<void>{
    const deadline=Date.now()+10_000;
    while(Date.now()<deadline){
      const result=await adminPool.query<{due:boolean}>(`SELECT state='pending' AND next_check_at<=clock_timestamp() due
        FROM ai_media_provider_terminal_checks WHERE id=$1`,[terminalCheckId]);
      if(result.rows[0]?.due)return;
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    throw new Error("terminal backoff did not become due");
  }
  const acquireActionParams=(scenario:ExactScenario):unknown[]=>[
    scenario.actionCapabilityId,OWNER,WORKSPACE,scenario.work.reservationId,scenario.work.renderJobId,
    scenario.target.daily_plan_slot_id,scenario.target.attempt,scenario.target.work_handoff_digest,
    scenario.action,scenario.commandId,scenario.commandDigest,scenario.actor,60_000,
  ];
  const completeAction=async(session:RoleSession,scenario:ExactScenario,outcome:string):Promise<void>=>{
    const result=await session.query<{applied:boolean}>(completeRunSql,
      [scenario.actionCapabilityId,OWNER,WORKSPACE,scenario.acquired.execution_id,scenario.commandId,
        scenario.commandDigest,scenario.acquired.fencing_token,scenario.acquired.lease_token,
        scenario.work.reservationId,scenario.work.renderJobId,scenario.target.daily_plan_slot_id,
        scenario.target.attempt,scenario.target.work_handoff_digest,scenario.action,outcome]);
    assert.deepEqual(result.rows,[{applied:true}]);
    const replay=await session.query<Record<string,unknown>>(acquireRunSql,acquireActionParams(scenario));
    assert.equal(replay.rows[0]?.kind,"replayed");assert.equal(replay.rows[0]?.outcome,outcome);
  };

  const reconciliation=await setupScenario("ambiguous","reconcile_submission","reconcile");
  let session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
  try{
    const claimReconciliationSql=
      "SELECT * FROM ai_media_worker_api.claim_exact_one_video_reconciliation_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)";
    const finalizeNoSubmitSql=
      "SELECT * FROM ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)";
    const prefix=[reconciliation.acquired.execution_id,reconciliation.acquired.lease_token,
      reconciliation.acquired.fencing_token,reconciliation.commandDigest,reconciliation.actor,OWNER,WORKSPACE,
      reconciliation.work.reservationId,reconciliation.work.renderJobId,reconciliation.target.daily_plan_slot_id,
      reconciliation.target.attempt,reconciliation.target.work_handoff_digest];
    const eventsBefore=await adminPool.query<{count:string}>(
      "SELECT count(*)::text count FROM ai_media_provider_submission_events WHERE submission_attempt_id=$1",
      [reconciliation.attempt.id]);
    await assert.rejects(session.query(claimReconciliationSql,
      [...prefix.slice(0,9),"26000000-0000-4000-8000-00000000001d",...prefix.slice(10),
        "exact-one-video-worker",1_000]),
    (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="42501");
    const untouched=await adminPool.query<{fence:string;events:string}>(`SELECT
      attempt.reconciliation_fencing_token::text fence,count(event.id)::text events
      FROM ai_media_provider_submission_attempts attempt
      LEFT JOIN ai_media_provider_submission_events event ON event.submission_attempt_id=attempt.id
      WHERE attempt.id=$1 GROUP BY attempt.reconciliation_fencing_token`,[reconciliation.attempt.id]);
    assert.deepEqual(untouched.rows,[{fence:"0",events:eventsBefore.rows[0].count}]);
    const first=await session.query<Record<string,unknown>>(claimReconciliationSql,
      [...prefix,"exact-one-video-worker",1_000]);
    assert.equal(first.rowCount,1);assertIdentity(first.rows[0],reconciliation);
    await waitForExpiredAttempt(String(first.rows[0].id),"reconciliation_lease_expires_at");
    const reclaimed=await session.query<Record<string,unknown>>(claimReconciliationSql,
      [...prefix,"exact-one-video-worker",60_000]);
    assert.equal(reclaimed.rowCount,1);assertIdentity(reclaimed.rows[0],reconciliation);
    assert.equal(reclaimed.rows[0].id,first.rows[0].id);
    assert.equal(reclaimed.rows[0].reconciliation_fencing_token,"2");
    assert.notEqual(reclaimed.rows[0].reconciliation_lease_token,first.rows[0].reconciliation_lease_token);
    const finalityTail=[first.rows[0].id,first.rows[0].fencing_token,first.rows[0].send_authorization_digest,
      first.rows[0].reconciliation_lease_token,first.rows[0].reconciliation_fencing_token,
      "linearizable_not_accepted_and_cannot_later_accept",first.rows[0].provider_account_id,
      first.rows[0].provider_key,first.rows[0].provider_credential_version,first.rows[0].provider_idempotency_key,
      new Date().toISOString(),digest("a")];
    const stale=await session.query<Record<string,unknown>>(finalizeNoSubmitSql,[...prefix,...finalityTail]);
    assert.equal(stale.rows[0]?.applied,false);assertIdentity(stale.rows[0],reconciliation);
    const finalityObservedAt=new Date().toISOString(),finalityEvidence=digest("b");
    const currentFinalityTail=[
      reclaimed.rows[0].id,reclaimed.rows[0].fencing_token,reclaimed.rows[0].send_authorization_digest,
      reclaimed.rows[0].reconciliation_lease_token,reclaimed.rows[0].reconciliation_fencing_token,
      "linearizable_not_accepted_and_cannot_later_accept",reclaimed.rows[0].provider_account_id,
      reclaimed.rows[0].provider_key,reclaimed.rows[0].provider_credential_version,
      reclaimed.rows[0].provider_idempotency_key,finalityObservedAt,finalityEvidence,
    ];
    const applied=await session.query<Record<string,unknown>>(finalizeNoSubmitSql,
      [...prefix,...currentFinalityTail]);
    assert.equal(applied.rows[0]?.applied,true);assertIdentity(applied.rows[0],reconciliation);
    const finalityReplay=await session.query<Record<string,unknown>>(finalizeNoSubmitSql,
      [...prefix,...currentFinalityTail]);
    assert.equal(finalityReplay.rows[0]?.applied,true);assertIdentity(finalityReplay.rows[0],reconciliation);
    const mismatchedFinality=await session.query<Record<string,unknown>>(finalizeNoSubmitSql,
      [...prefix,...currentFinalityTail.slice(0,-1),digest("f")]);
    assert.equal(mismatchedFinality.rows[0]?.applied,false);
    assertIdentity(mismatchedFinality.rows[0],reconciliation);
    await completeAction(session,reconciliation,"reconciled_no_submit");
    const ledger=await adminPool.query<{state:string;capacity:string;capacity_version:string;
      committed:string;events:string;provider_request_id:string|null;ambiguous_request_id:string|null}>(`SELECT
      attempt.state,capacity.state capacity,capacity.state_version::text capacity_version,
      bucket.committed_micro_usd::text committed,attempt.provider_request_id,
      max(event.provider_request_id) FILTER (WHERE event.event_kind='ambiguous') ambiguous_request_id,
      count(event.id) FILTER (WHERE event.event_kind='reconciled_no_submit')::text events
      FROM ai_media_provider_submission_attempts attempt
      JOIN ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
      JOIN ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      LEFT JOIN ai_media_provider_submission_events event ON event.submission_attempt_id=attempt.id
      WHERE attempt.id=$1 GROUP BY attempt.state,capacity.state,capacity.state_version,
        bucket.committed_micro_usd,attempt.provider_request_id`,
    [reconciliation.attempt.id]);
    assert.deepEqual(ledger.rows,[{state:"reconciled_no_submit",capacity:"released",capacity_version:"2",
      committed:"0",provider_request_id:null,ambiguous_request_id:"provider-request-reconcile",events:"1"}]);
  }finally{await session.close();}

  const terminal=await setupScenario("confirmed","observe_terminal","terminal");
  session=new RoleSession(EXACT_RUN_LOGIN,EXACT_RUN_ROLE);await session.connect();
  try{
    const claimTerminalSql=
      "SELECT * FROM ai_media_worker_api.claim_exact_one_video_terminal_check_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)";
    const releaseTerminalSql=
      "SELECT * FROM ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)";
    const recordTerminalSql=
      "SELECT * FROM ai_media_worker_api.record_exact_one_video_provider_terminal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)";
    const prefix=[terminal.acquired.execution_id,terminal.acquired.lease_token,terminal.acquired.fencing_token,
      terminal.commandDigest,terminal.actor,OWNER,WORKSPACE,terminal.work.reservationId,terminal.work.renderJobId,
      terminal.target.daily_plan_slot_id,terminal.target.attempt,terminal.target.work_handoff_digest];
    await assert.rejects(session.query(claimTerminalSql,
      [...prefix.slice(0,9),"26000000-0000-4000-8000-00000000001d",...prefix.slice(10),
        "exact-one-video-worker",60_000]),
    (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="42501");
    const noWrongClaim=await adminPool.query("SELECT id FROM ai_media_provider_terminal_checks");
    assert.equal(noWrongClaim.rowCount,0);
    const first=await session.query<Record<string,unknown>>(claimTerminalSql,
      [...prefix,"exact-one-video-worker",60_000]);
    assert.equal(first.rowCount,1);assertIdentity(first.rows[0],terminal);
    const terminalReleaseObservedAt=new Date().toISOString();
    const released=await session.query<Record<string,unknown>>(releaseTerminalSql,
      [...prefix,first.rows[0].id,first.rows[0].lease_token,first.rows[0].fencing_token,
        "processing",terminalReleaseObservedAt,digest("c")]);
    assert.equal(released.rows[0]?.applied,true);assertIdentity(released.rows[0],terminal);
    const releasedReplay=await session.query<Record<string,unknown>>(releaseTerminalSql,
      [...prefix,first.rows[0].id,first.rows[0].lease_token,first.rows[0].fencing_token,
        "processing",terminalReleaseObservedAt,digest("c")]);
    assert.equal(releasedReplay.rows[0]?.applied,true);assertIdentity(releasedReplay.rows[0],terminal);
    await waitForTerminalDue(String(first.rows[0].id));
    const reclaimed=await session.query<Record<string,unknown>>(claimTerminalSql,
      [...prefix,"exact-one-video-worker",60_000]);
    assert.equal(reclaimed.rowCount,1);assertIdentity(reclaimed.rows[0],terminal);
    assert.equal(reclaimed.rows[0].id,first.rows[0].id);
    assert.equal(reclaimed.rows[0].fencing_token,"2");
    assert.notEqual(reclaimed.rows[0].lease_token,first.rows[0].lease_token);
    const terminalTail=[first.rows[0].id,first.rows[0].submission_attempt_id,
      first.rows[0].submission_fencing_token,first.rows[0].lease_token,first.rows[0].fencing_token,
      first.rows[0].send_authorization_digest,first.rows[0].provider_account_id,first.rows[0].provider_key,
      first.rows[0].provider_credential_version,first.rows[0].provider_job_id,"completed",
      "artifact-ref-pr34","https://media.example.com/pr34/video.mp4",new Date().toISOString(),digest("d")];
    const stale=await session.query<Record<string,unknown>>(recordTerminalSql,[...prefix,...terminalTail]);
    assert.equal(stale.rows[0]?.outcome,"rejected");assertIdentity(stale.rows[0],terminal);
    const observedAt=new Date().toISOString(),providerEvidence=digest("e");
    const currentTail=[reclaimed.rows[0].id,reclaimed.rows[0].submission_attempt_id,
      reclaimed.rows[0].submission_fencing_token,reclaimed.rows[0].lease_token,
      reclaimed.rows[0].fencing_token,reclaimed.rows[0].send_authorization_digest,
      reclaimed.rows[0].provider_account_id,reclaimed.rows[0].provider_key,
      reclaimed.rows[0].provider_credential_version,reclaimed.rows[0].provider_job_id,"completed",
      "artifact-ref-pr34","https://media.example.com/pr34/video.mp4",observedAt,providerEvidence];
    const applied=await session.query<Record<string,unknown>>(recordTerminalSql,[...prefix,...currentTail]);
    assert.equal(applied.rows[0]?.outcome,"applied");assert.ok(applied.rows[0]?.terminal_event_id);
    assert.ok(applied.rows[0]?.ingest_job_id);assertIdentity(applied.rows[0],terminal);
    const duplicate=await session.query<Record<string,unknown>>(recordTerminalSql,[...prefix,...currentTail]);
    assert.equal(duplicate.rows[0]?.outcome,"replayed");
    assert.equal(duplicate.rows[0]?.terminal_event_id,applied.rows[0]?.terminal_event_id);
    assert.equal(duplicate.rows[0]?.ingest_job_id,applied.rows[0]?.ingest_job_id);
    assertIdentity(duplicate.rows[0],terminal);
    const mismatched=await session.query<Record<string,unknown>>(recordTerminalSql,
      [...prefix,...currentTail.slice(0,-1),digest("f")]);
    assert.equal(mismatched.rows[0]?.outcome,"conflict");assertIdentity(mismatched.rows[0],terminal);
    await completeAction(session,terminal,"completed");
    const ledger=await adminPool.query<{terminal_events:string;ingest_jobs:string;capacity:string;capacity_version:string;
      committed:string;job_stage:string;publishing_surface_absent:boolean}>(`SELECT
      count(DISTINCT event.id)::text terminal_events,count(DISTINCT ingest.id)::text ingest_jobs,
      capacity.state capacity,capacity.state_version::text capacity_version,
      bucket.committed_micro_usd::text committed,job.stage job_stage,
      to_regclass('public.ai_media_publishing_jobs') IS NULL publishing_surface_absent
      FROM ai_media_provider_submission_attempts attempt
      JOIN ai_media_render_jobs job ON job.id=attempt.render_job_id
      JOIN ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
      JOIN ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      LEFT JOIN ai_media_provider_terminal_events event ON event.submission_attempt_id=attempt.id
      LEFT JOIN ai_media_asset_ingest_jobs ingest ON ingest.render_job_id=attempt.render_job_id
      WHERE attempt.id=$1 GROUP BY capacity.state,capacity.state_version,bucket.committed_micro_usd,job.stage`,
    [terminal.attempt.id]);
    assert.deepEqual(ledger.rows,[{terminal_events:"1",ingest_jobs:"1",capacity:"released",capacity_version:"2",
      committed:"1250000",job_stage:"artifact_ingest_queued",publishing_surface_absent:true}]);
    const rollbackClient=await adminPool.connect();try{
      await assert.rejects(rollbackClient.query(pr34Rollback),
        /rollback preserves exact one-video reconciliation and terminal evidence/u);
      await rollbackClient.query("ROLLBACK");
    }finally{rollbackClient.release();}
  }finally{await session.close();}
});
