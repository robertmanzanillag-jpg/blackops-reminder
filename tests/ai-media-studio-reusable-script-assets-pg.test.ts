import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sourceScriptPreviewRequestSchema } from "../shared/ai-media-studio-source-to-script";
import type { TenantScope } from "../server/ai-media-studio/core/resource-domain";
import {
  DrizzleReusableScriptAssetRepository,
  type ReusableScriptAssetDatabase,
} from "../server/ai-media-studio/sources/drizzle-reusable-script-asset-repository";
import { DrizzleSourceRepository } from "../server/ai-media-studio/sources/drizzle-source-repository";
import {
  ReusableScriptAssetError,
  ReusableScriptAssetService,
} from "../server/ai-media-studio/sources/reusable-script-asset-service";
import { SourceToScriptPreviewService } from "../server/ai-media-studio/sources/source-to-script-preview-service";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};

const TEMP_PREFIX = "ams-pr21-pg-";
const DATABASE = "ams_pr21_test";
const PORT = "55432";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url),
  "utf8",
)) as Manifest;

const rawHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const digest = (value: string): `sha256:${string}` => `sha256:${rawHash(value)}`;

function requireOwnedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) {
    throw new Error("reusable-script PostgreSQL test requires only its owned TEST_DATABASE_URL");
  }
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
  connectionString: enabled ? requireOwnedUrl() : "postgresql://postgres@localhost/ams_reusable_scripts_disabled",
  max: 16,
  allowExitOnIdle: true,
});
after(async () => pool.end());
let lastDatabaseError: unknown;

function reviewedForward(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(rawHash(bytes), file.sha256, `${file.path} differs from the reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyExactChain(): Promise<void> {
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
    await pool.query(reviewedForward(entry.forward));
  }
}

function uuid(seed: string): string {
  const hex = rawHash(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function stack(): { previews: SourceToScriptPreviewService; assets: ReusableScriptAssetService } {
  const database = drizzle(pool);
  const repositoryDatabase: ReusableScriptAssetDatabase = {
    async execute(query) {
      try {
        return await database.execute(query);
      } catch (error) {
        lastDatabaseError = error;
        throw error;
      }
    },
    async transaction(callback) {
      return database.transaction(async (tx) => callback({
        async execute(query) {
          try {
            return await tx.execute(query);
          } catch (error) {
            lastDatabaseError = error;
            throw error;
          }
        },
      }));
    },
  };
  const previews = new SourceToScriptPreviewService(new DrizzleSourceRepository(database));
  const assets = new ReusableScriptAssetService(
    previews,
    new DrizzleReusableScriptAssetRepository(repositoryDatabase),
  );
  return { previews, assets };
}

async function seedSource(scope: TenantScope, label: string): Promise<{ id: string; contentHash: `sha256:${string}` }> {
  const id = uuid(`${label}:source`);
  const content = `${label} licensed source content for deterministic reusable scripts.`;
  const contentHash = digest(content);
  await pool.query(`
    INSERT INTO ai_media_source_items (
      id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,
      status,rights_status,moderation_status,payload
    ) VALUES ($1,$2,$3,'restaurants',$4,$5,$6,$7,'ready','owned','approved',$8::jsonb)
  `, [
    id,
    scope.ownerUserId,
    scope.workspaceId,
    `${label}:external`,
    `${label} Restaurant`,
    content,
    contentHash,
    JSON.stringify({ adapterKey: "kong-owned", providerExternalId: `${label}:external`, data: {} }),
  ]);
  return { id, contentHash };
}

async function seedInfluencer(scope: TenantScope, label: string): Promise<string> {
  const id = uuid(`${label}:influencer`);
  await pool.query(`
    INSERT INTO ai_media_influencers (id,owner_user_id,workspace_id,name,slug,status)
    VALUES ($1,$2,$3,$4,$5,'active')
  `, [id, scope.ownerUserId, scope.workspaceId, `${label} Creator`, `${label}-creator`]);
  return id;
}

async function saveRequest(
  scope: TenantScope,
  sourceId: string,
  key: string,
  options: { influencerId?: string; variantCount?: number; selectedIndex?: number } = {},
) {
  const { previews } = stack();
  const previewRequest = sourceScriptPreviewRequestSchema.parse({
    sourceItemId: sourceId,
    idempotencyKey: `${key}-preview`,
    ...(options.influencerId ? { influencerId: options.influencerId } : {}),
    language: "en",
    variantCount: options.variantCount ?? 3,
  });
  const preview = await previews.preview(scope, previewRequest);
  return {
    preview,
    request: {
      previewRequest,
      expectedSourceContentHash: preview.source.contentHash,
      expectedPreviewDigest: preview.previewDigest,
      selectedVariantId: preview.scriptSet.variants[options.selectedIndex ?? 1]!.id,
      saveIdempotencyKey: `${key}-save`,
    },
  };
}

async function expectAssetError(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof ReusableScriptAssetError && error.code === code,
  );
}

async function tenantCounts(scope: TenantScope): Promise<{ scripts: number; variants: number }> {
  const result = await pool.query<{ scripts: number; variants: number }>(`
    SELECT
      (SELECT count(*)::integer FROM ai_media_scripts
        WHERE owner_user_id=$1 AND workspace_id=$2 AND metadata ? 'reusableScriptAssetV1') scripts,
      (SELECT count(*)::integer FROM ai_media_script_variants
        WHERE owner_user_id=$1 AND workspace_id=$2 AND metadata ? 'reusableScriptCreativeV1') variants
  `, [scope.ownerUserId, scope.workspaceId]);
  return result.rows[0]!;
}

integrationTest("reusable script assets are atomic, idempotent, and tenant-safe on the exact PostgreSQL chain", async () => {
  await applyExactChain();

  const primary: TenantScope = { ownerUserId: "reusable-owner-primary", workspaceId: "reusable-workspace-primary" };
  const primarySource = await seedSource(primary, "primary");
  const prepared = await saveRequest(primary, primarySource.id, "primary", { variantCount: 3, selectedIndex: 1 });
  const [created, concurrentReplay] = await Promise.all([
    stack().assets.save(primary, "operator-primary", prepared.request),
    stack().assets.save(primary, "operator-primary-replay", prepared.request),
  ]).catch((error: unknown) => {
    throw lastDatabaseError ?? error;
  });
  const first = created.replayed ? concurrentReplay : created;
  const replay = created.replayed ? created : concurrentReplay;
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.asset, first.asset);
  assert.equal(first.asset.variants.length, 3);
  assert.equal(first.asset.currentVariantId, first.asset.variants[1]!.id);
  assert.deepEqual(await tenantCounts(primary), { scripts: 1, variants: 3 });

  const durableRows = await pool.query<{
    script_status: string;
    current_variant_id: string;
    variant_count: number;
    selected_count: number;
    checksums_valid: boolean;
  }>(`
    SELECT scripts.status script_status,scripts.current_variant_id,
      count(variants.id)::integer variant_count,
      count(variants.id) FILTER (WHERE variants.id=scripts.current_variant_id)::integer selected_count,
      bool_and(variants.checksum='sha256:' || encode(digest(variants.content,'sha256'),'hex')) checksums_valid
    FROM ai_media_scripts scripts
    JOIN ai_media_script_variants variants
      ON variants.script_id=scripts.id AND variants.owner_user_id=scripts.owner_user_id
        AND variants.workspace_id=scripts.workspace_id
    WHERE scripts.id=$1 AND scripts.owner_user_id=$2 AND scripts.workspace_id=$3
    GROUP BY scripts.id,scripts.status,scripts.current_variant_id
  `, [first.asset.id, primary.ownerUserId, primary.workspaceId]);
  assert.deepEqual(durableRows.rows, [{
    script_status: "draft",
    current_variant_id: first.asset.currentVariantId,
    variant_count: 3,
    selected_count: 1,
    checksums_valid: true,
  }]);

  await expectAssetError(() => stack().assets.save(primary, "operator-primary", {
    ...prepared.request,
    selectedVariantId: prepared.preview.scriptSet.variants[0]!.id,
  }), "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(await tenantCounts(primary), { scripts: 1, variants: 3 });

  const secondary: TenantScope = { ownerUserId: "reusable-owner-secondary", workspaceId: "reusable-workspace-secondary" };
  const secondarySource = await seedSource(secondary, "secondary");
  const secondaryPrepared = await saveRequest(secondary, secondarySource.id, "primary", { variantCount: 2, selectedIndex: 0 });
  const secondarySaved = await stack().assets.save(secondary, "operator-secondary", secondaryPrepared.request);
  const primaryList = await stack().assets.list(primary, { limit: 25, status: "draft" });
  const secondaryList = await stack().assets.list(secondary, { limit: 25, status: "draft" });
  assert.deepEqual(primaryList.items.map((asset) => asset.id), [first.asset.id]);
  assert.deepEqual(secondaryList.items.map((asset) => asset.id), [secondarySaved.asset.id]);
  assert.notEqual(primaryList.items[0]!.id, secondaryList.items[0]!.id);

  const rollbackScope: TenantScope = { ownerUserId: "reusable-owner-rollback", workspaceId: "reusable-workspace-rollback" };
  const rollbackSource = await seedSource(rollbackScope, "rollback");
  const rollbackPrepared = await saveRequest(rollbackScope, rollbackSource.id, "rollback", { variantCount: 3 });
  await pool.query(`ALTER TABLE ai_media_script_variants ADD CONSTRAINT reusable_script_test_mid_insert_ck
    CHECK (owner_user_id <> 'reusable-owner-rollback' OR version <> 2)`);
  await expectAssetError(
    () => stack().assets.save(rollbackScope, "operator-rollback", rollbackPrepared.request),
    "PERSISTENCE_UNAVAILABLE",
  );
  assert.deepEqual(await tenantCounts(rollbackScope), { scripts: 0, variants: 0 });

  const refreshedScope: TenantScope = { ownerUserId: "reusable-owner-refreshed", workspaceId: "reusable-workspace-refreshed" };
  const refreshedSource = await seedSource(refreshedScope, "refreshed");
  const refreshedPrepared = await saveRequest(refreshedScope, refreshedSource.id, "refreshed", { variantCount: 2 });
  const changedContent = "Refreshed licensed content that invalidates the operator preview.";
  await pool.query(`UPDATE ai_media_source_items SET content=$1,content_hash=$2,updated_at=clock_timestamp()
    WHERE id=$3 AND owner_user_id=$4 AND workspace_id=$5`, [
    changedContent,
    digest(changedContent),
    refreshedSource.id,
    refreshedScope.ownerUserId,
    refreshedScope.workspaceId,
  ]);
  await expectAssetError(
    () => stack().assets.save(refreshedScope, "operator-refreshed", refreshedPrepared.request),
    "SOURCE_REFRESHED",
  );
  assert.deepEqual(await tenantCounts(refreshedScope), { scripts: 0, variants: 0 });

  const archivedScope: TenantScope = { ownerUserId: "reusable-owner-archived", workspaceId: "reusable-workspace-archived" };
  const archivedSource = await seedSource(archivedScope, "archived");
  const influencerId = await seedInfluencer(archivedScope, "archived");
  const archivedPrepared = await saveRequest(archivedScope, archivedSource.id, "archived", {
    influencerId,
    variantCount: 2,
  });
  await pool.query(`UPDATE ai_media_influencers SET archived_at=clock_timestamp(),status='archived'
    WHERE id=$1 AND owner_user_id=$2 AND workspace_id=$3`, [
    influencerId,
    archivedScope.ownerUserId,
    archivedScope.workspaceId,
  ]);
  await expectAssetError(
    () => stack().assets.save(archivedScope, "operator-archived", archivedPrepared.request),
    "NOT_FOUND",
  );
  assert.deepEqual(await tenantCounts(archivedScope), { scripts: 0, variants: 0 });

  const sideEffects = await pool.query<Record<string, number>>(`SELECT
    (SELECT count(*)::integer FROM ai_media_render_jobs) render_jobs,
    (SELECT count(*)::integer FROM ai_media_outbox) outbox_commands,
    (SELECT count(*)::integer FROM ai_media_publishing_jobs) publishing_jobs,
    (SELECT count(*)::integer FROM ai_media_cost_ledger) cost_entries,
    (SELECT count(*)::integer FROM ai_media_provider_submission_attempts) provider_submissions
  `);
  assert.deepEqual(sideEffects.rows, [{
    render_jobs: 0,
    outbox_commands: 0,
    publishing_jobs: 0,
    cost_entries: 0,
    provider_submissions: 0,
  }]);
});
