import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr30_quote_bound_human_approvals_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr30_quote_bound_human_approvals_rollback.sql",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("../shared/models/ai-media-studio-db.ts", import.meta.url), "utf8");

test("PR30 is pending, additive, and requires the exact PR22/PR28/PR29 stack", () => {
  assert.match(forward, /current_setting\('server_version_num'\)::integer<160000/iu);
  assert.match(forward, /to_regclass\('public\.ai_media_static_credential_bindings'\) IS NULL/iu);
  assert.match(forward, /to_regclass\('public\.ai_media_static_heygen_verification_headers'\) IS NULL/iu);
  assert.match(forward, /to_regclass\('public\.ai_media_launch_evidence_exact_identity_uq'\) IS NULL/iu);
  assert.match(forward, /to_regprocedure\('public\.ai_media_reject_launch_authority_rewrite\(\)'\) IS NULL/iu);
  assert.doesNotMatch(forward, /(?:^|;)\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b/imu);
  assert.match(forward, /Legacy human_launch_approval evidence intentionally remains unbound\. There is no backfill\./u);
});

test("PR30 stores one exact quote-bound human decision", () => {
  assert.match(forward, /CREATE TABLE ai_media_quote_bound_human_approvals/iu);
  for (const column of [
    "daily_plan_slot_id", "slot_attempt", "launch_subject_digest", "launch_intent_id",
    "launch_intent_digest", "human_launch_approval_evidence_id",
    "human_launch_approval_evidence_revision", "human_launch_approval_evidence_digest",
    "maximum_quote_evidence_id", "maximum_quote_evidence_revision",
    "maximum_quote_evidence_digest", "decision", "currency",
    "quote_expires_at", "render_spec_digest", "approval_binding_digest", "input_digest",
    "idempotency_key", "bound_at", "created_at",
  ]) assert.match(forward, new RegExp(`${column} [^,]+NOT NULL`, "iu"));
  assert.match(forward, /amount_micro_usd numeric\(20,0\) NOT NULL/iu);
  assert.match(forward, /decision IN \('approved','rejected','revoked'\)/u);
  assert.match(forward, /maximum_quote_decision='quoted'/u);
  assert.match(forward, /quote_expires_at>bound_at/u);
  assert.match(forward, /created_at=bound_at/u);
});

test("PR30 binds both evidence rows by exact tenant, slot, subject, intent, revision and digest", () => {
  assert.match(forward, /ai_media_launch_evidence_human_quote_binding_identity_uq/iu);
  assert.match(forward, /ai_media_launch_evidence_maximum_quote_binding_identity_uq/iu);
  assert.match(forward, /ai_media_quote_bound_human_approvals_human_evidence_fk FOREIGN KEY[\s\S]*REFERENCES ai_media_launch_evidence/iu);
  assert.match(forward, /ai_media_quote_bound_human_approvals_quote_evidence_fk FOREIGN KEY[\s\S]*REFERENCES ai_media_launch_evidence/iu);
  assert.match(forward, /human_evidence_kind='human_launch_approval'/u);
  assert.match(forward, /maximum_quote_evidence_kind='maximum_quote'/u);
  assert.match(forward, /amount_micro_usd,currency,maximum_quote_evidence_revision,[\s\S]*quote_expires_at,maximum_quote_evidence_digest\)/u);
  assert.match(forward, /ai_media_quote_bound_human_approvals_human_evidence_uq/iu);
  assert.match(forward, /ai_media_quote_bound_human_approvals_binding_digest_uq/iu);
});

test("PR30 evidence is immutable and rollback refuses to erase a populated bridge", () => {
  assert.match(forward, /BEFORE UPDATE OR DELETE ON ai_media_quote_bound_human_approvals/iu);
  assert.match(forward, /BEFORE TRUNCATE ON ai_media_quote_bound_human_approvals/iu);
  assert.match(rollback, /IF EXISTS \(SELECT 1 FROM ai_media_quote_bound_human_approvals\)/iu);
  assert.match(rollback, /rollback preserves quote-bound human approval evidence; stop and forward-fix/iu);
  assert.ok(rollback.indexOf("DROP TABLE ai_media_quote_bound_human_approvals")
    > rollback.indexOf("rollback preserves quote-bound human approval evidence"));
  assert.doesNotMatch(rollback, /\b(?:DELETE\s+FROM|TRUNCATE)\b/iu);
});

test("Drizzle maps the PR30 bridge and its exact evidence foreign keys", () => {
  assert.match(model, /export const aiMediaQuoteBoundHumanApprovals = pgTable\(/u);
  assert.match(model, /"ai_media_quote_bound_human_approvals"/u);
  assert.match(model, /name: "ai_media_quote_bound_human_approvals_human_evidence_fk"/u);
  assert.match(model, /name: "ai_media_quote_bound_human_approvals_quote_evidence_fk"/u);
  assert.match(model, /quoteBoundHumanApprovals: aiMediaQuoteBoundHumanApprovals/u);
});
