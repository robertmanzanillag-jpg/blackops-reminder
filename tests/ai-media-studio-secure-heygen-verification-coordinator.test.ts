import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleStaticHeyGenVerificationContextLoader,
  type StaticHeyGenVerificationContextDatabase,
} from "../server/ai-media-studio/provider-credentials/drizzle-static-heygen-verification-context-loader";
import { DrizzleStaticHeyGenVerificationReplayReader } from "../server/ai-media-studio/provider-credentials/drizzle-static-heygen-verification-replay-reader";
import {
  StaticHeyGenLiveVerificationCoordinator,
  StaticHeyGenLiveVerificationError,
  type StaticHeyGenLiveVerificationContext,
} from "../server/ai-media-studio/provider-credentials/static-heygen-verification-coordinator";
import type { StaticHeyGenApiKey } from "../server/ai-media-studio/provider-credentials/static-heygen-secret-resolver";
import {
  sha256,
  type PreparedStaticHeyGenVerificationRecord,
  type StaticHeyGenVerificationRepository,
} from "../server/ai-media-studio/provider-credentials/static-heygen-verification-contracts";
import { StaticHeyGenVerificationService } from "../server/ai-media-studio/provider-credentials/static-heygen-verification-service";
import type {
  HeyGenV3StaticVerificationCommand,
  HeyGenV3StaticVerificationOutcome,
} from "../server/ai-media-studio/providers/heygen-v3-static-verification-contracts";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" };
const observedAt = "2026-07-22T12:00:00.000Z";
const accountId = "11111111-1111-4111-8111-111111111111";
const bindingId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const SECRET = "a-secret-that-must-never-be-returned";

function uuid(index: number): string {
  const hex = index.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

function context(): StaticHeyGenLiveVerificationContext {
  return {
    scope,
    providerAccountId: accountId,
    providerKey: "heygen",
    providerCredentialVersion: 3,
    accountStatus: "disconnected",
    credentialStatus: "unverified",
    credentialSource: "static_api_key",
    staticCredentialBindingId: bindingId,
    credentialBindingRequestDigest: sha256("binding"),
    bindingLifecycleState: "pending",
    bindingVerificationState: "unverified",
    secretRef: "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY",
    dailyPlanId: planId,
    sourceRosterKey: `roster_${"a".repeat(24)}`,
    sourceRosterDigest: sha256("roster"),
    planDigest: sha256("plan"),
    planStatus: "blocked",
    plannedSlotCount: 50,
    selections: Array.from({ length: 5 }, (_, index) => ({
      avatarLookId: `look-${index + 1}`,
      voiceId: `voice-${index + 1}`,
      expectedVoiceLanguage: "English",
      requiredEngine: "avatar_iv" as const,
    })),
  };
}

function passed(command: HeyGenV3StaticVerificationCommand): HeyGenV3StaticVerificationOutcome {
  return {
    kind: "passed",
    providerKey: "heygen",
    providerAccountId: command.providerAccountId,
    providerCredentialVersion: command.providerCredentialVersion,
    observedAt,
    billingModel: "subscription",
    avatarLookCount: command.selections.length,
    voiceCount: command.selections.length,
    requestDigest: sha256("provider-request"),
    accountEvidenceDigest: sha256("account-evidence"),
    avatars: command.selections.map((selection, index) => ({
      avatarLookId: selection.avatarLookId,
      lookIdDigest: sha256(selection.avatarLookId),
      groupIdDigest: sha256(`group-${index + 1}`),
      lookStatus: "completed",
      groupStatus: "completed",
      groupConsentStatus: "approved",
      supportedEngines: ["avatar_iv"],
      evidenceDigest: sha256(`avatar-evidence-${index + 1}`),
    })),
    voices: command.selections.map((selection, index) => ({
      voiceId: selection.voiceId,
      voiceIdDigest: sha256(selection.voiceId),
      language: "English",
      evidenceDigest: sha256(`voice-evidence-${index + 1}`),
    })),
    evidenceDigest: sha256("provider-evidence"),
  };
}

test("coordinator authorizes before context/secret/provider and persists only a passed GET-only outcome", async () => {
  const order: string[] = [];
  let persisted: PreparedStaticHeyGenVerificationRecord | undefined;
  const repository: StaticHeyGenVerificationRepository = {
    async recordPassed(input) {
      order.push("persist");
      persisted = input;
      return {
        outcome: "recorded",
        verification: {
          verificationKey: "static_heygen_verification_public",
          evidenceKey: "evidence_public",
          providerKey: "heygen",
          providerCredentialVersion: input.providerCredentialVersion,
          verifiedAt: input.observedAt,
          expiresAt: input.expiresAt,
          avatarCount: 5,
          voiceCount: 5,
        },
      };
    },
  };
  const coordinator = new StaticHeyGenLiveVerificationCoordinator({
    authorizer: { async authorize() {
      order.push("authorize");
      return { decision: "authorized", capability: "heygen_static_verification:execute", actorUserId: "operator-a" };
    } },
    replayReader: { async find() { order.push("replay"); return undefined; } },
    contextLoader: { async loadCurrent() { order.push("context"); return context(); } },
    secretResolver: { async resolve(reference) {
      order.push("secret");
      assert.equal(reference, "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY");
      return SECRET as StaticHeyGenApiKey;
    } },
    evidenceService: new StaticHeyGenVerificationService(repository),
    verificationLifetimeMs: 60 * 60 * 1_000,
    providerFactory(options) {
      order.push("provider_construct");
      assert.equal(options.apiKey, SECRET);
      assert.equal(options.providerAccountId, accountId);
      return { async verify(command) { order.push("provider_gets"); return passed(command); } };
    },
  });

  const result = await coordinator.run({ scope, idempotencyKey: "verify-live-0001", authorizationContext: { session: "opaque" } });

  assert.deepEqual(order, ["authorize", "replay", "context", "secret", "provider_construct", "provider_gets", "persist"]);
  assert.equal(result.outcome, "recorded");
  assert.equal("verification" in result && result.verification.avatarCount, 5);
  assert.deepEqual(result.effects, {
    providerNetworkCall: true, liveVerification: true, generation: false, admission: false,
    spend: false, deployment: false, migrationApply: false, publishing: false,
  });
  assert.ok(persisted);
  assert.equal(persisted.actorUserId, "operator-a");
  assert.equal(persisted.expiresAt, "2026-07-22T13:00:00.000Z");
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(JSON.stringify(persisted).includes(SECRET), false);
});

test("denied authorization prevents context, secret, provider and persistence access", async () => {
  const calls = { context: 0, secret: 0, provider: 0, persistence: 0 };
  const coordinator = new StaticHeyGenLiveVerificationCoordinator({
    authorizer: { async authorize() { return undefined; } },
    replayReader: { async find() { throw new Error("must not read replay"); } },
    contextLoader: { async loadCurrent() { calls.context += 1; return context(); } },
    secretResolver: { async resolve() { calls.secret += 1; return SECRET as StaticHeyGenApiKey; } },
    evidenceService: new StaticHeyGenVerificationService({ async recordPassed() {
      calls.persistence += 1; return undefined;
    } }),
    providerFactory() { calls.provider += 1; return { async verify(command) { return passed(command); } }; },
  });
  await assert.rejects(
    coordinator.run({ scope, idempotencyKey: "verify-live-0002", authorizationContext: null }),
    (error: unknown) => error instanceof StaticHeyGenLiveVerificationError && error.code === "UNAUTHORIZED",
  );
  assert.deepEqual(calls, { context: 0, secret: 0, provider: 0, persistence: 0 });
});

test("provider failure is sanitized and never activates or persists evidence", async () => {
  let persisted = 0;
  const coordinator = new StaticHeyGenLiveVerificationCoordinator({
    authorizer: { async authorize() {
      return { decision: "authorized", capability: "heygen_static_verification:execute", actorUserId: "operator-a" };
    } },
    replayReader: { async find() { return undefined; } },
    contextLoader: { async loadCurrent() { return context(); } },
    secretResolver: { async resolve() { return SECRET as StaticHeyGenApiKey; } },
    evidenceService: new StaticHeyGenVerificationService({ async recordPassed() { persisted += 1; return undefined; } }),
    providerFactory() { return { async verify(command) {
      return {
        kind: "failed", providerKey: "heygen", providerAccountId: command.providerAccountId,
        providerCredentialVersion: command.providerCredentialVersion, observedAt,
        failureCode: "provider_unauthorized", requestDigest: sha256("request"), evidenceDigest: sha256("failure"),
      };
    } }; },
  });
  const result = await coordinator.run({ scope, idempotencyKey: "verify-live-0003", authorizationContext: {} });
  assert.equal(result.outcome, "provider_failed");
  assert.equal("failureCode" in result && result.failureCode, "provider_unauthorized");
  assert.equal(persisted, 0);
  assert.deepEqual(result.effects, {
    providerNetworkCall: true, liveVerification: false, generation: false, admission: false,
    spend: false, deployment: false, migrationApply: false, publishing: false,
  });
});

test("exact replay returns immutable receipt before context, secret or provider I/O", async () => {
  const calls: string[] = [];
  const coordinator = new StaticHeyGenLiveVerificationCoordinator({
    authorizer: { async authorize() {
      calls.push("authorize");
      return { decision: "authorized", capability: "heygen_static_verification:execute", actorUserId: "operator-a" };
    } },
    replayReader: { async find(readScope, key) {
      calls.push("replay");
      assert.deepEqual(readScope, scope);
      assert.equal(key, "verify-live-replay");
      return {
        outcome: "replayed",
        verification: {
          verificationKey: "verification_public",
          evidenceKey: "evidence_public",
          providerKey: "heygen",
          providerCredentialVersion: 3,
          verifiedAt: observedAt,
          expiresAt: "2026-07-22T18:00:00.000Z",
          avatarCount: 5,
          voiceCount: 5,
        },
      };
    } },
    contextLoader: { async loadCurrent() { calls.push("context"); return context(); } },
    secretResolver: { async resolve() { calls.push("secret"); return SECRET as StaticHeyGenApiKey; } },
    evidenceService: new StaticHeyGenVerificationService({ async recordPassed() {
      calls.push("persist"); return undefined;
    } }),
    providerFactory() { calls.push("provider"); return { async verify(command) { return passed(command); } }; },
  });
  const result = await coordinator.run({ scope, idempotencyKey: "verify-live-replay", authorizationContext: {} });
  assert.equal(result.outcome, "replayed");
  assert.deepEqual(result.effects, {
    providerNetworkCall: false, liveVerification: false, generation: false, admission: false,
    spend: false, deployment: false, migrationApply: false, publishing: false,
  });
  assert.deepEqual(calls, ["authorize", "replay"]);
});

test("Drizzle replay reader reconstructs one redacted immutable receipt", async () => {
  const queries: string[] = [];
  const dialect = new PgDialect();
  const reader = new DrizzleStaticHeyGenVerificationReplayReader({
    async execute(query: SQL) {
      queries.push(dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ").trim());
      return { rows: [{
        id: "44444444-4444-4444-8444-444444444444",
        evidence_digest: sha256("evidence"),
        provider_credential_version: 3,
        observed_at: observedAt,
        expires_at: "2026-07-22T18:00:00.000Z",
        avatar_count: 5,
        voice_count: 3,
      }] };
    },
  });
  const receipt = await reader.find(scope, "verify-live-replay");
  assert.equal(receipt?.outcome, "replayed");
  assert.equal(receipt?.verification.avatarCount, 5);
  assert.equal(receipt?.verification.voiceCount, 3);
  assert.doesNotMatch(JSON.stringify(receipt), /44444444|sha256:/u);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /idempotency_key/u);
  assert.match(queries[0]!, /LIMIT 2/iu);
  assert.doesNotMatch(queries[0]!, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
});

class FakeContextDatabase implements StaticHeyGenVerificationContextDatabase {
  readonly queries: string[] = [];
  transactionConfig: unknown;
  private readonly dialect = new PgDialect();

  constructor(private readonly creatorCount = 5) {}

  async execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> {
    const compiled = this.dialect.sqlToQuery(query);
    const source = compiled.sql.replace(/\s+/gu, " ").trim();
    this.queries.push(source);
    if (/FROM .*ai_media_provider_accounts.*ai_media_static_credential_bindings.*ai_media_daily_plans/iu.test(source)) {
      return { rows: [{
        provider_account_id: accountId, account_status: "disconnected", credential_status: "unverified",
        credential_source: "static_api_key", credential_version: 3,
        secret_ref: "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY", binding_id: bindingId,
        binding_request_digest: sha256("binding"), binding_lifecycle_state: "pending",
        binding_verification_state: "unverified", daily_plan_id: planId,
        source_roster_key: `roster_${"a".repeat(24)}`, source_roster_digest: sha256("roster"),
        plan_digest: sha256("plan"), plan_status: "blocked", planned_slot_count: this.creatorCount * 10,
      }] };
    }
    if (/WITH exact_slots AS/iu.test(source)) {
      return { rows: Array.from({ length: this.creatorCount }, (_, creator) => Array.from({ length: 10 }, (_, video) => ({
        daily_plan_id: planId,
        provider_account_id: accountId,
        provider_key: "heygen",
        provider_credential_version: 3,
        source_member_key: `member_${String(creator + 1).repeat(24).slice(0, 24)}`,
        influencer_id: uuid(100 + creator),
        avatar_resource_id: uuid(200 + creator),
        voice_resource_id: uuid(300 + creator),
        video_number: video + 1,
        status: "blocked",
        avatar_external_id: `look-${creator + 1}`,
        voice_external_id: `voice-${creator + 1}`,
      }))).flat() };
    }
    return { rows: [] };
  }

  async transaction<T>(callback: (tx: FakeContextDatabase) => Promise<T>, config?: unknown): Promise<T> {
    this.transactionConfig = config;
    return callback(this);
  }
}

test("Drizzle loader reads one exact active-roster 5x10 graph in a read-only snapshot", async () => {
  const db = new FakeContextDatabase();
  const loaded = await new DrizzleStaticHeyGenVerificationContextLoader(db).loadCurrent(scope);
  assert.ok(loaded);
  assert.equal(loaded.plannedSlotCount, 50);
  assert.equal(loaded.selections.length, 5);
  assert.deepEqual(loaded.selections.map((selection) => selection.avatarLookId), ["look-1", "look-2", "look-3", "look-4", "look-5"]);
  assert.equal(loaded.selections.some((selection) => selection.expectedVoiceLanguage !== undefined), false);
  assert.deepEqual(db.transactionConfig, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.equal(db.queries.length, 2);
  assert.match(db.queries[0]!, /configuration#>>'\{aiMediaStudioHeyGenRosterV1,activeRosterId\}'/u);
  assert.match(db.queries[0]!, /LIMIT 2/iu);
  assert.match(db.queries[1]!, /LIMIT 101/iu);
  assert.doesNotMatch(db.queries.join(" "), /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
});

test("Drizzle loader accepts the bounded 10x10 upper launch shape", async () => {
  const loaded = await new DrizzleStaticHeyGenVerificationContextLoader(new FakeContextDatabase(10)).loadCurrent(scope);
  assert.ok(loaded);
  assert.equal(loaded.plannedSlotCount, 100);
  assert.equal(loaded.selections.length, 10);
});

test("Drizzle loader rejects incomplete or ambiguous exact graphs", async () => {
  class IncompleteDatabase extends FakeContextDatabase {
    override async execute(query: SQL) {
      const result = await super.execute(query);
      if (result.rows.length === 50) result.rows.pop();
      return result;
    }
  }
  assert.equal(await new DrizzleStaticHeyGenVerificationContextLoader(new IncompleteDatabase()).loadCurrent(scope), undefined);
});

test("HTTP route source stays authenticated, strict, separately authorized and redacted", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/routes.ts", import.meta.url), "utf8");
  const route = source.match(/router\.post\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/provider-configurations\/heygen\/live-verification`[\s\S]*?\n\s*\}\)\);/u)?.[0] ?? "";
  assert.match(route, /getCurrentUserId\(req\)/u);
  assert.match(route, /requireSameOriginJsonAiMediaStudioMutation/u);
  assert.match(route, /Cache-Control[\s\S]*private, no-store/u);
  assert.match(route, /requireStaticHeyGenLiveVerification/u);
  assert.match(route, /runHeyGenLiveVerificationRequestSchema\.safeParse\(req\.body\)/u);
  assert.match(route, /authorizationContext:\s*req/u);
  assert.match(route, /runHeyGenLiveVerificationResponseSchema\.parse/u);
  assert.match(route, /runHeyGenLiveVerificationFailureResponseSchema\.parse/u);
  assert.doesNotMatch(route, /apiKey|secretRef|providerAccountId|avatarLookId|voiceId|fetch\s*\(/u);
  assert.match(source, /if \(!dependencies\.staticHeyGenLiveVerificationAuthorizer\)[\s\S]*explicit server-side live verification authorizer is required/u);
});
