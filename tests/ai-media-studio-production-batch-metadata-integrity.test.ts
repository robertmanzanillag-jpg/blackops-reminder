import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  productionApprovalInputDigest,
  productionCreativeDigest,
  verifiedProductionBatchApprovalBinding,
  verifyApprovedProductionBatchSlotMetadata,
  type ApprovedProductionBatchSlotFacts,
} from "../server/ai-media-studio/production-batches/metadata-integrity";

const rawHash = (input: string) => createHash("sha256").update(input).digest("hex");
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const planId = `plan_${"1".repeat(24)}`;
const slotId = `slot_${"2".repeat(24)}`;
const batchId = `batch_${"3".repeat(24)}`;
const scriptKey = `script_${"4".repeat(24)}`;
const sourceId = "11111111-1111-4111-8111-111111111111";
const preparedAt = "2026-07-21T11:00:00.000Z";
const approvedAt = "2026-07-21T11:30:00.000Z";

function approvedFacts(): ApprovedProductionBatchSlotFacts {
  const base = {
    version: 1, batchId, planId, slotId, scriptKey, idempotencyKey: "prepare-batch-0001",
    inputDigest: `sha256:${"5".repeat(64)}`, sourceContentHash: `sha256:${"6".repeat(64)}`,
    sourceContentChecksum: rawHash("Exact source content"), sourceTitle: "Exact source title",
    sourceCategory: "experiences", generatorVersion: "deterministic-script-v1", variantCount: 3, preparedAt,
  } as const;
  const variants = [0, 1, 2].map((index) => {
    const title = index === 0 ? "Selected title" : `Alternative ${index}`;
    const content = `Full script ${index}`;
    const creative = {
      title, angle: `Angle ${index}`, hook: `Hook ${index}`, script: content, cta: `CTA ${index}`,
      caption: `Caption ${index}`, hashtags: ["#kong"], seoKeywords: ["kong media"],
    };
    return {
      id: `variant-${index}`, version: index + 1, label: title, content,
      status: index === 0 ? "approved" : "draft", checksum: rawHash(content),
      metadata: {
        productionBatchV1: { ...base, variantKey: `variant_${String(index + 7).padStart(24, "0")}`,
          variantIndex: index, selected: index === 0 },
        productionCreativeV1: { ...creative, creativeDigest: productionCreativeDigest(creative) },
      } as Record<string, unknown>,
    };
  });
  const selected = variants[0]!;
  const selectedCreative = selected.metadata.productionCreativeV1 as Record<string, unknown>;
  const approval = {
    version: 1, ...scope, batchId, planId, slotId, scriptKey,
    selectedVariantChecksum: selected.checksum,
    selectedCreativeDigest: String(selectedCreative.creativeDigest),
    inputDigest: productionApprovalInputDigest({ ...scope, planId, expectedBatchId: batchId,
      idempotencyKey: "approve-batch-0001" }),
    idempotencyKey: "approve-batch-0001", approvedAt,
  };
  selected.metadata.productionBatchApprovalV1 = approval;
  return {
    scope, databaseNow: new Date("2026-07-21T12:00:00.000Z"),
    plan: { publicKey: planId, status: "planned", plannedSlotCount: 50 },
    planSlots: Array.from({ length: 50 }, (_, index) => ({
      sourceMemberKey: `member_${String(Math.floor(index / 10) + 1).padStart(24, "0")}`,
      videoNumber: (index % 10) + 1, status: "planned",
    })),
    slot: { publicKey: slotId, status: "planned", scriptVariantId: selected.id },
    script: { id: "script-db-id", title: selected.label, status: "approved", currentVariantId: selected.id,
      metadata: { productionBatchV1: base, productionBatchApprovalV1: approval },
      sourceType: "experiences", sourceItemId: sourceId },
    source: { id: sourceId, type: "experiences", title: base.sourceTitle, content: "Exact source content",
      contentHash: base.sourceContentHash, status: "ready", rightsStatus: "owned", moderationStatus: "approved" },
    variants,
  };
}

function changed(mutate: (facts: any) => void): ApprovedProductionBatchSlotFacts {
  const facts = structuredClone(approvedFacts());
  mutate(facts);
  return facts;
}

test("exact PR144 approved production metadata is launch-authority eligible", () => {
  assert.equal(verifyApprovedProductionBatchSlotMetadata(approvedFacts()), true);
  const binding = verifiedProductionBatchApprovalBinding(approvedFacts());
  assert.equal(binding?.batchId, batchId);
  assert.equal(binding?.planId, planId);
  assert.equal(binding?.slotId, slotId);
  assert.equal(binding?.scriptKey, scriptKey);
});

test("metadata envelopes fail closed when required fields are absent or extensions are added", () => {
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    delete facts.script.metadata.productionBatchApprovalV1;
  })), false);
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    facts.script.metadata.untrustedExtension = true;
  })), false);
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    delete facts.variants[0].metadata.productionCreativeV1.cta;
  })), false);
});

test("selection pointer, title, CTA, content, and checksum tampering fail closed", () => {
  const mutations = [
    (facts: any) => { facts.slot.scriptVariantId = facts.variants[1].id; },
    (facts: any) => { facts.script.currentVariantId = facts.variants[1].id; },
    (facts: any) => { facts.script.title = "Changed title"; },
    (facts: any) => { facts.variants[0].metadata.productionCreativeV1.cta = "Changed CTA"; },
    (facts: any) => { facts.variants[0].content = "Changed content"; },
    (facts: any) => { facts.variants[0].checksum = "0".repeat(64); },
  ];
  for (const mutate of mutations) assert.equal(verifyApprovedProductionBatchSlotMetadata(changed(mutate)), false);
});

test("approval scope, digest, timestamps, source truth, and alternative approval tampering fail closed", () => {
  const mutations = [
    (facts: any) => { facts.script.metadata.productionBatchApprovalV1.ownerUserId = "other-owner"; },
    (facts: any) => { facts.script.metadata.productionBatchApprovalV1.inputDigest = `sha256:${"9".repeat(64)}`; },
    (facts: any) => { facts.variants[0].metadata.productionBatchApprovalV1.approvedAt = "2026-07-22T00:00:00.000Z"; },
    (facts: any) => { facts.source.title = "Changed source title"; },
    (facts: any) => { facts.source.content = "Changed source content"; },
    (facts: any) => { facts.source.rightsStatus = "unknown"; },
    (facts: any) => { facts.variants[1].status = "approved"; },
    (facts: any) => { facts.variants[1].metadata.productionBatchApprovalV1 = facts.variants[0].metadata.productionBatchApprovalV1; },
  ];
  for (const mutate of mutations) assert.equal(verifyApprovedProductionBatchSlotMetadata(changed(mutate)), false);
});

test("source titles reject exterior whitespace and control characters without normalization", () => {
  for (const sourceTitle of [" Exact source title", "Exact source title ", "Exact\nsource title"]) {
    assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
      facts.script.metadata.productionBatchV1.sourceTitle = sourceTitle;
      facts.variants.forEach((variant: any) => { variant.metadata.productionBatchV1.sourceTitle = sourceTitle; });
      facts.source.title = sourceTitle;
    })), false);
  }
});

test("legacy and manual daily-plan scripts have no permissive production fallback", () => {
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    facts.script.metadata = {};
  })), false);
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    facts.script.sourceType = "manual";
    facts.script.sourceItemId = null;
  })), false);
});

test("production plan shape is exactly 5-10 members with ten unique videos each", () => {
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    facts.planSlots.pop();
  })), false);
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    facts.planSlots[1].videoNumber = facts.planSlots[0].videoNumber;
  })), false);
  assert.equal(verifyApprovedProductionBatchSlotMetadata(changed((facts) => {
    facts.plan.plannedSlotCount = 49;
  })), false);
});
