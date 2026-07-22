import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import express, { type Request } from "express";
import {
  oneVideoExecutionControlSchema,
  type OneVideoExecutionControl,
} from "../shared/ai-media-studio-one-video-execution-control";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { DrizzleOneVideoExecutionControlRepository, derivePersistedProviderVerificationState } from "../server/ai-media-studio/planning/drizzle-one-video-execution-control-repository";
import {
  deriveLaunchRenderSpecDigest,
  OneVideoExecutionControlError,
} from "../server/ai-media-studio/planning/one-video-execution-control-contracts";
import { OneVideoExecutionControlService } from "../server/ai-media-studio/planning/one-video-execution-control-service";
import { productionApprovalInputDigest, productionCreativeDigest } from "../server/ai-media-studio/production-batches/metadata-integrity";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";

const planId = `plan_${"1".repeat(24)}`;
const batchId = `batch_${"2".repeat(24)}`;
const slotId = `slot_${"3".repeat(24)}`;
const scope = { ownerUserId: "owner", workspaceId: "personal" } as const;
const internalPlanId = "11111111-1111-4111-8111-111111111111";
const internalSlotId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const avatarId = "44444444-4444-4444-8444-444444444444";
const voiceId = "55555555-5555-4555-8555-555555555555";
const scriptId = "66666666-6666-4666-8666-666666666666";
const variantId = "77777777-7777-4777-8777-777777777777";
const sourceId = "88888888-8888-4888-8888-888888888888";
const governanceId = "99999999-9999-4999-8999-999999999999";
const verificationHeaderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2026-07-22T12:00:00.000Z");
const verifiedAt = new Date("2026-07-22T11:55:00.000Z");
const verificationExpiresAt = new Date("2026-07-22T13:00:00.000Z");

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const sha256 = (value: string): `sha256:${string}` => `sha256:${hash(value)}`;
const quoteKey = `quote_${"a".repeat(24)}`;
const renderSpecKey = `render_spec_${"b".repeat(24)}`;

function packet(overrides: Partial<OneVideoExecutionControl> = {}): OneVideoExecutionControl {
  return oneVideoExecutionControlSchema.parse({
    version: 1, source: "postgresql_read_only",
    subject: { planId, batchId, slotId, slotAttempt: 1 }, observedAt: "2026-07-22T12:00:00.000Z",
    selection: { selectionKey: `selection_${"4".repeat(24)}`, creator: { label: "Safe creator" },
      avatar: { key: `resource_${"5".repeat(24)}`, label: "Safe avatar" },
      voice: { key: `resource_${"6".repeat(24)}`, label: "Safe voice" } },
    format: { aspectRatio: "9:16", container: "mp4" }, binding: { state: "current", credentialVersion: 1 },
    providerVerification: { state: "verified", observedAt: "2026-07-22T11:50:00.000Z",
      expiresAt: "2026-07-22T13:00:00.000Z" },
    maximumQuote: { state: "quoted", amountMicroUsd: "1250000", currency: "USD",
      evidenceKey: `evidence_${"7".repeat(24)}`, observedAt: "2026-07-22T11:51:00.000Z",
      expiresAt: "2026-07-22T12:30:00.000Z", quoteKey, renderSpecKey },
    humanApproval: { state: "approved", evidenceKey: `evidence_${"8".repeat(24)}`,
      observedAt: "2026-07-22T11:52:00.000Z", expiresAt: "2026-07-22T12:30:00.000Z",
      approvedQuoteKey: quoteKey, renderSpecKey },
    execute: { state: "disabled", postAvailable: false, reasonCodes: ["one_shot_executor_not_installed"] },
    effects: { providerCalled: false, secretResolved: false, verificationPerformed: false, quoteRequested: false,
      approvalRecorded: false, reservationCreated: false, renderCreated: false, outboxCreated: false,
      spendCommitted: false, publishingCreated: false },
    authoritativeForAdmission: false, canGenerate: false, spendAuthorized: false,
    ...overrides,
  });
}

test("strict v1 packet keeps an exact public subject and permanently disables execution and effects", () => {
  const value = packet();
  assert.deepEqual(value.subject, { planId, batchId, slotId, slotAttempt: 1 });
  assert.deepEqual(value.format, { aspectRatio: "9:16", container: "mp4" });
  assert.equal(value.execute.postAvailable, false);
  assert.ok(value.execute.reasonCodes.includes("one_shot_executor_not_installed"));
  assert.ok(Object.values(value.effects).every((effect) => effect === false));
  assert.equal(value.authoritativeForAdmission || value.canGenerate || value.spendAuthorized, false);
});

test("schema rejects private/native fields, money outside a quote, forged effects, and approval without exact quote binding", () => {
  for (const privateField of ["providerAccountId", "externalResourceId", "secretRef", "actorUserId", "evidenceDigest"]) {
    assert.equal(oneVideoExecutionControlSchema.safeParse({ ...packet(), [privateField]: "private" }).success, false);
  }
  const money = structuredClone(packet()) as any; money.maximumQuote.state = "stale";
  assert.equal(oneVideoExecutionControlSchema.safeParse(money).success, false);
  const effect = structuredClone(packet()) as any; effect.effects.providerCalled = true;
  assert.equal(oneVideoExecutionControlSchema.safeParse(effect).success, false);
    const noQuote = structuredClone(packet()) as any;
    noQuote.maximumQuote = { state: "missing" };
    assert.equal(oneVideoExecutionControlSchema.safeParse(noQuote).success, false);
    const staleApproval = structuredClone(packet()) as any;
    staleApproval.humanApproval.approvedQuoteKey = `quote_${"c".repeat(24)}`;
    assert.equal(oneVideoExecutionControlSchema.safeParse(staleApproval).success, false);
  });

test("service reparses repository output and verifies requested identity plus all denied effects", async () => {
  const calls: unknown[] = [];
  const service = new OneVideoExecutionControlService({ observe: async (...args) => { calls.push(args); return packet(); } });
  assert.equal((await service.observe(scope, planId, slotId)).subject.slotId, slotId);
  assert.deepEqual(calls, [[scope, planId, slotId]]);
  const wrong = new OneVideoExecutionControlService({ observe: async () => packet({
    subject: { planId, batchId, slotId: `slot_${"9".repeat(24)}`, slotAttempt: 1 },
  }) });
  await assert.rejects(wrong.observe(scope, planId, slotId),
    (error: unknown) => error instanceof OneVideoExecutionControlError && error.code === "UNAVAILABLE");
});

function queryText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

function approvedMetadata() {
  const scriptKey = `script_${"4".repeat(24)}`;
  const sourceContent = "Owned event source for one approved video.";
  const sourceContentChecksum = hash(sourceContent);
  const sourceContentHash = `sha256:${sourceContentChecksum}`;
  const creative = {
    title: "Approved launch script",
    angle: "Local launch angle",
    hook: "Start with the exact local hook.",
    script: "This is the approved one-video script.",
    cta: "Book now",
    caption: "Approved caption",
    hashtags: ["#miami"],
    seoKeywords: ["miami event"],
  };
  const creativeDigest = productionCreativeDigest(creative);
  const variantContent = creative.script;
  const selectedVariantChecksum = hash(variantContent);
  const base = {
    version: 1,
    batchId,
    planId,
    slotId,
    scriptKey,
    idempotencyKey: "production-batch-script-001",
    inputDigest: sha256("production-input"),
    sourceContentHash,
    sourceContentChecksum,
    sourceTitle: "Owned event",
    sourceCategory: "events",
    generatorVersion: "deterministic-script-v1",
    variantCount: 1,
    preparedAt: "2026-07-22T11:00:00.000Z",
  };
  const approval = {
    version: 1,
    ownerUserId: scope.ownerUserId,
    workspaceId: scope.workspaceId,
    batchId,
    planId,
    slotId,
    scriptKey,
    selectedVariantChecksum,
    selectedCreativeDigest: creativeDigest,
    inputDigest: productionApprovalInputDigest({
      ...scope, planId, expectedBatchId: batchId, idempotencyKey: "production-batch-approval-001",
    }),
    idempotencyKey: "production-batch-approval-001",
    approvedAt: "2026-07-22T11:30:00.000Z",
  };
  const variantMetadata = {
    productionBatchV1: { ...base, variantKey: `variant_${"7".repeat(24)}`, variantIndex: 0, selected: true },
    productionCreativeV1: { ...creative, creativeDigest },
    productionBatchApprovalV1: approval,
  };
  return {
    sourceContent,
    sourceContentHash,
    selectedVariantChecksum,
    scriptMetadata: { productionBatchV1: base, productionBatchApprovalV1: approval },
    variantMetadata,
    variantContent,
    title: creative.title,
  };
}

type StaticProjectionOverride = Partial<{
  staticVerificationHeaderId: string | null;
  staticVerificationCurrent: boolean;
  staticVerificationObservedAt: Date | null;
  staticVerificationExpiresAt: Date | null;
  accountStatus: string;
  credentialStatus: string;
  credentialSource: string;
  credentialExpiresAt: Date | null;
  avatarStatus: string;
  voiceStatus: string;
  nativeResourceIdsCurrent: boolean;
}>;

class FakeOneVideoReadModelDatabase {
  readonly queries: string[] = [];
  transactionConfig: unknown;
  private readonly staticProjection: StaticProjectionOverride;
  private readonly evidenceProjection: Record<string, unknown>;

  constructor(staticProjection: StaticProjectionOverride = {}, evidenceProjection: Record<string, unknown> = {}) {
    this.staticProjection = staticProjection;
    this.evidenceProjection = evidenceProjection;
  }

  async transaction<T>(callback: (tx: FakeOneVideoReadModelDatabase) => Promise<T>, config?: unknown): Promise<T> {
    this.transactionConfig = config;
    return callback(this);
  }

  async execute(query: unknown): Promise<{ rows: Record<string, unknown>[] }> {
    const text = queryText(query);
    this.queries.push(text);
    const metadata = approvedMetadata();
    if (/SELECT transaction_timestamp\(\) AS observed_at/iu.test(text)) {
      return { rows: [{ observed_at: now }] };
    }
    if (/FROM ai_media_daily_plans plans\s+WHERE/iu.test(text)) {
      return { rows: [{
        id: internalPlanId, public_plan_key: planId, status: "planned", planned_slot_count: 50,
        provider_account_id: accountId, provider_key: "heygen", provider_credential_version: 1,
        source_roster_key: "roster-primary", source_roster_digest: sha256("roster"),
        plan_digest: sha256("plan"),
      }] };
    }
    if (/FROM ai_media_daily_plan_slots slots\s+LEFT JOIN ai_media_scripts/iu.test(text)) {
      const accountStatus = this.staticProjection.accountStatus ?? "active";
      const credentialStatus = this.staticProjection.credentialStatus ?? "active";
      const credentialSource = this.staticProjection.credentialSource ?? "static_api_key";
      const credentialExpiresAt = this.staticProjection.credentialExpiresAt === undefined
        ? verificationExpiresAt : this.staticProjection.credentialExpiresAt;
      return { rows: [{
        id: internalSlotId, public_slot_key: slotId, status: "planned", script_variant_id: variantId,
        source_member_key: `member_${"a".repeat(24)}`, video_number: 1, provider_account_id: accountId,
        provider_key: "heygen", provider_credential_version: 1, slot_digest: sha256("slot"),
        script_id: scriptId, script_title: metadata.title, script_status: "approved",
        current_variant_id: variantId, script_metadata: metadata.scriptMetadata, source_type: "events",
        source_item_id: sourceId, source_id: sourceId, source_item_type: "events", source_title: "Owned event",
        source_content: metadata.sourceContent, source_content_hash: metadata.sourceContentHash,
        source_status: "accepted", rights_status: "owned", moderation_status: "approved",
        influencer_id: "influencer-1", creator_label: "Creator One",
        account_id: accountId, account_provider_key: "heygen", account_status: accountStatus,
        credential_status: credentialStatus, credential_version: 1, credential_expires_at: credentialExpiresAt,
        credential_source: credentialSource, last_verified_at: verifiedAt,
        static_credential_verification_id: verificationHeaderId, static_credential_verification_digest: sha256("header"),
        static_credential_verified_at: verifiedAt, static_credential_verification_expires_at: verificationExpiresAt,
        avatar_id: avatarId, avatar_type: "avatar", avatar_label: "Avatar One",
        avatar_status: this.staticProjection.avatarStatus ?? "active", avatar_synchronized_at: verifiedAt,
        avatar_verification_header_id: verificationHeaderId,
        avatar_verification_resource_evidence_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        avatar_verification_evidence_digest: sha256("avatar-evidence"), avatar_verified_credential_version: 1,
        avatar_verified_at: verifiedAt, avatar_verification_expires_at: verificationExpiresAt,
        voice_id: voiceId, voice_type: "voice", voice_label: "Voice One",
        voice_status: this.staticProjection.voiceStatus ?? "active", voice_synchronized_at: verifiedAt,
        voice_verification_header_id: verificationHeaderId,
        voice_verification_resource_evidence_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        voice_verification_evidence_digest: sha256("voice-evidence"), voice_verified_credential_version: 1,
        voice_verified_at: verifiedAt, voice_verification_expires_at: verificationExpiresAt,
        governance_id: governanceId, governance_evidence_digest: sha256("governance"),
        governance_state: "approved", governance_valid_from: "2026-07-22T10:00:00.000Z",
        governance_expires_at: "2026-07-23T10:00:00.000Z", revoked_at: null, governance_bound: true,
      }] };
    }
    if (/SELECT slots.source_member_key,slots.video_number,slots.status/iu.test(text)) {
      return { rows: Array.from({ length: 50 }, (_value, index) => ({
        source_member_key: `member_${Math.floor(index / 10).toString(16).repeat(24)}`,
        video_number: (index % 10) + 1,
        status: "planned",
      })) };
    }
    if (/FROM ai_media_script_variants variants/iu.test(text)) {
      return { rows: [{
        id: variantId, version: 1, label: metadata.title, content: metadata.variantContent,
        status: "approved", checksum: metadata.selectedVariantChecksum, metadata: metadata.variantMetadata,
      }] };
    }
    if (/SELECT attempt\.slot_attempt,intent\.id AS intent_id/iu.test(text)) {
      return { rows: [{ slot_attempt: 1, intent_id: null, launch_intent_digest: null,
        provider_account_id: accountId, provider_key: "heygen", provider_credential_version: 1,
        avatar_resource_id: avatarId, voice_resource_id: voiceId, script_variant_id: variantId,
        current_script_variant_checksum: metadata.selectedVariantChecksum,
        intent_current: null,
        quote_id: null, quote_decision: null, quote_amount: null, quote_currency: null, quote_valid_from: null,
        quote_expires_at: null, quote_revision: null, quote_evidence_digest: null, quote_current: null,
        human_id: null, human_decision: null, human_valid_from: null, human_expires_at: null,
        human_revision: null, human_evidence_digest: null, human_current: null,
        approval_bridge_id: null, bridge_render_spec_digest: null, bridge_quote_expires_at: null,
        bridge_quote_amount: null, bridge_quote_currency: null, bridge_decision: null,
        approval_binding_digest: null, approval_bridge_current: null,
        ...this.evidenceProjection }] };
    }
    if (/ai_media_static_heygen_verification_headers header/iu.test(text)) {
      const nativeResourceIdsCurrent = this.staticProjection.nativeResourceIdsCurrent ?? true;
      return { rows: [{
        static_verification_header_id: this.staticProjection.staticVerificationHeaderId === undefined
          ? verificationHeaderId : this.staticProjection.staticVerificationHeaderId,
        static_verification_observed_at: this.staticProjection.staticVerificationObservedAt === undefined
          ? verifiedAt : this.staticProjection.staticVerificationObservedAt,
        static_verification_expires_at: this.staticProjection.staticVerificationExpiresAt === undefined
          ? verificationExpiresAt : this.staticProjection.staticVerificationExpiresAt,
        avatar_external_resource_id: "look-main",
        avatar_external_resource_id_digest: nativeResourceIdsCurrent ? sha256("look-main") : sha256("look-old"),
        voice_external_resource_id: "voice-main",
        voice_external_resource_id_digest: nativeResourceIdsCurrent ? sha256("voice-main") : sha256("voice-old"),
        static_verification_current: this.staticProjection.staticVerificationCurrent ?? true,
      }] };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test("repository begins with PostgreSQL time in one repeatable-read/read-only tenant-scoped SELECT snapshot", async () => {
  const queries: string[] = []; let config: unknown;
  const repository = new DrizzleOneVideoExecutionControlRepository({
    execute: async () => ({ rows: [] }),
    transaction: async (callback, value) => { config = value; return callback({ execute: async (query) => {
      queries.push(queryText(query));
      return queries.length === 1 ? { rows: [{ observed_at: new Date("2026-07-22T12:00:00Z") }] } : { rows: [] };
    } }); },
  });
  assert.equal(await repository.observe(scope, planId, slotId), undefined);
  assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.ok(queries.every((query) => /^\s*SELECT/iu.test(query)));
  assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
  assert.match(queries[1]!, /owner_user_id=.*workspace_id=.*public_plan_key/isu);
});

test("repository source has no network, secret resolver, mutation, budget admission, render, or outbox execution surface", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/planning/drizzle-one-video-execution-control-repository.ts",
    import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|axios|secretRef|externalResourceId|reserveAndAdmit|FOR UPDATE/iu);
  assert.match(source, /verifyApprovedProductionBatchSlotMetadata/u);
  assert.match(source, /isolationLevel: "repeatable read", accessMode: "read only"/u);
  assert.match(source, /ORDER BY slots\.source_member_key,slots\.video_number\s+LIMIT 101/u);
  assert.match(source, /static_api_key.*disconnected.*unverified/su);
  assert.match(source, /one_shot_executor_not_installed/u);
});

test("pinned HeyGen V3 profile binds render avatar_id to a look and keeps group consent separate", () => {
  const profile = readFileSync(new URL("../docs/ai-media-studio/heygen-v3-provider-profile.md", import.meta.url), "utf8");
  assert.match(profile, /GET `?\/v3\/avatars\/looks/u);
  assert.match(profile, /look ID as the `avatar_id`/u);
  assert.match(profile, /parent group is separately resolved/u);
  assert.match(profile, /Group identity alone can never satisfy render-resource verification/u);
});

test("static disconnected/unverified metadata is explicitly not_requested even when resources make binding stale", () => {
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "stale", credentialSource: "static_api_key",
    accountStatus: "disconnected", credentialStatus: "unverified" }), "not_requested");
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "invalid", credentialSource: "static_api_key",
    accountStatus: "disconnected", credentialStatus: "unverified" }), "unavailable");
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "current", credentialSource: "static_api_key",
    accountStatus: "active", credentialStatus: "active", staticVerification: "verified" }), "verified");
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "current", credentialSource: "static_api_key",
    accountStatus: "active", credentialStatus: "active", staticVerification: "stale" }), "stale");
  assert.equal(derivePersistedProviderVerificationState({ bindingState: "current", credentialSource: "static_api_key",
    accountStatus: "active", credentialStatus: "revoked", staticVerification: "verified" }), "failed");
});

test("repository projects exact PR29 static HeyGen account, avatar, and voice evidence as verified without enabling execution", async () => {
  const fake = new FakeOneVideoReadModelDatabase();
  const control = await new DrizzleOneVideoExecutionControlRepository(fake).observe(scope, planId, slotId);
  assert.ok(control);
  assert.equal(control.providerVerification.state, "verified");
  assert.equal(control.providerVerification.observedAt, verifiedAt.toISOString());
  assert.equal(control.providerVerification.expiresAt, verificationExpiresAt.toISOString());
  assert.equal(control.binding.state, "current");
  assert.deepEqual(control.execute.reasonCodes, [
    "maximum_quote_missing", "human_approval_not_requested", "one_shot_executor_not_installed",
  ]);
  assert.ok(Object.values(control.effects).every((effect) => effect === false));
  assert.equal(control.execute.postAvailable, false);
  assert.equal(control.canGenerate || control.spendAuthorized || control.authoritativeForAdmission, false);
  assert.ok(fake.queries.some((query) => /avatar_evidence\.avatar_look_status='completed'/iu.test(query)));
  assert.ok(fake.queries.some((query) => /avatar_evidence\.avatar_group_id_digest<>avatar_evidence\.avatar_look_id_digest/iu.test(query)));
  assert.ok(fake.queries.some((query) => /voice_evidence\.voice_id_digest=voice_evidence\.provider_resource_external_id_digest/iu.test(query)));
});

test("read model exposes opaque quote/render keys only for the exact latest quote-bound human approval", async () => {
  const metadata = approvedMetadata();
  const renderSpecDigest = deriveLaunchRenderSpecDigest({ providerAccountId: accountId, providerKey: "heygen",
    providerCredentialVersion: 1, avatarResourceId: avatarId, voiceResourceId: voiceId,
    scriptVariantId: variantId, scriptVariantChecksum: metadata.selectedVariantChecksum });
  const quoteId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const humanId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const quoteExpiresAt = new Date("2026-07-22T12:30:00.000Z");
  const exact = {
    intent_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", launch_intent_digest: sha256("intent"), intent_current: true,
    quote_id: quoteId, quote_decision: "quoted", quote_amount: "1250000", quote_currency: "USD",
    quote_valid_from: verifiedAt, quote_expires_at: quoteExpiresAt, quote_revision: 1,
    quote_evidence_digest: sha256("quote-1"), quote_current: true,
    human_id: humanId, human_decision: "approved", human_valid_from: verifiedAt,
    human_expires_at: quoteExpiresAt, human_revision: 1, human_evidence_digest: sha256("human-1"),
    human_current: true, approval_bridge_id: "12121212-1212-4212-8212-121212121212",
    bridge_render_spec_digest: renderSpecDigest, bridge_quote_expires_at: quoteExpiresAt,
    bridge_quote_amount: "1250000", bridge_quote_currency: "USD", bridge_decision: "approved",
    approval_binding_digest: sha256("bridge-1"), approval_bridge_current: true,
  };
  const control = await new DrizzleOneVideoExecutionControlRepository(
    new FakeOneVideoReadModelDatabase({}, exact),
  ).observe(scope, planId, slotId);
  assert.ok(control);
  assert.equal(control.maximumQuote.state, "quoted");
  assert.match(control.maximumQuote.quoteKey ?? "", /^quote_[a-f0-9]{24}$/u);
  assert.match(control.maximumQuote.renderSpecKey ?? "", /^render_spec_[a-f0-9]{24}$/u);
  assert.equal(control.humanApproval.state, "approved");
  assert.equal(control.humanApproval.approvedQuoteKey, control.maximumQuote.quoteKey);
  assert.equal(control.humanApproval.renderSpecKey, control.maximumQuote.renderSpecKey);
  assert.deepEqual(control.execute.reasonCodes, ["one_shot_executor_not_installed"]);

  const newerQuote = await new DrizzleOneVideoExecutionControlRepository(new FakeOneVideoReadModelDatabase({}, {
    ...exact, quote_id: "13131313-1313-4313-8313-131313131313", quote_revision: 2,
    quote_evidence_digest: sha256("quote-2"), approval_bridge_current: false,
  })).observe(scope, planId, slotId);
  assert.ok(newerQuote);
  assert.equal(newerQuote.maximumQuote.state, "quoted");
  assert.notEqual(newerQuote.maximumQuote.quoteKey, control.maximumQuote.quoteKey);
  assert.deepEqual(newerQuote.humanApproval, {
    state: "stale", evidenceKey: newerQuote.humanApproval.evidenceKey,
    observedAt: verifiedAt.toISOString(), expiresAt: quoteExpiresAt.toISOString(),
  });
  assert.equal(newerQuote.humanApproval.approvedQuoteKey, undefined);
  assert.ok(newerQuote.execute.reasonCodes.includes("human_approval_stale"));
});

test("repository marks static HeyGen verification stale when PR29 evidence is expired, missing, or resource pointers misalign", async () => {
  for (const override of [
    { staticVerificationCurrent: false, staticVerificationExpiresAt: new Date("2026-07-22T11:59:00.000Z") },
    { staticVerificationCurrent: false },
    { nativeResourceIdsCurrent: false },
    { staticVerificationHeaderId: null, staticVerificationCurrent: false,
      staticVerificationObservedAt: null, staticVerificationExpiresAt: null },
  ] satisfies StaticProjectionOverride[]) {
    const control = await new DrizzleOneVideoExecutionControlRepository(
      new FakeOneVideoReadModelDatabase(override),
    ).observe(scope, planId, slotId);
    assert.ok(control);
    assert.equal(control.providerVerification.state, "stale");
    assert.ok(control.execute.reasonCodes.includes("provider_verification_stale"));
    assert.ok(control.execute.reasonCodes.includes("one_shot_executor_not_installed"));
  }
});

test("repository preserves static disconnected/unverified provider verification as not requested", async () => {
  const control = await new DrizzleOneVideoExecutionControlRepository(new FakeOneVideoReadModelDatabase({
    accountStatus: "disconnected",
    credentialStatus: "unverified",
    credentialExpiresAt: null,
    avatarStatus: "pending_verification",
    voiceStatus: "pending_verification",
    staticVerificationHeaderId: null,
    staticVerificationCurrent: false,
    staticVerificationObservedAt: null,
    staticVerificationExpiresAt: null,
  })).observe(scope, planId, slotId);
  assert.ok(control);
  assert.equal(control.binding.state, "stale");
  assert.equal(control.providerVerification.state, "not_requested");
  assert.ok(control.execute.reasonCodes.includes("binding_stale"));
  assert.ok(control.execute.reasonCodes.includes("provider_verification_not_requested"));
});

test("route surface is GET-only and installs no prepare, execute, generate, or retry mutation for the exact slot", () => {
  const routes = readFileSync(new URL("../server/ai-media-studio/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /router\.get\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/production-batches\/:planId\/one-video-execution-control\/:slotId`/u);
  assert.doesNotMatch(routes, /router\.post\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/production-batches\/:planId\/one-video-execution-control/u);
  assert.doesNotMatch(routes, /one-video-execution-control\/:slotId\/(?:prepare|execute|generate|retry)/u);
});

async function getWithBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "x-test-user": "owner", "content-type": "application/json",
      "content-length": "2" } }, (res) => { res.resume(); res.once("end", () => resolve(res.statusCode ?? 0)); });
    req.once("error", reject); req.end("{}");
  });
}

async function routeHarness() {
  const { createAiMediaStudioRuntime } = await import("../server/ai-media-studio/routes");
  const previous = process.env.ALLOW_DEV_USER_FALLBACK; process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const calls: unknown[] = []; const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const runtime = createAiMediaStudioRuntime({ repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()], defaultProviderKey: "fake", runtimeEnvironment: "test",
    oneVideoExecutionControlRepository: { observe: async (...args) => { calls.push(args); return packet(); } },
    operations: { runtimeEnvironment: "test" } });
  app.use(runtime.router); const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, calls, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("authenticated GET is exact, bodyless, queryless, no-store, redacted, and has no execution POST", async (t) => {
  let server: Awaited<ReturnType<typeof routeHarness>>;
  try { server = await routeHarness(); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-execution-control/${slotId}`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-test-user": "owner" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert.doesNotMatch(body, /providerAccountId|externalResourceId|secretRef|actorUserId|evidenceDigest|sha256:/iu);
  assert.deepEqual(server.calls, [[scope, planId, slotId]]);
  assert.equal(await getWithBody(url), 400);
  assert.equal((await fetch(`${url}?execute=true`, { headers: { "x-test-user": "owner" } })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: { "x-test-user": "owner" } })).status, 404);
});
