import assert from "node:assert/strict";
import test from "node:test";
import {
  DrizzleOneVideoHeldAdmissionReplayRepository,
} from "../server/ai-media-studio/planning/drizzle-one-video-held-admission-replay-repository";
import {
  deriveMaximumQuoteKey,
  deriveRenderSpecKey,
} from "../server/ai-media-studio/planning/one-video-execution-control-contracts";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionPublicCas,
} from "../server/ai-media-studio/planning/one-video-held-admission-contracts";

const key = (prefix: string, digit: string) => `${prefix}_${digit.repeat(24)}`;
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const digest = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const ids = {
  plan: uuid("1"), slot: uuid("2"), reservation: uuid("3"), snapshot: uuid("4"), quote: uuid("5"),
  human: uuid("6"), render: uuid("7"), outbox: uuid("8"),
};
const quoteExpiry = "2026-07-22T12:30:00.000Z";
const renderSpecDigest = digest("e");
const quoteEvidenceDigest = digest("d");
const publicQuoteKey = deriveMaximumQuoteKey({
  evidenceId: ids.quote, evidenceRevision: 2, evidenceDigest: quoteEvidenceDigest,
  amountMicroUsd: "1250000", currency: "USD", expiresAt: new Date(quoteExpiry), renderSpecDigest,
});
const cas: OneVideoHeldAdmissionPublicCas = {
  publicPlanKey: key("plan", "1"), publicSlotKey: key("slot", "2"),
  expectedBatchId: key("batch", "3"), expectedQuoteKey: publicQuoteKey,
  expectedRenderSpecKey: deriveRenderSpecKey(renderSpecDigest), expectedSlotAttempt: 1,
  idempotencyKey: "held-admission-0001",
};

const metadata = {
  productionBatchV1: {
    version: 1, batchId: cas.expectedBatchId, planId: cas.publicPlanKey, slotId: cas.publicSlotKey,
    scriptKey: key("script", "9"), idempotencyKey: "production-batch-0001", inputDigest: digest("1"),
    sourceContentHash: digest("2"), sourceContentChecksum: "3".repeat(64), sourceTitle: "Source",
    sourceCategory: "events", generatorVersion: "v1", variantCount: 1,
    preparedAt: "2026-07-22T11:00:00.000Z",
  },
};

function heldRow(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observed_at: new Date("2026-07-22T12:00:00.000Z"),
    owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    id: ids.reservation, plan_id: ids.plan, public_plan_key: cas.publicPlanKey,
    daily_plan_slot_id: ids.slot, public_slot_key: cas.publicSlotKey, slot_status: "reserved",
    script_metadata: metadata, attempt: 1, idempotency_key: cas.idempotencyKey,
    state: "reserved", submission_state: "not_started", amount_micro_usd: "1250000", currency: "USD",
    quote_digest: quoteEvidenceDigest, quote_expires_at: new Date(quoteExpiry),
    expires_at: new Date("2026-07-22T12:10:00.000Z"),
    authority_snapshot_id: ids.snapshot, authority_digest: digest("a"), admission_digest: digest("b"),
    render_job_id: ids.render, dispatch_outbox_id: ids.outbox, work_handoff_digest: digest("c"),
    snapshot_id: ids.snapshot, snapshot_plan_id: ids.plan, snapshot_slot_id: ids.slot,
    snapshot_slot_attempt: 1, maximum_quote_evidence_id: ids.quote,
    maximum_quote_evidence_digest: quoteEvidenceDigest, snapshot_maximum_quote_micro_usd: "1250000",
    snapshot_currency: "USD", human_launch_approval_evidence_id: ids.human,
    snapshot_authority_digest: digest("a"), snapshot_admission_digest: digest("b"),
    quote_id: ids.quote, quote_revision: 2, quote_kind: "maximum_quote", quote_decision: "quoted",
    quote_amount: "1250000", quote_currency: "USD", evidence_quote_expires_at: new Date(quoteExpiry),
    quote_evidence_digest: quoteEvidenceDigest,
    bridge_human_id: ids.human, bridge_quote_id: ids.quote, bridge_quote_revision: 2,
    bridge_quote_digest: quoteEvidenceDigest, bridge_slot_id: ids.slot, bridge_slot_attempt: 1,
    bridge_decision: "approved", bridge_amount: "1250000", bridge_currency: "USD",
    bridge_quote_expires_at: new Date(quoteExpiry), render_spec_digest: renderSpecDigest,
    job_id: ids.render, job_status: "pending", job_stage: "admission_held", job_progress: 0, job_attempts: 0,
    job_provider_job_id: null, job_lease_owner: null, job_reservation_id: ids.reservation,
    job_slot_id: ids.slot, job_slot_attempt: 1, job_snapshot_id: ids.snapshot,
    job_authority_digest: digest("a"), job_admission_digest: digest("b"),
    job_handoff_digest: digest("c"), job_sealed_digest: digest("f"),
    outbox_id: ids.outbox, outbox_status: "held", outbox_attempts: 0, outbox_lease_owner: null,
    outbox_processed_at: null, outbox_reservation_id: ids.reservation, outbox_render_id: ids.render,
    outbox_handoff_digest: digest("c"), outbox_sealed_digest: digest("f"),
    ...changes,
  };
}

function sqlText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

function repository(result: Record<string, unknown>[] = [heldRow()]) {
  const queries: string[] = [];
  return {
    queries,
    repo: new DrizzleOneVideoHeldAdmissionReplayRepository({ async execute(query) {
      queries.push(sqlText(query)); return { rows: result };
    } }),
  };
}

test("tenant-bound existing and exact replay recover the same original held attempt read-only", async () => {
  const harness = repository();
  const existing = await harness.repo.observeExisting(scope, cas.publicPlanKey, cas.publicSlotKey);
  const replay = await harness.repo.loadExactReplay(scope, cas);
  assert.deepEqual(replay, existing);
  assert.deepEqual(replay, {
    ownerUserId: scope.ownerUserId, workspaceId: "personal",
    observedAt: "2026-07-22T12:00:00.000Z",
    publicPlanKey: cas.publicPlanKey, publicBatchKey: cas.expectedBatchId,
    publicSlotKey: cas.publicSlotKey, publicQuoteKey: cas.expectedQuoteKey,
    publicRenderSpecKey: cas.expectedRenderSpecKey, slotAttempt: 1,
    idempotencyKey: cas.idempotencyKey, reservationId: ids.reservation,
    maximumQuoteMicroUsd: "1250000", currency: "USD",
    expiresAt: "2026-07-22T12:10:00.000Z", state: "held",
  });
  assert.equal(harness.queries.length, 2);
  assert.match(harness.queries[0]!, /reservation\.owner_user_id=/u);
  assert.match(harness.queries[0]!, /reservation\.workspace_id=/u);
  assert.doesNotMatch(harness.queries[0]!, /INSERT|UPDATE|DELETE|provider_job_id\s*=/u);
});

test("every mismatched public CAS or idempotency binding is a generic conflict", async () => {
  const cases: Partial<OneVideoHeldAdmissionPublicCas>[] = [
    { publicPlanKey: key("plan", "9") }, { publicSlotKey: key("slot", "9") },
    { expectedBatchId: key("batch", "9") }, { expectedQuoteKey: key("quote", "9") },
    { expectedRenderSpecKey: key("render_spec", "9") }, { expectedSlotAttempt: 2 },
    { idempotencyKey: "held-admission-other" },
  ];
  for (const changed of cases) {
    await assert.rejects(repository().repo.loadExactReplay(scope, { ...cas, ...changed }),
      (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
  }
});

test("cross-tenant absence is invisible while ambiguity and corrupt authority fail unavailable", async () => {
  assert.equal(await repository([]).repo.observeExisting(
    { ownerUserId: "other-owner", workspaceId: "personal" }, cas.publicPlanKey, cas.publicSlotKey,
  ), undefined);
  await assert.rejects(repository([heldRow(), heldRow({ id: uuid("9") })]).repo.loadExactReplay(scope, cas), unavailable);
  for (const corrupt of [
    { snapshot_authority_digest: digest("9") }, { bridge_quote_digest: digest("9") },
    { quote_amount: "999" }, { job_stage: "queued" }, { outbox_status: "pending" },
    { job_provider_job_id: "provider-job" }, { script_metadata: {} },
  ]) {
    await assert.rejects(repository([heldRow(corrupt)]).repo.loadExactReplay(scope, cas), unavailable);
  }
});

test("expired is observable but not replayable by the coordinator; committed work is blocked", async () => {
  const expired = await repository([heldRow({ expires_at: new Date("2026-07-22T11:59:59.000Z") })])
    .repo.observeExisting(scope, cas.publicPlanKey, cas.publicSlotKey);
  assert.equal(expired?.state, "expired");
  const committed = await repository([heldRow({ state: "committed", submission_state: "confirmed",
    slot_status: "committed", job_status: "rendering", job_stage: "submitted", outbox_status: "dispatched" })])
    .repo.observeExisting(scope, cas.publicPlanKey, cas.publicSlotKey);
  assert.equal(committed?.state, "blocked");
});

function unavailable(error: unknown): boolean {
  return error instanceof OneVideoHeldAdmissionError
    && error.code === "UNAVAILABLE"
    && !error.message.includes("authority") && !error.message.includes("provider");
}
