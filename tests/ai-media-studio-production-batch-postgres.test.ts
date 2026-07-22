import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleProductionBatchRepository, type ProductionBatchDatabase } from "../server/ai-media-studio/production-batches/drizzle-repository";
import { ProductionBatchError, type ProductionScriptGenerator } from "../server/ai-media-studio/production-batches/contracts";
import { ProductionBatchService } from "../server/ai-media-studio/production-batches/service";
import { DeterministicScriptService } from "../server/ai-media-studio/script-service";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};
type Scope = { ownerUserId: string; workspaceId: string };
type Fixture = { scope: Scope; planId: string; planUuid: string };

const TEMP_PREFIX = "ams-pr21-pg-";
const DATABASE = "ams_pr21_test";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8",
)) as Manifest;
const rawHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const digest = (value: string): string => `sha256:${rawHash(value)}`;

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("production-batch requires only the owned TEST_DATABASE_URL");
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
  max: 20,
  allowExitOnIdle: true,
});
after(async () => pool.end());

function migration(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(rawHash(bytes), file.sha256, `${file.path} differs from the reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyFullChain(): Promise<void> {
  assert.equal(manifest.migrations.length, 22, "the production harness must exercise the exact 22-migration chain");
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
  const hex = rawHash(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function key(prefix: "plan" | "slot" | "member", seed: string): string {
  return `${prefix}_${rawHash(seed).slice(0, 24)}`;
}

function client() {
  const repository = new DrizzleProductionBatchRepository(drizzle(pool) as unknown as ProductionBatchDatabase);
  return { repository, service: new ProductionBatchService(repository) };
}

async function seedFixture(label: string, avatarCount: number, workspace = `workspace-${label}`, eligibleSources = 10): Promise<Fixture> {
  const scope = { ownerUserId: `owner-${label}`, workspaceId: workspace };
  const account = uuid(`${label}:account`);
  const voice = uuid(`${label}:voice`);
  const planUuid = uuid(`${label}:plan`);
  const planId = key("plan", label);
  await pool.query(`
    INSERT INTO ai_media_provider_accounts
      (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'generic-video','Generic video provider','active','active',1,'legacy_authorized_unbound')
  `, [account, scope.ownerUserId, scope.workspaceId]);
  await pool.query(`
    INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,
       display_name,status,canonical_key)
    VALUES ($1,$2,$3,$4,'generic-video','voice',$5,'Fixture voice','active',$6)
  `, [voice, scope.ownerUserId, scope.workspaceId, account, `${label}-voice`, `generic-video:${account}:${label}-voice`]);
  const influencers: Array<{ id: string; avatar: string; member: string }> = [];
  for (let index = 1; index <= avatarCount; index += 1) {
    const influencer = uuid(`${label}:influencer:${index}`);
    const avatar = uuid(`${label}:avatar:${index}`);
    const member = key("member", `${label}:${index}`);
    influencers.push({ id: influencer, avatar, member });
    await pool.query(`
      INSERT INTO ai_media_provider_resources
        (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,external_resource_id,
         display_name,status,canonical_key)
      VALUES ($1,$2,$3,$4,'generic-video','avatar',$5,$6,'active',$7)
    `, [avatar, scope.ownerUserId, scope.workspaceId, account, `${label}-avatar-${index}`, `${label} Avatar ${index}`,
      `generic-video:${account}:${label}-avatar-${index}`]);
    await pool.query(`
      INSERT INTO ai_media_influencers
        (id,owner_user_id,workspace_id,name,slug,status,language,default_voice_resource_id,default_avatar_resource_id)
      VALUES ($1,$2,$3,$4,$5,'active','es-US',$6,$7)
    `, [influencer, scope.ownerUserId, scope.workspaceId, `${label} Creator ${index}`,
      `${label}-creator-${index}`, voice, avatar]);
  }
  await pool.query(`
    INSERT INTO ai_media_daily_plans
      (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
       source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
       idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'generic-video',1,$6,$7,(transaction_timestamp() AT TIME ZONE 'UTC')::date,
      'UTC','blocked',$8,$9,$10,$11)
  `, [planUuid, scope.ownerUserId, scope.workspaceId, planId, account, `roster-${label}`, digest(`${label}:roster`),
    avatarCount * 10, `plan-${label}-idem`, digest(`${label}:input`), digest(`${label}:plan`)]);
  for (const [memberIndex, influencer] of influencers.entries()) {
    for (let video = 1; video <= 10; video += 1) {
      await pool.query(`
        INSERT INTO ai_media_daily_plan_slots
          (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
           provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
           video_number,status,slot_digest,state_version)
        VALUES ($1,$2,$3,$4,$5,$6,'generic-video',1,$7,$8,$9,$10,$11,'blocked',$12,1)
      `, [uuid(`${label}:slot:${memberIndex}:${video}`), scope.ownerUserId, scope.workspaceId,
        key("slot", `${label}:${memberIndex}:${video}`), planUuid, account, influencer.member, influencer.id,
        influencer.avatar, voice, video, digest(`${label}:slot:${memberIndex}:${video}`)]);
    }
  }
  for (let index = 1; index <= eligibleSources; index += 1) {
    const content = `${label} production-safe source content ${index}`;
    await pool.query(`
      INSERT INTO ai_media_source_items
        (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,rights_status,moderation_status,payload)
      VALUES ($1,$2,$3,'events',$4,$5,$6,$7,'ready','owned','approved','{}'::jsonb)
    `, [uuid(`${label}:source:${index}`), scope.ownerUserId, scope.workspaceId, `${label}-source-${index}`,
      `${label} Source ${index}`, content, digest(content)]);
  }
  const rejectedContent = `${label} rejected source`;
  await pool.query(`
    INSERT INTO ai_media_source_items
      (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,rights_status,moderation_status,payload)
    VALUES ($1,$2,$3,'events',$4,'Rejected source',$5,$6,'rejected','owned','approved','{}'::jsonb)
  `, [uuid(`${label}:source:rejected`), scope.ownerUserId, scope.workspaceId, `${label}-source-rejected`, rejectedContent, digest(rejectedContent)]);
  return { scope, planId, planUuid };
}

async function counts(scope: Scope): Promise<{ scripts: number; variants: number; bindings: number }> {
  const result = await pool.query<{ scripts: string; variants: string; bindings: string }>(`
    SELECT
      (SELECT count(*)::text FROM ai_media_scripts WHERE owner_user_id=$1 AND workspace_id=$2) scripts,
      (SELECT count(*)::text FROM ai_media_script_variants WHERE owner_user_id=$1 AND workspace_id=$2) variants,
      (SELECT count(*)::text FROM ai_media_daily_plan_slots WHERE owner_user_id=$1 AND workspace_id=$2 AND script_variant_id IS NOT NULL) bindings
  `, [scope.ownerUserId, scope.workspaceId]);
  const row = result.rows[0]!;
  return { scripts: Number(row.scripts), variants: Number(row.variants), bindings: Number(row.bindings) };
}

async function sideEffects(): Promise<Record<string, number>> {
  const tables = ["ai_media_budget_buckets", "ai_media_budget_reservations", "ai_media_launch_intents",
    "ai_media_render_jobs", "ai_media_outbox", "ai_media_provider_submission_attempts"] as const;
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

integrationTest("PG16 exact chain prepares durable 5→50 and 10→100 batches without launch side effects", async () => {
  await applyFullChain();
  assert.deepEqual(await sideEffects(), {
    ai_media_budget_buckets: 0, ai_media_budget_reservations: 0, ai_media_launch_intents: 0,
    ai_media_render_jobs: 0, ai_media_outbox: 0, ai_media_provider_submission_attempts: 0,
  });

  const five = await seedFixture("five", 5);
  const fiveRequest = { idempotencyKey: "batch-five-idem-0001", variantCount: 1 };
  const [fiveBatch, concurrentReplay] = await Promise.all([
    client().service.prepare(five.scope, five.planId, fiveRequest),
    client().service.prepare(five.scope, five.planId, fiveRequest),
  ]);
  assert.deepEqual(concurrentReplay, fiveBatch);
  assert.equal(fiveBatch.avatarCount, 5);
  assert.equal(fiveBatch.plannedVideoCount, 50);
  assert.equal(fiveBatch.status, "draft_ready");
  assert.equal(fiveBatch.canGenerate, false);
  assert.equal(fiveBatch.noSpend, true);
  assert.deepEqual(await counts(five.scope), { scripts: 50, variants: 50, bindings: 50 });
  assert.deepEqual(await client().service.prepare(five.scope, five.planId, fiveRequest), fiveBatch);
  await expectCode(() => client().service.prepare(five.scope, five.planId,
    { idempotencyKey: fiveRequest.idempotencyKey, variantCount: 2 }), "IDEMPOTENCY_CONFLICT");

  const ten = await seedFixture("ten", 10);
  const tenBatch = await client().service.prepare(ten.scope, ten.planId,
    { idempotencyKey: "batch-ten-idem-0001", variantCount: 5 });
  assert.equal(tenBatch.avatarCount, 10);
  assert.equal(tenBatch.plannedVideoCount, 100);
  assert.deepEqual(await counts(ten.scope), { scripts: 100, variants: 500, bindings: 100 });
  const sourceUse = await pool.query<{ used: string; variants: string; checksums_valid: boolean }>(`
    SELECT count(DISTINCT scripts.source_item_id)::text used, count(variants.id)::text variants,
      bool_and(variants.checksum = encode(digest(variants.content,'sha256'),'hex')) checksums_valid
    FROM ai_media_scripts scripts
    JOIN ai_media_script_variants variants ON variants.owner_user_id=scripts.owner_user_id
      AND variants.workspace_id=scripts.workspace_id AND variants.script_id=scripts.id
    WHERE scripts.owner_user_id=$1 AND scripts.workspace_id=$2
  `, [ten.scope.ownerUserId, ten.scope.workspaceId]);
  assert.deepEqual(sourceUse.rows, [{ used: "10", variants: "500", checksums_valid: true }]);
  assert.equal(await client().repository.getCurrent(five.scope).then((batch) => batch?.planId), five.planId);
  assert.equal(await client().repository.getCurrent({ ownerUserId: "owner-other", workspaceId: five.scope.workspaceId }), undefined);
  await expectCode(() => client().service.prepare(ten.scope, five.planId,
    { idempotencyKey: "cross-tenant-idem", variantCount: 1 }), "NOT_FOUND");

  const badHash = await seedFixture("bad-hash", 5, undefined, 9);
  const badContent = "invalid hash source";
  await pool.query(`INSERT INTO ai_media_source_items
    (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,rights_status,moderation_status,payload)
    VALUES ($1,$2,$3,'events','bad-hash-invalid','Bad hash',$4,'sha256:not-a-digest','ready','owned','approved','{}')`,
  [uuid("bad-hash:invalid"), badHash.scope.ownerUserId, badHash.scope.workspaceId, badContent]);
  await expectCode(() => client().service.prepare(badHash.scope, badHash.planId,
    { idempotencyKey: "bad-hash-idem-0001", variantCount: 1 }), "SOURCE_INELIGIBLE");
  assert.deepEqual(await counts(badHash.scope), { scripts: 0, variants: 0, bindings: 0 });

  const refresh = await seedFixture("refresh", 5);
  const refreshService = client().service;
  await refreshService.prepare(refresh.scope, refresh.planId, { idempotencyKey: "refresh-idem-0001", variantCount: 2 });
  const changed = "refreshed source content";
  await pool.query(`UPDATE ai_media_source_items SET content=$3,content_hash=$4
    WHERE owner_user_id=$1 AND workspace_id=$2 AND external_id='refresh-source-1'`,
  [refresh.scope.ownerUserId, refresh.scope.workspaceId, changed, digest(changed)]);
  assert.equal((await refreshService.current(refresh.scope))?.status, "stale");
  await expectCode(() => refreshService.prepare(refresh.scope, refresh.planId,
    { idempotencyKey: "refresh-idem-0001", variantCount: 2 }), "SOURCE_REFRESHED");

  const rollback = await seedFixture("rollback", 5);
  const deterministic = new DeterministicScriptService();
  let generated = 0;
  const failingGenerator: ProductionScriptGenerator = {
    version: "rollback-generator-v1",
    generate(input) {
      generated += 1;
      if (generated === 17) throw new Error("intentional late generator failure");
      return deterministic.generate(input);
    },
  };
  await assert.rejects(() => client().repository.prepare({ scope: rollback.scope, planId: rollback.planId,
    idempotencyKey: "rollback-idem-0001", variantCount: 3, generator: failingGenerator }), /intentional late generator failure/u);
  assert.equal(generated, 17);
  assert.deepEqual(await counts(rollback.scope), { scripts: 0, variants: 0, bindings: 0 });

  const parallelA = await seedFixture("parallel-a", 5, "shared-production-workspace");
  const parallelB = await seedFixture("parallel-b", 5, "shared-production-workspace");
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT id FROM ai_media_source_items WHERE owner_user_id=$1 AND workspace_id=$2 FOR UPDATE`,
      [parallelA.scope.ownerUserId, parallelA.scope.workspaceId]);
    const pendingA = client().service.prepare(parallelA.scope, parallelA.planId,
      { idempotencyKey: "parallel-a-idem-0001", variantCount: 1 });
    let planLocked = false;
    for (let attempt = 0; attempt < 100 && !planLocked; attempt += 1) {
      try {
        await pool.query(`SELECT id FROM ai_media_daily_plans WHERE id=$1 FOR UPDATE NOWAIT`, [parallelA.planUuid]);
      } catch (error: unknown) {
        planLocked = typeof error === "object" && error !== null && "code" in error && error.code === "55P03";
      }
      if (!planLocked) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(planLocked, true, "plan A must be inside its transaction before probing workspace isolation");
    const batchB = await Promise.race([
      client().service.prepare(parallelB.scope, parallelB.planId,
        { idempotencyKey: "parallel-b-idem-0001", variantCount: 1 }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("unrelated plan blocked globally")), 3000)),
    ]);
    assert.equal(batchB.plannedVideoCount, 50);
    await blocker.query("COMMIT");
    assert.equal((await pendingA).plannedVideoCount, 50);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
  }

  assert.deepEqual(await sideEffects(), {
    ai_media_budget_buckets: 0, ai_media_budget_reservations: 0, ai_media_launch_intents: 0,
    ai_media_render_jobs: 0, ai_media_outbox: 0, ai_media_provider_submission_attempts: 0,
  });
});
