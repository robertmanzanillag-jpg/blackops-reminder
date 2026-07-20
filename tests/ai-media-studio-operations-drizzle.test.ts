import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleOutboxRepository,
  type AiMediaOutboxDatabase,
} from "../server/ai-media-studio/operations";

interface CompiledQuery { text: string; params: unknown[] }
type QueryResponder = (query: CompiledQuery) => unknown | Promise<unknown>;

class FakeOutboxDatabase {
  readonly queries: CompiledQuery[] = [];
  transactionCalls = 0;
  private readonly dialect = new PgDialect();

  constructor(private readonly respond: QueryResponder) {}

  async execute(query: SQL): Promise<unknown> {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/g, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    return this.respond(entry);
  }

  async transaction<T>(callback: (tx: FakeOutboxDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
    return callback(this);
  }

  asDrizzle(): AiMediaOutboxDatabase { return this as unknown as AiMediaOutboxDatabase; }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: "tenant-a",
    workspace_id: "workspace-a",
    event_type: "generation.ready",
    payload: { jobId: "job-1" },
    status: "pending",
    attempts: 0,
    available_at: new Date(1_000),
    created_at: new Date(900),
    updated_at: new Date(1_000),
    lease_owner: null,
    lease_expires_at: null,
    fencing_token: null,
    last_error: null,
    processed_at: null,
    dead_letter_at: null,
    ...overrides,
  };
}

test("durable add is tenant/workspace idempotent and maps the existing scoped row", async () => {
  const fake = new FakeOutboxDatabase((query) => {
    if (query.text.startsWith("WITH inserted AS")) return { rows: [row()] };
    return { rows: [] };
  });
  const repository = new DrizzleOutboxRepository(fake.asDrizzle(), {
    ownerUserId: "tenant-a", workspaceId: "workspace-a", maxAttempts: 3,
  });
  const message = await repository.add({
    id: "00000000-0000-4000-8000-000000000001", topic: "generation.ready",
    payload: { jobId: "job-1" }, maxAttempts: 3,
  }, 1_000);
  assert.equal(message.topic, "generation.ready");
  const query = fake.queries[0];
  assert.match(query.text, /ON CONFLICT \(owner_user_id, workspace_id, idempotency_key\) DO NOTHING/i);
  assert.match(query.text, /existing\.owner_user_id =/i);
  assert.match(query.text, /existing\.workspace_id =/i);
  assert.ok(query.params.includes("tenant-a"));
  assert.ok(query.params.includes("workspace-a"));
});

test("concurrent claims use SKIP LOCKED and cannot escape tenant/workspace scope", async () => {
  let claimed = false;
  const fake = new FakeOutboxDatabase(async (query) => {
    if (!query.text.startsWith("WITH candidate AS")) return { rows: [] };
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (claimed) return { rows: [] };
    claimed = true;
    return { rows: [row({
      status: "leased", attempts: 1, lease_owner: "worker-a",
      lease_expires_at: new Date(2_000), fencing_token: 1,
    })] };
  });
  const repository = new DrizzleOutboxRepository(fake.asDrizzle(), {
    ownerUserId: "tenant-a", workspaceId: "workspace-a", maxAttempts: 3,
  });
  const [first, second] = await Promise.all([
    repository.claim({ workerId: "worker-a", limit: 5, leaseDurationMs: 1_000, nowMs: 1_000 }),
    repository.claim({ workerId: "worker-b", limit: 5, leaseDurationMs: 1_000, nowMs: 1_000 }),
  ]);
  assert.equal(first.length + second.length, 1);
  assert.equal(fake.transactionCalls, 2);
  for (const claim of fake.queries.filter((query) => query.text.startsWith("WITH candidate AS"))) {
    assert.match(claim.text, /FOR UPDATE SKIP LOCKED/i);
    assert.match(claim.text, /event\.owner_user_id =/i);
    assert.match(claim.text, /event\.workspace_id =/i);
    assert.match(claim.text, /event\.status IN \('pending', 'retry_wait'\)/i);
    assert.match(claim.text, /event\.dead_letter_at IS NULL/i);
    assert.match(claim.text, /UPDATE "ai_media_outbox" AS event/i);
    assert.ok(claim.params.includes("tenant-a"));
    assert.ok(claim.params.includes("workspace-a"));
  }
});

test("ack and nack require an unexpired matching fencing token and bounded retry", async () => {
  const fake = new FakeOutboxDatabase((query) => {
    if (query.text.includes("SET status = 'dispatched'") && query.params.includes(2)) {
      return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }] };
    }
    if (query.text.includes("SET status = CASE")) {
      return { rows: [row({ status: "dead_letter", attempts: 3, dead_letter_at: new Date(2_000), last_error: "offline" })] };
    }
    return { rows: [] };
  });
  const repository = new DrizzleOutboxRepository(fake.asDrizzle(), {
    ownerUserId: "tenant-a", workspaceId: "workspace-a", maxAttempts: 3,
  });
  assert.equal(await repository.markDispatched({ id: "00000000-0000-4000-8000-000000000001", leaseToken: "1", nowMs: 2_000 }), false);
  assert.equal(await repository.markDispatched({ id: "00000000-0000-4000-8000-000000000001", leaseToken: "2", nowMs: 2_000 }), true);
  const failed = await repository.recordFailure({
    id: "00000000-0000-4000-8000-000000000001", leaseToken: "2",
    error: "offline", retryAtMs: 3_000, retryable: true, nowMs: 2_000,
  });
  assert.equal(failed?.state, "dead_letter");
  for (const mutation of fake.queries.filter((query) => query.text.startsWith("UPDATE \"ai_media_outbox\" AS event"))) {
    assert.match(mutation.text, /event\.owner_user_id =/i);
    assert.match(mutation.text, /event\.workspace_id =/i);
    assert.match(mutation.text, /event\.lease_expires_at >/i);
    assert.match(mutation.text, /event\.fencing_token =/i);
    assert.doesNotMatch(mutation.text, /fencing_token = NULL/i, "the non-null monotonic fence is preserved after release");
  }
  const nack = fake.queries.find((query) => query.text.includes("SET status = CASE"));
  assert.ok(nack);
  assert.match(nack.text, /event\.attempts </i);
  assert.match(nack.text, /dead_letter_at = CASE/i);
});

test("expired lease recovery is scoped, locked, and dead-letters exhausted attempts", async () => {
  const fake = new FakeOutboxDatabase((query) => query.text.startsWith("WITH expired AS")
    ? { rows: [{ id: "one" }, { id: "two" }] }
    : { rows: [] });
  const repository = new DrizzleOutboxRepository(fake.asDrizzle(), {
    ownerUserId: "tenant-a", workspaceId: "workspace-a", maxAttempts: 3,
  });
  assert.equal(await repository.reconcileExpiredLeases(5_000), 2);
  const query = fake.queries[0];
  assert.match(query.text, /FOR UPDATE SKIP LOCKED/i);
  assert.match(query.text, /event\.attempts >=/i);
  assert.match(query.text, /THEN 'dead_letter' ELSE 'retry_wait'/i);
  assert.doesNotMatch(query.text, /fencing_token = NULL/i);
  assert.ok(query.params.includes("tenant-a"));
  assert.ok(query.params.includes("workspace-a"));
});
