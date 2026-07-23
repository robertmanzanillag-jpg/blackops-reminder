import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { AssetIngestWorker } from "../server/ai-media-studio/assets/worker";
import { DrizzleAssetIngestRepository } from "../server/ai-media-studio/assets/drizzle-ingest-repository";
import { DrizzleAdmittedProviderArtifactBindingLoader } from "../server/ai-media-studio/assets/drizzle-admitted-artifact-binding-loader";
import type { ArtifactReadStream, OwnedObjectStorage } from "../server/ai-media-studio/assets/contracts";
import { DrizzleMediaAssetRepository } from "../server/ai-media-studio/persistence/drizzle-core-repositories";
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
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import type {
  AdmittedAuthorizedIdentity,
  ExactAdmittedProviderCapability,
} from "../server/ai-media-studio/workers/admitted-render-contracts";
import { AdmittedRenderWorker } from "../server/ai-media-studio/workers/admitted-render-worker";
import { AdmittedRenderTerminalWorker } from "../server/ai-media-studio/workers/admitted-render-terminal-worker";
import {
  DrizzleAdmittedRenderRepository,
  type AdmittedRenderDatabase,
  type AdmittedRenderTransactionalDatabase,
} from "../server/ai-media-studio/workers/drizzle-admitted-render-repository";
import { DrizzleAdmittedRenderTerminalRepository } from "../server/ai-media-studio/workers/drizzle-admitted-render-terminal-repository";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};

const TEMP_PREFIX = "ams-offline-one-slot-pg-";
const DATABASE = "ams_offline_one_slot_test";
const PORT = "55436";
const OWNER = "offline-one-slot-owner";
const WORKSPACE = "personal";
const SUBMIT_LOGIN = "ams_offline_submit_login";
const RECONCILE_LOGIN = "ams_offline_reconcile_login";
const SUBMIT_ROLE = "ai_media_admitted_submit_executor";
const RECONCILE_ROLE = "ai_media_admitted_reconcile_executor";
const SCRIPT_CONTENT = "An approved, synthetic offline rehearsal script with no external destination.";
const SCRIPT_CHECKSUM = createHash("sha256").update(SCRIPT_CONTENT).digest("hex");
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8",
)) as Manifest;
const dialect = new PgDialect();

const ids = {
  account: "51000000-0000-4000-8000-000000000001",
  voice: "51000000-0000-4000-8000-000000000002",
  script: "51000000-0000-4000-8000-000000000003",
  variant: "51000000-0000-4000-8000-000000000004",
  governance: "51000000-0000-4000-8000-000000000005",
  plan: "51000000-0000-4000-8000-000000000006",
  bucket: "51000000-0000-4000-8000-000000000007",
  policy: "51000000-0000-4000-8000-000000000008",
  kill: "51000000-0000-4000-8000-000000000009",
  source: "51000000-0000-4000-8000-00000000000a",
  intent: "51000000-0000-4000-8000-00000000000b",
  snapshot: "51000000-0000-4000-8000-00000000000c",
  contentEvidence: "51000000-0000-4000-8000-00000000000d",
  humanEvidence: "51000000-0000-4000-8000-00000000000e",
  sandboxEvidence: "51000000-0000-4000-8000-00000000000f",
  quoteEvidence: "51000000-0000-4000-8000-000000000010",
  submitCapability: "51000000-0000-4000-8000-000000000011",
  reconcileCapability: "51000000-0000-4000-8000-000000000012",
  asset: "51000000-0000-4000-8000-000000000013",
} as const;

const digest = (value: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as Sha256Digest;
const deterministicUuid = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("offline one-slot test requires only its owned TEST_DATABASE_URL");
  const forbidden = Object.entries(process.env).filter(([name, configured]) => Boolean(configured?.trim())
    && /^(?:HEYGEN(?:_|$)|AWS(?:_|$)|AI_MEDIA_STUDIO_(?:HEYGEN|ASSET)_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|BUCKET|ENDPOINT))/u.test(name));
  assert.deepEqual(forbidden, [], "provider/cloud secrets are forbidden in the offline rehearsal");
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
  const resolvedRoot = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(resolvedRoot), realpathSync(process.platform === "darwin" ? "/private/tmp" : tmpdir()));
  assert.ok(basename(resolvedRoot).startsWith(TEMP_PREFIX));
  assert.equal(basename(resolvedSocket), "socket");
  return value;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest = enabled ? test : test.skip;
const databaseUrl = enabled ? requireOwnedUrl() : "postgresql://postgres@localhost/ams_offline_one_slot_disabled";
const adminPool = new Pool({ connectionString: databaseUrl, max: 12, allowExitOnIdle: true });
const database = drizzle(adminPool);
const rolePools: Pool[] = [];

after(async () => {
  await Promise.all(rolePools.map((pool) => pool.end()));
  await adminPool.end();
});

function migration(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `${file.path} differs from reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyExactMigrationChain(): Promise<void> {
  assert.equal(manifest.migrations.length, 22);
  for (const entry of manifest.migrations) {
    if (entry.pullRequest === "PR26") {
      for (const role of manifest.pr26.requiredRoles) {
        assert.deepEqual({ login: role.login, inherit: role.inherit }, { login: false, inherit: false });
        await adminPool.query(`CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    await adminPool.query(migration(entry.forward));
  }
}

type RepositoryDatabase = DailyAdmissionTransactionalDatabase & HeldWorkActivationTransactionalDatabase;

function adminRepositoryDatabase(): RepositoryDatabase {
  return {
    async execute(query: SQL) {
      const rendered = dialect.sqlToQuery(query);
      return adminPool.query(rendered.sql, rendered.params);
    },
    async transaction<T>(callback: (tx: DailyAdmissionDatabase & HeldWorkActivationDatabase) => Promise<T>): Promise<T> {
      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        const tx = { execute: async (query: SQL) => {
          const rendered = dialect.sqlToQuery(query);
          return client.query(rendered.sql, rendered.params);
        } };
        const result = await callback(tx);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function capabilityLane(login: string, role: string): AdmittedRenderTransactionalDatabase {
  const url = new URL(databaseUrl);
  url.username = login;
  const pool = new Pool({ connectionString: url.toString(), max: 1, allowExitOnIdle: true });
  rolePools.push(pool);
  const execute = async (client: PoolClient, query: SQL) => {
    const rendered = dialect.sqlToQuery(query);
    return client.query(rendered.sql, rendered.params);
  };
  return {
    async execute(query: SQL) {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        return await execute(client, query);
      } finally {
        client.release();
      }
    },
    async transaction<T>(callback: (tx: AdmittedRenderDatabase) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${role}`);
        const result = await callback({ execute: (query) => execute(client, query) });
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function seedValidFiveByTenSubject(): Promise<{ slotId: string; influencerId: string; avatarId: string }> {
  await adminPool.query(`
    CREATE ROLE ${SUBMIT_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ${RECONCILE_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT ${SUBMIT_ROLE} TO ${SUBMIT_LOGIN};
    GRANT ${RECONCILE_ROLE} TO ${RECONCILE_LOGIN}`);
  await adminPool.query(`INSERT INTO ai_media_admitted_worker_capabilities
      (id,database_principal,owner_user_id,workspace_id,lane,accounting_time_zone,worker_id,allowed_operations,
       max_lease_ms,max_batch_size,valid_from,expires_at,evidence_digest)
    VALUES ($1,$2,$3,$4,'submit','UTC','offline-submit-worker',ARRAY['claim','authorize','expire_authorized',
      'record_submit_confirmed','record_submit_ambiguous'],300000,100,clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '1 hour',$5),
      ($6,$7,$3,$4,'reconcile','UTC','offline-reconcile-worker',ARRAY['claim_reconciliation',
      'release_reconciliation_unknown','record_reconciled_confirmed','finalize_reconciled_no_submit',
      'claim_terminal_check','release_terminal_check_unknown','record_provider_terminal'],
      300000,100,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$8)`,
  [ids.submitCapability, SUBMIT_LOGIN, OWNER, WORKSPACE, digest("submit-capability"),
    ids.reconcileCapability, RECONCILE_LOGIN, digest("reconcile-capability")]);

  await adminPool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'heygen','Synthetic offline provider','connected','active',1,'legacy_authorized_unbound')`,
  [ids.account, OWNER, WORKSPACE]);
  await adminPool.query(`INSERT INTO ai_media_provider_resources
    (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,display_name,status,canonical_key)
    VALUES ($1,$2,$3,$4,'heygen','voice','offline-voice','Synthetic voice','active',$5)`,
  [ids.voice, OWNER, WORKSPACE, ids.account, `heygen:${ids.account}:offline-voice`]);

  const members: Array<{ influencerId: string; avatarId: string }> = [];
  for (let member = 1; member <= 5; member += 1) {
    const influencerId = deterministicUuid(`influencer:${member}`);
    const avatarId = deterministicUuid(`avatar:${member}`);
    members.push({ influencerId, avatarId });
    await adminPool.query(`INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,display_name,status,canonical_key)
      VALUES ($1,$2,$3,$4,'heygen','avatar',$5,$6,'active',$7)`,
    [avatarId, OWNER, WORKSPACE, ids.account, `offline-avatar-${member}`, `Synthetic avatar ${member}`,
      `heygen:${ids.account}:offline-avatar-${member}`]);
    await adminPool.query(`INSERT INTO ai_media_influencers
      (id,owner_user_id,workspace_id,name,slug,status,language,default_voice_resource_id,default_avatar_resource_id)
      VALUES ($1,$2,$3,$4,$5,'active','en',$6,$7)`,
    [influencerId, OWNER, WORKSPACE, `Synthetic creator ${member}`, `synthetic-creator-${member}`, ids.voice, avatarId]);
  }

  await adminPool.query(`INSERT INTO ai_media_source_items
    (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,rights_status,moderation_status,payload)
    VALUES ($1,$2,$3,'events','offline-owned-source','Synthetic source','Offline owned source',$4,'ready','owned','approved','{}')`,
  [ids.source, OWNER, WORKSPACE, digest("offline-owned-source")]);
  await adminPool.query(`INSERT INTO ai_media_scripts
    (id,owner_user_id,workspace_id,influencer_id,source_type,source_item_id,title,language,status,current_variant_id)
    VALUES ($1,$2,$3,$4,'events',$5,'Synthetic launch','en','approved',$6)`,
  [ids.script, OWNER, WORKSPACE, members[0]!.influencerId, ids.source, ids.variant]);
  await adminPool.query(`INSERT INTO ai_media_script_variants
    (id,owner_user_id,workspace_id,script_id,version,content,checksum,status)
    VALUES ($1,$2,$3,$4,1,$5,$6,'approved')`,
  [ids.variant, OWNER, WORKSPACE, ids.script, SCRIPT_CONTENT, SCRIPT_CHECKSUM]);

  await adminPool.query(`INSERT INTO ai_media_daily_plans
    (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
     source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
     idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'heygen',1,'offline-five-roster',$6,
      (clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC','planned',50,'offline-plan-idempotency',$7,$8)`,
  [ids.plan, OWNER, WORKSPACE, `plan_${"5".repeat(24)}`, ids.account, digest("five-roster"),
    digest("plan-input"), digest("plan")]);

  let selectedSlot = "";
  for (let member = 0; member < members.length; member += 1) {
    for (let video = 1; video <= 10; video += 1) {
      const slotId = deterministicUuid(`slot:${member + 1}:${video}`);
      const selected = member === 0 && video === 1;
      if (selected) selectedSlot = slotId;
      const scriptId = selected ? ids.script : deterministicUuid(`script:${member + 1}:${video}`);
      const variantId = selected ? ids.variant : deterministicUuid(`variant:${member + 1}:${video}`);
      if (!selected) {
        const content = `${SCRIPT_CONTENT} Subject member ${member + 1}, video ${video}.`;
        const checksum = createHash("sha256").update(content).digest("hex");
        await adminPool.query(`INSERT INTO ai_media_scripts
          (id,owner_user_id,workspace_id,influencer_id,source_type,source_item_id,title,language,status,current_variant_id)
          VALUES ($1,$2,$3,$4,'events',$5,$6,'en','approved',$7)`,
        [scriptId, OWNER, WORKSPACE, members[member]!.influencerId, ids.source,
          `Synthetic launch ${member + 1}-${video}`, variantId]);
        await adminPool.query(`INSERT INTO ai_media_script_variants
          (id,owner_user_id,workspace_id,script_id,version,content,checksum,status)
          VALUES ($1,$2,$3,$4,1,$5,$6,'approved')`,
        [variantId, OWNER, WORKSPACE, scriptId, content, checksum]);
      }
      await adminPool.query(`INSERT INTO ai_media_daily_plan_slots
        (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
         provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
         script_variant_id,video_number,status,slot_digest,state_version)
        VALUES ($1,$2,$3,$4,$5,$6,'heygen',1,$7,$8,$9,$10,$11,$12,'planned',$13,1)`,
      [slotId, OWNER, WORKSPACE, `slot_${createHash("sha256").update(`${member}:${video}`).digest("hex").slice(0, 24)}`,
        ids.plan, ids.account, `member-${member + 1}`, members[member]!.influencerId, members[member]!.avatarId,
        ids.voice, variantId, video, digest(`slot:${member + 1}:${video}`)]);
    }
  }

  await adminPool.query(`INSERT INTO ai_media_governance_profiles
    (id,owner_user_id,workspace_id,influencer_id,avatar_resource_id,voice_resource_id,version,
     consent_basis,rights_basis,proof_digest,evidence_digest,state,valid_from,expires_at,allowed_uses,territories,
     policy_version,actor_user_id,idempotency_key,input_digest)
    VALUES ($1,$2,$3,$4,$5,$6,1,'synthetic_not_applicable','owned',$7,$8,'active',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','["internal_preview"]','["WORLDWIDE"]',
      'offline-only','offline-operator','offline-governance',$9)`,
  [ids.governance, OWNER, WORKSPACE, members[0]!.influencerId, members[0]!.avatarId, ids.voice,
    digest("governance-proof"), digest("governance-evidence"), digest("governance-input")]);
  await adminPool.query(`INSERT INTO ai_media_admission_policy_revisions
    (id,owner_user_id,workspace_id,revision,daily_budget_micro_usd,total_concurrency,provider_concurrency,
     tenant_concurrency,allowed_languages,allowed_countries,allowed_time_zones,state,valid_from,expires_at,
     policy_digest,evidence_digest,input_digest,actor_user_id,idempotency_key)
    VALUES ($1,$2,$3,1,5000000,1,1,1,'["en"]','["US"]','["UTC"]','active',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$4,$5,$6,
      'offline-operator','offline-policy')`,
  [ids.policy, OWNER, WORKSPACE, digest("policy"), digest("policy-evidence"), digest("policy-input")]);
  await adminPool.query(`INSERT INTO ai_media_kill_switch_revisions
    (id,owner_user_id,workspace_id,revision,active,valid_from,expires_at,reason,evidence_digest,input_digest,
     actor_user_id,idempotency_key)
    VALUES ($1,$2,$3,1,false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',
      'offline rehearsal enabled',$4,$5,'offline-operator','offline-kill')`,
  [ids.kill, OWNER, WORKSPACE, digest("kill-evidence"), digest("kill-input")]);
  await adminPool.query(`INSERT INTO ai_media_budget_buckets
    (id,owner_user_id,workspace_id,budget_date,accounting_time_zone,currency,limit_micro_usd,
     reserved_micro_usd,committed_micro_usd,policy_digest,policy_version,state_version)
    VALUES ($1,$2,$3,(clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC','USD',5000000,0,0,$4,1,1)`,
  [ids.bucket, OWNER, WORKSPACE, digest("policy")]);

  const launchSubjectDigest = digest("launch-subject");
  const launchIntentDigest = digest("launch-intent");
  await adminPool.query(`INSERT INTO ai_media_launch_intents
    (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,provider_account_id,
     provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,
     source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,
     source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,governance_territory,
     content_country,launch_subject_digest,launch_intent_digest,actor_user_id,input_digest,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,1,$6,'heygen',1,$7,$8,'offline-five-roster',$9,'member-1',$10,$11,$12,
      'events',$13,$14,$15,$16,'internal_preview','WORLDWIDE','US',$17,$18,'offline-operator',$19,'offline-intent')`,
  [ids.intent, OWNER, WORKSPACE, ids.plan, selectedSlot, ids.account, digest("plan"), digest("slot:1:1"),
    digest("five-roster"), ids.script, ids.variant, SCRIPT_CHECKSUM, ids.source, digest("offline-owned-source"),
    ids.governance, digest("governance-evidence"), launchSubjectDigest, launchIntentDigest, digest("intent-input")]);

  const evidence = [
    [ids.contentEvidence, "content_approval", "approved", null, null, null, null, digest("content-evidence")],
    [ids.humanEvidence, "human_launch_approval", "approved", null, null, null, null, digest("human-evidence")],
    [ids.sandboxEvidence, "sandbox_proof", "passed", null, null, "synthetic-offline-sandbox", digest("sandbox-source"), digest("sandbox-evidence")],
    [ids.quoteEvidence, "maximum_quote", "quoted", "1250000", "USD", "synthetic-offline-quote", digest("quote-source"), digest("quote-evidence")],
  ] as const;
  for (const [id, kind, decision, amount, currency, attestation, sourceDigest, evidenceDigest] of evidence) {
    await adminPool.query(`INSERT INTO ai_media_launch_evidence
      (id,owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version,
       slot_attempt,script_variant_id,script_variant_checksum,governance_profile_id,governance_evidence_digest,
       governance_use,governance_territory,content_country,launch_subject_digest,launch_intent_id,
       launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,revision,valid_from,expires_at,
       actor_user_id,source_kind,source_attestation_id,source_evidence_digest,evidence_digest,input_digest,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,'heygen',1,1,$6,$7,$8,$9,'internal_preview','WORLDWIDE','US',$10,$11,$12,$13,$14,
       $15,$16,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','offline-operator',
       'offline-disposable-db',$17,$18,$19,$20,$21)`,
    [id, OWNER, WORKSPACE, selectedSlot, ids.account, ids.variant, SCRIPT_CHECKSUM, ids.governance,
      digest("governance-evidence"), launchSubjectDigest, ids.intent, launchIntentDigest, kind, decision, amount,
      currency, attestation, sourceDigest, evidenceDigest, digest(`${kind}-input`), `offline-${kind}`]);
  }

  await adminPool.query(`INSERT INTO ai_media_launch_authority_snapshots
    (id,owner_user_id,workspace_id,daily_plan_id,plan_digest,daily_plan_slot_id,slot_digest,provider_account_id,
     provider_key,provider_credential_version,slot_attempt,script_variant_id,script_variant_checksum,
     governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
     launch_subject_digest,content_approval_evidence_id,launch_intent_id,launch_intent_digest,
     content_approval_evidence_digest,human_launch_approval_evidence_id,human_launch_approval_evidence_digest,
     sandbox_evidence_id,sandbox_evidence_digest,maximum_quote_evidence_id,maximum_quote_evidence_digest,
     policy_revision_id,policy_revision,policy_digest,kill_switch_revision_id,kill_switch_revision,
     kill_switch_evidence_digest,maximum_quote_micro_usd,currency,valid_from,expires_at,admission_digest,
     authority_digest,input_digest,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'heygen',1,1,$9,$10,$11,$12,'internal_preview','WORLDWIDE','US',$13,$14,$15,$16,
      $17,$18,$19,$20,$21,$22,$23,$24,1,$25,$26,1,$27,1250000,'USD',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '30 minutes',$28,$29,$30,'offline-snapshot')`,
  [ids.snapshot, OWNER, WORKSPACE, ids.plan, digest("plan"), selectedSlot, digest("slot:1:1"), ids.account,
    ids.variant, SCRIPT_CHECKSUM, ids.governance, digest("governance-evidence"), launchSubjectDigest,
    ids.contentEvidence, ids.intent, launchIntentDigest, digest("content-evidence"), ids.humanEvidence,
    digest("human-evidence"), ids.sandboxEvidence, digest("sandbox-evidence"), ids.quoteEvidence,
    digest("quote-evidence"), ids.policy, digest("policy"), ids.kill, digest("kill-evidence"),
    digest("admission"), digest("authority"), digest("snapshot-input")]);

  return { slotId: selectedSlot, influencerId: members[0]!.influencerId, avatarId: members[0]!.avatarId };
}

integrationTest("offline PG16 exact-22-migration rehearsal durably completes one valid 5x10 slot and links its owned artifact without publishing", async () => {
  await applyExactMigrationChain();
  const selected = await seedValidFiveByTenSubject();
  const subject = await adminPool.query<{ creator_groups: string; influencers: string; min_videos: number; max_videos: number }>(`
    SELECT count(*)::text creator_groups,count(DISTINCT influencer_id)::text influencers,
      min(member_videos)::integer min_videos,max(member_videos)::integer max_videos
    FROM (SELECT influencer_id,count(*)::integer member_videos FROM ai_media_daily_plan_slots
      WHERE daily_plan_id=$1 GROUP BY influencer_id) members`, [ids.plan]);
  assert.deepEqual(subject.rows[0], { creator_groups: "5", influencers: "5", min_videos: 10, max_videos: 10 });
  const totalSlots = await adminPool.query<{ count: string }>(
    "SELECT count(*)::text count FROM ai_media_daily_plan_slots WHERE daily_plan_id=$1", [ids.plan]);
  assert.equal(totalSlots.rows[0]!.count, "50");
  const approvedBindings = await adminPool.query<{ count: string }>(`SELECT count(*)::text count
    FROM ai_media_daily_plan_slots slot
    JOIN ai_media_script_variants variant ON variant.id=slot.script_variant_id
      AND variant.owner_user_id=slot.owner_user_id AND variant.workspace_id=slot.workspace_id
      AND variant.status='approved' AND variant.checksum IS NOT NULL
    JOIN ai_media_scripts script ON script.id=variant.script_id AND script.influencer_id=slot.influencer_id
      AND script.current_variant_id=variant.id AND script.status='approved'
    WHERE slot.daily_plan_id=$1 AND slot.status='planned'`, [ids.plan]);
  assert.equal(approvedBindings.rows[0]!.count, "50", "every slot in the 5x10 subject must have an approved exact script binding");

  const db = adminRepositoryDatabase();
  const admissionRepository = new DrizzleDailyAdmissionRepository(db, { accountingTimeZone: "UTC" });
  const unsignedAdmission = {
    scope: { ownerUserId: OWNER, workspaceId: WORKSPACE }, planId: ids.plan, slotId: selected.slotId,
    budgetBucketId: ids.bucket, authoritySnapshotId: ids.snapshot, authorityDigest: digest("authority"),
    expectedSlotStateVersion: 1, expectedBucketStateVersion: 1,
    reservationExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    idempotencyKey: "offline-one-slot-admission",
  };
  const admission = await admissionRepository.reserveAndAdmit({
    ...unsignedAdmission, inputDigest: admissionRepository.inputDigest(unsignedAdmission),
  });
  assert.equal(admission.reservation.state, "reserved");
  const held = await adminPool.query<{ job: string; outbox: string; slot: string }>(`
    SELECT job.stage job,outbox.status outbox,slot.status slot FROM ai_media_budget_reservations reservation
    JOIN ai_media_render_jobs job ON job.id=reservation.render_job_id
    JOIN ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
    JOIN ai_media_daily_plan_slots slot ON slot.id=reservation.daily_plan_slot_id WHERE reservation.id=$1`,
  [admission.reservation.id]);
  assert.deepEqual(held.rows[0], { job: "admission_held", outbox: "held", slot: "reserved" });

  const activationRepository = new DrizzleHeldWorkActivationRepository(db, { accountingTimeZone: "UTC" });
  const unsignedActivation = {
    scope: unsignedAdmission.scope, budgetReservationId: admission.reservation.id,
    workHandoffDigest: admission.reservation.workHandoffDigest, requestedBy: "offline-operator",
    idempotencyKey: "offline-one-slot-activation",
  };
  const activation = await activationRepository.activate({
    ...unsignedActivation, inputDigest: activationRepository.inputDigest(unsignedActivation),
    principal: { capability: "activate-held-work", actorUserId: "offline-operator" } as TrustedActivationPrincipal,
  });
  assert.deepEqual(activation.effects, {
    renderQueued: true, outboxPending: true, slotQueued: true, budgetCommitted: false, providerCalled: false,
  });

  const submitLane = capabilityLane(SUBMIT_LOGIN, SUBMIT_ROLE);
  const reconcileLane = capabilityLane(RECONCILE_LOGIN, RECONCILE_ROLE);
  const admittedRepository = new DrizzleAdmittedRenderRepository(
    { submit: submitLane, reconcile: reconcileLane },
    { scope: unsignedAdmission.scope, submitCapabilityId: ids.submitCapability, reconcileCapabilityId: ids.reconcileCapability },
  );
  let submitCalls = 0;
  let reconcileCalls = 0;
  let submittedKey = "";
  const submitWorker = new AdmittedRenderWorker({
    workerId: "offline-submit-worker",
    leaseDurationMs: 60_000,
    repository: admittedRepository,
    providerResolver: {
      async resolve(authorization: AdmittedAuthorizedIdentity) {
        const capability = {
          scope: authorization.scope,
          providerAccountId: authorization.providerAccountId,
          providerKey: authorization.providerKey,
          providerCredentialVersion: authorization.providerCredentialVersion,
          authorizationDigest: authorization.authorizationDigest,
        } as ExactAdmittedProviderCapability;
        return { capability, provider: {
          async submit(request, context) {
            submitCalls += 1;
            submittedKey = context.providerIdempotencyKey;
            assert.equal(request.script, SCRIPT_CONTENT);
            assert.equal(context.avatarExternalResourceId, "offline-avatar-1");
            assert.equal(context.voiceExternalResourceId, "offline-voice");
            return { kind: "confirmed" as const, providerJobId: "offline-provider-job-1",
              providerRequestId: "offline-provider-request-1", evidenceDigest: digest("submit-confirmed") };
          },
          async reconcile() { reconcileCalls += 1; return { kind: "unknown" as const }; },
        } };
      },
    },
  });
  const submitted = await submitWorker.runNext();
  assert.equal(submitted.outcome, "confirmed");
  assert.match(submittedKey, /^admit:[0-9a-f]{64}$/u);
  assert.equal((await submitWorker.runNext()).outcome, "idle");
  assert.deepEqual({ submitCalls, reconcileCalls }, { submitCalls: 1, reconcileCalls: 0 });

  const terminalRepository = new DrizzleAdmittedRenderTerminalRepository(
    { reconcile: reconcileLane }, { scope: unsignedAdmission.scope, reconcileCapabilityId: ids.reconcileCapability },
  );
  let terminalObservations = 0;
  const terminalWorker = new AdmittedRenderTerminalWorker({
    workerId: "offline-reconcile-worker",
    leaseDurationMs: 60_000,
    repository: terminalRepository,
    providerResolver: {
      async resolveTerminal(claim) {
        const capability = {
          scope: claim.scope, providerAccountId: claim.providerAccountId, providerKey: claim.providerKey,
          providerCredentialVersion: claim.providerCredentialVersion, authorizationDigest: claim.authorizationDigest,
        } as ExactAdmittedProviderCapability;
        return { capability, provider: { async observeTerminal(context) {
          terminalObservations += 1;
          assert.equal(context.providerJobId, "offline-provider-job-1");
          return { kind: "completed" as const, observedAt: new Date().toISOString(),
            remoteArtifactRef: context.providerJobId,
            sourceUrl: "https://offline.invalid/ephemeral-render.mp4?synthetic=1",
            sourceUrlPolicy: "ephemeral_refresh_via_provider_get" as const,
            mediaType: "video/mp4" as const, durationSeconds: 12, evidenceDigest: digest("terminal-completed") };
        } } };
      },
    },
  });
  const terminal = await terminalWorker.runNext();
  assert.deepEqual(terminal, { outcome: "completed", attemptId: submitted.attemptId, finalization: "applied" });
  assert.equal((await terminalWorker.runNext()).outcome, "idle");
  assert.equal(terminalObservations, 1);

  const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109]);
  const stored = new Map<string, Uint8Array>();
  const storage: OwnedObjectStorage = {
    async beginUpload({ temporaryObjectKey }) {
      const chunks: Uint8Array[] = [];
      return {
        async write(chunk) { chunks.push(Uint8Array.from(chunk)); },
        async commit(metadata) {
          const bytes = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
          assert.equal(bytes.byteLength, metadata.sizeBytes);
          assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.sha256);
          const prefix = temporaryObjectKey.split("/ingest/", 1)[0]!;
          const finalObjectKey = `${prefix}/sha256/${metadata.sha256}.mp4`;
          stored.set(finalObjectKey, bytes);
          return { finalObjectKey, reused: false };
        },
        async abort() { chunks.length = 0; },
      };
    },
  };
  const durableIngest = await adminPool.query<{
    id: string; render_job_id: string; remote_artifact_ref: string; remote_url: string;
  }>(`SELECT id,render_job_id,remote_artifact_ref,remote_url FROM ai_media_asset_ingest_jobs
    WHERE render_job_id=$1`, [admission.reservation.renderJobId]);
  assert.equal(durableIngest.rowCount, 1);
  const ingestRepository = new DrizzleAssetIngestRepository(database);
  const artifactBindingLoader = new DrizzleAdmittedProviderArtifactBindingLoader(database);
  const mediaAssets = new DrizzleMediaAssetRepository(database, { workspaceId: WORKSPACE });
  let readerCalls = 0;
  let resolverCalls = 0;
  let materializationError: unknown;
  const ingestWorker = new AssetIngestWorker({
    workerId: "offline-asset-worker",
    repository: ingestRepository,
    reader: { async open(request): Promise<ArtifactReadStream> {
      readerCalls += 1;
      assert.equal(request.url, "https://offline.invalid/refreshed-render.mp4?synthetic=2");
      return { finalUrl: request.url, mimeType: "video/mp4", declaredSizeBytes: mp4.byteLength,
        chunks: (async function* () { yield mp4; })(), abort() {} };
    } },
    providerArtifactResolver: { async resolveArtifact(request) {
      resolverCalls += 1;
      const binding = await artifactBindingLoader.load(request);
      assert.ok(binding, "actively leased ingest must resolve through the exact admitted evidence graph");
      assert.equal(binding.jobId, request.jobId);
      assert.equal(binding.renderJobId, admission.reservation.renderJobId);
      assert.equal(binding.remoteArtifactRef, request.remoteArtifactRef);
      assert.equal(binding.providerJobId, "offline-provider-job-1");
      assert.equal(binding.providerAccountId, selected.providerAccountId);
      assert.equal(binding.providerKey, "heygen");
      assert.equal(binding.providerCredentialVersion, 1);
      assert.deepEqual(binding.scope, { ownerUserId: OWNER, workspaceId: WORKSPACE });
      return { remoteArtifactRef: request.remoteArtifactRef,
        sourceUrl: "https://offline.invalid/refreshed-render.mp4?synthetic=2", mediaType: "video/mp4",
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get" };
    } },
    sourcePolicy: { allowedHosts: new Set(["offline.invalid"]), requireHttps: true, requireStandardPort: true,
      maxRedirects: 0, async resolvePublicAddresses() { throw new Error("offline reader performs no DNS"); } },
    storage,
    leaseDurationMs: 60_000,
    maxArtifactBytes: 1024,
    maxChunkBytes: 1024,
    retry: { baseDelayMs: 0, maxDelayMs: 0 },
    hooks: { async onCompleted(job) {
      try {
        assert.ok(job.ownedObjectKey && job.sha256 && job.sizeBytes);
        const now = new Date().toISOString();
        const result = await mediaAssets.createOrGet({
          id: ids.asset, ownerUserId: OWNER, workspaceId: WORKSPACE, type: "video",
          name: "Offline owned rehearsal render", status: "ready", mimeType: "video/mp4",
          sizeBytes: job.sizeBytes, checksumSha256: job.sha256, storageProvider: "owned-object-storage",
          storageKey: job.ownedObjectKey, deliveryUrl: null, thumbnailUrl: null, projectId: null,
          renderJobId: job.renderJobId, influencerId: selected.influencerId, providerResourceId: selected.avatarId,
          source: { kind: "remote" }, metadata: { durationMs: 12_000 }, createdAt: now, updatedAt: now, deletedAt: null,
        });
        return { mediaAssetId: result.asset.id };
      } catch (error) {
        materializationError = error;
        throw error;
      }
    } },
  });
  const ingested = await ingestWorker.runNext();
  if (materializationError) throw materializationError;
  assert.equal(ingested.outcome, "completed");
  if (ingested.outcome !== "completed") assert.fail("owned ingest did not complete");
  assert.equal(ingested.job.mediaAssetId, ids.asset);
  const ownedAsset = await mediaAssets.get(OWNER, ids.asset);
  assert.ok(ownedAsset);
  assert.equal(ownedAsset.storageProvider, "owned-object-storage");
  assert.equal(ownedAsset.deliveryUrl, null);
  assert.equal(ownedAsset.renderJobId, admission.reservation.renderJobId);
  assert.equal((await ingestWorker.runNext()).outcome, "idle");
  assert.deepEqual({ readerCalls, resolverCalls, storedObjects: stored.size }, { readerCalls: 1, resolverCalls: 1, storedObjects: 1 });

  const ledger = await adminPool.query<{
    reservation_state: string; submission_state: string; reserved: string; committed: string;
    capacity_state: string; capacity_release: string; attempt_state: string; terminal_state: string;
    ingest_state: string; media_asset_id: string | null; render_stage: string; render_status: string;
    output_media_asset_id: string | null;
  }>(`SELECT reservation.state reservation_state,reservation.submission_state,
      bucket.reserved_micro_usd::text reserved,bucket.committed_micro_usd::text committed,
      capacity.state capacity_state,capacity.release_kind capacity_release,attempt.state attempt_state,
      terminal.state terminal_state,ingest.state ingest_state,ingest.media_asset_id::text,
      render.stage render_stage,render.status render_status,render.output_media_asset_id::text
    FROM ai_media_budget_reservations reservation
    JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
    JOIN ai_media_render_jobs render ON render.id=reservation.render_job_id
    JOIN ai_media_provider_submission_attempts attempt ON attempt.budget_reservation_id=reservation.id
    JOIN ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
    JOIN ai_media_provider_terminal_checks terminal ON terminal.submission_attempt_id=attempt.id
    JOIN ai_media_asset_ingest_jobs ingest ON ingest.render_job_id=render.id
    WHERE reservation.id=$1`, [admission.reservation.id]);
  assert.deepEqual(ledger.rows[0], {
    reservation_state: "committed", submission_state: "confirmed", reserved: "0", committed: "1250000",
    capacity_state: "released", capacity_release: "provider_terminal", attempt_state: "confirmed",
    terminal_state: "terminal", ingest_state: "completed", media_asset_id: ids.asset,
    render_stage: "completed", render_status: "completed", output_media_asset_id: ids.asset,
  });
  const counts = await adminPool.query<{ attempts: string; confirmed_events: string; terminal_events: string;
    assets: string; publishing_jobs: string; publications: string }>(`SELECT
      (SELECT count(*)::text FROM ai_media_provider_submission_attempts) attempts,
      (SELECT count(*)::text FROM ai_media_provider_submission_events WHERE event_kind='confirmed') confirmed_events,
      (SELECT count(*)::text FROM ai_media_provider_terminal_events WHERE terminal_state='completed') terminal_events,
      (SELECT count(*)::text FROM ai_media_assets WHERE id=$1 AND storage_provider='owned-object-storage'
        AND public_url IS NULL AND deleted_at IS NULL) assets,
      (SELECT count(*)::text FROM ai_media_publishing_jobs) publishing_jobs,
      (SELECT count(*)::text FROM ai_media_publications) publications`, [ids.asset]);
  assert.deepEqual(counts.rows[0], { attempts: "1", confirmed_events: "1", terminal_events: "1",
    assets: "1", publishing_jobs: "0", publications: "0" });
});
