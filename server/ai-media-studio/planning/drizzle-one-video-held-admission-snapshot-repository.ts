import { sql, type SQL } from "drizzle-orm";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionAuthoritySnapshot,
  type OneVideoHeldAdmissionContext,
  type OneVideoHeldAdmissionSnapshotRepository,
} from "./one-video-held-admission-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OneVideoHeldAdmissionSnapshotDatabase = { execute(query: SQL): Promise<ExecuteResult> };
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

/**
 * Read-only resolver for one exact, still-current authority snapshot. The
 * future admission POST re-locks and revalidates this evidence atomically;
 * this observation never creates or extends authority.
 */
export class DrizzleOneVideoHeldAdmissionSnapshotRepository
implements OneVideoHeldAdmissionSnapshotRepository {
  constructor(private readonly db: OneVideoHeldAdmissionSnapshotDatabase) {
    if (!db || typeof db.execute !== "function") throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }

  async loadCurrent(input: Readonly<{
    scope: OneVideoHeldAdmissionContext["scope"];
    context: OneVideoHeldAdmissionContext;
  }>): Promise<OneVideoHeldAdmissionAuthoritySnapshot | undefined> {
    assertInput(input);
    let found: Row[];
    try {
      found = rows(await this.db.execute(sql`
        WITH db_clock AS MATERIALIZED (
          SELECT transaction_timestamp() AS observed_at
        )
        SELECT snapshot.id AS authority_snapshot_id,
          snapshot.authority_digest, snapshot.admission_digest,
          snapshot.daily_plan_slot_id, snapshot.slot_attempt,
          db_clock.observed_at
        FROM ai_media_launch_authority_snapshots snapshot
        INNER JOIN ai_media_launch_intents intent
          ON intent.owner_user_id=snapshot.owner_user_id
          AND intent.workspace_id=snapshot.workspace_id
          AND intent.id=snapshot.launch_intent_id
          AND intent.daily_plan_id=snapshot.daily_plan_id
          AND intent.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND intent.slot_attempt=snapshot.slot_attempt
          AND intent.launch_intent_digest=snapshot.launch_intent_digest
          AND intent.launch_subject_digest=snapshot.launch_subject_digest
          AND intent.provider_account_id=snapshot.provider_account_id
          AND intent.provider_key=snapshot.provider_key
          AND intent.provider_credential_version=snapshot.provider_credential_version
          AND intent.script_variant_id=snapshot.script_variant_id
          AND intent.script_variant_checksum=snapshot.script_variant_checksum
          AND intent.governance_profile_id=snapshot.governance_profile_id
          AND intent.governance_evidence_digest=snapshot.governance_evidence_digest
        INNER JOIN ai_media_launch_evidence content
          ON content.owner_user_id=snapshot.owner_user_id
          AND content.workspace_id=snapshot.workspace_id
          AND content.id=snapshot.content_approval_evidence_id
          AND content.evidence_digest=snapshot.content_approval_evidence_digest
          AND content.launch_intent_id=snapshot.launch_intent_id
          AND content.launch_intent_digest=snapshot.launch_intent_digest
        INNER JOIN ai_media_launch_evidence human
          ON human.owner_user_id=snapshot.owner_user_id
          AND human.workspace_id=snapshot.workspace_id
          AND human.id=snapshot.human_launch_approval_evidence_id
          AND human.evidence_digest=snapshot.human_launch_approval_evidence_digest
          AND human.launch_intent_id=snapshot.launch_intent_id
          AND human.launch_intent_digest=snapshot.launch_intent_digest
        INNER JOIN ai_media_launch_evidence sandbox
          ON sandbox.owner_user_id=snapshot.owner_user_id
          AND sandbox.workspace_id=snapshot.workspace_id
          AND sandbox.id=snapshot.sandbox_evidence_id
          AND sandbox.evidence_digest=snapshot.sandbox_evidence_digest
          AND sandbox.launch_intent_id=snapshot.launch_intent_id
          AND sandbox.launch_intent_digest=snapshot.launch_intent_digest
        INNER JOIN ai_media_launch_evidence quote
          ON quote.owner_user_id=snapshot.owner_user_id
          AND quote.workspace_id=snapshot.workspace_id
          AND quote.id=snapshot.maximum_quote_evidence_id
          AND quote.evidence_digest=snapshot.maximum_quote_evidence_digest
          AND quote.launch_intent_id=snapshot.launch_intent_id
          AND quote.launch_intent_digest=snapshot.launch_intent_digest
        INNER JOIN ai_media_admission_policy_revisions policy
          ON policy.owner_user_id=snapshot.owner_user_id
          AND policy.workspace_id=snapshot.workspace_id
          AND policy.id=snapshot.policy_revision_id
          AND policy.revision=snapshot.policy_revision
          AND policy.policy_digest=snapshot.policy_digest
        INNER JOIN ai_media_kill_switch_revisions kill
          ON kill.owner_user_id=snapshot.owner_user_id
          AND kill.workspace_id=snapshot.workspace_id
          AND kill.id=snapshot.kill_switch_revision_id
          AND kill.revision=snapshot.kill_switch_revision
          AND kill.evidence_digest=snapshot.kill_switch_evidence_digest
        CROSS JOIN db_clock
        WHERE snapshot.owner_user_id=${input.scope.ownerUserId}
          AND snapshot.workspace_id=${input.scope.workspaceId}
          AND snapshot.daily_plan_id=${input.context.planId}
          AND snapshot.daily_plan_slot_id=${input.context.dailyPlanSlotId}
          AND snapshot.slot_attempt=${input.context.slotAttempt}
          AND snapshot.maximum_quote_micro_usd=${input.context.maximumQuoteMicroUsd}
          AND snapshot.currency='USD'
          AND snapshot.valid_from<=db_clock.observed_at
          AND snapshot.expires_at>db_clock.observed_at
          AND ${input.context.reservationExpiresAt}::timestamptz>db_clock.observed_at
          AND ${input.context.reservationExpiresAt}::timestamptz<=snapshot.expires_at
          AND content.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND content.slot_attempt=snapshot.slot_attempt
          AND content.launch_subject_digest=snapshot.launch_subject_digest
          AND content.evidence_kind='content_approval' AND content.decision='approved'
          AND content.valid_from<=db_clock.observed_at AND content.expires_at>db_clock.observed_at
          AND ${input.context.reservationExpiresAt}::timestamptz<=content.expires_at
          AND human.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND human.slot_attempt=snapshot.slot_attempt
          AND human.launch_subject_digest=snapshot.launch_subject_digest
          AND human.evidence_kind='human_launch_approval' AND human.decision='approved'
          AND human.valid_from<=db_clock.observed_at AND human.expires_at>db_clock.observed_at
          AND ${input.context.reservationExpiresAt}::timestamptz<=human.expires_at
          AND sandbox.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND sandbox.slot_attempt=snapshot.slot_attempt
          AND sandbox.launch_subject_digest=snapshot.launch_subject_digest
          AND sandbox.evidence_kind='sandbox_proof' AND sandbox.decision='passed'
          AND sandbox.valid_from<=db_clock.observed_at AND sandbox.expires_at>db_clock.observed_at
          AND ${input.context.reservationExpiresAt}::timestamptz<=sandbox.expires_at
          AND quote.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND quote.slot_attempt=snapshot.slot_attempt
          AND quote.launch_subject_digest=snapshot.launch_subject_digest
          AND quote.evidence_kind='maximum_quote' AND quote.decision='quoted'
          AND quote.amount_micro_usd=snapshot.maximum_quote_micro_usd
          AND quote.currency=snapshot.currency
          AND quote.expires_at=${input.context.quoteExpiresAt}::timestamptz
          AND quote.valid_from<=db_clock.observed_at AND quote.expires_at>db_clock.observed_at
          AND ${input.context.reservationExpiresAt}::timestamptz<=quote.expires_at
          AND policy.state='active' AND policy.valid_from<=db_clock.observed_at
          AND (policy.expires_at IS NULL OR policy.expires_at>db_clock.observed_at)
          AND kill.active=false AND kill.valid_from<=db_clock.observed_at
          AND (kill.expires_at IS NULL OR kill.expires_at>db_clock.observed_at)
          AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
            WHERE newer.owner_user_id=content.owner_user_id AND newer.workspace_id=content.workspace_id
              AND newer.daily_plan_slot_id=content.daily_plan_slot_id
              AND newer.slot_attempt=content.slot_attempt AND newer.evidence_kind=content.evidence_kind
              AND newer.revision>content.revision)
          AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
            WHERE newer.owner_user_id=human.owner_user_id AND newer.workspace_id=human.workspace_id
              AND newer.daily_plan_slot_id=human.daily_plan_slot_id
              AND newer.slot_attempt=human.slot_attempt AND newer.evidence_kind=human.evidence_kind
              AND newer.revision>human.revision)
          AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
            WHERE newer.owner_user_id=sandbox.owner_user_id AND newer.workspace_id=sandbox.workspace_id
              AND newer.daily_plan_slot_id=sandbox.daily_plan_slot_id
              AND newer.slot_attempt=sandbox.slot_attempt AND newer.evidence_kind=sandbox.evidence_kind
              AND newer.revision>sandbox.revision)
          AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
            WHERE newer.owner_user_id=quote.owner_user_id AND newer.workspace_id=quote.workspace_id
              AND newer.daily_plan_slot_id=quote.daily_plan_slot_id
              AND newer.slot_attempt=quote.slot_attempt AND newer.evidence_kind=quote.evidence_kind
              AND newer.revision>quote.revision)
          AND NOT EXISTS (SELECT 1 FROM ai_media_admission_policy_revisions newer
            WHERE newer.owner_user_id=policy.owner_user_id AND newer.workspace_id=policy.workspace_id
              AND newer.revision>policy.revision)
          AND NOT EXISTS (SELECT 1 FROM ai_media_kill_switch_revisions newer
            WHERE newer.owner_user_id=kill.owner_user_id AND newer.workspace_id=kill.workspace_id
              AND newer.revision>kill.revision)
        LIMIT 2
      `));
    } catch (error) {
      if (error instanceof OneVideoHeldAdmissionError) throw error;
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    if (found.length === 0) return undefined;
    if (found.length !== 1) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    const row = found[0]!;
    const snapshot = {
      authoritySnapshotId: text(row, "authoritySnapshotId", "authority_snapshot_id"),
      authorityDigest: text(row, "authorityDigest", "authority_digest"),
      admissionDigest: text(row, "admissionDigest", "admission_digest"),
      dailyPlanSlotId: text(row, "dailyPlanSlotId", "daily_plan_slot_id"),
      slotAttempt: Number(value(row, "slotAttempt", "slot_attempt")),
    };
    const observedAt = instant(value(row, "observedAt", "observed_at"));
    if (!observedAt
      || !UUID.test(snapshot.authoritySnapshotId)
      || !SHA256.test(snapshot.authorityDigest)
      || !SHA256.test(snapshot.admissionDigest)
      || snapshot.dailyPlanSlotId !== input.context.dailyPlanSlotId
      || snapshot.slotAttempt !== input.context.slotAttempt) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    return Object.freeze(snapshot) as OneVideoHeldAdmissionAuthoritySnapshot;
  }
}

function assertInput(input: Readonly<{
  scope: OneVideoHeldAdmissionContext["scope"];
  context: OneVideoHeldAdmissionContext;
}>): void {
  const context = input?.context;
  const scope = input?.scope;
  if (!context || !scope
    || scope.ownerUserId !== context.scope.ownerUserId
    || scope.workspaceId !== context.scope.workspaceId
    || !UUID.test(context.planId)
    || !UUID.test(context.dailyPlanSlotId)
    || !Number.isSafeInteger(context.slotAttempt) || context.slotAttempt < 1
    || !/^[1-9]\d{0,15}$/u.test(context.maximumQuoteMicroUsd)
    || BigInt(context.maximumQuoteMicroUsd) > 9_000_000_000_000_000n
    || context.currency !== "USD"
    || !instant(context.quoteExpiresAt)
    || !instant(context.reservationExpiresAt)
    || Date.parse(context.reservationExpiresAt) > Date.parse(context.quoteExpiresAt)) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
}

function rows(result: ExecuteResult): Row[] {
  const candidate = Array.isArray(result) ? result : result?.rows;
  if (!Array.isArray(candidate)) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  return candidate as Row[];
}

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function text(row: Row, camel: string, snake: string): string {
  const result = value(row, camel, snake);
  return typeof result === "string" ? result : "";
}

function instant(raw: unknown): string {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}
