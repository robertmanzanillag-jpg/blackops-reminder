import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after, before } from "node:test";
import { Pool, type PoolClient } from "pg";
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
import {
  DrizzleAdmittedRenderRepository,
  type AdmittedRenderTransactionalDatabase,
} from "../server/ai-media-studio/workers/drizzle-admitted-render-repository";
import type { ExactNegativeSubmissionFinality } from "../server/ai-media-studio/workers/admitted-render-contracts";

const TEMP_PREFIX = "ams-pr21-pg-";
const TEST_DATABASE_NAME = "ams_pr21_test";
const OWNER = "owner-pr21";
const WORKSPACE = "workspace-pr21";
const SCRIPT_CONTENT = "Approved launch script for the isolated PostgreSQL admission test.";
const SCRIPT_CHECKSUM = createHash("sha256").update(SCRIPT_CONTENT).digest("hex");
const ids = {
  account: "10000000-0000-4000-8000-000000000001",
  influencer: "10000000-0000-4000-8000-000000000002",
  avatar: "10000000-0000-4000-8000-000000000003",
  alternateAvatar: "10000000-0000-4000-8000-000000000019",
  voice: "10000000-0000-4000-8000-000000000004",
  script: "10000000-0000-4000-8000-000000000005",
  sourceItem: "10000000-0000-4000-8000-000000000013",
  variant: "10000000-0000-4000-8000-000000000006",
  governance: "10000000-0000-4000-8000-000000000007",
  plan: "10000000-0000-4000-8000-000000000008",
  slot: "10000000-0000-4000-8000-000000000009",
  bucket: "10000000-0000-4000-8000-00000000000a",
  policy: "10000000-0000-4000-8000-00000000000b",
  killSwitch: "10000000-0000-4000-8000-00000000000c",
  contentEvidence: "10000000-0000-4000-8000-00000000000d",
  humanEvidence: "10000000-0000-4000-8000-00000000000e",
  sandboxEvidence: "10000000-0000-4000-8000-00000000000f",
  quoteEvidence: "10000000-0000-4000-8000-000000000010",
  snapshot: "10000000-0000-4000-8000-000000000011",
  reservation: "10000000-0000-4000-8000-000000000012",
  authorityReservation: "10000000-0000-4000-8000-00000000001a",
  launchIntent: "10000000-0000-4000-8000-000000000014",
  launchIntent2: "10000000-0000-4000-8000-000000000015",
  launchIntent4: "10000000-0000-4000-8000-000000000016",
  renderJob: "10000000-0000-4000-8000-000000000017",
  outbox: "10000000-0000-4000-8000-000000000018",
} as const;

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function activationPrincipal(actorUserId:string):TrustedActivationPrincipal {
  return { capability:"activate-held-work",actorUserId } as unknown as TrustedActivationPrincipal;
}

function testTemporaryDirectory(): string {
  return process.platform === "darwin" ? "/private/tmp" : tmpdir();
}

function requireSafeTestDatabaseUrl(): string {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for the isolated PostgreSQL suite");
  if (process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL must be absent from the isolated PostgreSQL suite");
  if (testDatabaseUrl === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must never equal DATABASE_URL");

  const parsed = new URL(testDatabaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.hostname, "localhost", "the URI authority must remain local");
  assert.equal(parsed.username, "postgres", "the isolated URL must select only its ephemeral cluster owner");
  assert.equal(parsed.password, "", "the isolated URL must not contain credentials");
  assert.equal(parsed.pathname, `/${TEST_DATABASE_NAME}`);
  assert.equal(parsed.searchParams.get("port"), "55432");
  const socketDirectory = parsed.searchParams.get("host");
  assert.ok(socketDirectory, "the isolated URL must select its Unix socket explicitly");

  const resolvedSocket = realpathSync(socketDirectory);
  const resolvedRoot = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot), realpathSync(testTemporaryDirectory()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX));
  assert.equal(basename(resolvedSocket), "socket");
  return testDatabaseUrl;
}

const postgresHarnessEnabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest = postgresHarnessEnabled ? test : test.skip;
const testDatabaseUrl = postgresHarnessEnabled
  ? requireSafeTestDatabaseUrl()
  : "postgresql://postgres@localhost/ams_pr21_disabled";
const pool = new Pool({ connectionString: testDatabaseUrl, max: 20, allowExitOnIdle: true });
const prerequisite = readFileSync(new URL("./fixtures/ai-media-studio-pr21-prerequisite.sql", import.meta.url), "utf8");
const pr19Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr19_daily_admission_forward.sql",
  import.meta.url,
), "utf8");
const pr19Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr19_daily_admission_rollback.sql",
  import.meta.url,
), "utf8");
const pr20Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr20_launch_authorities_forward.sql",
  import.meta.url,
), "utf8");
const pr20Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr20_launch_authorities_rollback.sql",
  import.meta.url,
), "utf8");
const pr22Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr22_launch_intents_forward.sql",
  import.meta.url,
), "utf8");
const pr22Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr22_launch_intents_rollback.sql",
  import.meta.url,
), "utf8");
const pr23Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr23_admission_held_handoff_forward.sql",
  import.meta.url,
), "utf8");
const pr23Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr23_admission_held_handoff_rollback.sql",
  import.meta.url,
), "utf8");
const pr24Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr24_held_activation_forward.sql",
  import.meta.url,
), "utf8");
const pr24Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr24_held_activation_rollback.sql",
  import.meta.url,
), "utf8");
const pr25Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr25_admitted_worker_forward.sql", import.meta.url,
), "utf8");
const pr25Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr25_admitted_worker_rollback.sql", import.meta.url,
), "utf8");

async function seedAuthorityGraph(): Promise<void> {
  await pool.query(`
    INSERT INTO ai_media_provider_accounts
      (id,owner_user_id,workspace_id,provider_key,credential_version,status,credential_status)
    VALUES ('${ids.account}','${OWNER}','${WORKSPACE}','heygen',1,'active','active');
    INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,status)
    VALUES
      ('${ids.avatar}','${OWNER}','${WORKSPACE}','${ids.account}','heygen','avatar','avatar-external-pr25','active'),
      ('${ids.alternateAvatar}','${OWNER}','${WORKSPACE}','${ids.account}','heygen','avatar','avatar-alternate-pr25','active'),
      ('${ids.voice}','${OWNER}','${WORKSPACE}','${ids.account}','heygen','voice','voice-external-pr25','active');
    INSERT INTO ai_media_influencers (id,owner_user_id,workspace_id,status)
    VALUES ('${ids.influencer}','${OWNER}','${WORKSPACE}','active');
    INSERT INTO ai_media_source_items
      (id,owner_user_id,workspace_id,source_type,external_id,content_hash,status,rights_status,moderation_status)
    VALUES ('${ids.sourceItem}','${OWNER}','${WORKSPACE}','rss','source-pr21','${digest("9")}',
      'ready','owned','approved');
    INSERT INTO ai_media_scripts
      (id,owner_user_id,workspace_id,influencer_id,source_type,source_item_id,title,language,status,current_variant_id)
    VALUES ('${ids.script}','${OWNER}','${WORKSPACE}','${ids.influencer}','rss','${ids.sourceItem}','Launch','en','approved',
      '${ids.variant}');
    INSERT INTO ai_media_script_variants
      (id,owner_user_id,workspace_id,script_id,content,checksum,status)
    VALUES ('${ids.variant}','${OWNER}','${WORKSPACE}','${ids.script}','${SCRIPT_CONTENT}',
      '${SCRIPT_CHECKSUM}','approved');
    INSERT INTO ai_media_governance_profiles
      (id,owner_user_id,workspace_id,influencer_id,avatar_resource_id,voice_resource_id,version,evidence_digest,
       state,valid_from,expires_at,allowed_uses,territories)
    VALUES ('${ids.governance}','${OWNER}','${WORKSPACE}','${ids.influencer}','${ids.avatar}','${ids.voice}',1,'${digest("2")}',
      'active',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','["marketing"]','["WORLDWIDE"]');
    INSERT INTO ai_media_daily_plans
      (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
       source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
       idempotency_key,input_digest,plan_digest,created_at,updated_at)
    VALUES ('${ids.plan}','${OWNER}','${WORKSPACE}','plan_${"3".repeat(24)}','${ids.account}','heygen',1,
      'launch-roster','${digest("3")}',(statement_timestamp() AT TIME ZONE 'UTC')::date,'UTC','planned',1,
      'plan-pr21-idempotency','${digest("4")}','${digest("5")}',statement_timestamp(),statement_timestamp());
    INSERT INTO ai_media_daily_plan_slots
      (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
       provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
       script_variant_id,video_number,status,slot_digest,state_version)
    VALUES ('${ids.slot}','${OWNER}','${WORKSPACE}','slot_${"4".repeat(24)}','${ids.plan}','${ids.account}',
      'heygen',1,'member-pr21','${ids.influencer}','${ids.avatar}','${ids.voice}','${ids.variant}',1,
      'planned','${digest("6")}',1);
    INSERT INTO ai_media_admission_policy_revisions
      (id,owner_user_id,workspace_id,revision,daily_budget_micro_usd,total_concurrency,provider_concurrency,
       tenant_concurrency,allowed_languages,allowed_countries,allowed_time_zones,state,valid_from,expires_at,
       policy_digest,evidence_digest,input_digest,actor_user_id,idempotency_key)
    VALUES ('${ids.policy}','${OWNER}','${WORKSPACE}',1,5000000,10,10,10,'["en"]','["US"]','["UTC"]',
      'active',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','${digest("7")}',
      '${digest("8")}','${digest("9")}','actor-pr21','policy-pr21-revision-1');
    INSERT INTO ai_media_kill_switch_revisions
      (id,owner_user_id,workspace_id,revision,active,valid_from,expires_at,reason,evidence_digest,input_digest,
       actor_user_id,idempotency_key)
    VALUES ('${ids.killSwitch}','${OWNER}','${WORKSPACE}',1,false,clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '1 hour','launch enabled','${digest("a")}','${digest("b")}',
      'actor-pr21','kill-pr21-revision-1');
    INSERT INTO ai_media_budget_buckets
      (id,owner_user_id,workspace_id,budget_date,accounting_time_zone,currency,limit_micro_usd,
       reserved_micro_usd,committed_micro_usd,policy_digest,policy_version,state_version,created_at,updated_at)
    VALUES ('${ids.bucket}','${OWNER}','${WORKSPACE}',(statement_timestamp() AT TIME ZONE 'UTC')::date,'UTC',
      'USD',5000000,0,0,'${digest("7")}',1,1,statement_timestamp(),statement_timestamp());
    INSERT INTO ai_media_launch_intents
      (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,provider_account_id,
       provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,
       source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,
       source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
       governance_territory,content_country,launch_subject_digest,launch_intent_digest,actor_user_id,
       input_digest,idempotency_key)
    VALUES ('${ids.launchIntent}','${OWNER}','${WORKSPACE}','${ids.plan}','${ids.slot}',1,'${ids.account}',
      'heygen',1,'${digest("5")}','${digest("6")}','launch-roster','${digest("3")}','member-pr21',
      '${ids.script}','${ids.variant}','${SCRIPT_CHECKSUM}','rss','${ids.sourceItem}','${digest("9")}',
      '${ids.governance}','${digest("2")}','marketing','WORLDWIDE','US','${digest("0")}',
      '${digest("9")}','actor-pr21','${digest("8")}','launch-intent-pr21-attempt-1');
  `);

  const evidence = [
    [ids.contentEvidence, "content_approval", "approved", null, null, null, null,
      digest("c"), "content-pr21-revision-1"],
    [ids.humanEvidence, "human_launch_approval", "approved", null, null, null, null,
      digest("d"), "human-pr21-revision-1"],
    [ids.sandboxEvidence, "sandbox_proof", "passed", null, null, "sandbox-attestation-pr21", digest("6"),
      digest("e"), "sandbox-pr21-revision-1"],
    [ids.quoteEvidence, "maximum_quote", "quoted", "1250000", "USD", "maximum-quote-attestation-pr21", digest("7"),
      digest("f"), "quote-pr21-revision-1"],
  ] as const;
  for (const [id, kind, decision, amount, currency, sourceAttestationId, sourceEvidenceDigest,
    evidenceDigest, idempotencyKey] of evidence) {
    await pool.query(`
      INSERT INTO ai_media_launch_evidence
        (id,owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,
         provider_credential_version,slot_attempt,script_variant_id,script_variant_checksum,
         governance_profile_id,governance_evidence_digest,governance_use,governance_territory,
         content_country,launch_subject_digest,launch_intent_id,launch_intent_digest,
         evidence_kind,decision,amount_micro_usd,currency,revision,
         valid_from,expires_at,actor_user_id,source_kind,source_attestation_id,source_evidence_digest,
         evidence_digest,input_digest,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,'heygen',1,1,$6,$7,$8,$9,'marketing','WORLDWIDE','US',$10,$11,$12,$13,$14,$15,$16,1,
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','actor-pr21','pr21-test',
        $17,$18,$19,$20,$21)
    `, [id, OWNER, WORKSPACE, ids.slot, ids.account, ids.variant, SCRIPT_CHECKSUM, ids.governance,
      digest("2"), digest("0"), ids.launchIntent, digest("9"), kind, decision, amount, currency,
      sourceAttestationId, sourceEvidenceDigest, evidenceDigest, digest("1"), idempotencyKey]);
  }

  await pool.query(`
    INSERT INTO ai_media_launch_authority_snapshots
      (id,owner_user_id,workspace_id,daily_plan_id,plan_digest,daily_plan_slot_id,slot_digest,
       provider_account_id,provider_key,provider_credential_version,slot_attempt,script_variant_id,
       script_variant_checksum,governance_profile_id,governance_evidence_digest,governance_use,
       governance_territory,content_country,launch_subject_digest,content_approval_evidence_id,
       launch_intent_id,launch_intent_digest,
       content_approval_evidence_digest,human_launch_approval_evidence_id,human_launch_approval_evidence_digest,
       sandbox_evidence_id,sandbox_evidence_digest,maximum_quote_evidence_id,maximum_quote_evidence_digest,
       policy_revision_id,policy_revision,policy_digest,kill_switch_revision_id,kill_switch_revision,
       kill_switch_evidence_digest,maximum_quote_micro_usd,currency,valid_from,expires_at,admission_digest,
       authority_digest,input_digest,idempotency_key)
    VALUES ('${ids.snapshot}','${OWNER}','${WORKSPACE}','${ids.plan}','${digest("5")}','${ids.slot}',
      '${digest("6")}','${ids.account}','heygen',1,1,'${ids.variant}','${SCRIPT_CHECKSUM}','${ids.governance}',
      '${digest("2")}','marketing','WORLDWIDE','US','${digest("0")}','${ids.contentEvidence}',
      '${ids.launchIntent}','${digest("9")}','${digest("c")}',
      '${ids.humanEvidence}','${digest("d")}','${ids.sandboxEvidence}','${digest("e")}',
      '${ids.quoteEvidence}','${digest("f")}','${ids.policy}',1,'${digest("7")}','${ids.killSwitch}',1,
      '${digest("a")}',1250000,'USD',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes',
      '${digest("3")}','${digest("4")}','${digest("5")}','snapshot-pr21-revision-1');
  `);
}

async function expectDatabaseError(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
  });
}

async function insertCompleteAttachedReservation(
  client:PoolClient,
  input:{ handoffDigest:string; renderJobId:string; outboxId:string; idempotencyKey:string },
):Promise<void> {
  await client.query(`
    INSERT INTO ai_media_budget_reservations
      (id,owner_user_id,workspace_id,budget_bucket_id,daily_plan_slot_id,provider_account_id,provider_key,
       provider_credential_version,attempt,state,submission_state,amount_micro_usd,currency,idempotency_key,
       input_digest,admission_digest,script_variant_checksum,quote_digest,quote_expires_at,
       content_approval_digest,human_launch_approval_digest,governance_profile_id,governance_evidence_digest,
       policy_digest,kill_switch_evidence_digest,sandbox_evidence_digest,provider_idempotency_key,
       reserved_at,expires_at,authority_snapshot_id,authority_digest,render_job_id,dispatch_outbox_id,
       work_handoff_digest)
    VALUES ($1,$2,$3,$4,$5,$6,'heygen',1,1,'reserved','not_started',1250000,'USD',$7,$8,$9,$10,$11,
      clock_timestamp()+interval '30 minutes',$12,$13,$14,$15,$16,$17,$18,'provider-pr21-idempotency',
      clock_timestamp(),clock_timestamp()+interval '10 minutes',$19,$20,$21,$22,$23)
  `,[ids.reservation,OWNER,WORKSPACE,ids.bucket,ids.slot,ids.account,input.idempotencyKey,digest("1"),
    digest("3"),SCRIPT_CHECKSUM,digest("f"),digest("c"),digest("d"),ids.governance,digest("2"),
    digest("7"),digest("a"),digest("e"),ids.snapshot,digest("4"),input.renderJobId,input.outboxId,
    input.handoffDigest]);
}

async function transactionInsert(statement: string, values: readonly unknown[]): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(statement, [...values]);
    await client.query("COMMIT");
    return "committed";
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
    throw error;
  } finally {
    client.release();
  }
}

async function assertReapplicationFails(client: PoolClient, migration: string): Promise<void> {
  try {
    await client.query(migration);
    assert.fail("an already-applied migration must fail its preflight");
  } catch (error) {
    assert.equal(typeof error === "object" && error !== null && "code" in error ? error.code : undefined, "P0001");
    await client.query("ROLLBACK");
  }
}

function rollbackAdmissionDatabase(): {
  db: DailyAdmissionTransactionalDatabase;
  inspection(): Record<string, unknown>;
} {
  const dialect = new PgDialect();
  let captured: Record<string, unknown> | undefined;
  const db: DailyAdmissionTransactionalDatabase = {
    async execute(_query: SQL) {
      throw new Error("Admission SQL must run inside its owned transaction");
    },
    async transaction<T>(callback: (tx: DailyAdmissionDatabase) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: DailyAdmissionDatabase = {
        async execute(query) {
          const compiled = dialect.sqlToQuery(query);
          return client.query(compiled.sql, compiled.params);
        },
      };
      try {
        await client.query("BEGIN");
        const result = await callback(tx);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const rows = await client.query<Record<string, unknown>>(`
          SELECT reservation.render_job_id, reservation.dispatch_outbox_id,
            reservation.work_handoff_digest, reservation.submission_state,
            job.stage AS render_stage, job.provider_job_id, job.lease_owner AS render_lease_owner,
            outbox.status AS outbox_status, outbox.lease_owner AS outbox_lease_owner
          FROM ai_media_budget_reservations reservation
          INNER JOIN ai_media_render_jobs job ON job.id=reservation.render_job_id
          INNER JOIN ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
          WHERE reservation.owner_user_id=$1 AND reservation.workspace_id=$2
            AND reservation.idempotency_key='real-repository-admission-pr23'
        `, [OWNER, WORKSPACE]);
        assert.equal(rows.rowCount, 1);
        captured = rows.rows[0];
        await client.query("ROLLBACK");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return {
    db,
    inspection() {
      if (!captured) throw new Error("Admission inspection was not captured");
      return captured;
    },
  };
}

before(async () => {
  if (!postgresHarnessEnabled) return;
  await pool.query(prerequisite);
  await pool.query(pr19Forward);
  await pool.query(pr20Forward);
  await pool.query(pr22Forward);
  await pool.query(pr23Forward);
  await pool.query(pr24Forward);
  await pool.query(pr25Forward);
  await seedAuthorityGraph();
});

after(async () => {
  if (!postgresHarnessEnabled) return;
  await pool.end();
});

integrationTest("PR21 runs only on the owned socket-only PostgreSQL 16 database", async () => {
  const result = await pool.query<{
    version_number: string;
    database_name: string;
    listen_addresses: string;
    socket_directories: string;
  }>(`
    SELECT current_setting('server_version_num') AS version_number,
      current_database() AS database_name,
      current_setting('listen_addresses') AS listen_addresses,
      current_setting('unix_socket_directories') AS socket_directories
  `);
  assert.match(result.rows[0].version_number, /^16\d{4}$/u);
  assert.equal(result.rows[0].database_name, TEST_DATABASE_NAME);
  assert.equal(result.rows[0].listen_addresses, "");
  assert.ok(result.rows[0].socket_directories.includes(TEMP_PREFIX));
});

integrationTest("real PostgreSQL installs the exact PR19 through PR25 schema controls", async () => {
  const tables = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN (
      'ai_media_daily_plans','ai_media_daily_plan_slots','ai_media_budget_buckets','ai_media_budget_reservations',
      'ai_media_admission_policy_revisions','ai_media_kill_switch_revisions','ai_media_launch_evidence',
      'ai_media_launch_authority_snapshots','ai_media_launch_intents','ai_media_work_activations',
      'ai_media_provider_submission_attempts','ai_media_provider_submission_events') ORDER BY table_name
  `);
  assert.equal(tables.rowCount, 12);

  const controls = await pool.query<{ constraint_name: string }>(`
    SELECT conname AS constraint_name FROM pg_constraint
    WHERE conname IN (
      'ai_media_budget_reservations_authority_snapshot_fk',
      'ai_media_launch_authority_snapshots_exact_slot_fk',
      'ai_media_launch_authority_snapshots_content_evidence_fk',
      'ai_media_launch_evidence_previous_fk',
      'ai_media_launch_evidence_launch_intent_fk',
      'ai_media_launch_authority_snapshots_launch_intent_fk')
  `);
  assert.equal(controls.rowCount, 6);

  const heldControls = await pool.query<{ constraint_name: string }>(`
    SELECT conname AS constraint_name FROM pg_constraint
    WHERE conname IN (
      'ai_media_budget_reservations_exact_render_job_fk',
      'ai_media_budget_reservations_exact_dispatch_outbox_fk',
      'ai_media_render_jobs_admission_held_ck',
      'ai_media_outbox_held_ck')
  `);
  assert.equal(heldControls.rowCount, 4);

  const triggers = await pool.query<{ trigger_name: string }>(`
    SELECT tgname AS trigger_name FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN (
      'ai_media_budget_reservations_transition_guard',
      'ai_media_budget_reservations_authority_immutable_guard',
      'ai_media_admission_policy_revisions_immutable_guard',
      'ai_media_kill_switch_revisions_immutable_guard',
      'ai_media_launch_evidence_immutable_guard',
      'ai_media_launch_authority_snapshots_immutable_guard',
      'ai_media_launch_intents_immutable_guard',
      'ai_media_render_jobs_admitted_submission_guard',
      'ai_media_outbox_admitted_submission_guard',
      'ai_media_work_activations_immutable_guard',
      'ai_media_work_activations_final_state_guard',
      'ai_media_budget_reservations_handoff_immutable_guard')
  `);
  assert.equal(triggers.rowCount, 12);
});

integrationTest("the real admission repository atomically creates one exact non-claimable held triplet", async () => {
  const harness = rollbackAdmissionDatabase();
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "UTC" });
  const unsigned = {
    scope: { ownerUserId: OWNER, workspaceId: WORKSPACE },
    planId: ids.plan,
    slotId: ids.slot,
    budgetBucketId: ids.bucket,
    authoritySnapshotId: ids.snapshot,
    authorityDigest: digest("4") as `sha256:${string}`,
    expectedSlotStateVersion: 1,
    expectedBucketStateVersion: 1,
    reservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    idempotencyKey: "real-repository-admission-pr23",
  };
  const result = await repository.reserveAndAdmit({ ...unsigned, inputDigest: repository.inputDigest(unsigned) });
  assert.equal(result.replayed, false);
  assert.equal(result.effects.renderJobCreated, true);
  assert.equal(result.effects.outboxCreated, true);
  assert.equal(result.effects.providerCalled, false);
  const held = harness.inspection();
  assert.equal(held.submission_state, "not_started");
  assert.equal(held.render_stage, "admission_held");
  assert.equal(held.outbox_status, "held");
  assert.equal(held.provider_job_id, null);
  assert.equal(held.render_lease_owner, null);
  assert.equal(held.outbox_lease_owner, null);
  assert.match(String(held.work_handoff_digest), /^sha256:[0-9a-f]{64}$/u);
});

integrationTest("real admission, activation, claim, and PR25 authorization commit exactly once", async () => {
  const client = await pool.connect();
  const dialect = new PgDialect();
  const sharedDb: DailyAdmissionTransactionalDatabase & HeldWorkActivationTransactionalDatabase = {
    async execute(_query: SQL) { throw new Error("repositories must use the owned transaction"); },
    async transaction<T>(callback: (tx: DailyAdmissionDatabase & HeldWorkActivationDatabase) => Promise<T>): Promise<T> {
      return callback({ execute: async (query) => {
        const compiled = dialect.sqlToQuery(query);
        return client.query(compiled.sql, compiled.params);
      } });
    },
  };
  try {
    await client.query("BEGIN");
    const admissionRepository = new DrizzleDailyAdmissionRepository(sharedDb, { accountingTimeZone: "UTC" });
    const unsignedAdmission = {
      scope: { ownerUserId: OWNER, workspaceId: WORKSPACE }, planId: ids.plan, slotId: ids.slot,
      budgetBucketId: ids.bucket, authoritySnapshotId: ids.snapshot,
      authorityDigest: digest("4") as `sha256:${string}`, expectedSlotStateVersion: 1,
      expectedBucketStateVersion: 1, reservationExpiresAt: new Date(Date.now()+5*60_000).toISOString(),
      idempotencyKey: "real-admit-then-activate-pr24",
    };
    const admission = await admissionRepository.reserveAndAdmit({
      ...unsignedAdmission,inputDigest:admissionRepository.inputDigest(unsignedAdmission),
    });
    assert.equal(admission.replayed,false);
    const activationRepository = new DrizzleHeldWorkActivationRepository(sharedDb,{accountingTimeZone:"UTC"});
    const unsignedActivation = {
      scope:unsignedAdmission.scope,budgetReservationId:admission.reservation.id,
      workHandoffDigest:admission.reservation.workHandoffDigest,requestedBy:"operator-pr24-real",
      idempotencyKey:"real-held-activation-pr24",
    };
    const authorizedActivation = {
      ...unsignedActivation,inputDigest:activationRepository.inputDigest(unsignedActivation),
      principal:activationPrincipal(unsignedActivation.requestedBy),
    };
    for (const [savepoint, mutation] of [
      ["slot_avatar_substitution", `UPDATE ai_media_daily_plan_slots SET avatar_resource_id='${ids.alternateAvatar}' WHERE id='${ids.slot}'`],
      ["sealed_avatar_deactivated", `UPDATE ai_media_provider_resources SET status='inactive' WHERE id='${ids.avatar}'`],
      ["script_subject_substitution", `UPDATE ai_media_scripts SET influencer_id=NULL WHERE id='${ids.script}'`],
      ["script_archived", `UPDATE ai_media_scripts SET archived_at=clock_timestamp() WHERE id='${ids.script}'`],
    ] as const) {
      await client.query(`SAVEPOINT ${savepoint}`);
      await client.query(mutation);
      await assert.rejects(activationRepository.activate(authorizedActivation));
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    }
    const activation = await activationRepository.activate({
      ...authorizedActivation,
    });
    assert.equal(activation.replayed,false);
    assert.equal(activation.effects.budgetCommitted,false);
    assert.equal(activation.effects.providerCalled,false);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const state=await client.query<Record<string,unknown>>(`
      SELECT activation.id AS activation_id,job.stage AS render_stage,job.attempts AS render_attempts,
        job.provider_job_id,outbox.status AS outbox_status,slot.status AS slot_status,
        reservation.state AS reservation_state,reservation.submission_state,
        bucket.reserved_micro_usd::text,bucket.committed_micro_usd::text
      FROM ai_media_work_activations activation
      JOIN ai_media_budget_reservations reservation ON reservation.id=activation.budget_reservation_id
      JOIN ai_media_render_jobs job ON job.id=activation.render_job_id
      JOIN ai_media_outbox outbox ON outbox.id=activation.dispatch_outbox_id
      JOIN ai_media_daily_plan_slots slot ON slot.id=activation.daily_plan_slot_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      WHERE activation.id=$1`,[activation.activation.id]);
    assert.equal(state.rowCount,1);
    assert.deepEqual(state.rows[0],{
      activation_id:activation.activation.id,render_stage:"queued",render_attempts:0,provider_job_id:null,
      outbox_status:"pending",slot_status:"queued",reservation_state:"reserved",submission_state:"not_started",
      reserved_micro_usd:"1250000",committed_micro_usd:"0",
    });

    for (const [name,statement,params] of [
      ["queued_render_tamper","UPDATE ai_media_render_jobs SET stage='leased' WHERE id=$1",[activation.activation.renderJobId]],
      ["activation_update","UPDATE ai_media_work_activations SET actor_user_id='tampered' WHERE id=$1",[activation.activation.id]],
      ["activation_delete","DELETE FROM ai_media_work_activations WHERE id=$1",[activation.activation.id]],
    ] as const) {
      await client.query(`SAVEPOINT ${name}`);
      await assert.rejects(client.query(statement,[...params]));
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    }
    const admittedDb=sharedDb as AdmittedRenderTransactionalDatabase;
    const admittedRepository=new DrizzleAdmittedRenderRepository(admittedDb,{workspaceId:WORKSPACE,accountingTimeZone:"UTC"});
    const claim=await admittedRepository.claim({workerId:"worker-pr25-real",leaseDurationMs:60_000});
    assert.ok(claim);
    assert.match(claim.providerIdempotencyKey,/^admit:[0-9a-f]{64}$/u);
    const authorization=await admittedRepository.authorize(claim);
    assert.ok(authorization);
    assert.equal(authorization.providerAccountId,ids.account);
    const committed=await client.query<{state:string;submission_state:string;render_stage:string;render_attempts:number;
      outbox_status:string;slot_status:string;reserved_micro_usd:string;committed_micro_usd:string}>(`
      SELECT reservation.state,reservation.submission_state,job.stage render_stage,job.attempts render_attempts,
        outbox.status outbox_status,slot.status slot_status,bucket.reserved_micro_usd::text,
        bucket.committed_micro_usd::text FROM ai_media_budget_reservations reservation
      JOIN ai_media_render_jobs job ON job.id=reservation.render_job_id
      JOIN ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
      JOIN ai_media_daily_plan_slots slot ON slot.id=reservation.daily_plan_slot_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      WHERE reservation.id=$1`,[admission.reservation.id]);
    assert.deepEqual(committed.rows[0],{state:"committed",submission_state:"dispatching",render_stage:"leased",
      render_attempts:1,outbox_status:"leased",slot_status:"committed",reserved_micro_usd:"0",committed_micro_usd:"1250000"});
    assert.equal(await admittedRepository.markAmbiguous({...authorization,evidenceDigest:digest("8") as `sha256:${string}`}),true);
    await client.query("SAVEPOINT ambiguous_reopen");
    await assert.rejects(client.query(`UPDATE ai_media_budget_reservations SET submission_state='dispatching'
      WHERE id=$1 AND submission_state='ambiguous'`,[admission.reservation.id]));
    await client.query("ROLLBACK TO SAVEPOINT ambiguous_reopen");
    const unknownReconciliation=await admittedRepository.claimAmbiguous({workerId:"reconciler-pr25-unknown",leaseDurationMs:60_000});
    assert.ok(unknownReconciliation);
    assert.equal(await admittedRepository.releaseUnknownReconciliation(unknownReconciliation),true);
    const releasedLeaseEvent=await client.query<{event_kind:string;actor_user_id:string}>(`
      SELECT event_kind,actor_user_id FROM ai_media_provider_submission_events
      WHERE submission_attempt_id=$1 ORDER BY sequence DESC LIMIT 1`,[unknownReconciliation.id]);
    assert.deepEqual(releasedLeaseEvent.rows[0],{event_kind:"reconciliation_released",actor_user_id:"reconciler-pr25-unknown"});
    const reconciliation=await admittedRepository.claimAmbiguous({workerId:"reconciler-pr25-real",leaseDurationMs:60_000});
    assert.ok(reconciliation);
    const finality={scope:reconciliation.scope,providerAccountId:reconciliation.providerAccountId,
      providerKey:reconciliation.providerKey,providerCredentialVersion:reconciliation.providerCredentialVersion,
      authorizationDigest:reconciliation.authorizationDigest,providerIdempotencyKey:reconciliation.providerIdempotencyKey,
      guarantee:"linearizable_not_accepted_and_cannot_later_accept",observedAt:new Date().toISOString(),
      evidenceDigest:digest("9") as `sha256:${string}`} as unknown as ExactNegativeSubmissionFinality;
    assert.equal(await admittedRepository.markReconciledNoSubmit({...reconciliation,
      finality}),true);
    assert.equal(await admittedRepository.markReconciledNoSubmit({...reconciliation,
      finality}),false,"stale reconciliation fence cannot refund twice");
    const released=await client.query<{state:string;submission_state:string;committed_micro_usd:string}>(`
      SELECT reservation.state,reservation.submission_state,bucket.committed_micro_usd::text
      FROM ai_media_budget_reservations reservation JOIN ai_media_budget_buckets bucket
        ON bucket.id=reservation.budget_bucket_id WHERE reservation.id=$1`,[admission.reservation.id]);
    assert.deepEqual(released.rows[0],{state:"released",submission_state:"reconciled_no_submit",committed_micro_usd:"0"});
    const terminalEvent=await client.query<{actor_user_id:string}>(`SELECT actor_user_id
      FROM ai_media_provider_submission_events WHERE submission_attempt_id=$1
      ORDER BY sequence DESC LIMIT 1`,[reconciliation.id]);
    assert.equal(terminalEvent.rows[0]?.actor_user_id,"reconciler-pr25-real");
    await client.query("SAVEPOINT rollback_guard");
    await assert.rejects(client.query(pr25Rollback),(error:unknown)=>
      typeof error==="object"&&error!==null&&"code" in error&&error.code==="P0001");
    await client.query("ROLLBACK TO SAVEPOINT rollback_guard");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

integrationTest("tenant and immutable authority constraints fail closed in PostgreSQL", async () => {
  await expectDatabaseError(() => pool.query(`
    INSERT INTO ai_media_launch_evidence
      (owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version,
       slot_attempt,script_variant_id,script_variant_checksum,governance_profile_id,governance_evidence_digest,
       governance_use,governance_territory,content_country,launch_subject_digest,evidence_kind,decision,revision,
       launch_intent_id,launch_intent_digest,
       valid_from,expires_at,actor_user_id,source_kind,evidence_digest,input_digest,idempotency_key)
    VALUES ('other-owner','${WORKSPACE}','${ids.slot}','${ids.account}','heygen',1,1,'${ids.variant}',
      '${SCRIPT_CHECKSUM}','${ids.governance}','${digest("2")}','marketing','WORLDWIDE','US','${digest("0")}',
      'content_approval','approved',1,'${ids.launchIntent}','${digest("9")}',
      clock_timestamp(),clock_timestamp()+interval '1 hour','actor-pr21',
      'pr21-test','${digest("6")}','${digest("7")}','cross-tenant-pr21')
  `), "23503");

  await expectDatabaseError(() => pool.query(
    "UPDATE ai_media_launch_evidence SET source_kind='rewritten' WHERE id=$1",
    [ids.contentEvidence],
  ), "P0001");
  await expectDatabaseError(() => pool.query(
    "DELETE FROM ai_media_launch_authority_snapshots WHERE id=$1",
    [ids.snapshot],
  ), "P0001");
  await expectDatabaseError(() => pool.query(
    "UPDATE ai_media_launch_intents SET actor_user_id='rewritten' WHERE id=$1",
    [ids.launchIntent],
  ), "P0001");
  await expectDatabaseError(() => pool.query(
    "UPDATE ai_media_admission_policy_revisions SET state='disabled' WHERE id=$1",
    [ids.policy],
  ), "P0001");
  await expectDatabaseError(() => pool.query(
    "DELETE FROM ai_media_kill_switch_revisions WHERE id=$1",
    [ids.killSwitch],
  ), "P0001");
});

integrationTest("reservation authority remains exact and cannot be attached or rewritten", async () => {
  const client=await pool.connect();
  try {
  await client.query("BEGIN");
  await client.query(`
    INSERT INTO ai_media_budget_reservations
      (id,owner_user_id,workspace_id,budget_bucket_id,daily_plan_slot_id,provider_account_id,provider_key,
       provider_credential_version,attempt,state,submission_state,amount_micro_usd,currency,idempotency_key,
       input_digest,admission_digest,script_variant_checksum,quote_digest,quote_expires_at,
       content_approval_digest,human_launch_approval_digest,governance_profile_id,governance_evidence_digest,
       policy_digest,kill_switch_evidence_digest,sandbox_evidence_digest,provider_idempotency_key,
       reserved_at,expires_at,authority_snapshot_id,authority_digest)
    VALUES ('${ids.authorityReservation}','${OWNER}','${WORKSPACE}','${ids.bucket}','${ids.slot}','${ids.account}',
      'heygen',1,1,'reserved','not_started',1250000,'USD','reservation-pr21-idempotency','${digest("1")}',
      '${digest("3")}','${SCRIPT_CHECKSUM}','${digest("f")}',clock_timestamp()+interval '30 minutes',
      '${digest("c")}','${digest("d")}','${ids.governance}','${digest("2")}','${digest("7")}',
      '${digest("a")}','${digest("e")}','authority-provider-pr21-idempotency',clock_timestamp(),
      clock_timestamp()+interval '10 minutes','${ids.snapshot}','${digest("4")}')
  `);

  await client.query("SAVEPOINT rewrite_authority");
  await expectDatabaseError(() => client.query(
    "UPDATE ai_media_budget_reservations SET authority_digest=$1 WHERE id=$2",
    [digest("9"), ids.authorityReservation],
  ), "P0001");
  await client.query("ROLLBACK TO SAVEPOINT rewrite_authority");
  await client.query("SAVEPOINT attach_handoff");
  await expectDatabaseError(() => client.query(`
    UPDATE ai_media_budget_reservations
    SET render_job_id=$1,dispatch_outbox_id=$2,work_handoff_digest=$3
    WHERE id=$4
  `,[ids.renderJob,ids.outbox,digest("d"),ids.authorityReservation]),"P0001");
  await client.query("ROLLBACK TO SAVEPOINT attach_handoff");
  await client.query("SAVEPOINT wrong_authority");
  await expectDatabaseError(() => client.query(`
    INSERT INTO ai_media_budget_reservations
      (owner_user_id,workspace_id,budget_bucket_id,daily_plan_slot_id,provider_account_id,provider_key,
       provider_credential_version,attempt,state,submission_state,amount_micro_usd,currency,idempotency_key,
       input_digest,admission_digest,script_variant_checksum,quote_digest,quote_expires_at,
       content_approval_digest,human_launch_approval_digest,governance_profile_id,governance_evidence_digest,
       policy_digest,kill_switch_evidence_digest,sandbox_evidence_digest,provider_idempotency_key,reserved_at,
       expires_at,released_at,authority_snapshot_id,authority_digest)
    VALUES ('${OWNER}','${WORKSPACE}','${ids.bucket}','${ids.slot}','${ids.account}','heygen',1,2,
      'released','not_started',1250000,'USD','reservation-wrong-authority','${digest("1")}','${digest("9")}',
      '${SCRIPT_CHECKSUM}','${digest("f")}',clock_timestamp()+interval '30 minutes','${digest("c")}',
      '${digest("d")}','${ids.governance}','${digest("2")}','${digest("7")}','${digest("a")}',
      '${digest("e")}','provider-wrong-authority',clock_timestamp(),clock_timestamp()+interval '10 minutes',
      clock_timestamp(),'${ids.snapshot}','${digest("4")}')
  `), "23503");
  await client.query("ROLLBACK TO SAVEPOINT wrong_authority");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

integrationTest("PR23 exact held handoff is durable, non-claimable, and immutable in PostgreSQL", async () => {
  const client = await pool.connect();
  const handoffDigest = digest("d");
  const sealedDigest = digest("e");
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(`UPDATE ai_media_budget_buckets SET reserved_micro_usd=1250000,state_version=state_version+1
      WHERE id='${ids.bucket}'`);
    await client.query(`UPDATE ai_media_daily_plan_slots SET status='reserved',state_version=2
      WHERE id='${ids.slot}'`);
    await insertCompleteAttachedReservation(client,{
      handoffDigest,renderJobId:ids.renderJob,outboxId:ids.outbox,idempotencyKey:"manual-held-reservation-pr23",
    });
    await client.query(`
      INSERT INTO ai_media_render_jobs
        (id,owner_user_id,workspace_id,provider_account_id,provider_key,idempotency_key,title,status,stage,
         progress,attempts,retry_count,max_attempts,request,governance_profile_id,governance_evidence_digest,
         queued_at,available_at,created_at,updated_at,budget_reservation_id,daily_plan_slot_id,slot_attempt,
         influencer_id,avatar_resource_id,voice_resource_id,script_id,script_variant_id,script_variant_checksum,
         source_item_id,source_content_hash,authority_snapshot_id,authority_digest,launch_intent_id,
         launch_intent_digest,admission_digest,work_handoff_digest,sealed_request_digest,
         provider_credential_version)
      VALUES ('${ids.renderJob}','${OWNER}','${WORKSPACE}','${ids.account}','heygen',
        'provider-pr21-idempotency','Held render','pending','admission_held',0,0,0,3,
        '{"influencerId":"${ids.influencer}","script":"launch","voiceId":"${ids.voice}",
          "language":"en","aspectRatio":"9:16","idempotencyKey":"provider-pr21-idempotency"}'::jsonb,
        '${ids.governance}','${digest("2")}',clock_timestamp(),clock_timestamp(),clock_timestamp(),
        clock_timestamp(),'${ids.reservation}','${ids.slot}',1,'${ids.influencer}','${ids.avatar}',
        '${ids.voice}','${ids.script}','${ids.variant}','${SCRIPT_CHECKSUM}','${ids.sourceItem}',
        '${digest("9")}','${ids.snapshot}','${digest("4")}','${ids.launchIntent}','${digest("9")}',
        '${digest("3")}','${handoffDigest}','${sealedDigest}',1)
    `);
    await client.query(`
      INSERT INTO ai_media_outbox
        (id,owner_user_id,workspace_id,idempotency_key,aggregate_type,aggregate_id,event_type,payload,status,
         attempts,available_at,fencing_token,created_at,updated_at,budget_reservation_id,render_job_id,
         work_handoff_digest,sealed_request_digest)
      VALUES ('${ids.outbox}','${OWNER}','${WORKSPACE}','provider-pr21-idempotency:dispatch','render_job',
        '${ids.renderJob}','ai_media.render.dispatch','{"version":1}'::jsonb,'held',0,clock_timestamp(),0,
        clock_timestamp(),clock_timestamp(),'${ids.reservation}','${ids.renderJob}','${handoffDigest}',
        '${sealedDigest}')
    `);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    const claimable = await client.query<{ render_count: string; outbox_count: string }>(`
      SELECT
        (SELECT count(*)::text FROM ai_media_render_jobs
          WHERE stage IN ('queued','retry_wait') AND id='${ids.renderJob}') AS render_count,
        (SELECT count(*)::text FROM ai_media_outbox
          WHERE status IN ('pending','retry_wait') AND id='${ids.outbox}') AS outbox_count
    `);
    assert.deepEqual(claimable.rows[0], { render_count: "0", outbox_count: "0" });

    for (const [savepoint, statement] of [
      ["held_job", `UPDATE ai_media_render_jobs SET stage='queued' WHERE id='${ids.renderJob}'`],
      ["held_outbox", `UPDATE ai_media_outbox SET status='pending' WHERE id='${ids.outbox}'`],
    ] as const) {
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query(statement);
        assert.fail("held work mutation must fail");
      } catch (error) {
        assert.equal(typeof error === "object" && error !== null && "code" in error ? error.code : undefined, "P0001");
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

integrationTest("the real PR24 repository atomically activates exact held work while budget and render stay inert", async () => {
  const client = await pool.connect();
  const requestJson = { influencerId:ids.influencer,script:SCRIPT_CONTENT,voiceId:ids.voice,language:"en",
    aspectRatio:"9:16",idempotencyKey:"provider-pr21-idempotency",
    governance:{profileId:ids.governance,evidenceDigest:digest("2")} };
  const canonical = (value:unknown):unknown => Array.isArray(value)?value.map(canonical):value&&typeof value==="object"
    ?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)])):value;
  const hash = (value:unknown) => `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
  const sealedDigest = hash({version:1,request:requestJson,reservationId:ids.reservation,renderJobId:ids.renderJob,
    outboxId:ids.outbox,slotId:ids.slot,slotAttempt:1,authoritySnapshotId:ids.snapshot,authorityDigest:digest("4"),
    launchIntentId:ids.launchIntent,launchIntentDigest:digest("9"),admissionDigest:digest("3"),
    providerAccountId:ids.account,providerKey:"heygen",providerCredentialVersion:1,scriptVariantId:ids.variant,
    scriptVariantChecksum:SCRIPT_CHECKSUM,sourceItemId:ids.sourceItem,sourceContentHash:digest("9"),
    avatarResourceId:ids.avatar,voiceResourceId:ids.voice});
  const handoffDigest = hash({version:1,reservationId:ids.reservation,renderJobId:ids.renderJob,outboxId:ids.outbox,
    sealedRequestDigest:sealedDigest,authorityDigest:digest("4"),launchIntentDigest:digest("9"),admissionDigest:digest("3")}) as `sha256:${string}`;
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(`UPDATE ai_media_budget_buckets SET reserved_micro_usd=1250000,state_version=2
      WHERE id='${ids.bucket}'`);
    await client.query(`UPDATE ai_media_daily_plan_slots SET status='reserved',state_version=2
      WHERE id='${ids.slot}'`);
    await insertCompleteAttachedReservation(client,{
      handoffDigest,renderJobId:ids.renderJob,outboxId:ids.outbox,idempotencyKey:"manual-held-reservation-pr24",
    });
    await client.query(`
      INSERT INTO ai_media_render_jobs
        (id,owner_user_id,workspace_id,provider_account_id,provider_key,idempotency_key,title,status,stage,
         progress,attempts,retry_count,max_attempts,request,governance_profile_id,governance_evidence_digest,
         queued_at,available_at,created_at,updated_at,budget_reservation_id,daily_plan_slot_id,slot_attempt,
         influencer_id,avatar_resource_id,voice_resource_id,script_id,script_variant_id,script_variant_checksum,
         source_item_id,source_content_hash,authority_snapshot_id,authority_digest,launch_intent_id,
         launch_intent_digest,admission_digest,work_handoff_digest,sealed_request_digest,provider_credential_version)
      VALUES ('${ids.renderJob}','${OWNER}','${WORKSPACE}','${ids.account}','heygen','provider-pr21-idempotency',
        'Held render','pending','admission_held',0,0,0,3,
        '${JSON.stringify(requestJson)}'::jsonb,
        '${ids.governance}','${digest("2")}',clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),
        '${ids.reservation}','${ids.slot}',1,'${ids.influencer}','${ids.avatar}','${ids.voice}','${ids.script}',
        '${ids.variant}','${SCRIPT_CHECKSUM}','${ids.sourceItem}','${digest("9")}','${ids.snapshot}','${digest("4")}',
        '${ids.launchIntent}','${digest("9")}','${digest("3")}','${handoffDigest}','${sealedDigest}',1)
    `);
    await client.query(`
      INSERT INTO ai_media_outbox
        (id,owner_user_id,workspace_id,idempotency_key,aggregate_type,aggregate_id,event_type,payload,status,
         attempts,available_at,fencing_token,created_at,updated_at,budget_reservation_id,render_job_id,
         work_handoff_digest,sealed_request_digest)
      VALUES ('${ids.outbox}','${OWNER}','${WORKSPACE}','provider-pr21-idempotency:dispatch','render_job',
        '${ids.renderJob}','ai_media.render.dispatch','{"version":1}'::jsonb,'held',0,clock_timestamp(),0,
        clock_timestamp(),clock_timestamp(),'${ids.reservation}','${ids.renderJob}','${handoffDigest}','${sealedDigest}')
    `);
    const dialect = new PgDialect();
    const db: HeldWorkActivationTransactionalDatabase = {
      async execute(_query: SQL) { throw new Error("activation must use its transaction"); },
      async transaction<T>(callback: (tx: HeldWorkActivationDatabase) => Promise<T>): Promise<T> {
        return callback({ execute: async (query) => {
          const compiled = dialect.sqlToQuery(query);
          return client.query(compiled.sql, compiled.params);
        } });
      },
    };
    const repository = new DrizzleHeldWorkActivationRepository(db, { accountingTimeZone: "UTC" });
    const unsigned = {
      scope: { ownerUserId: OWNER, workspaceId: WORKSPACE },
      budgetReservationId: ids.reservation, workHandoffDigest: handoffDigest,
      requestedBy: "operator-pr24", idempotencyKey: "activate-pr24-real-repository",
    };
    const result = await repository.activate({ ...unsigned, inputDigest: repository.inputDigest(unsigned),
      principal:activationPrincipal(unsigned.requestedBy) });
    assert.equal(result.replayed, false);
    assert.equal(result.effects.budgetCommitted, false);
    assert.equal(result.effects.providerCalled, false);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    const state = await client.query<{
      render_stage:string;render_attempts:number;outbox_status:string;slot_status:string;
      reservation_state:string;submission_state:string;reserved_micro_usd:string;committed_micro_usd:string;
    }>(`SELECT job.stage AS render_stage,job.attempts AS render_attempts,outbox.status AS outbox_status,
      slot.status AS slot_status,reservation.state AS reservation_state,reservation.submission_state,
      bucket.reserved_micro_usd::text,bucket.committed_micro_usd::text
      FROM ai_media_budget_reservations reservation
      JOIN ai_media_render_jobs job ON job.id=reservation.render_job_id
      JOIN ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
      JOIN ai_media_daily_plan_slots slot ON slot.id=reservation.daily_plan_slot_id
      JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
      WHERE reservation.id=$1`,[ids.reservation]);
    assert.deepEqual(state.rows[0],{
      render_stage:"queued",render_attempts:0,outbox_status:"pending",slot_status:"queued",
      reservation_state:"reserved",submission_state:"not_started",reserved_micro_usd:"1250000",committed_micro_usd:"0",
    });
    await assert.rejects(client.query(`UPDATE ai_media_render_jobs SET stage='leased',attempts=1,
      lease_owner='forbidden',lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1`,[ids.renderJob]),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

integrationTest("concurrent revision append allows one canonical successor", async () => {
  const statement = `
    INSERT INTO ai_media_admission_policy_revisions
      (id,owner_user_id,workspace_id,revision,previous_revision_id,previous_revision,daily_budget_micro_usd,
       total_concurrency,provider_concurrency,tenant_concurrency,allowed_languages,allowed_countries,
       allowed_time_zones,state,valid_from,expires_at,policy_digest,evidence_digest,input_digest,
       actor_user_id,idempotency_key)
    VALUES ($1,$2,$3,2,$4,1,5000000,10,10,10,'["en"]','["US"]','["UTC"]','active',
      clock_timestamp(),clock_timestamp()+interval '1 hour',$5,$6,$7,'actor-pr21',$8)
  `;
  const contenders = [
    ["20000000-0000-4000-8000-000000000001", digest("1"), digest("2"), digest("3"), "policy-pr21-contender-a"],
    ["20000000-0000-4000-8000-000000000002", digest("4"), digest("5"), digest("6"), "policy-pr21-contender-b"],
  ] as const;
  const results = await Promise.all(contenders.map(([id, policyDigest, evidenceDigest, inputDigest, key]) =>
    transactionInsert(statement, [id, OWNER, WORKSPACE, ids.policy, policyDigest, evidenceDigest, inputDigest, key])));
  assert.deepEqual([...results].sort(), ["23505", "committed"]);
  const canonical = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM ai_media_admission_policy_revisions
    WHERE owner_user_id=$1 AND workspace_id=$2 AND revision=2
  `, [OWNER, WORKSPACE]);
  assert.equal(canonical.rows[0].count, "1");
});

integrationTest("launch intents enforce exact source content and one canonical row per slot attempt", async () => {
  const columns = `(id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,
    source_roster_digest,source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,
    source_item_id,source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
    governance_territory,content_country,launch_subject_digest,launch_intent_digest,actor_user_id,
    input_digest,idempotency_key)`;
  await expectDatabaseError(() => pool.query(`
    INSERT INTO ai_media_launch_intents ${columns}
    SELECT '40000000-0000-4000-8000-000000000001',owner_user_id,workspace_id,daily_plan_id,
      daily_plan_slot_id,4,provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,
      source_roster_key,source_roster_digest,source_member_key,script_id,script_variant_id,
      script_variant_checksum,source_type,source_item_id,$1,governance_profile_id,governance_evidence_digest,
      governance_use,governance_territory,content_country,launch_subject_digest,$2,actor_user_id,$3,
      'launch-intent-wrong-source-hash'
    FROM ai_media_launch_intents WHERE id=$4
  `, ["8".repeat(64), digest("6"), digest("5"), ids.launchIntent]), "23514");

  const matchingBeforeRefresh = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM ai_media_launch_intents intents
    JOIN ai_media_source_items sources
      ON sources.owner_user_id=intents.owner_user_id AND sources.workspace_id=intents.workspace_id
      AND sources.id=intents.source_item_id AND sources.source_type=intents.source_type
      AND sources.content_hash=intents.source_content_hash
      AND sources.status IN ('accepted','ready') AND sources.rights_status IN ('owned','licensed')
      AND sources.moderation_status='approved'
    WHERE intents.id=$1
  `, [ids.launchIntent]);
  assert.equal(matchingBeforeRefresh.rows[0].count, "1");
  await pool.query("UPDATE ai_media_source_items SET content_hash=$1 WHERE id=$2", [digest("8"), ids.sourceItem]);
  const matchingAfterRefresh = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM ai_media_launch_intents intents
    JOIN ai_media_source_items sources
      ON sources.owner_user_id=intents.owner_user_id AND sources.workspace_id=intents.workspace_id
      AND sources.id=intents.source_item_id AND sources.source_type=intents.source_type
      AND sources.content_hash=intents.source_content_hash
    WHERE intents.id=$1
  `, [ids.launchIntent]);
  assert.equal(matchingAfterRefresh.rows[0].count, "0");
  await pool.query("UPDATE ai_media_source_items SET content_hash=$1 WHERE id=$2", [digest("9"), ids.sourceItem]);

  const statement = `
    INSERT INTO ai_media_launch_intents ${columns}
    SELECT $1,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,3,provider_account_id,provider_key,
      provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,
      source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,
      source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
      governance_territory,content_country,launch_subject_digest,$2,actor_user_id,$3,$4
    FROM ai_media_launch_intents WHERE id=$5
  `;
  const contenders = [
    ["40000000-0000-4000-8000-000000000002", digest("4"), digest("3"), "launch-intent-contender-a"],
    ["40000000-0000-4000-8000-000000000003", digest("2"), digest("1"), "launch-intent-contender-b"],
  ] as const;
  const results = await Promise.all(contenders.map(([id, intentDigest, inputDigest, key]) =>
    transactionInsert(statement, [id, intentDigest, inputDigest, key, ids.launchIntent])));
  assert.deepEqual([...results].sort(), ["23505", "committed"]);
});

integrationTest("runtime evidence requires safe source attestation audit fields by kind", async () => {
  await pool.query(`
    INSERT INTO ai_media_launch_intents
      (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,provider_account_id,
       provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,
       source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,
       source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
       governance_territory,content_country,launch_subject_digest,launch_intent_digest,actor_user_id,
       input_digest,idempotency_key)
    SELECT '${ids.launchIntent4}',owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,4,
      provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,
      source_roster_digest,source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,
      source_item_id,source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
      governance_territory,content_country,launch_subject_digest,'${digest("6")}',actor_user_id,
      '${digest("5")}','launch-intent-pr21-attempt-4'
    FROM ai_media_launch_intents WHERE id='${ids.launchIntent}'
  `);
  const evidenceColumns = `(id,owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,
    provider_credential_version,slot_attempt,script_variant_id,script_variant_checksum,governance_profile_id,
    governance_evidence_digest,governance_use,governance_territory,content_country,launch_subject_digest,
    launch_intent_id,launch_intent_digest,evidence_kind,decision,revision,valid_from,expires_at,actor_user_id,
    source_kind,source_attestation_id,source_evidence_digest,evidence_digest,input_digest,idempotency_key)`;
  const selectEvidence = `SELECT $1,owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,
    provider_key,provider_credential_version,4,script_variant_id,script_variant_checksum,governance_profile_id,
    governance_evidence_digest,governance_use,governance_territory,content_country,launch_subject_digest,
    $2,$3,$4,$5,1,valid_from,expires_at,actor_user_id,source_kind,$6,$7,$8,$9,$10
    FROM ai_media_launch_evidence WHERE id=$11`;
  await expectDatabaseError(() => pool.query(
    `INSERT INTO ai_media_launch_evidence ${evidenceColumns} ${selectEvidence}`,
    ["50000000-0000-4000-8000-000000000001", ids.launchIntent4, digest("6"), "sandbox_proof",
      "passed", null, null, digest("4"), digest("3"), "sandbox-missing-attestation", ids.sandboxEvidence],
  ), "23514");
  await expectDatabaseError(() => pool.query(
    `INSERT INTO ai_media_launch_evidence ${evidenceColumns} ${selectEvidence}`,
    ["50000000-0000-4000-8000-000000000002", ids.launchIntent4, digest("6"), "human_launch_approval",
      "approved", "unsafe attestation", digest("2"), digest("1"), digest("0"),
      "human-forbidden-attestation", ids.humanEvidence],
  ), "23514");
});

integrationTest("concurrent evidence writes enforce one durable idempotency binding", async () => {
  await pool.query(`
    INSERT INTO ai_media_launch_intents
      (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,provider_account_id,
       provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,
       source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,
       source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
       governance_territory,content_country,launch_subject_digest,launch_intent_digest,actor_user_id,
       input_digest,idempotency_key)
    VALUES ('${ids.launchIntent2}','${OWNER}','${WORKSPACE}','${ids.plan}','${ids.slot}',2,'${ids.account}',
      'heygen',1,'${digest("5")}','${digest("6")}','launch-roster','${digest("3")}','member-pr21',
      '${ids.script}','${ids.variant}','${SCRIPT_CHECKSUM}','rss','${ids.sourceItem}','${digest("9")}',
      '${ids.governance}','${digest("2")}','marketing','WORLDWIDE','US','${digest("0")}',
      '${digest("8")}','actor-pr21','${digest("7")}','launch-intent-pr21-attempt-2')
  `);
  const statement = `
    INSERT INTO ai_media_launch_evidence
      (id,owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,
       provider_credential_version,slot_attempt,script_variant_id,script_variant_checksum,
       governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
       launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_kind,decision,revision,
       valid_from,expires_at,actor_user_id,source_kind,
       evidence_digest,input_digest,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,'heygen',1,2,$6,$7,$8,$9,'marketing','WORLDWIDE','US',$10,$11,$12,$13,'approved',1,
      clock_timestamp(),clock_timestamp()+interval '1 hour','actor-pr21','pr21-test',$14,$15,$16)
  `;
  const sharedIdempotencyKey = "evidence-pr21-shared-idempotency";
  const contenders = [
    ["30000000-0000-4000-8000-000000000001", "content_approval", digest("4"), digest("5")],
    ["30000000-0000-4000-8000-000000000002", "human_launch_approval", digest("6"), digest("7")],
  ] as const;
  const results = await Promise.all(contenders.map(([id, kind, evidenceDigest, inputDigest]) =>
    transactionInsert(statement, [id, OWNER, WORKSPACE, ids.slot, ids.account, ids.variant, SCRIPT_CHECKSUM,
      ids.governance, digest("2"), digest("0"), ids.launchIntent2, digest("8"), kind,
      evidenceDigest, inputDigest, sharedIdempotencyKey])));
  assert.deepEqual([...results].sort(), ["23505", "committed"]);
  const durableBinding = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM ai_media_launch_evidence
    WHERE owner_user_id=$1 AND workspace_id=$2 AND idempotency_key=$3
  `, [OWNER, WORKSPACE, sharedIdempotencyKey]);
  assert.equal(durableBinding.rows[0].count, "1");
});

integrationTest("application-only rollbacks preserve evidence and repeated forwards fail without partial changes", async () => {
  const beforeCount = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM ai_media_launch_evidence",
  );
  const pr23Client = await pool.connect();
  try {
    await assertReapplicationFails(pr23Client, pr25Forward);
    await assertReapplicationFails(pr23Client, pr24Forward);
    await assertReapplicationFails(pr23Client, pr23Forward);
  } finally {
    pr23Client.release();
  }
  await pool.query(pr25Rollback);
  await pool.query(pr24Rollback);
  await pool.query(pr23Rollback);
  await pool.query(pr20Rollback);
  await pool.query(pr19Rollback);
  await pool.query(pr22Rollback);
  const afterRollback = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM ai_media_launch_evidence",
  );
  assert.equal(afterRollback.rows[0].count, beforeCount.rows[0].count);

  const client = await pool.connect();
  try {
    await assertReapplicationFails(client, pr19Forward);
    await assertReapplicationFails(client, pr20Forward);
    await assertReapplicationFails(client, pr22Forward);
  } finally {
    client.release();
  }
  const retained = await pool.query<{ authority_tables: string; snapshot_rows: string }>(`
    SELECT
      (SELECT count(*)::text FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'ai_media_%authority%') AS authority_tables,
      (SELECT count(*)::text FROM ai_media_launch_authority_snapshots) AS snapshot_rows
  `);
  assert.equal(retained.rows[0].authority_tables, "1");
  assert.equal(retained.rows[0].snapshot_rows, "1");
});
