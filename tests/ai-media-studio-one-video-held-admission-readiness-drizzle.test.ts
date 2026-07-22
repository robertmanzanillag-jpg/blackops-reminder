import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DrizzleOneVideoHeldAdmissionReadinessRepository,
} from "../server/ai-media-studio/planning/drizzle-one-video-held-admission-readiness-repository";
import { OneVideoHeldAdmissionError, type OneVideoHeldAdmissionContext } from
  "../server/ai-media-studio/planning/one-video-held-admission-contracts";
import { deriveMaximumQuoteKey, deriveRenderSpecKey } from
  "../server/ai-media-studio/planning/one-video-execution-control-contracts";
import {
  productionApprovalInputDigest,
  productionCreativeDigest,
} from "../server/ai-media-studio/production-batches/metadata-integrity";

const rawHash = (input: string) => createHash("sha256").update(input).digest("hex");
const scope = { ownerUserId: "owner-1", workspaceId: "personal" } as const;
const planKey = `plan_${"1".repeat(24)}`;
const batchKey = `batch_${"2".repeat(24)}`;
const slotKey = `slot_${"3".repeat(24)}`;
const scriptKey = `script_${"4".repeat(24)}`;
const sourceId = "11111111-1111-4111-8111-111111111111";
const quoteEvidenceId = "55555555-5555-4555-8555-555555555555";
const quoteEvidenceDigest = `sha256:${"a".repeat(64)}` as const;
const renderSpecDigest = `sha256:${"b".repeat(64)}` as const;
const quoteExpiresAt = "2026-07-22T12:15:00.000Z";
const context: OneVideoHeldAdmissionContext = Object.freeze({
  scope,
  planId: "22222222-2222-4222-8222-222222222222",
  dailyPlanSlotId: "33333333-3333-4333-8333-333333333333",
  budgetBucketId: "44444444-4444-4444-8444-444444444444",
  publicPlanKey: planKey,
  publicBatchKey: batchKey,
  publicSlotKey: slotKey,
  publicQuoteKey: deriveMaximumQuoteKey({ evidenceId: quoteEvidenceId, evidenceRevision: 1,
    evidenceDigest: quoteEvidenceDigest, amountMicroUsd: "2500000", currency: "USD",
    expiresAt: new Date(quoteExpiresAt), renderSpecDigest }),
  publicRenderSpecKey: deriveRenderSpecKey(renderSpecDigest),
  slotAttempt: 1,
  expectedSlotStateVersion: 7,
  expectedBucketStateVersion: 9,
  maximumQuoteMicroUsd: "2500000",
  currency: "USD",
  quoteExpiresAt,
  reservationExpiresAt: "2026-07-22T12:10:00.000Z",
});

function approvedBatchFields() {
  const sourceContent = "Exact source content";
  const base = {
    version: 1, batchId: batchKey, planId: planKey, slotId: slotKey, scriptKey,
    idempotencyKey: "prepare-batch-0001", inputDigest: `sha256:${"7".repeat(64)}`,
    sourceContentHash: `sha256:${"8".repeat(64)}`, sourceContentChecksum: rawHash(sourceContent),
    sourceTitle: "Exact source title", sourceCategory: "experiences",
    generatorVersion: "deterministic-script-v1", variantCount: 3,
    preparedAt: "2026-07-22T11:00:00.000Z",
  } as const;
  const variants = [0, 1, 2].map((index) => {
    const title = index === 0 ? "Selected title" : `Alternative ${index}`;
    const content = `Full script ${index}`;
    const creative = { title, angle: `Angle ${index}`, hook: `Hook ${index}`, script: content,
      cta: `CTA ${index}`, caption: `Caption ${index}`, hashtags: ["#safe"], seoKeywords: ["safe"] };
    return {
      id: `variant-${index}`, version: index + 1, label: title, content,
      status: index === 0 ? "approved" : "draft", checksum: rawHash(content),
      metadata: {
        productionBatchV1: { ...base, variantKey: `variant_${String(index + 9).padStart(24, "0")}`,
          variantIndex: index, selected: index === 0 },
        productionCreativeV1: { ...creative, creativeDigest: productionCreativeDigest(creative) },
      } as Record<string, unknown>,
    };
  });
  const selected = variants[0]!;
  const selectedCreative = selected.metadata.productionCreativeV1 as Record<string, unknown>;
  const approval = {
    version: 1, ...scope, batchId: batchKey, planId: planKey, slotId: slotKey, scriptKey,
    selectedVariantChecksum: selected.checksum, selectedCreativeDigest: String(selectedCreative.creativeDigest),
    inputDigest: productionApprovalInputDigest({ ...scope, planId: planKey, expectedBatchId: batchKey,
      idempotencyKey: "approve-batch-0001" }), idempotencyKey: "approve-batch-0001",
    approvedAt: "2026-07-22T11:30:00.000Z",
  };
  selected.metadata.productionBatchApprovalV1 = approval;
  return {
    status: "planned", plannedSlotCount: 50,
    planSlots: Array.from({ length: 50 }, (_, index) => ({
      sourceMemberKey: `member_${String(Math.floor(index / 10) + 1).padStart(24, "0")}`,
      videoNumber: (index % 10) + 1, status: "planned",
    })),
    slotStatus: "planned", scriptVariantId: selected.id,
    scriptId: "script-db-id", scriptTitle: selected.label, scriptStatus: "approved",
    currentVariantId: selected.id,
    scriptMetadata: { productionBatchV1: base, productionBatchApprovalV1: approval },
    sourceType: "experiences", sourceItemId: sourceId,
    sourceId, sourceItemType: "experiences", sourceTitle: base.sourceTitle,
    sourceContent, sourceContentHash: base.sourceContentHash, sourceStatus: "ready",
    rightsStatus: "owned", moderationStatus: "approved", variants,
    planSlotCount: 50, memberCount: 5, rowsCurrent: true, tenEach: true,
  };
}

function readyRow(): Record<string, unknown> {
  return {
    observedAt: new Date("2026-07-22T12:00:00.000Z"), ...approvedBatchFields(),
    planCandidates: 1, slotCandidates: 1, scriptCandidates: 1, sourceCandidates: 1,
    intentCandidates: 1, contentCandidates: 1, sandboxCandidates: 1, quoteCandidates: 1,
    humanCandidates: 1, bridgeCandidates: 1, policyCandidates: 1, killCandidates: 1,
    governanceCandidates: 1, accountCandidates: 1, avatarCandidates: 1, voiceCandidates: 1,
    headerCandidates: 1, avatarVerificationCandidates: 1, voiceVerificationCandidates: 1,
    slotCurrent: true, intentCurrent: true,
    contentDecision: "approved", contentCurrent: true,
    sandboxDecision: "passed", sandboxCurrent: true,
    policyState: "active", policyCurrent: true,
    killActive: false, killCurrent: true,
    governanceCurrent: true, credentialCurrent: true, sourceCurrent: true,
    verificationId: "55555555-5555-4555-8555-555555555555", providerVerificationCurrent: true,
    quoteId: quoteEvidenceId, quoteRevision: 1, quoteEvidenceDigest,
    bridgeRenderSpecDigest: renderSpecDigest, quoteDecision: "quoted", quoteCurrent: true,
    humanDecision: "approved", humanCurrent: true,
    budgetCurrent: true, concurrencyCurrent: true,
    reservationCandidates: 0,
  };
}

function queryText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

function repositoryWith(rows: Record<string, unknown>[]) {
  const queries: string[] = [];
  const repository = new DrizzleOneVideoHeldAdmissionReadinessRepository({ execute: async (query) => {
    queries.push(queryText(query));
    return { rows };
  } });
  return { repository, queries };
}

test("one tenant-bound DB-clock statement projects every ready gate without side effects", async () => {
  const scripted = repositoryWith([readyRow()]);
  const observed = await scripted.repository.observe({ scope, context });
  assert.equal(observed.observedAt, "2026-07-22T12:00:00.000Z");
  assert.deepEqual(observed.gates, {
    batch: "ready", slot: "ready", launchIntent: "ready", contentApproval: "ready",
    sandboxProof: "ready", policy: "ready", killSwitch: "ready", governance: "ready",
    credential: "ready", source: "ready", providerVerification: "ready", maximumQuote: "ready",
    humanApproval: "ready", budget: "ready", concurrency: "ready",
  });
  assert.deepEqual(observed.reservations, []);
  assert.equal(scripted.queries.length, 1);
  const query = scripted.queries[0]!;
  assert.match(query, /^\s*WITH\s+db_clock/iu);
  assert.match(query, /transaction_timestamp\(\)/iu);
  assert.match(query, /owner_user_id=.*workspace_id=.*LIMIT 2/isu);
  assert.match(query, /maximum_quote.*human_launch_approval.*quote_bound_human_approvals/isu);
  assert.match(query, /NOT EXISTS.*newer\.revision>evidence\.revision/isu);
  assert.match(query, /static_heygen_verification_headers.*static_heygen_resource_verifications/isu);
  assert.match(query, /budget_reservations.*total_concurrency.*provider_concurrency.*tenant_concurrency/isu);
  assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|LOCK|FOR\s+UPDATE)\b/iu);
});

test("missing, stale, blocked, and ambiguous candidates fail closed per gate", async () => {
  const cases: readonly [Record<string, unknown>, string, string][] = [
    [{ planCandidates: 0 }, "batch", "missing"],
    [{ slotCurrent: false }, "slot", "stale"],
    [{ slotCandidates: 2 }, "slot", "unknown"],
    [{ intentCandidates: 0 }, "launchIntent", "missing"],
    [{ contentCurrent: false }, "contentApproval", "stale"],
    [{ sandboxCandidates: 2 }, "sandboxProof", "unknown"],
    [{ policyState: "inactive", policyCurrent: false }, "policy", "blocked"],
    [{ killActive: true, killCurrent: false }, "killSwitch", "blocked"],
    [{ governanceCandidates: 0 }, "governance", "missing"],
    [{ accountCandidates: 2 }, "credential", "unknown"],
    [{ sourceCurrent: false }, "source", "stale"],
    [{ headerCandidates: 2 }, "providerVerification", "unknown"],
    [{ verificationId: "" }, "providerVerification", "missing"],
    [{ quoteCandidates: 0 }, "maximumQuote", "missing"],
    [{ bridgeRenderSpecDigest: `sha256:${"c".repeat(64)}` }, "maximumQuote", "stale"],
    [{ bridgeCandidates: 0 }, "humanApproval", "missing"],
    [{ budgetCurrent: false }, "budget", "blocked"],
    [{ concurrencyCurrent: false }, "concurrency", "blocked"],
  ];
  for (const [override, gate, expected] of cases) {
    const observed = await repositoryWith([{ ...readyRow(), ...override }]).repository.observe({ scope, context });
    assert.equal((observed.gates as Record<string, unknown>)[gate], expected, gate);
  }
});

test("approved 5-10 by ten metadata is exact and tampering becomes stale", async () => {
  const changed = readyRow();
  changed.memberCount = 4;
  assert.equal((await repositoryWith([changed]).repository.observe({ scope, context })).gates.batch, "stale");
  const changedEnvelope = readyRow();
  (changedEnvelope.scriptMetadata as any).productionBatchV1.batchId = `batch_${"f".repeat(24)}`;
  assert.equal((await repositoryWith([changedEnvelope]).repository.observe({ scope, context })).gates.batch, "stale");
});

test("zero or one durable reservation is projected exactly, while ambiguity fails closed", async () => {
  const reservation = {
    reservationCandidates: 1,
    reservationId: "66666666-6666-4666-8666-666666666666",
    reservationSlotId: context.dailyPlanSlotId,
    reservationBucketId: context.budgetBucketId,
    reservationAttempt: 1,
    reservationAmount: context.maximumQuoteMicroUsd,
    reservationCurrency: "USD",
    reservationState: "reserved",
    submissionState: "not_started",
    reservationExpiresAt: new Date(context.reservationExpiresAt),
  };
  const observed = await repositoryWith([{ ...readyRow(), ...reservation }]).repository.observe({ scope, context });
  assert.equal(observed.reservations.length, 1);
  assert.deepEqual(observed.reservations[0], {
    reservationId: reservation.reservationId, dailyPlanSlotId: context.dailyPlanSlotId,
    budgetBucketId: context.budgetBucketId, slotAttempt: 1, amountMicroUsd: context.maximumQuoteMicroUsd,
    currency: "USD", state: "reserved", submissionState: "not_started",
    expiresAt: context.reservationExpiresAt,
  });
  const second = { ...readyRow(), ...reservation, reservationCandidates: 2,
    reservationId: "77777777-7777-4777-8777-777777777777" };
  const ambiguous = await repositoryWith([{ ...readyRow(), ...reservation, reservationCandidates: 2 }, second])
    .repository.observe({ scope, context });
  assert.equal(ambiguous.reservations.length, 2);
  await assert.rejects(repositoryWith([{ ...readyRow(), reservationCandidates: 3 }]).repository.observe({ scope, context }),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
});

test("invalid server context and malformed DB observations never reach a permissive projection", async () => {
  let calls = 0;
  const repository = new DrizzleOneVideoHeldAdmissionReadinessRepository({ execute: async () => {
    calls += 1; return { rows: [readyRow()] };
  } });
  await assert.rejects(repository.observe({ scope, context: { ...context, publicBatchKey: "bad" } }),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
  assert.equal(calls, 0);
  await assert.rejects(repositoryWith([]).repository.observe({ scope, context }),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
  await assert.rejects(repositoryWith([{ ...readyRow(), observedAt: "not-a-date" }]).repository.observe({ scope, context }),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
});

test("repository source has no provider, secret, mutation, activation, or network surface", () => {
  const source = readFileSync(new URL(
    "../server/ai-media-studio/planning/drizzle-one-video-held-admission-readiness-repository.ts",
    import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|axios|secretResolver|secretRef|providerClient|reserveHeld\s*\(|activate\s*\(/iu);
  assert.match(source, /POST transaction must re-lock and\s+\* revalidate/iu);
  assert.match(source, /LIMIT 2/iu);
});
