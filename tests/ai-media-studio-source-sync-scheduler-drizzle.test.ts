import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleSourceSyncSchedulerRepository,
  type SourceSyncSchedulerDatabase,
} from "../server/ai-media-studio/sources/drizzle-source-sync-scheduler-repository";

interface CompiledQuery { text: string; params: unknown[] }
type Responder = (query: CompiledQuery) => unknown | Promise<unknown>;

class FakeDatabase {
  readonly queries: CompiledQuery[] = [];
  transactionCalls = 0;
  private readonly dialect = new PgDialect();
  constructor(private readonly respond: Responder) {}
  async execute(query: SQL) {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/g, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    return this.respond(entry);
  }
  async transaction<T>(callback: (tx: FakeDatabase) => Promise<T>) {
    this.transactionCalls += 1;
    return callback(this);
  }
  asDrizzle() { return this as unknown as SourceSyncSchedulerDatabase; }
}

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId,
    source_item_id: null,
    run_type: "source_sync_scheduler",
    mode: "scheduled",
    status: "queued",
    state_version: 0,
    run_payload: { version: 1, adapterKey: "kong-owned-catalog", cursor: null, page: 0, cycle: 0, autoPrepareBatch: false },
    idempotency_key: "ams-source-sync-v1:kong-owned-catalog",
    available_at: new Date(1_000),
    lease_owner: null,
    lease_expires_at: null,
    fencing_token: 0,
    attempts: 0,
    max_attempts: 3,
    dead_letter_at: null,
    failure_code: null,
    completed_at: null,
    created_at: new Date(900),
    updated_at: new Date(1_000),
    ...overrides,
  };
}

test("ensure uses one tenant-scoped orchestration row and no migration or downstream table", async () => {
  const fake = new FakeDatabase(() => ({ rows: [row()] }));
  const repository = new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle());
  const task = await repository.ensureTask(scope, { availableAtMs: 1_000, maxAttempts: 3, autoPrepareBatch: false });
  assert.equal(task.payload.adapterKey, "kong-owned-catalog");
  const query = fake.queries[0]!;
  assert.match(query.text, /insert into "ai_media_orchestration_runs"/i);
  assert.match(query.text, /on conflict \(owner_user_id, workspace_id, idempotency_key\) do update/i);
  assert.match(query.text, /status.*completed.*'queued'/i);
  assert.doesNotMatch(query.text, /status.*dead_letter.*'queued'/i);
  assert.match(query.text, /source_item_id.*null/i);
  assert.ok(query.params.includes(scope.ownerUserId));
  assert.ok(query.params.includes(scope.workspaceId));
  assert.ok(query.params.some((part) => typeof part === "string" && part.includes("kong-owned-catalog")));
  assert.doesNotMatch(query.text, /outbox|render|publish|provider|secret|migration/i);
});

test("read-only observation is exact-tenant and never exposes an ambiguous scheduler row", async () => {
  const fake = new FakeDatabase(() => ({ rows: [row({ status: "retry_wait", failure_code: "source_sync_unavailable" })] }));
  const task = await new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle()).observe(scope);
  assert.equal(task?.status, "retry_wait");
  assert.equal(task?.failureCode, "source_sync_unavailable");
  const query = fake.queries[0]!.text;
  assert.match(query, /owner_user_id =/i);
  assert.match(query, /workspace_id =/i);
  assert.match(query, /idempotency_key =/i);
  assert.match(query, /limit 2/i);

  const ambiguous = new FakeDatabase(() => ({ rows: [row(), row({ id: "00000000-0000-4000-8000-000000000002" })] }));
  await assert.rejects(new DrizzleSourceSyncSchedulerRepository(ambiguous.asDrizzle()).observe(scope), /ambiguous/i);
});

test("claim is atomic, due-ordered, SKIP LOCKED and advances a fencing token", async () => {
  const fake = new FakeDatabase((query) => ({ rows: [row({
    status: "leased", attempts: 1, lease_owner: "worker-a", lease_expires_at: new Date(2_000), fencing_token: 1,
  })] }));
  const claimed = await new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle()).claimDue({
    workerId: "worker-a", nowMs: 1_000, leaseDurationMs: 1_000,
  });
  assert.equal(claimed?.fencingToken, 1);
  assert.equal(fake.transactionCalls, 1);
  const query = fake.queries[0]!.text;
  assert.match(query, /status in \('queued', 'retry_wait'\)/i);
  assert.match(query, /for update skip locked/i);
  assert.match(query, /order by available_at, created_at, id/i);
  assert.match(query, /fencing_token = task\.fencing_token \+ 1/i);
  assert.match(query, /task\.owner_user_id = candidate\.owner_user_id/i);
  assert.match(query, /task\.workspace_id = candidate\.workspace_id/i);
});

test("page cursor and terminal completion writes require exact tenant, adapter, worker, fence and unexpired lease", async () => {
  let count = 0;
  const fake = new FakeDatabase(() => ({ rows: [count++ === 0
    ? row({ status: "queued", run_payload: { version: 1, adapterKey: "kong-owned-catalog", cursor: "page-2", page: 1, cycle: 0, autoPrepareBatch: false }, fencing_token: 4 })
    : row({ status: "completed", run_payload: { version: 1, adapterKey: "kong-owned-catalog", cursor: null, page: 0, cycle: 1, autoPrepareBatch: false }, fencing_token: 5, completed_at: new Date(2_000) })] }));
  const repository = new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle());
  await repository.commitPage({ taskId: "task-1", scope, workerId: "worker-a", fencingToken: 4, nowMs: 1_500, nextCursor: "page-2" });
  await repository.completeCycle({ taskId: "task-1", scope, workerId: "worker-b", fencingToken: 5, nowMs: 2_000 });
  for (const query of fake.queries) {
    assert.match(query.text, /owner_user_id =/i);
    assert.match(query.text, /workspace_id =/i);
    assert.match(query.text, /run_payload->>'adapterKey'/i);
    assert.match(query.text, /lease_owner =/i);
    assert.match(query.text, /fencing_token =/i);
    assert.match(query.text, /lease_expires_at >/i);
    assert.match(query.text, /jsonb_build_object/i);
  }
});

test("runtime failures use only safe codes and atomically choose retry_wait or dead_letter", async () => {
  const fake = new FakeDatabase(() => ({ rows: [row({
    status: "dead_letter", attempts: 3, fencing_token: 2, failure_code: "source_sync_unavailable", dead_letter_at: new Date(1_500),
  })] }));
  const failed = await new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle()).fail({
    taskId: "task-1", scope, workerId: "worker-a", fencingToken: 2,
    failureCode: "source_sync_unavailable", retryAtMs: 2_000, nowMs: 1_500,
  });
  assert.equal(failed?.deadLettered, true);
  assert.match(fake.queries[0]!.text, /case when task\.attempts < task\.max_attempts then 'retry_wait' else 'dead_letter'/i);
  assert.doesNotMatch(JSON.stringify(fake.queries), /password|exception message|stack trace/i);
  await assert.rejects(new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle()).fail({
    taskId: "task-1", scope, workerId: "worker-a", fencingToken: 2,
    failureCode: "database password leaked" as never, retryAtMs: 2_000, nowMs: 1_500,
  }), /failure code/i);
});

test("expired lease reconciliation is SKIP LOCKED, tenant-fenced, and never invokes downstream dependencies", async () => {
  const fake = new FakeDatabase(() => ({ rows: [{ id: "task-1" }, { id: "task-2" }] }));
  const count = await new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle()).recoverExpiredLeases(2_000);
  assert.equal(count, 2);
  assert.equal(fake.transactionCalls, 1);
  const query = fake.queries[0]!.text;
  assert.match(query, /status = 'leased'.*lease_expires_at <=/i);
  assert.match(query, /for update skip locked/i);
  assert.match(query, /failure_code = 'lease_expired'/i);
  assert.match(query, /task\.owner_user_id = expired\.owner_user_id/i);
  assert.match(query, /task\.workspace_id = expired\.workspace_id/i);
  assert.doesNotMatch(query, /outbox|render|publish|provider|secret|spend/i);
});

test("strict v1 payload rejects unknown fields instead of accepting an unsafe cursor envelope", async () => {
  const fake = new FakeDatabase(() => ({ rows: [row({
    run_payload: { version: 1, adapterKey: "kong-owned-catalog", cursor: null, page: 0, cycle: 0, autoPrepareBatch: false, providerToken: "unsafe" },
  })] }));
  await assert.rejects(new DrizzleSourceSyncSchedulerRepository(fake.asDrizzle()).ensureTask(scope, {
    availableAtMs: 1_000, maxAttempts: 3, autoPrepareBatch: false,
  }), /Invalid source sync payload/);
});
