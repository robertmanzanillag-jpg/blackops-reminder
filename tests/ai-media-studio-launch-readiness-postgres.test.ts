import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProductionBatchError } from "../server/ai-media-studio/production-batches/contracts";
import {
  DrizzleProductionBatchRepository,
  type ProductionBatchDatabase,
} from "../server/ai-media-studio/production-batches/drizzle-repository";
import { ProductionBatchService } from "../server/ai-media-studio/production-batches/service";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};
type Scope = { ownerUserId: string; workspaceId: string };
type Fixture = { scope: Scope; planId: string; planUuid: string };

const TEMP_PREFIX = "ams-readiness-pg-";
const DATABASE = "ams_launch_readiness_test";
const PORT = "55434";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8",
)) as Manifest;
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const digest = (value: string): string => `sha256:${hash(value)}`;

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("readiness test requires only owned TEST_DATABASE_URL");
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
const pool = new Pool({
  connectionString: enabled ? requireOwnedUrl() : "postgresql://postgres@localhost/ams_readiness_disabled",
  max: 20,
  allowExitOnIdle: true,
});
after(async () => pool.end());

function migration(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(hash(bytes), file.sha256, `${file.path} differs from the reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyFullChain(): Promise<void> {
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
}

function uuid(seed: string): string {
  const hex = hash(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function key(prefix: "plan" | "slot" | "member", seed: string): string {
  return `${prefix}_${hash(seed).slice(0, 24)}`;
}

function service(): ProductionBatchService {
  const repository = new DrizzleProductionBatchRepository(drizzle(pool) as unknown as ProductionBatchDatabase);
  return new ProductionBatchService(repository);
}

async function seedFixture(label: string, avatarCount: number, variantCount: number): Promise<Fixture & { batchId: string }> {
  const scope = { ownerUserId: `readiness-owner-${label}`, workspaceId: `readiness-workspace-${label}` };
  const account = uuid(`${label}:account`);
  const voice = uuid(`${label}:voice`);
  const planUuid = uuid(`${label}:plan`);
  const planId = key("plan", label);
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'generic-video','Readiness provider','active','active',1,'legacy_authorized_unbound')`,
  [account, scope.ownerUserId, scope.workspaceId]);
  await pool.query(`INSERT INTO ai_media_provider_resources
    (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,
     display_name,status,canonical_key)
    VALUES ($1,$2,$3,$4,'generic-video','voice',$5,'Readiness voice','active',$6)`,
  [voice, scope.ownerUserId, scope.workspaceId, account, `${label}-voice`, `generic-video:${account}:${label}-voice`]);
  const members: Array<{ influencer: string; avatar: string; member: string }> = [];
  for (let index = 1; index <= avatarCount; index += 1) {
    const influencer = uuid(`${label}:influencer:${index}`);
    const avatar = uuid(`${label}:avatar:${index}`);
    members.push({ influencer, avatar, member: key("member", `${label}:${index}`) });
    await pool.query(`INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,
       display_name,status,canonical_key)
      VALUES ($1,$2,$3,$4,'generic-video','avatar',$5,$6,'active',$7)`,
    [avatar, scope.ownerUserId, scope.workspaceId, account, `${label}-avatar-${index}`,
      `${label} Avatar ${index}`, `generic-video:${account}:${label}-avatar-${index}`]);
    await pool.query(`INSERT INTO ai_media_influencers
      (id,owner_user_id,workspace_id,name,slug,status,language,default_voice_resource_id,default_avatar_resource_id)
      VALUES ($1,$2,$3,$4,$5,'active','es-US',$6,$7)`,
    [influencer, scope.ownerUserId, scope.workspaceId, `${label} Creator ${index}`,
      `${label}-creator-${index}`, voice, avatar]);
  }
  await pool.query(`INSERT INTO ai_media_daily_plans
    (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
     source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
     idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'generic-video',1,$6,$7,(transaction_timestamp() AT TIME ZONE 'UTC')::date,
      'UTC','blocked',$8,$9,$10,$11)`,
  [planUuid, scope.ownerUserId, scope.workspaceId, planId, account, `roster-${label}`, digest(`${label}:roster`),
    avatarCount * 10, `plan-${label}-idem`, digest(`${label}:input`), digest(`${label}:plan`)]);
  for (const [memberIndex, member] of members.entries()) {
    for (let video = 1; video <= 10; video += 1) {
      await pool.query(`INSERT INTO ai_media_daily_plan_slots
        (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
         provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
         video_number,status,slot_digest,state_version)
        VALUES ($1,$2,$3,$4,$5,$6,'generic-video',1,$7,$8,$9,$10,$11,'blocked',$12,1)`,
      [uuid(`${label}:slot:${memberIndex}:${video}`), scope.ownerUserId, scope.workspaceId,
        key("slot", `${label}:${memberIndex}:${video}`), planUuid, account, member.member, member.influencer,
        member.avatar, voice, video, digest(`${label}:slot:${memberIndex}:${video}`)]);
    }
  }
  for (let index = 1; index <= 10; index += 1) {
    const content = `${label} readiness source ${index}`;
    await pool.query(`INSERT INTO ai_media_source_items
      (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,
       status,rights_status,moderation_status,payload)
      VALUES ($1,$2,$3,'events',$4,$5,$6,$7,'ready','owned','approved','{}')`,
    [uuid(`${label}:source:${index}`), scope.ownerUserId, scope.workspaceId, `${label}-source-${index}`,
      `${label} Source ${index}`, content, digest(content)]);
  }
  const prepared = await service().prepare(scope, planId,
    { idempotencyKey: `${label}-prepare-idem-0001`, variantCount });
  assert.equal(prepared.status, "draft_ready");
  return { scope, planId, planUuid, batchId: prepared.batchId };
}

async function state(scope: Scope): Promise<Record<string, number>> {
  const result = await pool.query<Record<string, string>>(`SELECT
    (SELECT count(*)::text FROM ai_media_daily_plans WHERE owner_user_id=$1 AND workspace_id=$2 AND status='planned') plans_planned,
    (SELECT count(*)::text FROM ai_media_daily_plan_slots WHERE owner_user_id=$1 AND workspace_id=$2 AND status='planned') slots_planned,
    (SELECT count(*)::text FROM ai_media_scripts WHERE owner_user_id=$1 AND workspace_id=$2 AND status='approved') scripts_approved,
    (SELECT count(*)::text FROM ai_media_script_variants WHERE owner_user_id=$1 AND workspace_id=$2 AND status='approved') variants_approved`,
  [scope.ownerUserId, scope.workspaceId]);
  return Object.fromEntries(Object.entries(result.rows[0]!).map(([name, count]) => [name, Number(count)]));
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

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof ProductionBatchError && error.code === code);
}

integrationTest("PG16 atomically approves 5→50 and 10→100 while all launch and spend systems remain inert", async () => {
  await applyFullChain();
  const emptySideEffects = {
    ai_media_launch_evidence: 0, ai_media_launch_intents: 0, ai_media_launch_authority_snapshots: 0,
    ai_media_budget_buckets: 0, ai_media_budget_reservations: 0, ai_media_render_jobs: 0,
    ai_media_outbox: 0, ai_media_provider_submission_attempts: 0,
  };
  assert.deepEqual(await sideEffects(), emptySideEffects);

  const five = await seedFixture("five", 5, 1);
  const approveFive = { idempotencyKey: "five-approve-idem-0001", expectedBatchId: five.batchId };
  const [approvedFive, concurrentReplay] = await Promise.all([
    service().approve(five.scope, five.planId, approveFive),
    service().approve(five.scope, five.planId, approveFive),
  ]);
  assert.deepEqual(concurrentReplay, approvedFive);
  assert.equal(approvedFive.status, "approved_ready");
  assert.equal(approvedFive.avatarCount, 5);
  assert.equal(approvedFive.plannedVideoCount, 50);
  assert.equal(approvedFive.canGenerate, false);
  assert.equal(approvedFive.noSpend, true);
  assert.equal(approvedFive.blockers.length, 4);
  assert.deepEqual(await state(five.scope), {
    plans_planned: 1, slots_planned: 50, scripts_approved: 50, variants_approved: 50,
  });
  assert.deepEqual(await service().approve(five.scope, five.planId, approveFive), approvedFive);
  await expectCode(() => service().approve(five.scope, five.planId,
    { ...approveFive, idempotencyKey: "five-approve-conflict-0002" }), "IDEMPOTENCY_CONFLICT");

  const ten = await seedFixture("ten", 10, 5);
  const approvedTen = await service().approve(ten.scope, ten.planId,
    { idempotencyKey: "ten-approve-idem-0001", expectedBatchId: ten.batchId });
  assert.equal(approvedTen.avatarCount, 10);
  assert.equal(approvedTen.plannedVideoCount, 100);
  assert.deepEqual(await state(ten.scope), {
    plans_planned: 1, slots_planned: 100, scripts_approved: 100, variants_approved: 100,
  });
  const unreviewed = await pool.query<{ draft: string; approvals: string }>(`SELECT
    count(*) FILTER (WHERE status='draft')::text draft,
    count(*) FILTER (WHERE metadata ? 'productionBatchApprovalV1')::text approvals
    FROM ai_media_script_variants
    WHERE owner_user_id=$1 AND workspace_id=$2
      AND id<>(SELECT current_variant_id FROM ai_media_scripts
        WHERE owner_user_id=$1 AND workspace_id=$2 AND id=ai_media_script_variants.script_id)`,
  [ten.scope.ownerUserId, ten.scope.workspaceId]);
  assert.deepEqual(unreviewed.rows[0], { draft: "400", approvals: "0" });
  await expectCode(() => service().approve(ten.scope, five.planId,
    { idempotencyKey: "cross-tenant-approve", expectedBatchId: five.batchId }), "NOT_FOUND");

  const staleSource = await seedFixture("stale-source", 5, 2);
  const changed = "source changed after preparation";
  await pool.query(`UPDATE ai_media_source_items SET content=$3,content_hash=$4
    WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='stale-source-source-1'`,
  [staleSource.scope.ownerUserId, staleSource.scope.workspaceId, changed, digest(changed)]);
  await expectCode(() => service().approve(staleSource.scope, staleSource.planId,
    { idempotencyKey: "stale-source-approve", expectedBatchId: staleSource.batchId }), "SOURCE_REFRESHED");
  assert.deepEqual(await state(staleSource.scope), {
    plans_planned: 0, slots_planned: 0, scripts_approved: 0, variants_approved: 0,
  });

  for (const [label, column, value] of [
    ["revoked-rights", "rights_status", "unknown"],
    ["pending-moderation", "moderation_status", "pending"],
    ["discovered-source", "status", "discovered"],
  ] as const) {
    const revoked = await seedFixture(label, 5, 1);
    await pool.query(`UPDATE ai_media_source_items SET ${column}=$3
      WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id=$4`,
    [revoked.scope.ownerUserId, revoked.scope.workspaceId, value, `${label}-source-1`]);
    await expectCode(() => service().approve(revoked.scope, revoked.planId,
      { idempotencyKey: `${label}-approval`, expectedBatchId: revoked.batchId }), "SOURCE_INELIGIBLE");
    assert.deepEqual(await state(revoked.scope), {
      plans_planned: 0, slots_planned: 0, scripts_approved: 0, variants_approved: 0,
    });
  }

  const staleVariant = await seedFixture("stale-variant", 5, 2);
  await pool.query(`UPDATE ai_media_script_variants SET content=content || ' tampered'
    WHERE id=(SELECT id FROM ai_media_script_variants WHERE owner_user_id=$1 AND workspace_id=$2 ORDER BY id LIMIT 1)`,
  [staleVariant.scope.ownerUserId, staleVariant.scope.workspaceId]);
  await expectCode(() => service().approve(staleVariant.scope, staleVariant.planId,
    { idempotencyKey: "stale-variant-approve", expectedBatchId: staleVariant.batchId }), "BATCH_UNAVAILABLE");
  assert.deepEqual(await state(staleVariant.scope), {
    plans_planned: 0, slots_planned: 0, scripts_approved: 0, variants_approved: 0,
  });

  const mixed = await seedFixture("mixed", 5, 2);
  await pool.query(`UPDATE ai_media_scripts SET status='approved'
    WHERE id=(SELECT id FROM ai_media_scripts WHERE owner_user_id=$1 AND workspace_id=$2 ORDER BY id LIMIT 1)`,
  [mixed.scope.ownerUserId, mixed.scope.workspaceId]);
  await expectCode(() => service().approve(mixed.scope, mixed.planId,
    { idempotencyKey: "mixed-state-approve", expectedBatchId: mixed.batchId }), "BATCH_UNAVAILABLE");
  assert.deepEqual(await state(mixed.scope), {
    plans_planned: 0, slots_planned: 0, scripts_approved: 1, variants_approved: 0,
  });

  const rollback = await seedFixture("rollback", 5, 3);
  await pool.query(`CREATE FUNCTION fail_readiness_plan_transition() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.owner_user_id='readiness-owner-rollback' AND NEW.status='planned' THEN
      RAISE EXCEPTION 'intentional readiness rollback'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER fail_readiness_plan_transition BEFORE UPDATE OF status ON ai_media_daily_plans
    FOR EACH ROW EXECUTE FUNCTION fail_readiness_plan_transition()`);
  await assert.rejects(() => service().approve(rollback.scope, rollback.planId,
    { idempotencyKey: "rollback-approve-idem", expectedBatchId: rollback.batchId }), /intentional readiness rollback/u);
  assert.deepEqual(await state(rollback.scope), {
    plans_planned: 0, slots_planned: 0, scripts_approved: 0, variants_approved: 0,
  });
  await pool.query("DROP TRIGGER fail_readiness_plan_transition ON ai_media_daily_plans");
  await pool.query("DROP FUNCTION fail_readiness_plan_transition()");

  const creativeTamper = await seedFixture("creative-tamper", 5, 2);
  await service().approve(creativeTamper.scope, creativeTamper.planId,
    { idempotencyKey: "creative-tamper-approval", expectedBatchId: creativeTamper.batchId });
  await pool.query(`UPDATE ai_media_script_variants SET metadata=jsonb_set(
      metadata,'{productionCreativeV1,cta}','"tampered after approval"'::jsonb)
    WHERE id=(SELECT current_variant_id FROM ai_media_scripts
      WHERE owner_user_id=$1 AND workspace_id=$2 ORDER BY id LIMIT 1)`,
  [creativeTamper.scope.ownerUserId, creativeTamper.scope.workspaceId]);
  await expectCode(() => service().current(creativeTamper.scope), "BATCH_UNAVAILABLE");

  const titleTamper = await seedFixture("title-tamper", 5, 1);
  await service().approve(titleTamper.scope, titleTamper.planId,
    { idempotencyKey: "title-tamper-approval", expectedBatchId: titleTamper.batchId });
  await pool.query(`UPDATE ai_media_scripts SET title='tampered approved title'
    WHERE id=(SELECT id FROM ai_media_scripts
      WHERE owner_user_id=$1 AND workspace_id=$2 ORDER BY id LIMIT 1)`,
  [titleTamper.scope.ownerUserId, titleTamper.scope.workspaceId]);
  await expectCode(() => service().current(titleTamper.scope), "BATCH_UNAVAILABLE");

  const pointerTamper = await seedFixture("pointer-tamper", 5, 2);
  await service().approve(pointerTamper.scope, pointerTamper.planId,
    { idempotencyKey: "pointer-tamper-approval", expectedBatchId: pointerTamper.batchId });
  await pool.query(`WITH replacement AS (
      SELECT scripts.id script_id,variants.id variant_id
      FROM ai_media_scripts scripts
      INNER JOIN ai_media_script_variants variants ON variants.script_id=scripts.id AND variants.version=2
      WHERE scripts.owner_user_id=$1 AND scripts.workspace_id=$2 ORDER BY scripts.id LIMIT 1
    ), changed_script AS (
      UPDATE ai_media_scripts scripts SET current_variant_id=replacement.variant_id
      FROM replacement WHERE scripts.id=replacement.script_id RETURNING scripts.id,replacement.variant_id
    )
    UPDATE ai_media_daily_plan_slots slots SET script_variant_id=changed_script.variant_id
    FROM changed_script
    WHERE slots.owner_user_id=$1 AND slots.workspace_id=$2
      AND slots.script_variant_id IN (SELECT id FROM ai_media_script_variants WHERE script_id=changed_script.id)`,
  [pointerTamper.scope.ownerUserId, pointerTamper.scope.workspaceId]);
  await expectCode(() => service().current(pointerTamper.scope), "BATCH_UNAVAILABLE");

  assert.deepEqual(await sideEffects(), emptySideEffects);
});
