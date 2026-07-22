import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  DrizzleLaunchAuthorityRepository,
  type LaunchAuthorityTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-launch-authority-repository";
import type {
  LaunchAuthorityPrincipalAuthenticator,
  TrustedLaunchAuthorityPrincipal,
} from "../server/ai-media-studio/planning/launch-authority-contracts";
import { LaunchAuthorityServiceError } from "../server/ai-media-studio/planning/launch-authority-contracts";
import { LaunchAuthorityService } from "../server/ai-media-studio/planning/launch-authority-service";
import {
  DrizzleLaunchPreflightRepository,
  type LaunchPreflightTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-launch-preflight-repository";
import { LaunchPreflightError } from "../server/ai-media-studio/planning/launch-preflight-contracts";
import { LaunchPreflightService } from "../server/ai-media-studio/planning/launch-preflight-service";
import {
  DrizzleProductionBatchRepository,
  type ProductionBatchDatabase,
} from "../server/ai-media-studio/production-batches/drizzle-repository";
import { ProductionBatchService } from "../server/ai-media-studio/production-batches/service";
import { launchPreflightGateCodes, launchPreflightSchema } from "../shared/ai-media-studio-launch-preflight";

type MigrationFile = { path: string; sha256: string };
type Manifest = { migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> } };
type Scope = { ownerUserId: string; workspaceId: string };
type Fixture = { scope: Scope; planId: string; planUuid: string; batchId: string; account: string;
  slots: string[]; influencers: string[]; avatars: string[]; voice: string };

const TEMP_PREFIX = "ams-offline-preflight-pg-";
const DATABASE = "ams_offline_preflight_test";
const PORT = "55435";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8",
)) as Manifest;
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const digest = (value: string): string => `sha256:${hash(value)}`;

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("offline preflight requires only owned TEST_DATABASE_URL");
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
const pool = new Pool({ connectionString: enabled ? requireOwnedUrl()
  : "postgresql://postgres@localhost/ams_offline_preflight_disabled", max: 20, allowExitOnIdle: true });
after(async () => pool.end());

function migration(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(hash(bytes), file.sha256, `${file.path} differs from reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyFullChain(): Promise<void> {
  assert.equal(manifest.migrations.length, 22);
  for (const entry of manifest.migrations) {
    if (entry.pullRequest === "PR26") {
      for (const role of manifest.pr26.requiredRoles) {
        assert.equal(role.login, false); assert.equal(role.inherit, false);
        await pool.query(`CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    await pool.query(migration(entry.forward));
  }
}

function uuid(seed: string): string {
  const hex = hash(seed).slice(0, 32).split(""); hex[12] = "4"; hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function key(prefix: "plan" | "slot" | "member", seed: string): string {
  return `${prefix}_${hash(seed).slice(0, 24)}`;
}

const database = drizzle(pool);
const production = new ProductionBatchService(new DrizzleProductionBatchRepository(database as unknown as ProductionBatchDatabase));
const preflight = new LaunchPreflightService(new DrizzleLaunchPreflightRepository(
  database as unknown as LaunchPreflightTransactionalDatabase,
));

async function seedFixture(label: string, avatarCount: 5 | 10): Promise<Fixture> {
  const scope = { ownerUserId: `preflight-owner-${label}`, workspaceId: `preflight-workspace-${label}` };
  const account = uuid(`${label}:account`); const voice = uuid(`${label}:voice`);
  const planUuid = uuid(`${label}:plan`); const planId = key("plan", label);
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'generic-video','Offline provider','connected','active',1,'legacy_authorized_unbound')`,
  [account, scope.ownerUserId, scope.workspaceId]);
  await pool.query(`INSERT INTO ai_media_provider_resources
    (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,display_name,status,canonical_key)
    VALUES ($1,$2,$3,$4,'generic-video','voice',$5,'Offline voice','active',$6)`,
  [voice, scope.ownerUserId, scope.workspaceId, account, `${label}-voice`, `generic-video:${account}:${label}-voice`]);
  const members: Array<{ influencer: string; avatar: string; member: string }> = [];
  for (let index = 1; index <= avatarCount; index += 1) {
    const influencer = uuid(`${label}:influencer:${index}`); const avatar = uuid(`${label}:avatar:${index}`);
    members.push({ influencer, avatar, member: key("member", `${label}:${index}`) });
    await pool.query(`INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,display_name,status,canonical_key)
      VALUES ($1,$2,$3,$4,'generic-video','avatar',$5,$6,'active',$7)`,
    [avatar, scope.ownerUserId, scope.workspaceId, account, `${label}-avatar-${index}`,
      `${label} Avatar ${index}`, `generic-video:${account}:${label}-avatar-${index}`]);
    await pool.query(`INSERT INTO ai_media_influencers
      (id,owner_user_id,workspace_id,name,slug,status,language,default_voice_resource_id,default_avatar_resource_id)
      VALUES ($1,$2,$3,$4,$5,'active','es-US',$6,$7)`,
    [influencer, scope.ownerUserId, scope.workspaceId, `${label} Creator ${index}`, `${label}-creator-${index}`, voice, avatar]);
  }
  await pool.query(`INSERT INTO ai_media_daily_plans
    (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
     source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'generic-video',1,$6,$7,(transaction_timestamp() AT TIME ZONE 'UTC')::date,
      'UTC','blocked',$8,$9,$10,$11)`,
  [planUuid, scope.ownerUserId, scope.workspaceId, planId, account, `roster-${label}`, digest(`${label}:roster`),
    avatarCount * 10, `plan-${label}-idem`, digest(`${label}:input`), digest(`${label}:plan`)]);
  const slots: string[] = [];
  for (const [memberIndex, member] of members.entries()) for (let video = 1; video <= 10; video += 1) {
    const slot = uuid(`${label}:slot:${memberIndex}:${video}`); slots.push(slot);
    await pool.query(`INSERT INTO ai_media_daily_plan_slots
      (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
       provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
       video_number,status,slot_digest,state_version)
      VALUES ($1,$2,$3,$4,$5,$6,'generic-video',1,$7,$8,$9,$10,$11,'blocked',$12,1)`,
    [slot, scope.ownerUserId, scope.workspaceId, key("slot", `${label}:${memberIndex}:${video}`), planUuid,
      account, member.member, member.influencer, member.avatar, voice, video, digest(`${label}:slot:${memberIndex}:${video}`)]);
  }
  for (let index = 1; index <= 10; index += 1) {
    const content = `${label} offline source ${index}`;
    await pool.query(`INSERT INTO ai_media_source_items
      (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,rights_status,moderation_status,payload)
      VALUES ($1,$2,$3,'events',$4,$5,$6,$7,'ready','owned','approved','{}')`,
    [uuid(`${label}:source:${index}`), scope.ownerUserId, scope.workspaceId, `${label}-source-${index}`,
      `${label} Source ${index}`, content, digest(content)]);
  }
  const prepared = await production.prepare(scope, planId, { idempotencyKey: `${label}-prepare-idem-0001`, variantCount: 3 });
  await production.approve(scope, planId, { idempotencyKey: `${label}-approve-idem-0001`, expectedBatchId: prepared.batchId });
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index]!;
    await pool.query(`INSERT INTO ai_media_governance_profiles
      (id,owner_user_id,workspace_id,influencer_id,avatar_resource_id,voice_resource_id,version,
       consent_basis,rights_basis,proof_digest,evidence_digest,state,valid_from,expires_at,allowed_uses,territories,
       policy_version,actor_user_id,idempotency_key,input_digest)
      VALUES ($1,$2,$3,$4,$5,$6,1,'synthetic_not_applicable','owned',$7,$8,'active',
       clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','["paid_ads"]','["WORLDWIDE"]',
       'offline-v1','offline-operator',$9,$10)`,
    [uuid(`${label}:governance:${index}:1`), scope.ownerUserId, scope.workspaceId, member.influencer,
      member.avatar, voice, digest(`${label}:governance-proof:${index}:1`), digest(`${label}:governance:${index}:1`),
      `${label}-governance-${index}-1`, digest(`${label}:governance-input:${index}:1`)]);
  }
  await pool.query(`INSERT INTO ai_media_admission_policy_revisions
    (id,owner_user_id,workspace_id,revision,daily_budget_micro_usd,total_concurrency,provider_concurrency,
     tenant_concurrency,allowed_languages,allowed_countries,allowed_time_zones,state,valid_from,expires_at,
     policy_digest,evidence_digest,input_digest,actor_user_id,idempotency_key)
    VALUES ($1,$2,$3,1,1000000000,1000,1000,1000,'["es-US"]','["US"]','["UTC"]','active',
      clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',$4,$5,$6,'offline-operator',$7)`,
  [uuid(`${label}:policy:1`), scope.ownerUserId, scope.workspaceId, digest(`${label}:policy:1`),
    digest(`${label}:policy-evidence:1`), digest(`${label}:policy-input:1`), `${label}-policy-1`]);
  await pool.query(`INSERT INTO ai_media_kill_switch_revisions
    (id,owner_user_id,workspace_id,revision,active,valid_from,expires_at,reason,evidence_digest,input_digest,actor_user_id,idempotency_key)
    VALUES ($1,$2,$3,1,false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',
      'offline preflight enabled',$4,$5,'offline-operator',$6)`,
  [uuid(`${label}:kill:1`), scope.ownerUserId, scope.workspaceId, digest(`${label}:kill-evidence:1`),
    digest(`${label}:kill-input:1`), `${label}-kill-1`]);
  return { scope, planId, planUuid, batchId: prepared.batchId, account, slots,
    influencers: members.map((entry) => entry.influencer), avatars: members.map((entry) => entry.avatar), voice };
}

async function sideEffects(): Promise<Record<string, number>> {
  const tables = ["ai_media_launch_evidence", "ai_media_launch_intents", "ai_media_launch_authority_snapshots",
    "ai_media_budget_buckets", "ai_media_budget_reservations", "ai_media_render_jobs", "ai_media_outbox",
    "ai_media_provider_submission_attempts"] as const;
  const result: Record<string, number> = {};
  for (const table of tables) {
    const count = await pool.query<{ count: string }>(`SELECT count(*)::text count FROM ${table}`);
    result[table] = Number(count.rows[0]!.count);
  }
  return result;
}

const gate = (result: Awaited<ReturnType<LaunchPreflightService["observe"]>>, code: string) =>
  result.gates.find((entry) => entry.code === code)!;

const authorityPrincipal: TrustedLaunchAuthorityPrincipal = {
    subjectId: "offline-human", kind: "user", capabilities: ["launch_intent:declare"],
  } as never;
function authorityRepository(): DrizzleLaunchAuthorityRepository {
  return new DrizzleLaunchAuthorityRepository(database as unknown as LaunchAuthorityTransactionalDatabase, {
    runtimeAttestationVerifier: { verify: async () => undefined }, validityPolicy: { ttlSeconds: () => 3600 },
  });
}
function authorityService(): LaunchAuthorityService {
  const authenticator: LaunchAuthorityPrincipalAuthenticator = { authenticate: async () => authorityPrincipal };
  return new LaunchAuthorityService({
    authenticator,
    repository: authorityRepository(),
  });
}

integrationTest("PG16 observes exact 5x10 and 10x10 launch readiness without spending or mutation", async () => {
  await applyFullChain();
  const five = await seedFixture("five", 5);
  const ten = await seedFixture("ten", 10);
  for (const fixture of [five, ten]) {
    const before = await sideEffects();
    const lowerClock = await pool.query<{ now: Date }>("SELECT transaction_timestamp() now");
    const result = await preflight.observe(fixture.scope, fixture.planId);
    const upperClock = await pool.query<{ now: Date }>("SELECT transaction_timestamp() now");
    assert.deepEqual(launchPreflightSchema.parse(result), result);
    assert.deepEqual(result.gates.map((entry) => entry.code), launchPreflightGateCodes);
    assert.equal(result.subject.avatarCount, fixture === five ? 5 : 10);
    assert.equal(result.subject.plannedVideoCount, fixture === five ? 50 : 100);
    assert.equal(result.subject.videosPerAvatar, 10);
    assert.equal(result.subject.batchId, fixture.batchId);
    assert.equal(result.status, "offline_ready_for_external_setup");
    assert.deepEqual(result.summary, { totalGates: 14, passedGates: 6, blockedGates: 0,
      pendingExternalGates: 5, pendingHumanGates: 3, unavailableGates: 0,
      readySlots: 0, requiredSlots: fixture === five ? 50 : 100 });
    assert.equal(result.noSpend, true); assert.equal(result.canGenerate, false);
    assert.equal(result.spendAuthorized, false); assert.equal(result.sandboxExecutionAllowed, false);
    assert.equal(result.authoritativeForAdmission, false); assert.ok(Object.values(result.effects).every((value) => !value));
    assert.ok(Date.parse(result.observedAt) >= lowerClock.rows[0]!.now.getTime());
    assert.ok(Date.parse(result.observedAt) <= upperClock.rows[0]!.now.getTime());
    assert.deepEqual(await sideEffects(), before);
    const repeated = await preflight.observe(fixture.scope, fixture.planId);
    assert.deepEqual(repeated.subject, result.subject);
    assert.deepEqual(repeated.gates, result.gates);
    assert.deepEqual(await sideEffects(), before);
    assert.equal(gate(result, "provider_live_verification").state, "pending_external");
    assert.equal(gate(result, "provider_live_verification").readySlots, 0);
    assert.equal(gate(result, "provider_live_verification").reasonCode, "provider_verification_required");
  }

  await assert.rejects(preflight.observe({ ownerUserId: ten.scope.ownerUserId, workspaceId: five.scope.workspaceId }, five.planId),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "NOT_FOUND");

  const originalPlanClock = await pool.query<{ created_at: Date }>("SELECT created_at FROM ai_media_daily_plans WHERE id=$1", [five.planUuid]);
  await pool.query("UPDATE ai_media_daily_plans SET plan_date=plan_date-1,created_at=created_at-interval '1 day' WHERE id=$1", [five.planUuid]);
  let observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "plan_window").reasonCode, "plan_outside_window");
  await pool.query("UPDATE ai_media_daily_plans SET created_at=$2,plan_date=($2 AT TIME ZONE 'UTC')::date WHERE id=$1",
    [five.planUuid, originalPlanClock.rows[0]!.created_at]);

  await pool.query("UPDATE ai_media_provider_accounts SET credential_status='expired' WHERE id=$1", [five.account]);
  observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "provider_binding_local").state, "pending_external");
  await pool.query("UPDATE ai_media_provider_accounts SET credential_status='active' WHERE id=$1", [five.account]);
  await pool.query("UPDATE ai_media_provider_resources SET status='inactive' WHERE id=$1", [five.avatars[0]]);
  observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "provider_binding_local").reasonCode, "provider_resources_invalid");
  await pool.query("UPDATE ai_media_provider_resources SET status='active' WHERE id=$1", [five.avatars[0]]);
  await pool.query("UPDATE ai_media_influencers SET status='paused' WHERE id=$1", [five.influencers[0]]);
  observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "provider_binding_local").readySlots, 40);
  await pool.query("UPDATE ai_media_influencers SET status='active' WHERE id=$1", [five.influencers[0]]);

  await pool.query(`UPDATE ai_media_source_items SET rights_status='unknown'
    WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='five-source-1'`, [five.scope.ownerUserId, five.scope.workspaceId]);
  observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "source_eligibility").reasonCode, "source_changed");
  await pool.query(`UPDATE ai_media_source_items SET rights_status='owned'
    WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='five-source-1'`, [five.scope.ownerUserId, five.scope.workspaceId]);
  for (const [column, blockedValue, restoredValue] of [
    ["moderation_status", "pending", "approved"], ["status", "discovered", "ready"],
  ] as const) {
    await pool.query(`UPDATE ai_media_source_items SET ${column}=$3
      WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='five-source-1'`,
    [five.scope.ownerUserId, five.scope.workspaceId, blockedValue]);
    observed = await preflight.observe(five.scope, five.planId);
    assert.equal(gate(observed, "source_eligibility").reasonCode, "source_changed");
    await pool.query(`UPDATE ai_media_source_items SET ${column}=$3
      WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='five-source-1'`,
    [five.scope.ownerUserId, five.scope.workspaceId, restoredValue]);
  }

  const bridgeBefore = await sideEffects();
  const bridgeCommand = { scope: five.scope, dailyPlanSlotId: five.slots[0]!,
    slotAttempt: 1, governanceUse: "paid_ads", governanceTerritory: "US", contentCountry: "US",
    idempotencyKey: "offline-pr144-bridge-intent-0001" } as const;
  const receipt = await authorityService().declareLaunchIntent({}, bridgeCommand);
  assert.equal(receipt.kind, "launch_intent"); assert.equal(receipt.replayed, false);
  observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "launch_intent").readySlots, 1);
  assert.equal(gate(observed, "launch_intent").reasonCode, "launch_intent_not_current");
  const bridgeAfter = await sideEffects();
  assert.equal(bridgeAfter.ai_media_launch_intents, bridgeBefore.ai_media_launch_intents + 1);
  const observationBaseline = { ...bridgeAfter };
  await preflight.observe(five.scope, five.planId);
  assert.deepEqual(await sideEffects(), observationBaseline);

  const changed = "five source changed after PR144 approval";
  const tamperedSlot = await pool.query<{ id: string }>(`SELECT slots.id FROM ai_media_daily_plan_slots slots
    JOIN ai_media_scripts scripts ON scripts.owner_user_id=slots.owner_user_id
      AND scripts.workspace_id=slots.workspace_id AND scripts.current_variant_id=slots.script_variant_id
    JOIN ai_media_source_items sources ON sources.owner_user_id=scripts.owner_user_id
      AND sources.workspace_id=scripts.workspace_id AND sources.id=scripts.source_item_id
    WHERE slots.daily_plan_id=$1 AND sources.external_id='five-source-1'
      AND NOT EXISTS (SELECT 1 FROM ai_media_launch_intents intents
        WHERE intents.owner_user_id=slots.owner_user_id AND intents.workspace_id=slots.workspace_id
          AND intents.daily_plan_slot_id=slots.id)
    ORDER BY slots.public_slot_key LIMIT 1`, [five.planUuid]);
  assert.equal(tamperedSlot.rows.length, 1);
  await pool.query(`UPDATE ai_media_source_items SET content=$3,content_hash=$4
    WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='five-source-1'`,
  [five.scope.ownerUserId, five.scope.workspaceId, changed, digest(changed)]);
  observed = await preflight.observe(five.scope, five.planId);
  assert.equal(gate(observed, "batch_integrity").reasonCode, "batch_ambiguous");
  await assert.rejects(authorityService().declareLaunchIntent({}, { scope: five.scope, dailyPlanSlotId: tamperedSlot.rows[0]!.id,
    slotAttempt: 1, governanceUse: "paid_ads", governanceTerritory: "US", contentCountry: "US",
    idempotencyKey: "offline-pr144-tampered-intent-0002" }),
  (error: unknown) => error instanceof LaunchAuthorityServiceError && error.code === "UNAVAILABLE");
  assert.equal((await sideEffects()).ai_media_launch_intents, bridgeAfter.ai_media_launch_intents);
});
