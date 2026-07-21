import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = "migrations/ai-media-studio";
const forward = readFileSync(resolve(directory, "20260720_pr1_foundation_forward.sql"), "utf8");
const rollback = readFileSync(resolve(directory, "20260720_pr1_foundation_rollback.sql"), "utf8");
const historicalModel = execFileSync(
  "git",
  ["show", "8b30f184:shared/models/ai-media-studio-db.ts"],
  { encoding: "utf8" },
);

const historicalTables = [...historicalModel.matchAll(/pgTable\(\s*\n\s*"(ai_media_[a-z_]+)"/gu)]
  .map((match) => match[1]);
const historicalIndexes = [...historicalModel.matchAll(/(?:uniqueIndex|index)\("(ai_media_[a-z_]+)"\)/gu)]
  .map((match) => match[1]);
const sqlTables = [...forward.matchAll(/CREATE TABLE (ai_media_[a-z_]+) \(/gu)].map((match) => match[1]);
const sqlIndexes = [...forward.matchAll(/CREATE (?:UNIQUE )?INDEX (ai_media_[a-z_]+)/gu)]
  .map((match) => match[1]);

test("PR1 SQL is pinned to the exact historical model artifact", () => {
  assert.equal(
    execFileSync("git", ["rev-parse", "8b30f184:shared/models/ai-media-studio-db.ts"], { encoding: "utf8" }).trim(),
    "4678f3b60595fe272ce11999806a4634317edb03",
  );
  assert.equal(
    createHash("sha256").update(historicalModel).digest("hex"),
    "560ac47625eb1a14297a5a5d127be7cc267d5de3c1943d51ea7e19640be1972d",
  );
  assert.deepEqual(sqlTables, historicalTables);
  assert.deepEqual(sqlIndexes.sort(), historicalIndexes.sort());
});

test("forward is an exact bounded 18-table, 20-FK, 38-index baseline", () => {
  assert.equal(sqlTables.length, 18);
  assert.equal((forward.match(/FOREIGN KEY/gu) ?? []).length, 20);
  assert.equal(sqlIndexes.length, 38);
  assert.equal((forward.match(/\bBEGIN;/gu) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/gu) ?? []).length, 1);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/u);
  assert.match(forward, /SET LOCAL search_path = public, pg_catalog/u);
  assert.match(forward, /CREATE EXTENSION IF NOT EXISTS pgcrypto/u);
  assert.match(forward, /current_setting\('server_version_num'\)::integer < 160000/u);
  assert.match(forward, /extension-owned public\.digest from pgcrypto in public/u);
  assert.match(forward, /to_regclass\(format\('public\.%I', relation_name\)\)/u);
  assert.ok(forward.indexOf("DO $preflight$") < forward.indexOf("CREATE EXTENSION"));
  assert.ok(forward.indexOf("DO $postflight$") > forward.lastIndexOf("CREATE INDEX"));
  assert.ok(forward.indexOf("DO $postflight$") < forward.lastIndexOf("COMMIT;"));
  assert.match(forward, /expected exactly 18 primary keys and 20 foreign keys/u);
  assert.match(forward, /expected 38 historical indexes plus 18 primary-key indexes/u);
  assert.match(forward, /column_fingerprint <> '81facb19ea146bdd3/u);
  assert.match(forward, /index_fingerprint <> 'c495ee80e41e12b1/u);
  assert.match(forward, /foreign_key_fingerprint <> 'dcb67afbd74aff62/u);
  assert.doesNotMatch(forward, /CREATE\s+TYPE\b[\s\S]*?\bAS\s+ENUM\b/iu);
  assert.doesNotMatch(forward, /IF NOT EXISTS ai_media_/iu);
});

test("forward preserves historically intentional unconstrained pointer columns", () => {
  for (const fragment of [
    "default_voice_resource_id uuid",
    "default_avatar_resource_id uuid",
    "source_item_id uuid",
    "current_variant_id uuid",
    "generation_history_id uuid",
    "render_job_id uuid, media_asset_id uuid",
  ]) {
    assert.match(forward, new RegExp(fragment));
  }
  assert.equal((forward.match(/FOREIGN KEY/gu) ?? []).length, 20);
});

test("rollback only destroys the exact empty PR1-only schema", () => {
  assert.equal((rollback.match(/\bBEGIN;/gu) ?? []).length, 1);
  assert.equal((rollback.match(/\bCOMMIT;/gu) ?? []).length, 1);
  assert.equal((rollback.match(/DROP TABLE ai_media_[a-z_]+ RESTRICT;/gu) ?? []).length, 18);
  assert.doesNotMatch(rollback, /\bCASCADE\b/iu);
  assert.doesNotMatch(rollback, /DROP\s+EXTENSION/iu);
  assert.match(rollback, /SELECT EXISTS \(SELECT 1 FROM public\.%I LIMIT 1\)/u);
  assert.match(rollback, /<> 274/u);
  assert.match(rollback, /<> 38/u);
  assert.match(rollback, /<> 56/u);
  assert.match(rollback, /later or foreign ai_media relations exist/u);
  assert.match(rollback, /later triggers or policies exist/u);
  assert.match(rollback, /external foreign-key dependencies exist/u);
  assert.match(rollback, /catalog is not the exact historical PR1 schema/u);
});

test("rollback drops dependants before referenced PR1 tables", () => {
  const position = (name: string) => rollback.indexOf(`DROP TABLE ${name} RESTRICT;`);
  assert.ok(position("ai_media_publications") < position("ai_media_publishing_jobs"));
  assert.ok(position("ai_media_publishing_jobs") < position("ai_media_videos"));
  assert.ok(position("ai_media_assets") < position("ai_media_render_jobs"));
  assert.ok(position("ai_media_render_jobs") < position("ai_media_provider_accounts"));
  assert.ok(position("ai_media_video_projects") < position("ai_media_script_variants"));
  assert.ok(position("ai_media_script_variants") < position("ai_media_scripts"));
  assert.ok(position("ai_media_scripts") < position("ai_media_influencers"));
});
