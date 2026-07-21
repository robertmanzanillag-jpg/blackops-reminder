import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after, before } from "node:test";
import { Pool, type PoolClient } from "pg";

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
const OWNER="owner-pr27",WORKSPACE="personal",RECONCILE="ai_media_admitted_reconcile_executor";
const digest=(c:string)=>`sha256:${c.repeat(64)}`;
const uuid=(n:number)=>`27000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

before(async()=>{if(!enabled)return;await pool.query(`DO $roles$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ai_media_admitted_fn_owner') THEN
    CREATE ROLE ai_media_admitted_fn_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ai_media_admitted_submit_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ai_media_admitted_reconcile_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $roles$`);await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  await pool.query(fixture);await pool.query(`CREATE TABLE public.ai_media_assets(
    id uuid PRIMARY KEY,owner_user_id text NOT NULL,workspace_id text NOT NULL,kind text NOT NULL,
    checksum text,deleted_at timestamptz);
    ALTER TABLE public.ai_media_render_jobs ADD COLUMN output_url text,ADD COLUMN error_code text,
      ADD COLUMN error_message text,ADD COLUMN completed_at timestamptz`);
  for(const forward of forwards.slice(0,-1))await pool.query(forward);
  await pool.query(`INSERT INTO public.ai_media_admitted_worker_capabilities(id,database_principal,owner_user_id,
    workspace_id,lane,accounting_time_zone,worker_id,allowed_operations,max_lease_ms,max_batch_size,valid_from,
    expires_at,revoked_at,evidence_digest) VALUES($1,$2,'historical-owner','personal','reconcile','UTC',
    'legacy-terminal-worker',ARRAY['release_terminal_capacity'],300000,10,clock_timestamp()-interval '2 hours',
    clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour',$3)`,[uuid(250),RECONCILE,digest("8")]);
  await pool.query(forwards.at(-1)!);
});
after(async()=>{await pool.end();});

integrationTest("PR27 DDL installs on exact PR26 and exposes only three reconciler entrypoints",async()=>{
  const surfaces=await pool.query<{checks:boolean;events:boolean;record:boolean;claim:boolean;release:boolean}>(`SELECT
    to_regclass('public.ai_media_provider_terminal_checks') IS NOT NULL checks,
    to_regclass('public.ai_media_provider_terminal_events') IS NOT NULL events,
    to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NOT NULL record,
    to_regprocedure('ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer)') IS NOT NULL claim,
    to_regprocedure('ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,timestamptz,text)') IS NOT NULL release`);
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
  const legacy=await pool.query<{revoked:boolean;executable:boolean}>(`SELECT revoked_at IS NOT NULL revoked,
    has_function_privilege($1,'ai_media_worker_api.release_terminal_capacity_v1(uuid,text,text,uuid,uuid,text,text,text)','EXECUTE') executable
    FROM public.ai_media_admitted_worker_capabilities WHERE id=$2`,[RECONCILE,uuid(250)]);
  assert.deepEqual(legacy.rows,[{revoked:true,executable:false}]);
});

integrationTest("PR27 exact tenant render FK rejects cross-workspace ingest",async()=>{
  const constraint=await pool.query<{validated:boolean}>(`SELECT convalidated validated FROM pg_constraint
    WHERE conname='ai_media_asset_ingest_jobs_exact_render_fk'`);
  assert.deepEqual(constraint.rows,[{validated:true}]);
});

async function seedConfirmedTuple(db:PoolClient,index:number):Promise<{attempt:string;reservation:string;render:string;job:string}>{
  const base=index*20,attempt=uuid(base+1),reservation=uuid(base+2),render=uuid(base+3),outbox=uuid(base+4),
    slot=uuid(base+5),account=uuid(base+6),activation=uuid(base+7),influencer=uuid(base+8),avatar=uuid(base+9),
    voice=uuid(base+10),script=uuid(base+11),variant=uuid(base+12),snapshot=uuid(base+13),intent=uuid(base+14),
    governance=uuid(base+15),job=`provider-job-pr27-${index}`,checksum=String(index).repeat(64),auth=digest(String(index));
  await db.query(`INSERT INTO public.ai_media_daily_plan_slots(id,owner_user_id,workspace_id,public_slot_key,
      daily_plan_id,provider_account_id,provider_key,provider_credential_version,source_member_key,influencer_id,
      avatar_resource_id,voice_resource_id,script_variant_id,video_number,status,slot_digest,state_version)
    VALUES($1,$2,$3,$4,$5,$6,'heygen',1,$7,$8,$9,$10,$11,$12,'submitted',$13,1)`,
    [slot,OWNER,WORKSPACE,`slot_${String(index).repeat(24)}`,uuid(base+16),account,`member-${index}`,
      influencer,avatar,voice,variant,index,digest(String(index))]);
  await db.query(`INSERT INTO public.ai_media_render_jobs(id,owner_user_id,workspace_id,provider_account_id,
      provider_key,provider_job_id,idempotency_key,title,status,stage,progress,attempts,retry_count,max_attempts,
      request,governance_profile_id,governance_evidence_digest,budget_reservation_id,daily_plan_slot_id,slot_attempt,
      influencer_id,avatar_resource_id,voice_resource_id,script_id,script_variant_id,script_variant_checksum,
      authority_snapshot_id,authority_digest,launch_intent_id,launch_intent_digest,admission_digest,
      work_handoff_digest,sealed_request_digest,provider_credential_version,queued_at,available_at,lease_fencing,
      created_at,updated_at)
    VALUES($1,$2,$3,$4,'heygen',$5,$6,$7,'rendering','submitted',10,1,0,3,'{}',$8,$9,$10,$11,1,$12,$13,
      $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,1,clock_timestamp(),clock_timestamp(),1,
      clock_timestamp(),clock_timestamp())`,[render,OWNER,WORKSPACE,account,job,`render-${index}`,`Render ${index}`,
      governance,digest("a"),reservation,slot,influencer,avatar,voice,script,variant,checksum,snapshot,digest("b"),
      intent,digest("c"),digest("d"),digest("e"),digest("f")]);
  await db.query(`INSERT INTO public.ai_media_outbox(id,owner_user_id,workspace_id,idempotency_key,aggregate_type,
      aggregate_id,event_type,budget_reservation_id,render_job_id,work_handoff_digest,sealed_request_digest,payload,
      status,attempts,available_at,fencing_token,processed_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,'render_job',$5,'render.requested',$6,$7,$8,$9,'{}','dispatched',1,clock_timestamp(),1,
      clock_timestamp(),clock_timestamp(),clock_timestamp())`,
    [outbox,OWNER,WORKSPACE,`outbox-${index}`,render,reservation,render,digest("e"),digest("f")]);
  await db.query(`INSERT INTO public.ai_media_budget_reservations(id,owner_user_id,workspace_id,budget_bucket_id,
      daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version,attempt,state,submission_state,
      amount_micro_usd,currency,idempotency_key,input_digest,admission_digest,script_variant_checksum,quote_digest,
      quote_expires_at,content_approval_digest,human_launch_approval_digest,governance_profile_id,
      governance_evidence_digest,policy_digest,kill_switch_evidence_digest,sandbox_evidence_digest,
      provider_idempotency_key,render_job_id,dispatch_outbox_id,reserved_at,expires_at,committed_at,
      commit_evidence_digest,authority_snapshot_id,authority_digest,work_handoff_digest,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,'heygen',1,1,'committed','confirmed',100,'USD',$7,$8,$9,$10,$11,
      clock_timestamp()+interval '2 hours',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
      clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '5 minutes',
      $22,$23,$24,$25,clock_timestamp(),clock_timestamp())`,
    [reservation,OWNER,WORKSPACE,uuid(200),slot,account,`budget-reservation-${index}`,digest("3"),digest("d"),
      checksum,digest("4"),digest("5"),digest("6"),governance,digest("a"),digest("7"),digest("8"),digest("9"),
      `provider-idem-${index}`,render,outbox,digest("1"),snapshot,digest("b"),digest("e")]);
  await db.query(`INSERT INTO public.ai_media_provider_submission_attempts(id,owner_user_id,workspace_id,
      budget_reservation_id,work_activation_id,render_job_id,dispatch_outbox_id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,provider_idempotency_key,
      avatar_external_resource_id,voice_external_resource_id,script_variant_checksum,authority_snapshot_id,
      work_handoff_digest,sealed_request_digest,authority_digest,launch_intent_id,launch_intent_digest,
      admission_digest,state,fencing_token,claim_count,commit_evidence_digest,send_authorization_digest,
      confirmed_evidence_digest,provider_job_id,claimed_at,authorized_at,confirmed_at,actor_user_id,input_digest,
      created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,'heygen',1,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      'confirmed',1,1,$21,$22,$23,$24,clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '2 minutes',
      clock_timestamp()-($25::text||' minutes')::interval,'seed-pr27',$26,clock_timestamp(),clock_timestamp())`,
    [attempt,OWNER,WORKSPACE,reservation,activation,render,outbox,slot,account,`idem-pr27-${index}`,
      `avatar-${index}`,`voice-${index}`,checksum,snapshot,digest("e"),digest("f"),digest("b"),intent,digest("c"),
      digest("d"),digest("1"),auth,digest("2"),job,4-index,digest("3")]);
  await db.query(`INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,
      submission_attempt_id,budget_reservation_id,sequence,event_kind,fencing_token,evidence_digest,
      provider_job_id,actor_user_id,observed_at,created_at)
    VALUES($1,$2,$3,$4,1,'confirmed',1,$5,$6,'seed-pr27',clock_timestamp(),clock_timestamp())`,
    [OWNER,WORKSPACE,attempt,reservation,digest("2"),job]);
  await db.query(`INSERT INTO public.ai_media_submission_capacity_leases(owner_user_id,workspace_id,
      budget_reservation_id,provider_account_id,provider_key,submission_attempt_id,state,held_at,actor_user_id)
    VALUES($1,$2,$3,$4,'heygen',$5,'held',clock_timestamp(),'seed-pr27')`,
    [OWNER,WORKSPACE,reservation,account,attempt]);
  return{attempt,reservation,render,job};
}

integrationTest("PR27 functionally fences terminal checks and atomically records completed, failed, replay, conflict, and rollback",async()=>{
  const admin=await pool.connect();try{
    await admin.query("SET session_replication_role=replica");
    await admin.query(`INSERT INTO public.ai_media_budget_buckets(id,owner_user_id,workspace_id,budget_date,
      accounting_time_zone,currency,limit_micro_usd,reserved_micro_usd,committed_micro_usd,policy_digest,
      policy_version,state_version,created_at,updated_at)
      VALUES($1,$2,$3,(clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC','USD',1000,0,400,$4,1,1,
        clock_timestamp(),clock_timestamp())`,[uuid(200),OWNER,WORKSPACE,digest("7")]);
    const completed=await seedConfirmedTuple(admin,1),failed=await seedConfirmedTuple(admin,2),
      rollbackWork=await seedConfirmedTuple(admin,3),retryWork=await seedConfirmedTuple(admin,4);
    await admin.query("SET session_replication_role=origin");
    const capability=uuid(99);
    await pool.query(`INSERT INTO public.ai_media_admitted_worker_capabilities(id,database_principal,
      owner_user_id,workspace_id,lane,accounting_time_zone,worker_id,allowed_operations,max_lease_ms,
      max_batch_size,valid_from,expires_at,evidence_digest)
      VALUES($1,$2,$3,$4,'reconcile','UTC','terminal-worker',ARRAY['claim_terminal_check',
        'release_terminal_check_unknown','record_provider_terminal'],300000,10,clock_timestamp()-interval '1 minute',
        clock_timestamp()+interval '1 hour',$5)`,[capability,RECONCILE,OWNER,WORKSPACE,digest("9")]);
    await pool.query(`INSERT INTO public.ai_media_asset_ingest_jobs(owner_user_id,workspace_id,render_job_id,
      provider_key,remote_artifact_ref,remote_url,expected_mime_type)
      VALUES($1,$2,$3,'heygen','preexisting:collision','https://files.heygen.com/collision.mp4','video/mp4')`,
      [OWNER,WORKSPACE,rollbackWork.render]);
    const worker=await pool.connect();try{
      await worker.query(`SET SESSION AUTHORIZATION ${RECONCILE}`);
      await assert.rejects(worker.query("SELECT * FROM ai_media_worker_api.claim_terminal_check_v1($1,$2,$3,$4,$5)",
        [capability,"cross-owner",WORKSPACE,"terminal-worker",60000]),(error:unknown)=>
        typeof error==="object"&&error!==null&&"code" in error&&error.code==="42501");
      const claim=async()=>{const result=await worker.query<Record<string,unknown>>(
        "SELECT * FROM ai_media_worker_api.claim_terminal_check_v1($1,$2,$3,$4,$5)",
        [capability,OWNER,WORKSPACE,"terminal-worker",60000]);assert.equal(result.rowCount,1);return result.rows[0];};
      const terminal=async(c:Record<string,unknown>,state:"completed"|"failed",evidence:string,ref:string|null,url:string|null)=>
        worker.query<{outcome:string;terminal_event_id:string|null;ingest_job_id:string|null}>(
          "SELECT * FROM ai_media_worker_api.record_provider_terminal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
          [capability,OWNER,WORKSPACE,c.id,c.submission_attempt_id,c.submission_fencing_token,c.lease_token,
            c.fencing_token,c.send_authorization_digest,c.provider_account_id,c.provider_key,
            c.provider_credential_version,c.provider_job_id,state,ref,url,new Date().toISOString(),evidence]);
      const first=await claim();assert.equal(first.submission_attempt_id,completed.attempt);
      const stale={...first,fencing_token:"0"};assert.deepEqual((await terminal(stale,"completed",digest("4"),
        `heygen:v3:${completed.job}`,"https://files.heygen.com/completed.mp4")).rows[0]?.outcome,"rejected");
      const applied=(await terminal(first,"completed",digest("4"),`heygen:v3:${completed.job}`,
        "https://files.heygen.com/completed.mp4")).rows[0];assert.equal(applied.outcome,"applied");
      const replay=(await terminal(first,"completed",digest("4"),`heygen:v3:${completed.job}`,
        "https://files.heygen.com/completed.mp4")).rows[0];assert.equal(replay.outcome,"replayed");
      const conflict=(await terminal(first,"completed",digest("5"),`heygen:v3:${completed.job}`,
        "https://files.heygen.com/completed.mp4")).rows[0];assert.equal(conflict.outcome,"conflict");
      const second=await claim();assert.equal(second.submission_attempt_id,failed.attempt);
      assert.equal((await terminal(second,"failed",digest("6"),null,null)).rows[0].outcome,"applied");
      const third=await claim();assert.equal(third.submission_attempt_id,rollbackWork.attempt);
      await assert.rejects(terminal(third,"completed",digest("7"),`heygen:v3:${rollbackWork.job}`,
        "https://files.heygen.com/rollback.mp4"));
      const fourth=await claim();assert.equal(fourth.submission_attempt_id,retryWork.attempt);
      const retryObservedAt="2026-07-21T20:00:00.000Z",retryEvidence=digest("8");
      const rescheduled=await worker.query<{applied:boolean}>(
        "SELECT * FROM ai_media_worker_api.release_terminal_check_unknown_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [capability,OWNER,WORKSPACE,fourth.id,fourth.lease_token,fourth.fencing_token,"processing",
          retryObservedAt,retryEvidence]);
      assert.deepEqual(rescheduled.rows,[{applied:true}]);
      const retryEvidenceRow=await pool.query<{state:string;reason:string;observed:string;evidence:string;due:boolean}>(`SELECT
        state,last_retry_reason reason,to_char(last_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed,
        last_evidence_digest evidence,next_check_at>clock_timestamp() due
        FROM public.ai_media_provider_terminal_checks WHERE id=$1`,[fourth.id]);
      assert.deepEqual(retryEvidenceRow.rows,[{state:"pending",reason:"processing",observed:retryObservedAt,
        evidence:retryEvidence,due:true}]);
    }finally{await worker.query("RESET SESSION AUTHORIZATION").catch(()=>undefined);worker.release();}
    const ledger=await pool.query<{attempt:string;capacity:string;version:string;events:string;ingests:string;
      stage:string;status:string;slot_status:string}>(`SELECT attempt.id::text attempt,capacity.state capacity,
      capacity.state_version::text version,count(DISTINCT terminal.id)::text events,
      count(DISTINCT ingest.id)::text ingests,job.stage,job.status,slot.status slot_status
      FROM public.ai_media_provider_submission_attempts attempt
      JOIN public.ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
      JOIN public.ai_media_render_jobs job ON job.id=attempt.render_job_id
      JOIN public.ai_media_daily_plan_slots slot ON slot.id=attempt.daily_plan_slot_id
      LEFT JOIN public.ai_media_provider_terminal_events terminal ON terminal.submission_attempt_id=attempt.id
      LEFT JOIN public.ai_media_asset_ingest_jobs ingest ON ingest.render_job_id=attempt.render_job_id
      GROUP BY attempt.id,capacity.state,capacity.state_version,job.stage,job.status,slot.status ORDER BY attempt.id`);
    assert.deepEqual(ledger.rows,[
      {attempt:completed.attempt,capacity:"released",version:"2",events:"1",ingests:"1",stage:"artifact_ingest_queued",status:"rendering",slot_status:"submitted"},
      {attempt:failed.attempt,capacity:"released",version:"2",events:"1",ingests:"0",stage:"failed",status:"failed",slot_status:"failed"},
      {attempt:rollbackWork.attempt,capacity:"held",version:"1",events:"0",ingests:"1",stage:"submitted",status:"rendering",slot_status:"submitted"},
      {attempt:retryWork.attempt,capacity:"held",version:"1",events:"0",ingests:"0",stage:"submitted",status:"rendering",slot_status:"submitted"},
    ]);
    const money=await pool.query<{committed:string;reservation_states:string[]}>(`SELECT
      bucket.committed_micro_usd::text committed,array_agg(reservation.state ORDER BY reservation.id) reservation_states
      FROM public.ai_media_budget_buckets bucket JOIN public.ai_media_budget_reservations reservation
        ON reservation.budget_bucket_id=bucket.id WHERE bucket.id=$1 GROUP BY bucket.committed_micro_usd`,[uuid(200)]);
    assert.deepEqual(money.rows,[{committed:"400",reservation_states:["committed","committed","committed","committed"]}]);
    await pool.query(`UPDATE public.ai_media_render_jobs SET stage='artifact_ingest_retrying',updated_at=clock_timestamp()
      WHERE id=$1`,[completed.render]);
    await pool.query(`INSERT INTO public.ai_media_assets(id,owner_user_id,workspace_id,kind)
      VALUES($1,$2,$3,'video')`,[uuid(120),OWNER,WORKSPACE]);
    await pool.query(`UPDATE public.ai_media_render_jobs SET stage='completed',status='completed',progress=100,
      output_media_asset_id=$2,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
      [completed.render,uuid(120)]);
    const attached=await pool.query<{stage:string;status:string;progress:number;asset:string}>(`SELECT stage,status,
      progress,output_media_asset_id::text asset FROM public.ai_media_render_jobs WHERE id=$1`,[completed.render]);
    assert.deepEqual(attached.rows,[{stage:"completed",status:"completed",progress:100,asset:uuid(120)}]);
    const replayedAttach=await pool.query(`UPDATE public.ai_media_render_jobs SET output_media_asset_id=$2,
      updated_at=clock_timestamp() WHERE id=$1`,[completed.render,uuid(120)]);
    assert.equal(replayedAttach.rowCount,1,"attachRenderOutput replay must be idempotent after service completion");
  }finally{await admin.query("SET session_replication_role=origin").catch(()=>undefined);admin.release();}
});

integrationTest("PR27 rollback removes mutation entrypoints but retains empty evidence schema",async()=>{
  await pool.query(`UPDATE public.ai_media_admitted_worker_capabilities SET revoked_at=clock_timestamp()
    WHERE revoked_at IS NULL AND allowed_operations && ARRAY['claim_terminal_check',
      'release_terminal_check_unknown','record_provider_terminal']::text[]`);
  await pool.query(rollback);
  const retained=await pool.query<{checks:boolean;events:boolean;record:boolean;ingest_fk:boolean}>(`SELECT
    to_regclass('public.ai_media_provider_terminal_checks') IS NOT NULL checks,
    to_regclass('public.ai_media_provider_terminal_events') IS NOT NULL events,
    to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NOT NULL record,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ai_media_asset_ingest_jobs_exact_render_fk') ingest_fk`);
  assert.deepEqual(retained.rows,[{checks:true,events:true,record:false,ingest_fk:true}]);
  const postRollbackReplay=await pool.query(`UPDATE public.ai_media_render_jobs SET output_media_asset_id=$2,
    updated_at=clock_timestamp() WHERE id=$1`,[uuid(23),uuid(120)]);
  assert.equal(postRollbackReplay.rowCount,1,"retained guards need read-only terminal evidence after rollback");
});
