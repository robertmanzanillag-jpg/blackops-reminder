import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleStaticHeyGenCredentialRepository,
  type StaticHeyGenCredentialDatabase,
} from "../server/ai-media-studio/provider-credentials/drizzle-static-heygen-credential-repository";
import {
  DEFAULT_STATIC_HEYGEN_SECRET_REF,
  StaticHeyGenCredentialBindingError,
  deriveStaticHeyGenCredentialRequestDigest,
  type BindStaticHeyGenCredential,
} from "../server/ai-media-studio/provider-credentials/static-heygen-contracts";

type Compiled = { text: string; params: unknown[] };
const now = new Date("2026-07-22T12:00:00.000Z");
const request: BindStaticHeyGenCredential = {
  bindingId: "11111111-1111-4111-8111-111111111111",
  scope: { ownerUserId: "owner-a", workspaceId: "personal" },
  actorUserId: "owner-a",
  providerAccountId: "22222222-2222-4222-8222-222222222222",
  expectedCredentialVersion: 0,
  secretRef: DEFAULT_STATIC_HEYGEN_SECRET_REF,
  idempotencyKey: "heygen-static-bind-0001",
};

class FakeDatabase {
  readonly queries: Compiled[] = [];
  transactionCalls = 0;
  accountVersion = 0;
  credentialSource = "not_bound";
  replay: Record<string, unknown> | undefined;
  private readonly dialect = new PgDialect();

  async execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/gu, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    if (/SELECT id\s*,\s*credential_source\s*,\s*credential_version\s*,\s*status\s*,\s*credential_status/iu.test(entry.text)) {
      return { rows: [{ id: request.providerAccountId, credential_source: this.credentialSource,
        credential_version: this.accountVersion, status: "disconnected", credential_status: "unverified" }] };
    }
    if (/^SELECT \* FROM .*ai_media_static_credential_bindings/iu.test(entry.text)) {
      return { rows: this.replay ? [this.replay] : [] };
    }
    if (/^UPDATE .*ai_media_static_credential_bindings/iu.test(entry.text)) return { rows: [] };
    if (/^INSERT INTO .*ai_media_static_credential_bindings/iu.test(entry.text)) {
      this.replay = {
        id: entry.params[0], owner_user_id: entry.params[1], workspace_id: entry.params[2],
        actor_user_id: entry.params[3], provider_account_id: entry.params[4], provider_key: "heygen",
        expected_credential_version: entry.params[5], target_credential_version: entry.params[6],
        secret_ref: entry.params[7], idempotency_key: entry.params[8],
        request_digest: entry.params[9], lifecycle_state: "pending",
        verification_state: "unverified", created_at: now, updated_at: now, superseded_at: null,
      };
      return { rows: [this.replay] };
    }
    if (/^UPDATE .*ai_media_provider_accounts"? SET/iu.test(entry.text)) {
      this.accountVersion += 1;
      this.credentialSource = "static_api_key";
      return { rows: [{ id: request.providerAccountId }] };
    }
    return { rows: [] };
  }

  async transaction<T>(callback: (tx: FakeDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(this);
  }

  database(): StaticHeyGenCredentialDatabase { return this as unknown as StaticHeyGenCredentialDatabase; }
}

test("durable static bind is tenant-scoped, CAS fenced and starts disconnected/unverified", async () => {
  const fake = new FakeDatabase();
  const result = await new DrizzleStaticHeyGenCredentialRepository(fake.database()).bind(request);
  assert.equal(result?.outcome, "created", JSON.stringify(fake.queries));
  assert.equal(result?.binding.credentialVersion, 1);
  assert.equal(result?.binding.lifecycleState, "pending");
  assert.equal(result?.binding.verificationState, "unverified");
  assert.equal(fake.transactionCalls, 1);
  const accountLock = fake.queries[0]!;
  assert.match(accountLock.text, /owner_user_id.*workspace_id.*provider_key.*FOR UPDATE/iu);
  const accountUpdate = fake.queries.find((query) => /^UPDATE .*ai_media_provider_accounts"? SET/iu.test(query.text));
  assert.ok(accountUpdate);
  assert.match(accountUpdate.text, /credential_source.*static_api_key/iu);
  assert.match(accountUpdate.text, /credential_status.*unverified.*status.*disconnected/iu);
  assert.match(accountUpdate.text, /credential_version.*AND status.*AND credential_status.*AND credential_source/iu);
  assert.doesNotMatch(accountUpdate.text, /credential_status='active'|last_verified_at=[^N]/iu);
});

test("same idempotency key replays exact evidence without a second mutation", async () => {
  const fake = new FakeDatabase();
  const repository = new DrizzleStaticHeyGenCredentialRepository(fake.database());
  assert.equal((await repository.bind(request))?.outcome, "created");
  const mutationCount = fake.queries.filter((query) => /^INSERT|^UPDATE/iu.test(query.text)).length;
  assert.equal((await repository.bind(request))?.outcome, "replayed");
  assert.equal(fake.queries.filter((query) => /^INSERT|^UPDATE/iu.test(query.text)).length, mutationCount);
});

test("idempotency collision and stale credential version fail closed", async () => {
  const fake = new FakeDatabase();
  const repository = new DrizzleStaticHeyGenCredentialRepository(fake.database());
  await repository.bind(request);
  await assert.rejects(
    () => repository.bind({ ...request, bindingId: "33333333-3333-4333-8333-333333333333" }),
    StaticHeyGenCredentialBindingError,
  );
  fake.replay = undefined;
  assert.equal(await repository.bind({ ...request, bindingId: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: "heygen-static-bind-0002", expectedCredentialVersion: 0 }), undefined);
});

test("rotation supersedes the prior pending binding and advances exactly one version", async () => {
  const fake = new FakeDatabase();
  const repository = new DrizzleStaticHeyGenCredentialRepository(fake.database());
  await repository.bind(request);
  fake.replay = undefined;
  const rotated = await repository.bind({
    ...request,
    bindingId: "55555555-5555-4555-8555-555555555555",
    expectedCredentialVersion: 1,
    secretRef: "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_V2",
    idempotencyKey: "heygen-static-bind-0002",
  });
  assert.equal(rotated?.binding.credentialVersion, 2);
  const supersede = fake.queries.find((query) => /^UPDATE .*ai_media_static_credential_bindings/iu.test(query.text));
  assert.ok(supersede);
  assert.match(supersede.text, /lifecycle_state.*superseded.*superseded_at/iu);
});
