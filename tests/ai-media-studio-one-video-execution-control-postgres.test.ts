import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import process from "node:process";
import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  productionApprovalInputDigest,
  productionCreativeDigest,
} from "../server/ai-media-studio/production-batches/metadata-integrity";
import {
  DrizzleOneVideoExecutionControlRepository,
  type OneVideoExecutionControlTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-one-video-execution-control-repository";
import {
  DrizzleStaticHeyGenVerificationRepository,
  type StaticHeyGenVerificationDatabase,
} from "../server/ai-media-studio/provider-credentials/drizzle-static-heygen-verification-repository";
import { StaticHeyGenVerificationService } from "../server/ai-media-studio/provider-credentials/static-heygen-verification-service";
import { sha256, type Sha256Digest } from "../server/ai-media-studio/provider-credentials/static-heygen-verification-contracts";

type MigrationFile = { path: string; sha256: string };
type Manifest = {
  migrations: Array<{ pullRequest: string; forward: MigrationFile }>;
  pr26: { requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }> };
};
type Scope = { ownerUserId: string; workspaceId: string };
type Fixture = {
  scope: Scope;
  accountId: string;
  bindingId: string;
  planId: string;
  publicPlanKey: string;
  targetSlotId: string;
  publicTargetSlotKey: string;
  targetInfluencerId: string;
  targetAvatarId: string;
  voiceId: string;
  planDigest: Sha256Digest;
  sourceRosterKey: string;
  sourceRosterDigest: Sha256Digest;
};

const DATABASE = "ams_one_video_control_test";
const TEMP_PREFIX = "ams-one-video-control-pg-";
const migrationRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../migrations/ai-media-studio/manifest.json", import.meta.url), "utf8")) as Manifest;
const pr28Forward = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_forward.sql", import.meta.url), "utf8");
const pr29Forward = readFileSync(new URL("../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_forward.sql", import.meta.url), "utf8");

function ownedUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value || process.env.DATABASE_URL?.trim()) throw new Error("one-video control PostgreSQL test requires only owned TEST_DATABASE_URL");
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.username, "postgres");
  assert.equal(parsed.password, "");
  assert.equal(parsed.pathname, `/${DATABASE}`);
  assert.equal(parsed.searchParams.get("port"), "55439");
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
const pool = new Pool({ connectionString: enabled ? ownedUrl() : "postgresql://postgres@localhost/disabled", max: 8, allowExitOnIdle: true });
after(async () => pool.end());

const rawHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown): Sha256Digest => `sha256:${rawHash(typeof value === "string" ? value : JSON.stringify(value))}`;

function uuid(seed: string): string {
  const hex = rawHash(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function publicKey(prefix: "plan" | "slot" | "batch" | "script" | "member" | "variant", seed: string): string {
  return `${prefix}_${rawHash(seed).slice(0, 24)}`;
}

function reviewedForward(file: MigrationFile): string {
  const bytes = readFileSync(new URL(file.path, migrationRoot));
  assert.equal(rawHash(bytes), file.sha256, `${file.path} differs from reviewed manifest`);
  return bytes.toString("utf8");
}

async function applyChain(): Promise<void> {
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

function staticService(): StaticHeyGenVerificationService {
  return new StaticHeyGenVerificationService(
    new DrizzleStaticHeyGenVerificationRepository(drizzle(pool) as unknown as StaticHeyGenVerificationDatabase),
  );
}

function controlRepository(): DrizzleOneVideoExecutionControlRepository {
  return new DrizzleOneVideoExecutionControlRepository(drizzle(pool) as unknown as OneVideoExecutionControlTransactionalDatabase);
}

async function seedBoundPlan(label: string, avatarCount: 5 | 10 = 5): Promise<Fixture> {
  const scope = { ownerUserId: `owner-${label}`, workspaceId: `workspace-${label}` };
  const accountId = uuid(`${label}:account`);
  const bindingId = uuid(`${label}:binding:v1`);
  const planId = uuid(`${label}:plan`);
  const voiceId = uuid(`${label}:voice`);
  const publicPlanKey = publicKey("plan", `${label}:plan`);
  const sourceRosterKey = `roster-${label}`;
  const sourceRosterDigest = digest(`${label}:roster`);
  const planDigest = digest(`${label}:plan-digest`);
  const avatars = Array.from({ length: avatarCount }, (_, index) => ({
    id: uuid(`${label}:avatar:${index + 1}`),
    influencerId: uuid(`${label}:influencer:${index + 1}`),
    memberKey: publicKey("member", `${label}:member:${index + 1}`),
    lookId: `${label}-look-${index + 1}`,
    groupId: `${label}-group-${index + 1}`,
  }));
  await pool.query(`INSERT INTO ai_media_provider_accounts
    (id,owner_user_id,workspace_id,provider_key,display_name,status,credential_status,credential_version,credential_source)
    VALUES ($1,$2,$3,'heygen','HeyGen one-video control','disconnected','unverified',0,'not_bound')`,
    [accountId, scope.ownerUserId, scope.workspaceId]);
  await pool.query("BEGIN");
  await pool.query(`INSERT INTO ai_media_static_credential_bindings
    (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
      expected_credential_version,target_credential_version,secret_ref,idempotency_key,request_digest)
    VALUES ($1,$2,$3,$2,$4,'heygen',0,1,'env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY',$5,$6)`,
    [bindingId, scope.ownerUserId, scope.workspaceId, accountId, `${label}-bind-v1`, digest(`${label}:binding-v1`)]);
  await pool.query(`UPDATE ai_media_provider_accounts SET credential_source='static_api_key',
    secret_ref='env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY',credential_version=1,
    credential_actor_user_id=$2 WHERE id=$1`, [accountId, scope.ownerUserId]);
  await pool.query("COMMIT");

  await pool.query(`INSERT INTO ai_media_provider_resources
    (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,canonical_key,
      external_resource_id,display_name,status)
    VALUES ($1,$2,$3,$4,'heygen','voice',$5,$6,'Primary voice','pending_verification')`,
    [voiceId, scope.ownerUserId, scope.workspaceId, accountId, `voice-${label}`, `${label}-voice-main`]);
  for (const [index, avatar] of avatars.entries()) {
    await pool.query(`INSERT INTO ai_media_provider_resources
      (id,owner_user_id,workspace_id,provider_account_id,provider_key,resource_type,canonical_key,
        external_resource_id,display_name,status)
      VALUES ($1,$2,$3,$4,'heygen','avatar',$5,$6,$7,'pending_verification')`,
      [avatar.id, scope.ownerUserId, scope.workspaceId, accountId, `avatar-${label}-${index + 1}`, avatar.lookId, `Avatar ${index + 1}`]);
    await pool.query(`INSERT INTO ai_media_influencers
      (id,owner_user_id,workspace_id,name,slug,status,language,default_avatar_resource_id,default_voice_resource_id)
      VALUES ($1,$2,$3,$4,$5,'draft','es-US',$6,$7)`,
      [avatar.influencerId, scope.ownerUserId, scope.workspaceId, `Creator ${index + 1}`, `${label}-creator-${index + 1}`,
        avatar.id, voiceId]);
  }
  await pool.query(`INSERT INTO ai_media_daily_plans
    (id,owner_user_id,workspace_id,public_plan_key,provider_account_id,provider_key,provider_credential_version,
      source_roster_key,source_roster_digest,plan_date,accounting_time_zone,status,planned_slot_count,
      idempotency_key,input_digest,plan_digest)
    VALUES ($1,$2,$3,$4,$5,'heygen',1,$6,$7,(transaction_timestamp() AT TIME ZONE 'UTC')::date,
      'UTC','blocked',$8,$9,$10,$11)`,
    [planId, scope.ownerUserId, scope.workspaceId, publicPlanKey, accountId, sourceRosterKey, sourceRosterDigest,
      avatarCount * 10, `${label}-plan-idem`, digest(`${label}:plan-input`), planDigest]);
  let targetSlotId = "";
  let publicTargetSlotKey = "";
  for (const [avatarIndex, avatar] of avatars.entries()) {
    for (let video = 1; video <= 10; video += 1) {
      const slotId = uuid(`${label}:slot:${avatarIndex + 1}:${video}`);
      const publicSlotKey = publicKey("slot", `${label}:slot:${avatarIndex + 1}:${video}`);
      if (avatarIndex === 0 && video === 1) {
        targetSlotId = slotId;
        publicTargetSlotKey = publicSlotKey;
      }
      await pool.query(`INSERT INTO ai_media_daily_plan_slots
        (id,owner_user_id,workspace_id,public_slot_key,daily_plan_id,provider_account_id,provider_key,
          provider_credential_version,source_member_key,influencer_id,avatar_resource_id,voice_resource_id,
          video_number,status,slot_digest)
        VALUES ($1,$2,$3,$4,$5,$6,'heygen',1,$7,$8,$9,$10,$11,'blocked',$12)`,
        [slotId, scope.ownerUserId, scope.workspaceId, publicSlotKey, planId, accountId, avatar.memberKey,
          avatar.influencerId, avatar.id, voiceId, video, digest(`${label}:slot:${avatarIndex + 1}:${video}`)]);
    }
  }

  const now = new Date();
  await staticService().recordPassed({
    verificationId: uuid(`${label}:verification`),
    scope,
    actorUserId: scope.ownerUserId,
    providerAccountId: accountId,
    staticCredentialBindingId: bindingId,
    providerCredentialVersion: 1,
    credentialBindingRequestDigest: digest(`${label}:binding-v1`),
    dailyPlanId: planId,
    sourceRosterKey,
    sourceRosterDigest,
    planDigest,
    policyExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    idempotencyKey: `${label}-verify-v1`,
    providerOutcome: {
      kind: "passed",
      providerKey: "heygen",
      providerAccountId: accountId,
      providerCredentialVersion: 1,
      observedAt: new Date(now.getTime() - 1000).toISOString(),
      billingModel: "subscription",
      avatarLookCount: avatarCount,
      voiceCount: 1,
      requestDigest: digest(`${label}:provider-request`),
      accountEvidenceDigest: digest(`${label}:account-evidence`),
      avatars: avatars.map((avatar) => ({
        avatarLookId: avatar.lookId,
        lookIdDigest: sha256(avatar.lookId),
        groupIdDigest: sha256(avatar.groupId),
        lookStatus: "completed",
        groupStatus: "completed",
        groupConsentStatus: "approved",
        supportedEngines: ["avatar_iv"],
        evidenceDigest: digest(`${label}:avatar-evidence:${avatar.lookId}`),
      })),
      voices: [{
        voiceId: `${label}-voice-main`,
        voiceIdDigest: sha256(`${label}-voice-main`),
        language: "Spanish",
        supportPause: true,
        supportLocale: true,
        supportInteractiveAvatar: false,
        evidenceDigest: digest(`${label}:voice-evidence`),
      }],
      evidenceDigest: digest(`${label}:provider-passed`),
    },
  });

  const fixture = {
    scope, accountId, bindingId, planId, publicPlanKey, targetSlotId, publicTargetSlotKey,
    targetInfluencerId: avatars[0]!.influencerId, targetAvatarId: avatars[0]!.id, voiceId,
    planDigest, sourceRosterKey, sourceRosterDigest,
  };
  await makeTargetSlotProductionReady(label, fixture);
  return fixture;
}

async function makeTargetSlotProductionReady(label: string, fixture: Fixture): Promise<void> {
  const batchKey = publicKey("batch", `${label}:batch`);
  const scriptKey = publicKey("script", `${label}:script`);
  const scriptId = uuid(`${label}:script`);
  const variantId = uuid(`${label}:variant`);
  const sourceId = uuid(`${label}:source`);
  const governanceId = uuid(`${label}:governance`);
  const launchIntentId = uuid(`${label}:launch-intent`);
  const quoteId = uuid(`${label}:quote`);
  const approvalId = uuid(`${label}:human-approval`);
  const sourceContent = `${label} source content approved for one-video control`;
  const sourceContentChecksum = rawHash(sourceContent);
  const sourceContentHash = `sha256:${sourceContentChecksum}`;
  const scriptContent = `${label} approved script content for slot one`;
  const scriptChecksum = rawHash(scriptContent);
  const preparedAt = new Date(Date.now() - 30_000).toISOString();
  const approvedAt = new Date(Date.now() - 20_000).toISOString();
  const title = `${label} Launch video`;
  const creative = {
    title,
    angle: "Local offer",
    hook: "Open with a practical hook.",
    script: scriptContent,
    cta: "Book now.",
    caption: "Approved caption.",
    hashtags: ["#travel"],
    seoKeywords: ["travel"],
  };
  const creativeDigest = productionCreativeDigest(creative);
  const baseEnvelope = {
    version: 1,
    batchId: batchKey,
    planId: fixture.publicPlanKey,
    slotId: fixture.publicTargetSlotKey,
    scriptKey,
    idempotencyKey: `${label}-production-batch`,
    inputDigest: digest(`${label}:batch-input`),
    sourceContentHash,
    sourceContentChecksum,
    sourceTitle: title,
    sourceCategory: "events",
    generatorVersion: "deterministic-script-v1",
    variantCount: 1,
    preparedAt,
  };
  const approval = {
    version: 1,
    ownerUserId: fixture.scope.ownerUserId,
    workspaceId: fixture.scope.workspaceId,
    batchId: batchKey,
    planId: fixture.publicPlanKey,
    slotId: fixture.publicTargetSlotKey,
    scriptKey,
    selectedVariantChecksum: scriptChecksum,
    selectedCreativeDigest: creativeDigest,
    inputDigest: productionApprovalInputDigest({
      ...fixture.scope,
      planId: fixture.publicPlanKey,
      expectedBatchId: batchKey,
      idempotencyKey: `${label}-production-approval`,
    }),
    idempotencyKey: `${label}-production-approval`,
    approvedAt,
  };
  const variantEnvelope = { ...baseEnvelope, variantKey: publicKey("variant", `${label}:variant`), variantIndex: 0, selected: true };
  const scriptMetadata = { productionBatchV1: baseEnvelope, productionBatchApprovalV1: approval };
  const variantMetadata = {
    productionBatchV1: variantEnvelope,
    productionCreativeV1: { ...creative, creativeDigest },
    productionBatchApprovalV1: approval,
  };
  const governanceEvidenceDigest = digest(`${label}:governance-evidence`);
  const launchSubjectDigest = digest(`${label}:launch-subject`);
  const launchIntentDigest = digest(`${label}:launch-intent`);

  await pool.query(`INSERT INTO ai_media_source_items
    (id,owner_user_id,workspace_id,source_type,external_id,title,content,content_hash,status,rights_status,moderation_status,payload)
    VALUES ($1,$2,$3,'events',$4,$5,$6,$7,'ready','owned','approved','{}'::jsonb)`,
    [sourceId, fixture.scope.ownerUserId, fixture.scope.workspaceId, `${label}-source`, title, sourceContent, sourceContentHash]);
  await pool.query(`INSERT INTO ai_media_scripts
    (id,owner_user_id,workspace_id,influencer_id,title,source_type,source_item_id,language,status,current_variant_id,metadata)
    VALUES ($1,$2,$3,$4,$5,'events',$6,'es-US','approved',$7,$8::jsonb)`,
    [scriptId, fixture.scope.ownerUserId, fixture.scope.workspaceId, fixture.targetInfluencerId, title, sourceId, variantId,
      JSON.stringify(scriptMetadata)]);
  await pool.query(`INSERT INTO ai_media_script_variants
    (id,owner_user_id,workspace_id,script_id,version,label,content,status,checksum,metadata)
    VALUES ($1,$2,$3,$4,1,$5,$6,'approved',$7,$8::jsonb)`,
    [variantId, fixture.scope.ownerUserId, fixture.scope.workspaceId, scriptId, title, scriptContent, scriptChecksum,
      JSON.stringify(variantMetadata)]);
  await pool.query(`INSERT INTO ai_media_governance_profiles
    (id,owner_user_id,workspace_id,influencer_id,avatar_resource_id,voice_resource_id,state,
      consent_basis,rights_basis,allowed_uses,territories,proof_digest,evidence_digest,brand_policy,
      version,policy_version,actor_user_id,valid_from,expires_at,idempotency_key,input_digest)
    VALUES ($1,$2,$3,$4,$5,$6,'active','obtained','owned','["commercial"]'::jsonb,'["US"]'::jsonb,
      $7,$8,'{}'::jsonb,1,'one-video-control-v1',$2,transaction_timestamp()-interval '1 minute',
      transaction_timestamp()+interval '1 hour',$9,$10)`,
    [governanceId, fixture.scope.ownerUserId, fixture.scope.workspaceId, fixture.targetInfluencerId,
      fixture.targetAvatarId, fixture.voiceId, digest(`${label}:governance-proof`), governanceEvidenceDigest,
      `${label}-governance`, digest(`${label}:governance-input`)]);
  await pool.query(`UPDATE ai_media_daily_plans SET status='planned',updated_at=transaction_timestamp() WHERE id=$1`, [fixture.planId]);
  await pool.query(`UPDATE ai_media_daily_plan_slots SET status='planned',script_variant_id=$1,updated_at=transaction_timestamp()
    WHERE owner_user_id=$2 AND workspace_id=$3 AND daily_plan_id=$4`,
    [variantId, fixture.scope.ownerUserId, fixture.scope.workspaceId, fixture.planId]);
  await pool.query(`INSERT INTO ai_media_launch_intents
    (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,plan_digest,slot_digest,source_roster_key,source_roster_digest,source_member_key,
      script_id,script_variant_id,script_variant_checksum,source_type,source_item_id,source_content_hash,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,launch_intent_digest,actor_user_id,input_digest,idempotency_key)
    SELECT $1,slots.owner_user_id,slots.workspace_id,slots.daily_plan_id,slots.id,1,slots.provider_account_id,
      slots.provider_key,slots.provider_credential_version,$2,slots.slot_digest,plans.source_roster_key,
      plans.source_roster_digest,slots.source_member_key,$3,$4,$5,'events',$6,$7,$8,$9,'commercial','US','US',
      $10,$11,$12,$13,$14
    FROM ai_media_daily_plan_slots slots
    JOIN ai_media_daily_plans plans ON plans.owner_user_id=slots.owner_user_id AND plans.workspace_id=slots.workspace_id
      AND plans.id=slots.daily_plan_id
    WHERE slots.id=$15`,
    [launchIntentId, fixture.planDigest, scriptId, variantId, scriptChecksum, sourceId, sourceContentHash,
      governanceId, governanceEvidenceDigest, launchSubjectDigest, launchIntentDigest, fixture.scope.ownerUserId,
      digest(`${label}:launch-input`), `${label}-launch-intent`, fixture.targetSlotId]);
  for (const evidence of [
    { id: quoteId, kind: "maximum_quote", decision: "quoted", amount: "1250000", currency: "USD", sourceId: `${label}-quote-attestation`, sourceDigest: digest(`${label}:quote-source`) },
    { id: approvalId, kind: "human_launch_approval", decision: "approved", amount: null, currency: null, sourceId: null, sourceDigest: null },
  ] as const) {
    await pool.query(`INSERT INTO ai_media_launch_evidence
      (id,owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
        provider_credential_version,script_variant_id,script_variant_checksum,governance_profile_id,
        governance_evidence_digest,governance_use,governance_territory,content_country,launch_subject_digest,
        launch_intent_id,launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,revision,
        valid_from,expires_at,actor_user_id,source_kind,source_attestation_id,source_evidence_digest,
        evidence_digest,input_digest,idempotency_key)
      VALUES ($1,$2,$3,$4,1,$5,'heygen',1,$6,$7,$8,$9,'commercial','US','US',$10,$11,$12,$13,$14,$15,$16,1,
        transaction_timestamp()-interval '1 second',transaction_timestamp()+interval '30 minutes',$2,$17,$18,$19,$20,$21,$22)`,
      [evidence.id, fixture.scope.ownerUserId, fixture.scope.workspaceId, fixture.targetSlotId, fixture.accountId,
        variantId, scriptChecksum, governanceId, governanceEvidenceDigest, launchSubjectDigest, launchIntentId,
        launchIntentDigest, evidence.kind, evidence.decision, evidence.amount, evidence.currency, evidence.kind,
        evidence.sourceId, evidence.sourceDigest, digest(`${label}:${evidence.kind}:evidence`),
        digest(`${label}:${evidence.kind}:input`), `${label}-${evidence.kind}`]);
  }
}

async function rotateCredential(fixture: Fixture): Promise<void> {
  await pool.query("BEGIN");
  await pool.query(`UPDATE ai_media_static_credential_bindings SET lifecycle_state='superseded',
    superseded_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [fixture.bindingId]);
  await pool.query(`INSERT INTO ai_media_static_credential_bindings
    (id,owner_user_id,workspace_id,actor_user_id,provider_account_id,provider_key,
      expected_credential_version,target_credential_version,secret_ref,idempotency_key,request_digest)
    VALUES ($1,$2,$3,$2,$4,'heygen',1,2,'env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2',$5,$6)`,
    [uuid(`${fixture.publicPlanKey}:binding:v2`), fixture.scope.ownerUserId, fixture.scope.workspaceId,
      fixture.accountId, `${fixture.publicPlanKey}-bind-v2`, digest(`${fixture.publicPlanKey}:binding-v2`)]);
  await pool.query(`UPDATE ai_media_provider_accounts SET status='disconnected',credential_status='unverified',
    credential_version=2,secret_ref='env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2',
    credential_expires_at=NULL,last_verified_at=NULL,static_credential_verification_id=NULL,
    static_credential_verification_digest=NULL,static_credential_verified_at=NULL,
    static_credential_verification_expires_at=NULL,capabilities='[]'::jsonb WHERE id=$1`, [fixture.accountId]);
  await pool.query("COMMIT");
}

function assertSafeControlPacket(packet: unknown): void {
  const body = JSON.stringify(packet);
  assert.doesNotMatch(body, /providerAccountId|externalResourceId|secretRef|actorUserId|sha256:|look-|voice-main|group-/iu);
  assert.equal((packet as any).execute.postAvailable, false);
  assert.equal((packet as any).execute.state, "disabled");
  assert.deepEqual((packet as any).effects, {
    providerCalled: false,
    secretResolved: false,
    verificationPerformed: false,
    quoteRequested: false,
    approvalRecorded: false,
    reservationCreated: false,
    renderCreated: false,
    outboxCreated: false,
    spendCommitted: false,
    publishingCreated: false,
  });
  assert.equal((packet as any).authoritativeForAdmission, false);
  assert.equal((packet as any).canGenerate, false);
  assert.equal((packet as any).spendAuthorized, false);
}

integrationTest("PG16 one-video read model consumes exact PR29 static HeyGen evidence for verified/current 5x10 and 10x10 plans", async () => {
  await applyChain();
  const five = await seedBoundPlan("five", 5);
  const fivePacket = await controlRepository().observe(five.scope, five.publicPlanKey, five.publicTargetSlotKey);
  assert.ok(fivePacket);
  assert.equal(fivePacket.binding.state, "current");
  assert.equal(fivePacket.binding.credentialVersion, 1);
  assert.equal(fivePacket.providerVerification.state, "verified");
  assert.equal(fivePacket.maximumQuote.state, "quoted");
  assert.equal(fivePacket.humanApproval.state, "approved");
  assert.ok(fivePacket.execute.reasonCodes.includes("one_shot_executor_not_installed"));
  assertSafeControlPacket(fivePacket);

  const ten = await seedBoundPlan("ten", 10);
  const tenPacket = await controlRepository().observe(ten.scope, ten.publicPlanKey, ten.publicTargetSlotKey);
  assert.ok(tenPacket);
  assert.equal(tenPacket.binding.state, "current");
  assert.equal(tenPacket.providerVerification.state, "verified");
  assert.equal(tenPacket.selection.creator.label, "Creator 1");
  assert.equal(await controlRepository().observe(five.scope, ten.publicPlanKey, ten.publicTargetSlotKey), undefined);
  assert.equal(await controlRepository().observe(ten.scope, five.publicPlanKey, five.publicTargetSlotKey), undefined);
});

integrationTest("PG16 one-video read model does not verify after rotation and the graph rejects incomplete or expired evidence", async () => {
  const rotated = await seedBoundPlan("rotated", 5);
  await rotateCredential(rotated);
  const rotatedPacket = await controlRepository().observe(rotated.scope, rotated.publicPlanKey, rotated.publicTargetSlotKey);
  assert.ok(rotatedPacket);
  assert.notEqual(rotatedPacket.providerVerification.state, "verified");
  assertSafeControlPacket(rotatedPacket);

  const incomplete = await seedBoundPlan("incomplete", 5);
  await assert.rejects(pool.query(`UPDATE ai_media_provider_resources SET verification_header_id=NULL,
    verification_resource_evidence_id=NULL,verification_evidence_digest=NULL,verified_credential_version=NULL,
    verified_at=NULL,verification_expires_at=NULL WHERE id=$1`, [incomplete.targetAvatarId]),
  /active static HeyGen resource lacks exact current resource verification evidence|violates check constraint/u);

  const expired = await seedBoundPlan("expired", 5);
  await assert.rejects(pool.query(`UPDATE ai_media_provider_accounts SET credential_expires_at=transaction_timestamp()-interval '1 second',
    static_credential_verification_expires_at=transaction_timestamp()-interval '1 second' WHERE id=$1`, [expired.accountId]),
  /active static HeyGen account lacks exact current verification evidence|violates check constraint/u);

  const drifted = await seedBoundPlan("drifted", 5);
  await pool.query("UPDATE ai_media_provider_resources SET external_resource_id='look-drifted' WHERE id=$1",
    [drifted.targetAvatarId]);
  const driftedPacket = await controlRepository().observe(
    drifted.scope, drifted.publicPlanKey, drifted.publicTargetSlotKey,
  );
  assert.ok(driftedPacket);
  assert.equal(driftedPacket.providerVerification.state, "stale");
  assertSafeControlPacket(driftedPacket);
});
