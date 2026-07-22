import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { Pool } from "pg";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};

const DATABASE = "ams_pr30_quote_bound_test";
const TEMP_PREFIX = "ams-pr30-quote-bound-pg-";
const PORT = "55443";
const OWNER = "owner-pr30";
const WORKSPACE = "workspace-pr30";
const SCRIPT_CONTENT = "Approved script for exact quote-bound human approval PostgreSQL proof.";
const SCRIPT_CHECKSUM = createHash("sha256").update(SCRIPT_CONTENT).digest("hex");
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8",
)) as Manifest;
const pr28Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_forward.sql", import.meta.url,
), "utf8");
const pr29Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_forward.sql", import.meta.url,
), "utf8");
const pr30Forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr30_quote_bound_human_approvals_forward.sql", import.meta.url,
), "utf8");
const pr30Rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr30_quote_bound_human_approvals_rollback.sql", import.meta.url,
), "utf8");

const ids = {
  account: "30000000-0000-4000-8000-000000000001",
  influencer: "30000000-0000-4000-8000-000000000002",
  avatar: "30000000-0000-4000-8000-000000000003",
  voice: "30000000-0000-4000-8000-000000000004",
  source: "30000000-0000-4000-8000-000000000005",
  script: "30000000-0000-4000-8000-000000000006",
  variant: "30000000-0000-4000-8000-000000000007",
  governance: "30000000-0000-4000-8000-000000000008",
  plan: "30000000-0000-4000-8000-000000000009",
  slot: "30000000-0000-4000-8000-00000000000a",
  launchIntent: "30000000-0000-4000-8000-00000000000b",
  humanEvidence: "30000000-0000-4000-8000-00000000000c",
  quoteEvidence: "30000000-0000-4000-8000-00000000000d",
  bridge: "30000000-0000-4000-8000-00000000000e",
} as const;

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const launchSubjectDigest = digest("1");
const launchIntentDigest = digest("2");
const humanEvidenceDigest = digest("3");
const quoteEvidenceDigest = digest("4");
const renderSpecDigest = digest("5");
const quoteAmount = "1250000";

function ownedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) {
    throw new Error("PR30 PostgreSQL test requires only its owned TEST_DATABASE_URL");
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
  const root = realpathSync(dirname(resolvedSocket));
  assert.equal(dirname(root), realpathSync(process.platform === "darwin" ? "/private/tmp" : "/tmp"));
  assert.ok(basename(root).startsWith(TEMP_PREFIX));
  assert.equal(basename(resolvedSocket), "socket");
  return value;
}

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const integrationTest = enabled ? test : test.skip;
const pool = new Pool({
  connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/disabled",
  max: 8,
  allowExitOnIdle: true,
});
after(async () => pool.end());

const rawHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

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
        await pool.query(`CREATE ROLE ${role.name} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    await pool.query(reviewedForward(entry.forward));
  }
  await pool.query(pr28Forward);
  await pool.query(pr29Forward);
  await pool.query(pr30Forward);
}

async function seedExactAuthorityEvidence(): Promise<Date> {
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,
      credential_version,credential_source)
    VALUES ($1,$2,$3,'heygen','PR30 provider','disconnected','unverified',0,'not_bound')`,
  [ids.account, OWNER, WORKSPACE]);
  await pool.query(`INSERT INTO ai_media_provider_resources
    (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,canonical_key,
      external_resource_id,display_name,status)
    VALUES
      ($1,$3,$4,$5,'heygen','avatar','avatar-pr30','avatar-external-pr30','Avatar','pending_verification'),
      ($2,$3,$4,$5,'heygen','voice','voice-pr30','voice-external-pr30','Voice','pending_verification')`,
  [ids.avatar, ids.voice, OWNER, WORKSPACE, ids.account]);
  await pool.query(`INSERT INTO ai_media_influencers
    (id,owner_user_id,workspace_id,name,slug,status,language,default_avatar_resource_id,default_voice_resource_id)
    VALUES ($1,$2,$3,'PR30 creator','pr30-creator','draft','en-US',$4,$5)`,
  [ids.influencer, OWNER, WORKSPACE, ids.avatar, ids.voice]);
  await pool.query(`INSERT INTO ai_media_source_items
    (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,
      rights_status,moderation_status,payload)
    VALUES ($1,$2,$3,'events','source-pr30','PR30 source','Owned source',$4,'ready','owned','approved','{}'::jsonb)`,
  [ids.source, OWNER, WORKSPACE, digest("6")]);
  await pool.query(`INSERT INTO ai_media_scripts
    (id,owner_user_id,workspace_id,influencer_id,title,source_type,source_item_id,language,status,current_variant_id)
    VALUES ($1,$2,$3,$4,'PR30 script','events',$5,'en-US','approved',$6)`,
  [ids.script, OWNER, WORKSPACE, ids.influencer, ids.source, ids.variant]);
  await pool.query(`INSERT INTO ai_media_script_variants
    (id,owner_user_id,workspace_id,script_id,version,label,content,status,checksum)
    VALUES ($1,$2,$3,$4,1,'approved',$5,'approved',$6)`,
  [ids.variant, OWNER, WORKSPACE, ids.script, SCRIPT_CONTENT, SCRIPT_CHECKSUM]);
  await pool.query(`INSERT INTO ai_media_governance_profiles
    (id,owner_user_id,workspace_id,influencer_id,avatar_resource_id,voice_resource_id,state,
      consent_basis,rights_basis,allowed_uses,territories,proof_digest,evidence_digest,brand_policy,
      version,policy_version,actor_user_id,valid_from,expires_at,idempotency_key,input_digest)
    VALUES ($1,$2,$3,$4,$5,$6,'active','obtained','owned','["commercial"]'::jsonb,'["US"]'::jsonb,
      $7,$8,'{}'::jsonb,1,'pr30-v1',$2,transaction_timestamp()-interval '1 minute',
      transaction_timestamp()+interval '2 hours','governance-pr30',$9)`,
  [ids.governance, OWNER, WORKSPACE, ids.influencer, ids.avatar, ids.voice, digest("7"), digest("8"), digest("9")]);
  await pool.query(`INSERT INTO ai_media_daily_plans
    (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
      source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
      idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'heygen',1,'roster-pr30',$6,
      (transaction_timestamp() AT TIME ZONE 'UTC')::date,'UTC','planned',1,'plan-pr30',$7,$8)`,
  [ids.plan, OWNER, WORKSPACE, `plan_${"a".repeat(24)}`, ids.account, digest("a"), digest("b"), digest("c")]);
  await pool.query(`INSERT INTO ai_media_daily_plan_slots
    (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
      provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
      script_variant_id,video_number,status,slot_digest)
    VALUES ($1,$2,$3,$4,$5,$6,'heygen',1,'member-pr30',$7,$8,$9,$10,1,'planned',$11)`,
  [ids.slot, OWNER, WORKSPACE, `slot_${"b".repeat(24)}`, ids.plan, ids.account, ids.influencer,
    ids.avatar, ids.voice, ids.variant, digest("d")]);
  await pool.query(`INSERT INTO ai_media_launch_intents
    (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,provider_account_id,
      provider_key,provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,
      source_member_key,script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,
      source_content_hash,governance_profile_id,governance_evidence_digest,governance_use,
      governance_territory,content_country,launch_subject_digest,launch_intent_digest,actor_user_id,
      input_digest,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,1,$6,'heygen',1,$7,$8,'roster-pr30',$9,'member-pr30',$10,$11,$12,
      'events',$13,$14,$15,$16,'commercial','US','US',$17,$18,$2,$19,'launch-intent-pr30')`,
  [ids.launchIntent, OWNER, WORKSPACE, ids.plan, ids.slot, ids.account, digest("c"), digest("d"), digest("a"),
    ids.script, ids.variant, SCRIPT_CHECKSUM, ids.source, digest("6"), ids.governance, digest("8"),
    launchSubjectDigest, launchIntentDigest, digest("e")]);

  await pool.query(`INSERT INTO ai_media_launch_evidence
    (id,owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,script_variant_id,script_variant_checksum,governance_profile_id,
      governance_evidence_digest,governance_use,governance_territory,content_country,launch_subject_digest,
      launch_intent_id,launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,revision,
      valid_from,expires_at,actor_user_id,source_kind,source_attestation_id,source_evidence_digest,
      evidence_digest,input_digest,idempotency_key)
    VALUES
      ($1,$3,$4,$5,1,$6,'heygen',1,$7,$8,$9,$10,'commercial','US','US',$11,$12,$13,
        'human_launch_approval','approved',NULL,NULL,1,transaction_timestamp()-interval '1 minute',
        date_trunc('milliseconds',transaction_timestamp()+interval '1 hour'),$3,'human_decision',NULL,NULL,$14,$15,'human-pr30'),
      ($2,$3,$4,$5,1,$6,'heygen',1,$7,$8,$9,$10,'commercial','US','US',$11,$12,$13,
        'maximum_quote','quoted',$16,'USD',1,transaction_timestamp()-interval '1 minute',
        date_trunc('milliseconds',transaction_timestamp()+interval '1 hour'),$3,'provider_quote','quote-attestation-pr30',$17,$18,$19,'quote-pr30')`,
  [ids.humanEvidence, ids.quoteEvidence, OWNER, WORKSPACE, ids.slot, ids.account, ids.variant, SCRIPT_CHECKSUM,
    ids.governance, digest("8"), launchSubjectDigest, ids.launchIntent, launchIntentDigest,
    humanEvidenceDigest, digest("f"), quoteAmount, digest("0"), quoteEvidenceDigest, digest("1")]);
  const result = await pool.query<{ expires_at: Date }>(
    "SELECT expires_at FROM ai_media_launch_evidence WHERE id=$1", [ids.quoteEvidence],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0]!.expires_at;
}

type Bridge = {
  id: string;
  owner: string;
  workspace: string;
  slot: string;
  attempt: number;
  subjectDigest: string;
  intentId: string;
  intentDigest: string;
  humanId: string;
  humanRevision: number;
  humanDigest: string;
  humanDecision: string;
  quoteId: string;
  quoteRevision: number;
  quoteDigest: string;
  quoteDecision: string;
  amount: string;
  currency: string;
  quoteExpiresAt: Date;
  renderSpecDigest: string;
  approvalBindingDigest: string;
  inputDigest: string;
  idempotencyKey: string;
};

function bridge(quoteExpiresAt: Date, label: string, overrides: Partial<Bridge> = {}): Bridge {
  return {
    id: overrides.id ?? `40000000-0000-4000-8000-${rawHash(label).slice(0, 12)}`,
    owner: overrides.owner ?? OWNER,
    workspace: overrides.workspace ?? WORKSPACE,
    slot: overrides.slot ?? ids.slot,
    attempt: overrides.attempt ?? 1,
    subjectDigest: overrides.subjectDigest ?? launchSubjectDigest,
    intentId: overrides.intentId ?? ids.launchIntent,
    intentDigest: overrides.intentDigest ?? launchIntentDigest,
    humanId: overrides.humanId ?? ids.humanEvidence,
    humanRevision: overrides.humanRevision ?? 1,
    humanDigest: overrides.humanDigest ?? humanEvidenceDigest,
    humanDecision: overrides.humanDecision ?? "approved",
    quoteId: overrides.quoteId ?? ids.quoteEvidence,
    quoteRevision: overrides.quoteRevision ?? 1,
    quoteDigest: overrides.quoteDigest ?? quoteEvidenceDigest,
    quoteDecision: overrides.quoteDecision ?? "quoted",
    amount: overrides.amount ?? quoteAmount,
    currency: overrides.currency ?? "USD",
    quoteExpiresAt: overrides.quoteExpiresAt ?? quoteExpiresAt,
    renderSpecDigest: overrides.renderSpecDigest ?? renderSpecDigest,
    approvalBindingDigest: overrides.approvalBindingDigest ?? `sha256:${rawHash(`binding:${label}`)}`,
    inputDigest: overrides.inputDigest ?? `sha256:${rawHash(`input:${label}`)}`,
    idempotencyKey: overrides.idempotencyKey ?? `bridge-${label}`,
  };
}

async function insertBridge(input: Bridge): Promise<void> {
  await pool.query(`INSERT INTO ai_media_quote_bound_human_approvals
    (id,owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,launch_subject_digest,
      launch_intent_id,launch_intent_digest,human_launch_approval_evidence_id,
      human_launch_approval_evidence_revision,human_launch_approval_evidence_digest,human_evidence_kind,
      maximum_quote_evidence_id,maximum_quote_evidence_revision,maximum_quote_evidence_digest,
      maximum_quote_evidence_kind,maximum_quote_decision,decision,amount_micro_usd,currency,
      quote_expires_at,render_spec_digest,approval_binding_digest,input_digest,idempotency_key,bound_at,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'human_launch_approval',$12,$13,$14,
      'maximum_quote',$15,$16,$17,$18,$19,$20,$21,$22,$23,transaction_timestamp(),transaction_timestamp())`,
  [input.id, input.owner, input.workspace, input.slot, input.attempt, input.subjectDigest, input.intentId,
    input.intentDigest, input.humanId, input.humanRevision, input.humanDigest, input.quoteId,
    input.quoteRevision, input.quoteDigest, input.quoteDecision, input.humanDecision, input.amount,
    input.currency, input.quoteExpiresAt, input.renderSpecDigest, input.approvalBindingDigest,
    input.inputDigest, input.idempotencyKey]);
}

async function assertBridgeRejected(input: Bridge): Promise<void> {
  await assert.rejects(insertBridge(input), (error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    return code === "23503" || code === "23514";
  });
}

async function inertCounts(): Promise<Record<string, number>> {
  const result = await pool.query(`SELECT
    (SELECT count(*)::integer FROM ai_media_budget_reservations) AS reservations,
    (SELECT count(*)::integer FROM ai_media_render_jobs) AS render_jobs,
    (SELECT count(*)::integer FROM ai_media_outbox) AS outbox,
    (SELECT count(*)::integer FROM ai_media_publishing_jobs) AS publishing_jobs`);
  return result.rows[0];
}

integrationTest("PG16 PR30 binds only one exact quote/human decision and remains inert and immutable", async () => {
  await applyExactChain();
  const quoteExpiresAt = await seedExactAuthorityEvidence();
  assert.deepEqual(await inertCounts(), { reservations: 0, render_jobs: 0, outbox: 0, publishing_jobs: 0 });

  const corruptions: Array<[string, Partial<Bridge>]> = [
    ["tenant", { owner: "owner-other" }],
    ["slot", { slot: "50000000-0000-4000-8000-000000000001" }],
    ["attempt", { attempt: 2 }],
    ["subject", { subjectDigest: digest("a") }],
    ["intent-id", { intentId: "50000000-0000-4000-8000-000000000002" }],
    ["intent-digest", { intentDigest: digest("b") }],
    ["human-decision", { humanDecision: "rejected" }],
    ["quote-decision", { quoteDecision: "declined" }],
    ["amount", { amount: "1250001" }],
    ["currency", { currency: "EUR" }],
    ["expiry", { quoteExpiresAt: new Date(quoteExpiresAt.getTime() + 1_000) }],
    ["human-revision", { humanRevision: 2 }],
    ["human-digest", { humanDigest: digest("c") }],
    ["quote-revision", { quoteRevision: 2 }],
    ["quote-digest", { quoteDigest: digest("d") }],
  ];
  for (const [label, overrides] of corruptions) {
    await assertBridgeRejected(bridge(quoteExpiresAt, `wrong-${label}`, overrides));
  }
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM ai_media_quote_bound_human_approvals")).rows[0].count, 0);

  await insertBridge(bridge(quoteExpiresAt, "valid", { id: ids.bridge }));
  const stored = await pool.query(`SELECT decision,amount_micro_usd::text AS amount,currency,quote_expires_at,
      human_launch_approval_evidence_revision,maximum_quote_evidence_revision
    FROM ai_media_quote_bound_human_approvals WHERE id=$1`, [ids.bridge]);
  assert.deepEqual(stored.rows, [{
    decision: "approved",
    amount: quoteAmount,
    currency: "USD",
    quote_expires_at: quoteExpiresAt,
    human_launch_approval_evidence_revision: 1,
    maximum_quote_evidence_revision: 1,
  }]);

  await assert.rejects(pool.query(
    "UPDATE ai_media_quote_bound_human_approvals SET currency='EUR' WHERE id=$1", [ids.bridge],
  ), /quote-bound human approval evidence is append-only/u);
  await assert.rejects(pool.query(
    "DELETE FROM ai_media_quote_bound_human_approvals WHERE id=$1", [ids.bridge],
  ), /quote-bound human approval evidence is append-only/u);
  await assert.rejects(pool.query(
    "TRUNCATE ai_media_quote_bound_human_approvals",
  ), /quote-bound human approval evidence is append-only/u);

  const rollbackClient = await pool.connect();
  try {
    await assert.rejects(rollbackClient.query(pr30Rollback),
      /rollback preserves quote-bound human approval evidence; stop and forward-fix/u);
    await rollbackClient.query("ROLLBACK");
  } finally {
    rollbackClient.release();
  }
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM ai_media_quote_bound_human_approvals")).rows[0].count, 1);
  assert.deepEqual(await inertCounts(), { reservations: 0, render_jobs: 0, outbox: 0, publishing_jobs: 0 });
});
