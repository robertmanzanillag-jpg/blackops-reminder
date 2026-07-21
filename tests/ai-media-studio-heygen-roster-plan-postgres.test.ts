import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createDrizzleHeyGenRosterAccountResolver,
  DrizzleHeyGenRosterRepository,
  type HeyGenRosterDatabase,
} from "../server/ai-media-studio/providers/drizzle-heygen-roster-repository";
import { HeyGenRosterError } from "../server/ai-media-studio/providers/heygen-roster-contracts";
import { HeyGenRosterDailyPlanService } from "../server/ai-media-studio/providers/heygen-roster-daily-plan-service";
import { HeyGenRosterService } from "../server/ai-media-studio/providers/heygen-roster-service";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};

const TEMP_PREFIX = "ams-pr21-pg-";
const DATABASE = "ams_pr21_test";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url),
  "utf8",
)) as Manifest;
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) {
    throw new Error("roster-plan requires only the owned TEST_DATABASE_URL");
  }
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
  assert.equal(sha256(bytes), file.sha256, `${file.path} differs from the reviewed manifest`);
  return bytes.toString("utf8");
}

const accounts = {
  five: { owner: "roster-owner-five", workspace: "personal", id: "10000000-0000-4000-8000-000000000005" },
  ten: { owner: "roster-owner-ten", workspace: "studio", id: "10000000-0000-4000-8000-000000000010" },
  rollback: { owner: "roster-owner-rollback", workspace: "personal", id: "10000000-0000-4000-8000-000000000099" },
} as const;

function request(count: number, idempotencyKey: string, prefix: string) {
  return {
    idempotencyKey,
    members: Array.from({ length: count }, (_, index) => ({
      name: `${prefix} Avatar ${index + 1}`,
      avatarId: `${prefix.toLowerCase()}-native-avatar-${index + 1}`,
      voiceId: `${prefix.toLowerCase()}-shared-native-voice`,
      language: "es-US",
      accent: "Latino",
      gender: "unspecified" as const,
    })),
  };
}

function opaqueId(prefix: "roster" | "member", seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

async function applyFullChain(): Promise<void> {
  assert.equal(manifest.migrations.length, 22);
  for (const entry of manifest.migrations) {
    if (entry.pullRequest === "PR26") {
      for (const role of manifest.pr26.requiredRoles) {
        assert.equal(role.login, false);
        assert.equal(role.inherit, false);
        await pool.query(
          `CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      }
    }
    await pool.query(migration(entry.forward));
  }
}

async function seedAccount(account: typeof accounts[keyof typeof accounts]): Promise<void> {
  await pool.query(`
    INSERT INTO ai_media_provider_accounts (
      id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,
      credential_version,credential_source,configuration
    ) VALUES ($1,$2,$3,'heygen','HeyGen roster test','active','active',1,
      'legacy_authorized_unbound','{}'::jsonb)
  `, [account.id, account.owner, account.workspace]);
}

function service() {
  const db = drizzle(pool) as unknown as HeyGenRosterDatabase;
  const repository = new DrizzleHeyGenRosterRepository(db);
  const rosterService = new HeyGenRosterService(
    repository,
    createDrizzleHeyGenRosterAccountResolver(db),
    () => "1999-01-01T00:00:00.000Z",
    "UTC",
  );
  return { repository, rosterService, planService: new HeyGenRosterDailyPlanService(rosterService) };
}

async function tableCounts(tableNames: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const tableName of tableNames) {
    assert.match(tableName, /^ai_media_[a-z_]+$/u);
    const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${tableName}`);
    counts[tableName] = Number(result.rows[0]?.count ?? "-1");
  }
  return counts;
}

integrationTest("real PG16 full chain atomically materializes safe 5→50 and 10→100 blocked roster plans", async () => {
  await applyFullChain();
  await Promise.all(Object.values(accounts).map(seedAccount));
  const sideEffectTables = [
    "ai_media_budget_reservations",
    "ai_media_render_jobs",
    "ai_media_outbox",
    "ai_media_provider_submission_attempts",
  ] as const;
  assert.deepEqual(await tableCounts(sideEffectTables), {
    ai_media_budget_reservations: 0,
    ai_media_render_jobs: 0,
    ai_media_outbox: 0,
    ai_media_provider_submission_attempts: 0,
  });

  const fiveScope = { ownerUserId: accounts.five.owner, workspaceId: accounts.five.workspace };
  const fiveRequest = request(5, "pg-roster-five-0001", "Five");
  const firstClient = service();
  const [firstFive, concurrentReplay] = await Promise.all([
    firstClient.rosterService.configure(fiveScope, fiveRequest),
    service().rosterService.configure(fiveScope, fiveRequest),
  ]);
  assert.deepEqual(concurrentReplay, firstFive, "concurrent exact replay returns the same durable roster");
  assert.equal(firstFive.roster.avatarCount, 5);
  assert.equal(firstFive.roster.plannedVideoCount, 50);
  assert.notEqual(firstFive.roster.configuredAt, "1999-01-01T00:00:00.000Z", "database clock owns configuredAt");

  const durableFive = await firstClient.planService.currentPlan(fiveScope);
  assert.ok(durableFive);
  assert.equal(durableFive.avatarCount, 5);
  assert.equal(durableFive.plannedVideoCount, 50);
  assert.equal(durableFive.slots.length, 50);
  assert.equal(durableFive.status, "blocked_before_generation");
  assert.equal(durableFive.canGenerate, false);
  assert.equal(durableFive.noSpendGuarantee, true);
  assert.equal(durableFive.slots.every((slot) => slot.status === "not_queued"), true);
  assert.deepEqual(
    [...new Set(durableFive.slots.map((slot) => slot.memberId))].map((memberId) =>
      durableFive.slots.filter((slot) => slot.memberId === memberId).map((slot) => slot.videoNumber).sort((a, b) => a - b)),
    Array.from({ length: 5 }, () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  );
  const publicDto = JSON.stringify(durableFive);
  assert.doesNotMatch(publicDto, /native-avatar|native-voice|providerAccountId|credentialVersion|influencerId|avatarResourceId|voiceResourceId/iu);

  const exactReplay = await firstClient.rosterService.configure(fiveScope, fiveRequest);
  assert.deepEqual(exactReplay, firstFive);
  const fiveCounts = await pool.query<{ plans: string; slots: string }>(`
    SELECT
      (SELECT count(*)::text FROM ai_media_daily_plans WHERE owner_user_id=$1 AND workspace_id=$2) AS plans,
      (SELECT count(*)::text FROM ai_media_daily_plan_slots WHERE owner_user_id=$1 AND workspace_id=$2) AS slots
  `, [fiveScope.ownerUserId, fiveScope.workspaceId]);
  assert.deepEqual(fiveCounts.rows, [{ plans: "1", slots: "50" }]);

  const tenScope = { ownerUserId: accounts.ten.owner, workspaceId: accounts.ten.workspace };
  const tenClient = service();
  const tenResult = await tenClient.rosterService.configure(tenScope, request(10, "pg-roster-ten-0001", "Ten"));
  const durableTen = await tenClient.planService.currentPlan(tenScope);
  assert.equal(tenResult.roster.avatarCount, 10);
  assert.equal(tenResult.roster.plannedVideoCount, 100);
  assert.ok(durableTen);
  assert.equal(durableTen.slots.length, 100);
  assert.equal(durableTen.canGenerate, false);
  assert.equal(durableTen.noSpendGuarantee, true);
  assert.equal(await tenClient.repository.get(tenScope, firstFive.roster.rosterId), undefined);
  assert.equal(await firstClient.repository.get(fiveScope, tenResult.roster.rosterId), undefined);
  assert.notEqual(durableTen.rosterId, durableFive.rosterId);

  const isolatedCounts = await pool.query<{ owner_user_id: string; workspace_id: string; plans: string; slots: string }>(`
    SELECT plans.owner_user_id,plans.workspace_id,count(DISTINCT plans.id)::text AS plans,count(slots.id)::text AS slots
    FROM ai_media_daily_plans plans
    JOIN ai_media_daily_plan_slots slots ON slots.owner_user_id=plans.owner_user_id
      AND slots.workspace_id=plans.workspace_id AND slots.daily_plan_id=plans.id
    GROUP BY plans.owner_user_id,plans.workspace_id ORDER BY plans.owner_user_id
  `);
  assert.deepEqual(isolatedCounts.rows, [
    { owner_user_id: accounts.five.owner, workspace_id: accounts.five.workspace, plans: "1", slots: "50" },
    { owner_user_id: accounts.ten.owner, workspace_id: accounts.ten.workspace, plans: "1", slots: "100" },
  ]);

  const rollbackScope = { ownerUserId: accounts.rollback.owner, workspaceId: accounts.rollback.workspace };
  const rollbackRequest = request(5, "pg-roster-rollback-0001", "Rollback");
  const rollbackRosterId = opaqueId(
    "roster",
    `${rollbackScope.ownerUserId}\0${rollbackScope.workspaceId}\0${rollbackRequest.idempotencyKey}`,
  );
  const firstMemberId = opaqueId("member", `${rollbackRosterId}\0${0}\0${rollbackRequest.members[0]!.avatarId}`);
  await pool.query(`
    INSERT INTO ai_media_influencers (owner_user_id,workspace_id,name,slug,status,persona)
    VALUES ($1,$2,'Collision', $3,'draft','{"source":"unrelated"}'::jsonb)
  `, [rollbackScope.ownerUserId, rollbackScope.workspaceId, `heygen-${firstMemberId.slice("member_".length)}`]);
  await assert.rejects(
    service().rosterService.configure(rollbackScope, rollbackRequest),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );
  const rollbackCounts = await pool.query<{
    resources: string; influencers: string; plans: string; slots: string; namespace_present: boolean;
  }>(`
    SELECT
      (SELECT count(*)::text FROM ai_media_provider_resources WHERE owner_user_id=$1 AND workspace_id=$2) AS resources,
      (SELECT count(*)::text FROM ai_media_influencers WHERE owner_user_id=$1 AND workspace_id=$2) AS influencers,
      (SELECT count(*)::text FROM ai_media_daily_plans WHERE owner_user_id=$1 AND workspace_id=$2) AS plans,
      (SELECT count(*)::text FROM ai_media_daily_plan_slots WHERE owner_user_id=$1 AND workspace_id=$2) AS slots,
      (SELECT configuration ? 'aiMediaStudioHeyGenRosterV1' FROM ai_media_provider_accounts
        WHERE owner_user_id=$1 AND workspace_id=$2 AND provider_key='heygen') AS namespace_present
  `, [rollbackScope.ownerUserId, rollbackScope.workspaceId]);
  assert.deepEqual(rollbackCounts.rows, [{
    resources: "0", influencers: "1", plans: "0", slots: "0", namespace_present: false,
  }], "a late influencer collision rolls back every roster/plan mutation in the transaction");

  assert.deepEqual(await tableCounts(sideEffectTables), {
    ai_media_budget_reservations: 0,
    ai_media_render_jobs: 0,
    ai_media_outbox: 0,
    ai_media_provider_submission_attempts: 0,
  }, "roster planning never admits spend, render, queue, or provider submission work");
});
