import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader } from "../server/ai-media-studio/provider-credentials/verified-static-heygen-runtime-credential";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};

const DATABASE = "ams_heygen_verification_test";
const TEMP_PREFIX = "ams-heygen-verification-pg-";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8")) as Manifest;
const pr28Forward = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_forward.sql", import.meta.url), "utf8");
const pr29Forward = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_forward.sql", import.meta.url), "utf8");
const pr29Rollback = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_rollback.sql", import.meta.url), "utf8");

const ids = {
  account: "10000000-0000-4000-8000-000000000001",
  binding1: "20000000-0000-4000-8000-000000000001",
  binding2: "20000000-0000-4000-8000-000000000002",
  plan: "30000000-0000-4000-8000-000000000001",
  slot: "30000000-0000-4000-8000-000000000002",
  influencer: "40000000-0000-4000-8000-000000000001",
  avatar: "50000000-0000-4000-8000-000000000001",
  voice: "50000000-0000-4000-8000-000000000002",
  otherAccount: "10000000-0000-4000-8000-000000000002",
  otherResource: "50000000-0000-4000-8000-000000000003",
  header: "60000000-0000-4000-8000-000000000001",
  voiceEvidence: "70000000-0000-4000-8000-000000000201",
  badEvidence: "70000000-0000-4000-8000-000000000003",
  spliceEvidence: "70000000-0000-4000-8000-000000000004",
};
const avatarIds = [
  ids.avatar,
  "50000000-0000-4000-8000-000000000011",
  "50000000-0000-4000-8000-000000000012",
  "50000000-0000-4000-8000-000000000013",
  "50000000-0000-4000-8000-000000000014",
] as const;
const influencerIds = [
  ids.influencer,
  "40000000-0000-4000-8000-000000000011",
  "40000000-0000-4000-8000-000000000012",
  "40000000-0000-4000-8000-000000000013",
  "40000000-0000-4000-8000-000000000014",
] as const;
const avatarEvidenceId = (index: number) => `70000000-0000-4000-8000-${String(101 + index).padStart(12, "0")}`;
const avatarLook = (index: number) => `look-${String(index + 1).padStart(3, "0")}`;
const owner = "owner-a";
const workspace = "personal";
const planKey = `plan_${"1".repeat(24)}`;
const slotKey = `slot_${"2".repeat(24)}`;
const digest = (seed: string) => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

function ownedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("PR29 PostgreSQL test requires only owned TEST_DATABASE_URL");
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres");
  assert.equal(parsed.password, "");
  assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), "55438");
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
const pool = new Pool({ connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/disabled", max: 1, allowExitOnIdle: true });
after(async () => pool.end());

function reviewedForward(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  return bytes.toString("utf8");
}

async function applyManifestAndPending(): Promise<void> {
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
}

async function seedStaticPlan(): Promise<void> {
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'heygen','HeyGen','disconnected','unverified',0,'not_bound')`, [ids.account, owner, workspace]);
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,'other-owner',$2,'heygen','Other','disconnected','unverified',0,'not_bound')`, [ids.otherAccount, workspace]);

  await pool.query("BEGIN");
  await pool.query(`INSERT INTO ai_media_static_credential_bindings
    (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
      expected_credential_version,target_credential_version,secret_ref,idempotency_key,request_digest)
    VALUES ($1,$2,$3,$2,$4,'heygen',0,1,'env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY','bind-v01',$5)`,
    [ids.binding1, owner, workspace, ids.account, digest("binding-v1")]);
  await pool.query(`UPDATE ai_media_provider_accounts SET credential_source='static_api_key',
    secret_ref='env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY',credential_version=1,
    credential_actor_user_id=$2 WHERE id=$1`, [ids.account, owner]);
  await pool.query("COMMIT");

  for (const [index, avatarId] of avatarIds.entries()) {
    await pool.query(`INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,canonical_key,
        external_resource_id,display_name,status)
      VALUES ($1,$2,$3,$4,'heygen','avatar',$5,$6,$7,'active')`,
      [avatarId, owner, workspace, ids.account, `avatar-canon-${index + 1}`, avatarLook(index), `Avatar ${index + 1}`]);
  }
  await pool.query(`INSERT INTO ai_media_provider_resources
    (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,canonical_key,
      external_resource_id,display_name,status)
    VALUES
      ($1,$3,$4,$5,'heygen','voice','voice-canon','voice-001','Voice','active'),
      ($2,'other-owner',$4,$6,'heygen','avatar','other-avatar','look-other','Other','active')`,
    [ids.voice, ids.otherResource, owner, workspace, ids.account, ids.otherAccount]);
  for (const [index, influencerId] of influencerIds.entries()) {
    await pool.query(`INSERT INTO ai_media_influencers
      (id,owner_user_id,workspace_id,name,slug,status,default_avatar_resource_id,default_voice_resource_id)
      VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)`,
      [influencerId, owner, workspace, `Creator ${index + 1}`, `creator-${index + 1}`, avatarIds[index], ids.voice]);
  }
  await pool.query(`INSERT INTO ai_media_daily_plans
    (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
      source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
      idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'heygen',1,'roster-1',$6,(transaction_timestamp() AT TIME ZONE 'UTC')::date,
      'UTC','planned',50,'plan-idem',$7,$8)`,
    [ids.plan, owner, workspace, planKey, ids.account, digest("roster"), digest("plan-input"), digest("plan")]);
  for (const [avatarIndex, avatarId] of avatarIds.entries()) {
    for (let videoNumber = 1; videoNumber <= 10; videoNumber += 1) {
      const slotId = `30000000-0000-4000-8000-${String(100000000000 + avatarIndex * 10 + videoNumber).padStart(12, "0")}`;
      const publicSlotKey = `slot_${String(avatarIndex + 1).padStart(2, "0")}_${String(videoNumber).padStart(2, "0")}_${"2".repeat(16)}`;
      await pool.query(`INSERT INTO ai_media_daily_plan_slots
        (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
          provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
          video_number,status,slot_digest)
        VALUES ($1,$2,$3,$4,$5,$6,'heygen',1,$7,$8,$9,$10,$11,'planned',$12)`,
        [slotId, owner, workspace, publicSlotKey, ids.plan, ids.account, `member-${avatarIndex + 1}`,
          influencerIds[avatarIndex], avatarId, ids.voice, videoNumber, digest(`slot-${avatarIndex + 1}-${videoNumber}`)]);
    }
  }
}

async function insertHeader(): Promise<void> {
  await pool.query(`INSERT INTO ai_media_static_heygen_verification_headers
    (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,static_credential_binding_id,
      provider_credential_version,credential_binding_request_digest,daily_plan_id,source_roster_key,source_roster_digest,
      plan_digest,verification_state,account_evidence_digest,billing_model,verification_request_digest,evidence_digest,input_digest,
      idempotency_key,observed_at,expires_at)
    VALUES ($1,$2,$3,$2,$4,'heygen',$5,1,$6,$7,'roster-1',$8,$9,'verified',$10,'subscription',
      $11,$12,$13,'verify-header',transaction_timestamp(),transaction_timestamp()+interval '1 hour')`,
    [ids.header, owner, workspace, ids.account, ids.binding1, digest("binding-v1"), ids.plan, digest("roster"),
      digest("plan"), digest("account-evidence"), digest("verification-request"), digest("header-evidence"), digest("header-input")]);
}

async function insertResourceEvidence(id: string, resourceId: string, type: "avatar" | "voice", input: {
  externalDigest?: string; groupDigest?: string; idempotencyKey?: string;
} = {}): Promise<void> {
  const externalDigest = input.externalDigest ?? digest(type === "avatar" ? "look-001" : "voice-001");
  if (type === "avatar") {
    const lookIndex = Math.max(0, avatarIds.indexOf(resourceId as typeof avatarIds[number]));
    await pool.query(`INSERT INTO ai_media_static_heygen_resource_verifications
      (id,owner_user_id,workspace_id,verification_header_id,provider_account_id,provider_key,provider_credential_version,
        provider_resource_id,resource_type,provider_resource_external_id_digest,avatar_look_id_digest,
        avatar_look_status,avatar_group_id_digest,avatar_group_status,avatar_group_consent_status,
        avatar_engines_digest,resource_response_digest,
        evidence_digest,input_digest,idempotency_key,observed_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,'heygen',1,$6,'avatar',$7,$7,'completed',$8,'completed','approved',$9,$10,$11,$12,$13,
        transaction_timestamp(),transaction_timestamp()+interval '1 hour')`,
      [id, owner, workspace, ids.header, ids.account, resourceId, externalDigest === digest("look-001") ? digest(avatarLook(lookIndex)) : externalDigest,
        input.groupDigest ?? digest("group-001"), digest("avatar-engines"), digest(`resource-response-${id}`), digest(`evidence-${id}`),
        digest(`input-${id}`), input.idempotencyKey ?? `resource-${id}`]);
  } else {
    await pool.query(`INSERT INTO ai_media_static_heygen_resource_verifications
      (id,owner_user_id,workspace_id,verification_header_id,provider_account_id,provider_key,provider_credential_version,
        provider_resource_id,resource_type,provider_resource_external_id_digest,voice_id_digest,
        language,voice_support_digest,resource_response_digest,evidence_digest,input_digest,idempotency_key,observed_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,'heygen',1,$6,'voice',$7,$7,'en',$8,$9,$10,$11,$12,
        transaction_timestamp(),transaction_timestamp()+interval '1 hour')`,
      [id, owner, workspace, ids.header, ids.account, resourceId, externalDigest,
        digest("voice-support"), digest(`resource-response-${id}`), digest(`evidence-${id}`), digest(`input-${id}`),
        input.idempotencyKey ?? `resource-${id}`]);
  }
}

async function activateWithPointers(): Promise<void> {
  for (const [index, avatarId] of avatarIds.entries()) {
    const evidenceId = avatarEvidenceId(index);
    await pool.query(`UPDATE ai_media_provider_resources SET
        verification_header_id=$1,verification_resource_evidence_id=$2,verification_evidence_digest=$3,
        verified_credential_version=1,verified_at=(SELECT observed_at FROM ai_media_static_heygen_resource_verifications WHERE id=$2),
        verification_expires_at=(SELECT expires_at FROM ai_media_static_heygen_resource_verifications WHERE id=$2)
      WHERE id=$4`, [ids.header, evidenceId, digest(`evidence-${evidenceId}`), avatarId]);
  }
  await pool.query(`UPDATE ai_media_provider_resources SET
      verification_header_id=$1,verification_resource_evidence_id=$2,verification_evidence_digest=$3,
      verified_credential_version=1,verified_at=(SELECT observed_at FROM ai_media_static_heygen_resource_verifications WHERE id=$2),
      verification_expires_at=(SELECT expires_at FROM ai_media_static_heygen_resource_verifications WHERE id=$2)
    WHERE id=$4`, [ids.header, ids.voiceEvidence, digest(`evidence-${ids.voiceEvidence}`), ids.voice]);
  await pool.query(`UPDATE ai_media_provider_accounts SET
      status='active',credential_status='active',credential_expires_at=(SELECT expires_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      last_verified_at=(SELECT observed_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      static_credential_verification_id=$2,static_credential_verification_digest=$3,
      static_credential_verified_at=(SELECT observed_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      static_credential_verification_expires_at=(SELECT expires_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      granted_scopes='[]'::jsonb,capabilities='["render_video"]'::jsonb
    WHERE id=$1`, [ids.account, ids.header, digest("header-evidence")]);
}

integrationTest("PG16 PR29 exact static HeyGen verification graph gates activation and preserves evidence", async () => {
  await applyManifestAndPending();
  await pool.query(pr29Rollback);
  assert.deepEqual((await pool.query(`SELECT
    to_regclass('public.ai_media_static_heygen_verification_headers') IS NULL AS headers_removed,
    to_regclass('public.ai_media_static_heygen_resource_verifications') IS NULL AS resources_removed`)).rows,
  [{ headers_removed: true, resources_removed: true }]);
  await pool.query(pr29Forward);
  await seedStaticPlan();

  await assert.rejects(pool.query(`UPDATE ai_media_provider_accounts SET status='active',credential_status='active',
    credential_expires_at=transaction_timestamp()+interval '1 hour',last_verified_at=transaction_timestamp(),
    granted_scopes='[]'::jsonb,capabilities='["render_video"]'::jsonb WHERE id=$1`, [ids.account]),
    /violates check constraint|lacks exact current verification evidence/u);

  await insertHeader();
  await insertResourceEvidence(ids.badEvidence, ids.avatar, "avatar", { groupDigest: digest("look-001"), idempotencyKey: "bad-group-as-look" })
    .then(() => assert.fail("group-as-look evidence should be rejected"),
      (error: unknown) => assert.match(String(error), /ai_media_static_heygen_resource_verifications_ck/u));
  await insertResourceEvidence(ids.spliceEvidence, ids.otherResource, "avatar", { idempotencyKey: "tenant-splice" })
    .then(() => assert.fail("cross-tenant resource evidence should be rejected"),
      (error: unknown) => assert.match(String(error), /foreign key|resource_fk/u));

  await pool.query("BEGIN");
  for (const [index, avatarId] of avatarIds.entries()) {
    const evidenceId = avatarEvidenceId(index);
    await insertResourceEvidence(evidenceId, avatarId, "avatar");
    await pool.query(`UPDATE ai_media_provider_resources SET
        verification_header_id=$1,verification_resource_evidence_id=$2,verification_evidence_digest=$3,
        verified_credential_version=1,verified_at=(SELECT observed_at FROM ai_media_static_heygen_resource_verifications WHERE id=$2),
        verification_expires_at=(SELECT expires_at FROM ai_media_static_heygen_resource_verifications WHERE id=$2)
      WHERE id=$4`, [ids.header, evidenceId, digest(`evidence-${evidenceId}`), avatarId]);
  }
  await pool.query(`UPDATE ai_media_provider_accounts SET
      status='active',credential_status='active',credential_expires_at=(SELECT expires_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      last_verified_at=(SELECT observed_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      static_credential_verification_id=$2,static_credential_verification_digest=$3,
      static_credential_verified_at=(SELECT observed_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      static_credential_verification_expires_at=(SELECT expires_at FROM ai_media_static_heygen_verification_headers WHERE id=$2),
      granted_scopes='[]'::jsonb,capabilities='["render_video"]'::jsonb
    WHERE id=$1`, [ids.account, ids.header, digest("header-evidence")]);
  await assert.rejects(pool.query("COMMIT"), /exactly cover the bound roster plan resources/u);
  await pool.query("ROLLBACK").catch(() => undefined);

  await pool.query("BEGIN");
  for (const [index, avatarId] of avatarIds.entries()) {
    await insertResourceEvidence(avatarEvidenceId(index), avatarId, "avatar");
  }
  await insertResourceEvidence(ids.voiceEvidence, ids.voice, "voice");
  await activateWithPointers();
  await pool.query("COMMIT");

  const credentialLoader = new DrizzleVerifiedStaticHeyGenRuntimeCredentialLoader(drizzle(pool));
  const exactIdentity = {
    scope: { ownerUserId: owner, workspaceId: workspace },
    providerAccountId: ids.account,
    providerKey: "heygen",
    providerCredentialVersion: 1,
  } as const;
  const loadedCredential = await credentialLoader.load(exactIdentity);
  assert.ok(loadedCredential);
  assert.deepEqual(loadedCredential.scope, exactIdentity.scope);
  assert.equal(loadedCredential.providerAccountId, ids.account);
  assert.equal(loadedCredential.providerCredentialVersion, 1);
  assert.equal(loadedCredential.secretRef, "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY");
  assert.ok(Date.parse(loadedCredential.expiresAt) > Date.parse(loadedCredential.verifiedAt));
  assert.equal(await credentialLoader.load({
    ...exactIdentity,
    scope: { ownerUserId: "other-owner", workspaceId: workspace },
  }), undefined);
  assert.equal(await credentialLoader.load({ ...exactIdentity, providerCredentialVersion: 2 }), undefined);

  await assert.rejects(pool.query(`UPDATE ai_media_static_heygen_verification_headers SET billing_model='changed' WHERE id=$1`, [ids.header]),
    /static HeyGen verification evidence is append-only/u);
  await assert.rejects(pool.query(`DELETE FROM ai_media_static_heygen_resource_verifications WHERE id=$1`, [avatarEvidenceId(0)]),
    /static HeyGen verification evidence is append-only/u);
  await assert.rejects(pool.query(`TRUNCATE ai_media_static_heygen_verification_headers,
    ai_media_static_heygen_resource_verifications CASCADE`),
    /static HeyGen verification evidence is append-only/u);
  await assert.rejects(pool.query("TRUNCATE ai_media_static_heygen_resource_verifications CASCADE"),
    /static HeyGen verification evidence is append-only/u);
  await assert.rejects(pool.query(pr29Rollback), /rollback preserves static HeyGen verification evidence; stop and forward-fix/u);
  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::integer FROM ai_media_static_heygen_verification_headers) AS headers,
    (SELECT count(*)::integer FROM ai_media_static_heygen_resource_verifications) AS resources`)).rows,
  [{ headers: 1, resources: 6 }]);

  await pool.query("BEGIN");
  await pool.query(`UPDATE ai_media_static_credential_bindings SET lifecycle_state='superseded',
    superseded_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [ids.binding1]);
  await pool.query(`INSERT INTO ai_media_static_credential_bindings
    (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
      expected_credential_version,target_credential_version,secret_ref,idempotency_key,request_digest)
    VALUES ($1,$2,$3,$2,$4,'heygen',1,2,'env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2','bind-v02',$5)`,
    [ids.binding2, owner, workspace, ids.account, digest("binding-v2")]);
  await pool.query(`UPDATE ai_media_provider_accounts SET status='disconnected',credential_status='unverified',
    credential_version=2,secret_ref='env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2',
    credential_expires_at=NULL,last_verified_at=NULL,static_credential_verification_id=NULL,
    static_credential_verification_digest=NULL,static_credential_verified_at=NULL,
    static_credential_verification_expires_at=NULL,capabilities='[]'::jsonb WHERE id=$1`, [ids.account]);
  await pool.query("COMMIT");
  assert.equal(await credentialLoader.load(exactIdentity), undefined,
    "credential rotation must immediately invalidate the formerly admitted runtime identity");
  await assert.rejects(pool.query(`UPDATE ai_media_provider_accounts SET status='active',credential_status='active',
    credential_expires_at=transaction_timestamp()+interval '1 hour',last_verified_at=transaction_timestamp(),
    static_credential_verification_id=$2,static_credential_verification_digest=$3,
    static_credential_verified_at=transaction_timestamp(),static_credential_verification_expires_at=transaction_timestamp()+interval '1 hour',
    granted_scopes='[]'::jsonb,capabilities='["render_video"]'::jsonb WHERE id=$1`,
    [ids.account, ids.header, digest("header-evidence")]), /foreign key|static_verification_fk/u);
});
