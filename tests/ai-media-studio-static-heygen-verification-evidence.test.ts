import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleStaticHeyGenVerificationRepository,
  type StaticHeyGenVerificationDatabase,
} from "../server/ai-media-studio/provider-credentials/drizzle-static-heygen-verification-repository";
import {
  StaticHeyGenVerificationError,
  sha256,
  type StaticHeyGenVerificationCommand,
} from "../server/ai-media-studio/provider-credentials/static-heygen-verification-contracts";
import {
  StaticHeyGenVerificationService,
  prepareStaticHeyGenPassedVerification,
} from "../server/ai-media-studio/provider-credentials/static-heygen-verification-service";

type Compiled = { text: string; params: unknown[] };

const observedAt = "2026-07-22T12:00:00.000Z";
const expiresAt = "2026-07-22T18:00:00.000Z";
const credentialBindingRequestDigest = sha256("credential-binding-request");
const providerRequestDigest = sha256("provider-verification-selection-request");
const accountEvidenceDigest = sha256("account-passed");

function uuid(seed: string): string {
  return `${seed.repeat(32).slice(0, 8)}-${seed.repeat(32).slice(0, 4)}-4${seed.repeat(32).slice(0, 3)}-8${seed.repeat(32).slice(0, 3)}-${seed.repeat(32).slice(0, 12)}`;
}

function command(overrides: Partial<StaticHeyGenVerificationCommand> = {}): StaticHeyGenVerificationCommand {
  const avatars = Array.from({ length: 5 }, (_, index) => {
    const look = `avatar-look-${index + 1}`;
    return {
      avatarLookId: look,
      lookIdDigest: sha256(look),
      groupIdDigest: sha256(`avatar-group-${index + 1}`),
      lookStatus: "completed" as const,
      groupStatus: "completed" as const,
      groupConsentStatus: "approved" as const,
      supportedEngines: ["avatar_iv"] as const,
      evidenceDigest: sha256(`avatar-evidence-${index + 1}`),
    };
  });
  return {
    verificationId: "11111111-1111-4111-8111-111111111111",
    scope: { ownerUserId: "owner-a", workspaceId: "personal" },
    actorUserId: "operator-a",
    providerAccountId: "22222222-2222-4222-8222-222222222222",
    staticCredentialBindingId: "33333333-3333-4333-8333-333333333333",
    providerCredentialVersion: 3,
    credentialBindingRequestDigest,
    dailyPlanId: "44444444-4444-4444-8444-444444444444",
    sourceRosterKey: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    sourceRosterDigest: sha256("roster"),
    planDigest: sha256("plan"),
    policyExpiresAt: expiresAt,
    idempotencyKey: "heygen-static-verification-001",
    providerOutcome: {
      kind: "passed",
      providerKey: "heygen",
      providerAccountId: "22222222-2222-4222-8222-222222222222",
      providerCredentialVersion: 3,
      observedAt,
      billingModel: "subscription",
      avatarLookCount: 5,
      voiceCount: 1,
      requestDigest: providerRequestDigest,
      accountEvidenceDigest,
      avatars,
      voices: [{
        voiceId: "voice-main",
        voiceIdDigest: sha256("voice-main"),
        language: "English",
        supportPause: true,
        supportLocale: true,
        supportInteractiveAvatar: false,
        evidenceDigest: sha256("voice-evidence"),
      }],
      evidenceDigest: sha256("provider-passed"),
    },
    ...overrides,
  };
}

class FakeDatabase {
  readonly queries: Compiled[] = [];
  readonly resources = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: uuid(String(index + 5)), resource_type: "avatar", external_resource_id: `avatar-look-${index + 1}`,
      status: "pending_verification", verified_credential_version: null, verification_header_id: null,
    })),
    {
      id: uuid("a"), resource_type: "voice", external_resource_id: "voice-main",
      status: "pending_verification", verified_credential_version: null, verification_header_id: null,
    },
  ];
  transactionConfig: unknown;
  header: Record<string, unknown> | undefined;
  resourceEvidence = 0;
  resourceUpdates = 0;
  accountUpdates = 0;
  private readonly dialect = new PgDialect();

  async execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/gu, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    if (/SELECT transaction_timestamp\(\) AS observed_at/iu.test(entry.text)) {
      return { rows: [{ observed_at: new Date("2026-07-22T12:01:00.000Z") }] };
    }
    if (/FROM .*ai_media_static_heygen_verification_headers.*FOR UPDATE/iu.test(entry.text)) {
      return { rows: this.header ? [this.header] : [] };
    }
    if (/FROM .*ai_media_provider_accounts.*ai_media_static_credential_bindings.*ai_media_daily_plans/iu.test(entry.text)) {
      return { rows: [{
        account_status: "disconnected", credential_status: "unverified", credential_source: "static_api_key",
        credential_version: 3, binding_id: "33333333-3333-4333-8333-333333333333",
        target_credential_version: 3, request_digest: credentialBindingRequestDigest,
        lifecycle_state: "pending", binding_verification_state: "unverified",
        daily_plan_id: "44444444-4444-4444-8444-444444444444",
        source_roster_key: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
        source_roster_digest: sha256("roster"), plan_digest: sha256("plan"),
        provider_credential_version: 3, plan_status: "blocked", planned_slot_count: 50,
      }] };
    }
    if (/WITH exact_slots AS/iu.test(entry.text)) {
      return { rows: [{
        total_slots: 50, avatar_count: 5, voice_count: 1, avatar_video_pairs: 50,
        all_blocked: true, video_numbers_bounded: true, every_avatar_has_ten: true,
      }] };
    }
    if (/SELECT resources\.id,resources\.resource_type,resources\.external_resource_id/iu.test(entry.text)) {
      assert.doesNotMatch(entry.text, /SELECT DISTINCT[\s\S]*FOR UPDATE/iu);
      assert.match(entry.text, /resources\.id IN \([\s\S]*UNION[\s\S]*voice_resource_id/iu);
      return { rows: this.resources };
    }
    if (/^INSERT INTO .*ai_media_static_heygen_verification_headers/iu.test(entry.text)) {
      this.header = {
        id: entry.params[0], evidence_digest: entry.params[15], input_digest: entry.params[16],
        provider_credential_version: entry.params[6], observed_at: new Date(observedAt), expires_at: new Date(expiresAt),
      };
      return { rows: [{ id: entry.params[0] }] };
    }
    if (/^INSERT INTO .*ai_media_static_heygen_resource_verifications/iu.test(entry.text)) {
      this.resourceEvidence += 1;
      assert.doesNotMatch(JSON.stringify(entry.params), /avatar-look-|voice-main|avatar-group-/u);
      return { rows: [{ id: entry.params[0] }] };
    }
    if (/^UPDATE .*ai_media_provider_resources/iu.test(entry.text)) {
      this.resourceUpdates += 1;
      return { rows: [{ id: entry.params[10] }] };
    }
    if (/^UPDATE .*ai_media_provider_accounts/iu.test(entry.text)) {
      this.accountUpdates += 1;
      return { rows: [{ id: entry.params[7] }] };
    }
    return { rows: [] };
  }

  async transaction<T>(callback: (tx: FakeDatabase) => Promise<T>, config?: unknown): Promise<T> {
    this.transactionConfig = config;
    return callback(this);
  }

  database(): StaticHeyGenVerificationDatabase {
    return this as unknown as StaticHeyGenVerificationDatabase;
  }
}

test("service prepares actual HeyGen V3 passed outcomes without conflating request digests", () => {
  const prepared = prepareStaticHeyGenPassedVerification(command());
  assert.equal(prepared.verificationRequestDigest, providerRequestDigest);
  assert.equal(prepared.credentialBindingRequestDigest, credentialBindingRequestDigest);
  assert.notEqual(prepared.verificationRequestDigest, prepared.credentialBindingRequestDigest);
  assert.equal(prepared.resources.filter((resource) => resource.resourceType === "avatar").length, 5);
  assert.equal(prepared.resources.find((resource) => resource.resourceType === "voice")?.language, "English");
  assert.equal(prepared.resources.some((resource) => "providerResourceId" in resource), false);
});

test("repository records passed evidence in one serializable transaction and projects active pointers", async () => {
  const fake = new FakeDatabase();
  const receipt = await new StaticHeyGenVerificationService(
    new DrizzleStaticHeyGenVerificationRepository(fake.database()),
  ).recordPassed(command());
  assert.equal(receipt.outcome, "recorded");
  assert.equal(receipt.verification.avatarCount, 5);
  assert.equal(receipt.verification.voiceCount, 1);
  assert.deepEqual(fake.transactionConfig, { isolationLevel: "serializable", accessMode: "read write" });
  assert.equal(fake.resourceEvidence, 6);
  assert.equal(fake.resourceUpdates, 6);
  assert.equal(fake.accountUpdates, 1);
  const headerInsert = fake.queries.find((query) => /^INSERT INTO .*ai_media_static_heygen_verification_headers/iu.test(query.text));
  assert.ok(headerInsert);
  assert.ok(headerInsert.params.includes(providerRequestDigest));
  assert.ok(headerInsert.params.includes(credentialBindingRequestDigest));
  assert.doesNotMatch(JSON.stringify(headerInsert.params), /avatar-look-|voice-main|avatar-group-/u);

  const mutationCount = fake.queries.filter((query) => /^(INSERT|UPDATE)/iu.test(query.text)).length;
  const replay = await new DrizzleStaticHeyGenVerificationRepository(fake.database())
    .recordPassed(prepareStaticHeyGenPassedVerification(command()));
  assert.equal(replay?.outcome, "replayed");
  assert.equal(fake.queries.filter((query) => /^(INSERT|UPDATE)/iu.test(query.text)).length, mutationCount);
});

test("verification fails closed for duplicate, extra, future, expired, and rotated evidence", async () => {
  const base = command();
  assert.throws(
    () => prepareStaticHeyGenPassedVerification({
      ...base,
      providerOutcome: { ...base.providerOutcome, avatars: [
        ...base.providerOutcome.avatars.slice(0, 4),
        base.providerOutcome.avatars[0]!,
      ] },
    }),
    StaticHeyGenVerificationError,
  );
  assert.throws(
    () => prepareStaticHeyGenPassedVerification({
      ...base,
      policyExpiresAt: "2026-07-23T13:00:00.000Z",
    }),
    StaticHeyGenVerificationError,
  );
  const future = new FakeDatabase();
  await assert.rejects(
    () => new DrizzleStaticHeyGenVerificationRepository(future.database())
      .recordPassed(prepareStaticHeyGenPassedVerification({
        ...base,
        providerOutcome: { ...base.providerOutcome, observedAt: "2026-07-22T12:02:00.000Z" },
        policyExpiresAt: "2026-07-22T13:00:00.000Z",
      })),
    StaticHeyGenVerificationError,
  );
  const expired = new FakeDatabase();
  await assert.rejects(
    () => new DrizzleStaticHeyGenVerificationRepository(expired.database())
      .recordPassed(prepareStaticHeyGenPassedVerification({
        ...base,
        providerOutcome: { ...base.providerOutcome, observedAt: "2026-07-22T11:00:00.000Z" },
        policyExpiresAt: "2026-07-22T12:00:00.000Z",
      })),
    StaticHeyGenVerificationError,
  );
  const extra = new FakeDatabase();
  extra.resources.push({
    id: uuid("b"), resource_type: "voice", external_resource_id: "voice-extra",
    status: "pending_verification", verified_credential_version: null, verification_header_id: null,
  });
  await assert.rejects(
    () => new DrizzleStaticHeyGenVerificationRepository(extra.database())
      .recordPassed(prepareStaticHeyGenPassedVerification(base)),
    StaticHeyGenVerificationError,
  );
  const rotated = new FakeDatabase();
  rotated.resources[0]!.verified_credential_version = 4;
  await assert.rejects(
    () => new DrizzleStaticHeyGenVerificationRepository(rotated.database())
      .recordPassed(prepareStaticHeyGenPassedVerification(base)),
    StaticHeyGenVerificationError,
  );
});

test("new static verification files expose no provider call, route, secret, video, spend, or publishing surface", () => {
  const files = [
    "server/ai-media-studio/provider-credentials/static-heygen-verification-contracts.ts",
    "server/ai-media-studio/provider-credentials/static-heygen-verification-service.ts",
    "server/ai-media-studio/provider-credentials/drizzle-static-heygen-verification-repository.ts",
  ].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(files, /fetch\s*\(|axios|resolveForExplicitVerification|HEYGEN_API_KEY|StaticHeyGenApiKey/iu);
  assert.doesNotMatch(files, /router\.|POST \/v3\/videos|createGeneration|reserve|spend|publishing|migration/iu);
  assert.match(files, /serializable/u);
  assert.match(files, /avatar_look_status/u);
  assert.match(files, /avatar_group_consent_status/u);
});
