import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createDrizzleHeyGenRosterAccountResolver,
  DrizzleHeyGenRosterRepository,
  type HeyGenRosterDatabase,
} from "../server/ai-media-studio/providers/drizzle-heygen-roster-repository";
import { HeyGenRosterError } from "../server/ai-media-studio/providers/heygen-roster-contracts";
import { HeyGenRosterService } from "../server/ai-media-studio/providers/heygen-roster-service";

type Compiled = { text: string; params: unknown[] };

class FakeRosterDatabase {
  readonly queries: Compiled[] = [];
  transactionCalls = 0;
  configuration: Record<string, unknown> = {};
  influencerCollisionPersona: Record<string, unknown> | undefined;
  failSlotNumber: number | undefined;
  private readonly dialect = new PgDialect();
  private resourceSequence = 0;
  private plan: Record<string, unknown> | undefined;
  private readonly slots: Record<string, unknown>[] = [];

  async execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/gu, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    if (/SELECT id, credential_version FROM .*ai_media_provider_accounts/iu.test(entry.text)) {
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", credential_version: 3 }] };
    }
    if (/SELECT id, credential_version, credential_status, configuration/iu.test(entry.text)) {
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", credential_version: 3,
        credential_status: "unverified", configuration: this.configuration }] };
    }
    if (/SELECT observed_at, .* AS plan_date FROM \(SELECT clock_timestamp\(\)/iu.test(entry.text)) {
      return { rows: [{ observed_at: new Date("2026-07-21T15:00:00.000Z"), plan_date: "2026-07-21" }] };
    }
    if (/^UPDATE .*ai_media_provider_resources/iu.test(entry.text)) return { rows: [] };
    if (/^INSERT INTO .*ai_media_provider_resources/iu.test(entry.text)) {
      this.resourceSequence += 1;
      return { rows: [{ id: `00000000-0000-4000-8000-${String(this.resourceSequence).padStart(12, "0")}` }] };
    }
    if (/^INSERT INTO .*ai_media_influencers/iu.test(entry.text)) {
      if (this.influencerCollisionPersona) return { rows: [] };
      return { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] };
    }
    if (/^SELECT id, persona FROM .*ai_media_influencers/iu.test(entry.text)) {
      return { rows: [{ id: "22222222-2222-4222-8222-222222222222", persona: this.influencerCollisionPersona }] };
    }
    if (/^UPDATE .*ai_media_influencers/iu.test(entry.text)) {
      return { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] };
    }
    if (/^UPDATE .*ai_media_provider_accounts/iu.test(entry.text)) {
      const serialized = entry.params.find((value) => typeof value === "string" && value.includes("\"activeRosterId\""));
      assert.equal(typeof serialized, "string");
      this.configuration = { ...this.configuration, aiMediaStudioHeyGenRosterV1: JSON.parse(serialized as string) };
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
    }
    if (/^INSERT INTO .*ai_media_daily_plans/iu.test(entry.text)) {
      this.plan = {
        id: entry.params[0], public_plan_key: entry.params[3], provider_account_id: entry.params[4],
        provider_credential_version: entry.params[5], source_roster_key: entry.params[6],
        source_roster_digest: entry.params[7], plan_date: entry.params[8], accounting_time_zone: entry.params[9],
        planned_slot_count: entry.params[10], plan_digest: entry.params[13], created_at: entry.params[14],
        plan_status: "blocked",
      };
      return { rows: [{ id: entry.params[0] }] };
    }
    if (/^INSERT INTO .*ai_media_daily_plan_slots/iu.test(entry.text)) {
      const videoNumber = Number(entry.params[11]);
      if (this.failSlotNumber === videoNumber) return { rows: [] };
      this.slots.push({
        id: entry.params[0], public_slot_key: entry.params[3], daily_plan_id: entry.params[4],
        source_member_key: entry.params[7], influencer_id: entry.params[8], avatar_resource_id: entry.params[9],
        voice_resource_id: entry.params[10], video_number: videoNumber, slot_digest: entry.params[12],
        slot_status: "blocked",
      });
      return { rows: [{ id: entry.params[0] }] };
    }
    if (/SELECT plans\.id AS daily_plan_id/iu.test(entry.text)) {
      if (!this.plan) return { rows: [] };
      const namespace = (this.configuration.aiMediaStudioHeyGenRosterV1 ?? {}) as Record<string, unknown>;
      const rosters = (namespace.rosters ?? {}) as Record<string, Record<string, unknown>>;
      const roster = rosters[String(this.plan.source_roster_key)];
      const members = Array.isArray(roster?.members) ? roster.members as Record<string, unknown>[] : [];
      return { rows: this.slots.map((slot) => ({
        ...this.plan, ...slot,
        source_roster_key: this.plan!.source_roster_key,
        source_roster_digest: this.plan!.source_roster_digest,
        creator_name: members.find((member) => member.memberId === slot.source_member_key)?.name,
        avatar_external_id: members.find((member) => member.memberId === slot.source_member_key)?.avatarId,
        voice_external_id: members.find((member) => member.memberId === slot.source_member_key)?.voiceId,
      })) };
    }
    if (/SELECT accounting_time_zone FROM .*ai_media_daily_plans/iu.test(entry.text)) {
      return { rows: this.plan ? [{ accounting_time_zone: this.plan.accounting_time_zone }] : [] };
    }
    if (/SELECT id, credential_version, configuration FROM .*ai_media_provider_accounts/iu.test(entry.text)) {
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", credential_version: 3, configuration: this.configuration }] };
    }
    return { rows: [] };
  }

  async transaction<T>(callback: (tx: FakeRosterDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(this);
  }

  asDatabase(): HeyGenRosterDatabase { return this as unknown as HeyGenRosterDatabase; }
}

function request() {
  return {
    idempotencyKey: "launch-roster-0001",
    members: Array.from({ length: 5 }, (_, index) => ({
      name: `Avatar ${index + 1}`,
      avatarId: `native-avatar-${index + 1}`,
      voiceId: "shared-native-voice",
      language: "es-US",
      accent: "Latino",
      gender: "unspecified" as const,
    })),
  };
}

function requestWithCount(count: number, idempotencyKey = `launch-roster-${count}`) {
  return {
    idempotencyKey,
    members: Array.from({ length: count }, (_, index) => ({
      name: `Avatar ${index + 1}`, avatarId: `native-avatar-${index + 1}`,
      voiceId: "shared-native-voice", language: "es-US", accent: "Latino",
      gender: "unspecified" as const,
    })),
  };
}

test("durable roster setup locks the exact pending static account and atomically writes pending resources, influencers and configuration", async () => {
  const fake = new FakeRosterDatabase();
  const db = fake.asDatabase();
  const service = new HeyGenRosterService(
    new DrizzleHeyGenRosterRepository(db),
    createDrizzleHeyGenRosterAccountResolver(db),
    () => "2026-07-21T15:00:00.000Z",
  );
  const configured = await service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, request());
  assert.equal(configured.roster.avatarCount, 5);
  assert.equal(configured.roster.plannedVideoCount, 50);
  assert.equal(fake.transactionCalls, 1);

  const lock = fake.queries.find((query) => /SELECT id, credential_version, credential_status, configuration/iu.test(query.text));
  assert.ok(lock);
  assert.match(lock.text, /owner_user_id/iu);
  assert.match(lock.text, /workspace_id/iu);
  assert.match(lock.text, /provider_key.*heygen/iu);
  assert.match(lock.text, /credential_source.*static_api_key/iu);
  assert.match(lock.text, /credential_status.*unverified/iu);
  assert.match(lock.text, /credential_version/iu);
  assert.match(lock.text, /FOR UPDATE/iu);
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_influencers/iu.test(query.text)).length, 5);
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_provider_resources/iu.test(query.text)).length, 10);
  assert.ok(fake.queries.filter((query) => /^INSERT INTO .*ai_media_provider_resources/iu.test(query.text))
    .every((query) => query.params.includes("pending_verification")));
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_daily_plans/iu.test(query.text)).length, 1);
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_daily_plan_slots/iu.test(query.text)).length, 50);
  const durablePlan = await new DrizzleHeyGenRosterRepository(db).getCurrentDailyPlan({ ownerUserId: "owner-a", workspaceId: "personal" });
  assert.ok(durablePlan);
  assert.equal(durablePlan.planDate, "2026-07-21");
  assert.equal(durablePlan.timeZone, "UTC");
  assert.equal(durablePlan.slots.length, 50);
  assert.equal(durablePlan.slots.every((slot) => slot.status === "not_queued"), true);

  const renderedResponse = JSON.stringify(configured);
  assert.doesNotMatch(renderedResponse, /native-avatar|shared-native-voice|providerAccountId|credentialVersion/iu);
  const voiceMutations = fake.queries.filter((query) => /ai_media_provider_resources/iu.test(query.text) && query.params.includes("voice"));
  assert.ok(voiceMutations.length > 0);
  for (const query of voiceMutations) {
    const canonicalKeys = query.params.filter((value) => typeof value === "string" && value.startsWith("heygen-roster-v1"));
    for (const key of canonicalKeys) {
      assert.doesNotMatch(key, /member_[a-f0-9]{24}/iu, "shared voice canonical keys are generic");
      assert.doesNotMatch(key, /shared-native-voice/iu, "shared voice canonical keys do not expose native IDs");
    }
    const metadata = query.params.filter((value) => typeof value === "string" && value.startsWith("{")).join(" ");
    assert.doesNotMatch(metadata, /member_[a-f0-9]{24}/iu, "shared voice metadata is not owned by one roster member");
    assert.doesNotMatch(metadata, /Avatar [1-5]/iu, "shared voice metadata is stable and generic");
  }
});

test("exact durable replay returns without rewriting catalog rows", async () => {
  const fake = new FakeRosterDatabase();
  const db = fake.asDatabase();
  const service = new HeyGenRosterService(
    new DrizzleHeyGenRosterRepository(db), createDrizzleHeyGenRosterAccountResolver(db),
    () => "2026-07-21T15:00:00.000Z",
  );
  const first = await service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, request());
  const mutationsAfterFirst = fake.queries.filter((query) => /^INSERT INTO .*ai_media_(provider_resources|influencers)/iu.test(query.text)).length;
  const replay = await service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, request());
  assert.deepEqual(replay, first);
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_(provider_resources|influencers)/iu.test(query.text)).length, mutationsAfterFirst);
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_daily_plans/iu.test(query.text)).length, 1);
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_daily_plan_slots/iu.test(query.text)).length, 50);
  assert.equal(fake.transactionCalls, 2);

  const changed = request();
  changed.members[0]!.name = "Changed";
  await assert.rejects(
    service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, changed),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_daily_plans/iu.test(query.text)).length, 1);
});

test("10-avatar Drizzle roster atomically materializes exactly 100 blocked slots without spend or queue side effects", async () => {
  const fake = new FakeRosterDatabase();
  const db = fake.asDatabase();
  const service = new HeyGenRosterService(
    new DrizzleHeyGenRosterRepository(db), createDrizzleHeyGenRosterAccountResolver(db),
    () => "1999-01-01T00:00:00.000Z",
  );
  const response = await service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, requestWithCount(10));
  assert.equal(response.roster.avatarCount, 10);
  assert.equal(response.roster.configuredAt, "2026-07-21T15:00:00.000Z", "DB clock overrides process clock");
  assert.equal(fake.queries.filter((query) => /^INSERT INTO .*ai_media_daily_plan_slots/iu.test(query.text)).length, 100);
  const plan = await new DrizzleHeyGenRosterRepository(db).getCurrentDailyPlan({ ownerUserId: "owner-a", workspaceId: "personal" });
  assert.ok(plan);
  assert.equal(plan.slots.length, 100);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
  const allSql = fake.queries.map((query) => query.text).join("\n");
  assert.doesNotMatch(allSql, /ai_media_(budget_reservations|render_jobs|outbox|provider_submissions|generation_jobs)/iu);
});

test("durable read is tenant-bound and a slot failure prevents roster configuration publication", async () => {
  const fake = new FakeRosterDatabase();
  const db = fake.asDatabase();
  const repository = new DrizzleHeyGenRosterRepository(db);
  const service = new HeyGenRosterService(repository, createDrizzleHeyGenRosterAccountResolver(db));
  await service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, request());
  await assert.rejects(
    repository.getCurrentDailyPlan({ ownerUserId: "owner-b", workspaceId: "personal" }),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );

  const failing = new FakeRosterDatabase();
  failing.failSlotNumber = 10;
  await assert.rejects(
    new HeyGenRosterService(
      new DrizzleHeyGenRosterRepository(failing.asDatabase()),
      createDrizzleHeyGenRosterAccountResolver(failing.asDatabase()),
    ).configure({ ownerUserId: "owner-a", workspaceId: "personal" }, request()),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );
  assert.deepEqual(failing.configuration, {}, "configuration is not published before all slots succeed");
  assert.equal(failing.queries.some((query) => /^UPDATE .*ai_media_provider_accounts/iu.test(query.text)), false);
});

test("restored configuration is validated exactly and corrupt native records fail closed", async () => {
  const fake = new FakeRosterDatabase();
  fake.configuration = {
    aiMediaStudioHeyGenRosterV1: {
      version: 1,
      activeRosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
      rosters: {
        roster_aaaaaaaaaaaaaaaaaaaaaaaa: {
          providerAccountId: "11111111-1111-4111-8111-111111111111",
          credentialVersion: 3,
          rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
          requestDigest: `sha256:${"a".repeat(64)}`,
          idempotencyKey: "launch-roster-0001",
          configuredAt: "2026-07-21T15:00:00.000Z",
          members: [{
            memberId: "member_aaaaaaaaaaaaaaaaaaaaaaaa", name: "Injected", avatarId: "avatar-safe",
            voiceId: "voice-safe", language: "es-US", accent: "Latino", gender: "unspecified",
            secret: "must-not-be-accepted",
          }],
        },
      },
    },
  };
  const repository = new DrizzleHeyGenRosterRepository(fake.asDatabase());
  await assert.rejects(
    repository.getCurrent({ ownerUserId: "owner-a", workspaceId: "personal" }),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );
});

test("a deterministic slug collision never overwrites an unrelated influencer", async () => {
  const fake = new FakeRosterDatabase();
  fake.influencerCollisionPersona = { source: "manual" };
  const db = fake.asDatabase();
  const service = new HeyGenRosterService(
    new DrizzleHeyGenRosterRepository(db), createDrizzleHeyGenRosterAccountResolver(db),
    () => "2026-07-21T15:00:00.000Z",
  );
  await assert.rejects(
    service.configure({ ownerUserId: "owner-a", workspaceId: "personal" }, request()),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );
  assert.equal(fake.queries.some((query) => /^UPDATE .*ai_media_influencers/iu.test(query.text)), false);
});

test("account resolver selects no secret/configuration columns and fails closed on ambiguous accounts", async () => {
  const dialect = new PgDialect();
  let compiled: { sql: string; params: unknown[] } | undefined;
  const resolver = createDrizzleHeyGenRosterAccountResolver({
    async execute(query) {
      compiled = dialect.sqlToQuery(query);
      return { rows: [
        { id: "11111111-1111-4111-8111-111111111111", credential_version: 1 },
        { id: "22222222-2222-4222-8222-222222222222", credential_version: 1 },
      ] };
    },
  });
  assert.equal(await resolver.resolve({ ownerUserId: "owner-a", workspaceId: "personal" }), undefined);
  assert.ok(compiled);
  const normalized = compiled.sql.replace(/\s+/gu, " ");
  assert.match(normalized, /owner_user_id.*workspace_id.*provider_key/iu);
  assert.match(normalized, /status IN \('active', 'connected'\)/iu);
  assert.match(normalized, /credential_source.*static_api_key/iu);
  assert.match(normalized, /credential_status.*unverified/iu);
  assert.doesNotMatch(normalized, /secret_ref|configuration|external_account_id/iu);
});
