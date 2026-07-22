import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DrizzleSandboxReadinessRepository } from "../server/ai-media-studio/planning/drizzle-sandbox-readiness-repository";
import { SandboxReadinessError } from "../server/ai-media-studio/planning/sandbox-readiness-contracts";
import { productionApprovalInputDigest, productionCreativeDigest } from "../server/ai-media-studio/production-batches/metadata-integrity";

const scope = { ownerUserId: "owner", workspaceId: "workspace" } as const;
const planId = `plan_${"1".repeat(24)}`;
const batchId = `batch_${"2".repeat(24)}`;
const slotId = `slot_${"3".repeat(24)}`;
const scriptKey = `script_${"4".repeat(24)}`;
const rawHash = (input: string) => createHash("sha256").update(input).digest("hex");

function approvedRows() {
  const sourceContent = "Exact source content";
  const base = { version: 1, batchId, planId, slotId, scriptKey, idempotencyKey: "prepare-batch-0001",
    inputDigest: `sha256:${"5".repeat(64)}`, sourceContentHash: `sha256:${"6".repeat(64)}`,
    sourceContentChecksum: rawHash(sourceContent), sourceTitle: "Exact source title", sourceCategory: "experiences",
    generatorVersion: "deterministic-script-v1", variantCount: 3, preparedAt: "2026-07-21T11:00:00.000Z" };
  const variants = [0, 1, 2].map((index) => {
    const content = `Full script ${index}`; const title = index === 0 ? "Selected title" : `Alternative ${index}`;
    const creative = { title, angle: `Angle ${index}`, hook: `Hook ${index}`, script: content, cta: `CTA ${index}`,
      caption: `Caption ${index}`, hashtags: ["#safe"], seoKeywords: ["safe"] };
    return { id: `variant-${index}`, version: index + 1, label: title, content,
      status: index === 0 ? "approved" : "draft", checksum: rawHash(content), metadata: {
        productionBatchV1: { ...base, variantKey: `variant_${String(index + 7).padStart(24, "0")}`,
          variantIndex: index, selected: index === 0 },
        productionCreativeV1: { ...creative, creativeDigest: productionCreativeDigest(creative) },
      } as Record<string, unknown> };
  });
  const selected = variants[0]!; const creative = selected.metadata.productionCreativeV1 as Record<string, unknown>;
  const approval = { version: 1, ...scope, batchId, planId, slotId, scriptKey,
    selectedVariantChecksum: selected.checksum, selectedCreativeDigest: creative.creativeDigest,
    inputDigest: productionApprovalInputDigest({ ...scope, planId, expectedBatchId: batchId, idempotencyKey: "approve-batch-0001" }),
    idempotencyKey: "approve-batch-0001", approvedAt: "2026-07-21T11:30:00.000Z" };
  selected.metadata.productionBatchApprovalV1 = approval;
  const plan = [{ id: "plan-db-id", public_plan_key: planId, status: "planned", planned_slot_count: 50 }];
  const slot = [{ id: "slot-db-id", public_slot_key: slotId, status: "planned", script_variant_id: selected.id,
    source_member_key: `member_${"7".repeat(24)}`, video_number: 1, script_id: "script-db-id",
    script_title: selected.label, script_status: "approved", current_variant_id: selected.id,
    script_metadata: { productionBatchV1: base, productionBatchApprovalV1: approval }, source_type: "experiences",
    source_item_id: "source-db-id", source_id: "source-db-id", source_item_type: "experiences",
    source_title: base.sourceTitle, source_content: sourceContent, source_content_hash: base.sourceContentHash,
    source_status: "ready", rights_status: "owned", moderation_status: "approved", creator_name: "Safe Creator",
    influencer_ready: true, account_ready: true, resources_ready: true, governance_state: "active",
    governance_valid_from: new Date("2026-07-21T11:00:00Z"), governance_expires_at: new Date("2026-07-22T13:00:00Z"),
    revoked_at: null, governance_bound: true, governance_use_allowed: true }];
  const planSlots = Array.from({ length: 50 }, (_, index) => ({
    source_member_key: `member_${String(Math.floor(index / 10) + 1).padStart(24, "0")}`,
    video_number: (index % 10) + 1, status: "planned",
  }));
  return { plan, slot, planSlots, variants };
}

function databaseFrom(input: ReturnType<typeof approvedRows>) {
  let call = 0; const queries: string[] = [];
  const database = {
    execute: async () => ({ rows: [] }),
    transaction: async (callback: any, config?: unknown) => callback({ execute: async (query: unknown) => {
      queries.push(queryText(query)); call += 1;
      return { rows: call === 1 ? [{ observed_at: new Date("2026-07-21T12:00:00Z") }]
        : call === 2 ? input.plan : call === 3 ? input.slot : call === 4 ? input.planSlots : input.variants };
    } }, config),
  };
  return { database, queries };
}

function queryText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("repository uses one repeatable-read/read-only DB-clock snapshot and tenant-scoped SELECTs", async () => {
  const queries: string[] = []; let config: unknown;
  const repository = new DrizzleSandboxReadinessRepository({
    transaction: async (callback, value) => { config = value; return callback({ execute: async (query) => {
      queries.push(queryText(query));
      return queries.length === 1 ? { rows: [{ observed_at: new Date("2026-07-22T00:00:00Z") }] } : { rows: [] };
    } }); }, execute: async () => ({ rows: [] }),
  });
  assert.equal(await repository.observe({ ownerUserId: "owner", workspaceId: "workspace" },
    `plan_${"a".repeat(24)}`, `slot_${"b".repeat(24)}`), undefined);
  assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.ok(queries.every((query) => /^\s*SELECT/iu.test(query)));
  assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
  assert.match(queries[1], /owner_user_id=.*workspace_id=.*public_plan_key/isu);
});

test("repository source has no provider/network/secret/authority/reservation/render/outbox surface", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/planning/drizzle-sandbox-readiness-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|axios|secretRef|externalResourceId|reserveAndAdmit|createAuthoritySnapshot|FOR UPDATE/iu);
  assert.match(source, /verifyApprovedProductionBatchSlotMetadata/u);
  assert.match(source, /isolationLevel: "repeatable read", accessMode: "read only"/u);
  assert.match(source, /governance\.allowed_uses \? 'internal_preview'/u);
});

test("repository derives a valid exact approved one-slot packet without writes", async () => {
  const scripted = databaseFrom(approvedRows());
  const packet = await new DrizzleSandboxReadinessRepository(scripted.database).observe(scope, planId, slotId);
  assert.equal(packet?.subject.batchId, batchId); assert.equal(packet?.subject.slotId, slotId);
  assert.equal(packet?.status, "locally_ready_for_external_sandbox");
  assert.equal(packet?.preview.script.script, "Full script 0"); assert.equal(packet?.format.aspectRatio, "9:16");
  assert.equal(scripted.queries.length, 5);
  assert.ok(scripted.queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
});

test("stale source and selected-script metadata fail closed as unavailable", async () => {
  const mutations = [
    (input: ReturnType<typeof approvedRows>) => { input.slot[0]!.source_content = "refreshed"; },
    (input: ReturnType<typeof approvedRows>) => { input.slot[0]!.source_status = "rejected"; },
    (input: ReturnType<typeof approvedRows>) => { input.slot[0]!.rights_status = "unknown"; },
    (input: ReturnType<typeof approvedRows>) => { input.slot[0]!.moderation_status = "pending"; },
    (input: ReturnType<typeof approvedRows>) => { input.slot[0]!.current_variant_id = "changed"; },
    (input: ReturnType<typeof approvedRows>) => { input.variants[0]!.checksum = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const input = approvedRows(); mutate(input);
    await assert.rejects(new DrizzleSandboxReadinessRepository(databaseFrom(input).database).observe(scope, planId, slotId),
      (error: unknown) => error instanceof SandboxReadinessError && error.code === "UNAVAILABLE");
  }
});

test("missing, revoked, and future governance stay safely blocked without exposing authority", async () => {
  const mutations = [
    (row: Record<string, unknown>) => { row.governance_state = null; row.governance_valid_from = null; row.governance_expires_at = null; },
    (row: Record<string, unknown>) => { row.governance_state = "revoked"; row.revoked_at = new Date("2026-07-21T11:30:00Z"); },
    (row: Record<string, unknown>) => { row.governance_valid_from = new Date("2026-07-21T12:00:01Z"); },
  ];
  for (const mutate of mutations) {
    const input = approvedRows(); mutate(input.slot[0]!);
    const packet = await new DrizzleSandboxReadinessRepository(databaseFrom(input).database).observe(scope, planId, slotId);
    assert.equal(packet?.status, "blocked");
    assert.equal(packet?.gates.find((gate) => gate.code === "governance_coverage")?.state, "blocked");
    assert.equal(packet?.authoritativeForAdmission, false);
  }
});

test("wrong-tenant plan and slot absence is indistinguishable", async () => {
  const input = approvedRows(); input.plan = [];
  assert.equal(await new DrizzleSandboxReadinessRepository(databaseFrom(input).database).observe(
    { ownerUserId: "other", workspaceId: "other" }, planId, slotId), undefined);
  const missingSlot = approvedRows(); missingSlot.slot = [];
  assert.equal(await new DrizzleSandboxReadinessRepository(databaseFrom(missingSlot).database).observe(scope, planId, slotId), undefined);
});
