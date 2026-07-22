import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleProductionBatchRepository,
  type ProductionBatchDatabase,
} from "../server/ai-media-studio/production-batches/drizzle-repository";
import { ProductionBatchError } from "../server/ai-media-studio/production-batches/contracts";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" };
const planId = `plan_${"1".repeat(24)}`;
const batchId = `batch_${"2".repeat(24)}`;
const preparedAt = "2026-07-21T12:00:00.000Z";
const rawHash = (value: string) => createHash("sha256").update(value).digest("hex");
const rawDigest = (value: unknown) => `sha256:${rawHash(JSON.stringify(value))}`;
const publicKey = (prefix: string, number: number) => `${prefix}_${number.toString(16).padStart(24, "0")}`;

function durableRows(currentContent = "Exact content") {
  const result: Record<string, unknown>[] = [];
  for (let member = 0; member < 5; member += 1) for (let video = 1; video <= 10; video += 1) {
    const slotId = publicKey("slot", member * 10 + video + 100);
    const scriptKey = publicKey("script", member * 10 + video + 200);
    const envelope = {
      version: 1, batchId, planId, slotId, scriptKey, idempotencyKey: "prepare-batch-1",
      inputDigest: `sha256:${"3".repeat(64)}`, sourceContentHash: `sha256:${"4".repeat(64)}`,
      sourceContentChecksum: rawHash("Exact content"), sourceTitle: `Source ${video}`,
      sourceCategory: "experiences", generatorVersion: "deterministic-script-v1",
      variantCount: 3, preparedAt,
    };
    for (let variant = 0; variant < 3; variant += 1) {
      const content = `Script ${member}-${video}-${variant}`;
      const variantTitle = variant === 0 ? `Script ${video}` : `Variant ${variant}`;
      const creative = { title: variantTitle, angle: `Angle ${variant}`, hook: `Hook ${variant}`, script: content,
        cta: `CTA ${variant}`, caption: `Caption ${variant}`, hashtags: ["#kong"], seoKeywords: ["kong media"] };
      result.push({
        public_plan_key: planId, plan_status: "blocked", planned_slot_count: 50,
        public_slot_key: slotId, source_member_key: publicKey("member", member + 10), video_number: video,
        slot_status: "blocked", script_variant_id: `${slotId}-selected`, creator_name: `Creator ${member + 1}`,
        script_title: `Script ${video}`, script_status: "draft", current_variant_id: `${slotId}-selected`,
        script_metadata: { productionBatchV1: envelope }, current_source_hash: envelope.sourceContentHash,
        source_status: "ready", rights_status: "owned", moderation_status: "approved",
        current_source_content: currentContent, variant_id: variant === 0 ? `${slotId}-selected` : `${slotId}-${variant}`,
        variant_version: variant + 1, variant_label: variantTitle, variant_content: content, variant_status: "draft",
        variant_checksum: rawHash(content), variant_metadata: {
          productionBatchV1: {
            ...envelope, variantKey: publicKey("variant", member * 100 + video * 5 + variant),
            variantIndex: variant, selected: variant === 0,
          },
          productionCreativeV1: { ...creative,
            creativeDigest: rawDigest({ domain: "ai-media-production-creative-v1", ...creative }) },
        },
      });
    }
  }
  return result;
}

function readDatabase(readRows: Record<string, unknown>[]) {
  let call = 0;
  const queries: string[] = [];
  const database: ProductionBatchDatabase = {
    async execute(query: SQL) {
      const text = dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ").trim(); queries.push(text); call += 1;
      return call === 1 ? { rows: [{ public_plan_key: planId }] } : { rows: readRows };
    },
    async transaction(callback) { return callback(this); },
  };
  return { database, queries };
}

test("durable read verifies exact script checksums/envelopes and projects source refresh as stale", async () => {
  const fresh = readDatabase(durableRows());
  const ready = await new DrizzleProductionBatchRepository(fresh.database).getCurrent(scope);
  assert.equal(ready?.status, "draft_ready");
  assert.equal(ready?.groups.flatMap((group) => group.items).every((item) => item.preparation === "draft"), true);

  const refreshed = readDatabase(durableRows("Changed after preparation"));
  const stale = await new DrizzleProductionBatchRepository(refreshed.database).getCurrent(scope);
  assert.equal(stale?.status, "stale");
  assert.equal(stale?.blockers[0], "script_refresh_required");

  const corrupt = durableRows(); corrupt[0]!.variant_checksum = "0".repeat(64);
  await assert.rejects(new DrizzleProductionBatchRepository(readDatabase(corrupt).database).getCurrent(scope),
    (error: unknown) => error instanceof ProductionBatchError && error.code === "BATCH_UNAVAILABLE");
});

test("prepare locks plan, ordered slots, and exactly ten sources without advisory, budget, render, provider, or outbox work", async () => {
  let call = 0;
  const queries: string[] = [];
  const slots = Array.from({ length: 50 }, (_, index) => ({
    id: `slot-uuid-${index}`, public_slot_key: publicKey("slot", index + 100),
    source_member_key: publicKey("member", Math.floor(index / 10) + 10), influencer_id: `influencer-${index}`,
    script_variant_id: null, video_number: (index % 10) + 1, status: "blocked", slot_status: "blocked",
    slot_digest: `sha256:${"5".repeat(64)}`, state_version: 1, creator_name: `Creator ${Math.floor(index / 10) + 1}`, language: "en-US",
  }));
  const database: ProductionBatchDatabase = {
    async execute(query: SQL) {
      const text = dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ").trim(); queries.push(text); call += 1;
      if (call === 1) return { rows: [{ id: "plan-uuid", public_plan_key: planId, plan_digest: `sha256:${"6".repeat(64)}`, planned_slot_count: 50 }] };
      if (call === 2) return { rows: slots };
      return { rows: [] };
    },
    async transaction(callback) { return callback(this); },
  };
  await assert.rejects(new DrizzleProductionBatchRepository(database).prepare({
    scope, planId, idempotencyKey: "prepare-batch-1", variantCount: 3,
    generator: { version: "deterministic-script-v1", generate: () => { throw new Error("must not generate without sources"); } },
  }), (error: unknown) => error instanceof ProductionBatchError && error.code === "SOURCE_INELIGIBLE");
  assert.match(queries[0]!, /for update/iu);
  assert.match(queries[1]!, /order by .*source_member_key.*video_number.*for update of/iu);
  assert.match(queries[2]!, /order by .*created_at.*limit 10 for update/iu);
  assert.match(queries[2]!, /title=btrim\(title\).*title !~ '\[\[:cntrl:\]\]'/iu);
  const all = queries.join(" ");
  assert.doesNotMatch(all, /advisory|budget|render|outbox|launch_intent|provider_submission/iu);
});

test("exact replay locks current sources and fails closed when content refreshed before replay", async () => {
  const durable = durableRows();
  const unique = durable.filter((row) => row.variant_version === 1);
  const slots = unique.map((row, index) => ({
    id: `slot-uuid-${index}`, public_slot_key: row.public_slot_key, source_member_key: row.source_member_key,
    influencer_id: `influencer-${index}`, script_variant_id: row.script_variant_id,
    video_number: row.video_number, status: "blocked", slot_status: "blocked",
    slot_digest: `sha256:${"5".repeat(64)}`, state_version: 2,
    creator_name: row.creator_name, language: "en-US",
  }));
  const lockedSources = unique.map((row) => ({
    public_slot_key: row.public_slot_key, script_metadata: row.script_metadata,
    current_source_hash: row.current_source_hash, current_source_content: "refreshed concurrently",
  }));
  let call = 0;
  const queries: string[] = [];
  const database: ProductionBatchDatabase = {
    async execute(query: SQL) {
      const text = dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ").trim(); queries.push(text); call += 1;
      if (call === 1) return { rows: [{ id: "plan-uuid", public_plan_key: planId, plan_digest: `sha256:${"6".repeat(64)}`, planned_slot_count: 50 }] };
      if (call === 2) return { rows: slots };
      if (call === 3) return { rows: lockedSources };
      return { rows: durable };
    },
    async transaction(callback) { return callback(this); },
  };
  await assert.rejects(new DrizzleProductionBatchRepository(database).prepare({
    scope, planId, idempotencyKey: "prepare-batch-1", variantCount: 3,
    generator: { version: "deterministic-script-v1", generate: () => { throw new Error("exact replay must not regenerate"); } },
  }), (error: unknown) => error instanceof ProductionBatchError && error.code === "SOURCE_REFRESHED");
  assert.match(queries[2]!, /order by .*source_member_key.*video_number.*for update of .*sources/iu);
  assert.equal(queries.length, 3, "stale replay fails before script read or mutation");
});
