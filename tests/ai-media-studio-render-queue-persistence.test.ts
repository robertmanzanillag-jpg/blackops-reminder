import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleRenderWorkRepository,
  type AiMediaRenderWorkDatabase,
} from "../server/ai-media-studio/persistence/drizzle-render-work-repository";

interface Payload { title: string; sequence: number }

interface CompiledQuery {
  text: string;
  params: unknown[];
}

type QueryResponder = (query: CompiledQuery) => unknown | Promise<unknown>;

class FakeTransactionalDatabase {
  readonly queries: CompiledQuery[] = [];
  transactionCalls = 0;
  activeTransactions = 0;
  maxActiveTransactions = 0;
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly dialect = new PgDialect();

  constructor(private readonly respond: QueryResponder) {}

  async execute(query: SQL): Promise<unknown> {
    const compiled = this.dialect.sqlToQuery(query);
    const entry = { text: compiled.sql.replace(/\s+/g, " ").trim(), params: compiled.params };
    this.queries.push(entry);
    return this.respond(entry);
  }

  async transaction<T>(callback: (tx: FakeTransactionalDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    this.activeTransactions += 1;
    this.maxActiveTransactions = Math.max(this.maxActiveTransactions, this.activeTransactions);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return await callback(this);
    } finally {
      this.activeTransactions -= 1;
      release();
    }
  }

  asDrizzle(): AiMediaRenderWorkDatabase {
    return this as unknown as AiMediaRenderWorkDatabase;
  }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: "tenant-a",
    workspace_id: "workspace-a",
    provider_account_id: null,
    provider_key: "heygen",
    provider_job_id: null,
    request: { title: "Launch", sequence: 1 },
    result: { __renderQueue: { leaseRecoveries: 0, maxLeaseRecoveries: 3 } },
    stage: "queued",
    attempts: 1,
    max_attempts: 3,
    available_at: new Date(1_000),
    created_at: new Date(900),
    updated_at: new Date(1_000),
    lease_owner: null,
    lease_expires_at: null,
    dead_letter_at: null,
    error_message: null,
    ...overrides,
  };
}

const wideQuotas = {
  maxConcurrentTotal: 10,
  maxConcurrentPerProvider: 5,
  maxConcurrentPerTenant: 2,
  providerLimits: { heygen: 3 },
  tenantLimits: { "tenant-a": 1 },
};

test("enqueue stores independent recovery metadata and maps snake_case PostgreSQL rows", async () => {
  const fake = new FakeTransactionalDatabase((query) => {
    if (query.text.startsWith("INSERT INTO \"ai_media_render_jobs\"")) {
      return { rows: [row({
        result: { priorResult: true, __renderQueue: { leaseRecoveries: 0, maxLeaseRecoveries: 7 } },
      })] };
    }
    return { rows: [] };
  });
  const repository = new DrizzleRenderWorkRepository<Payload>(fake.asDrizzle(), {
    workspaceId: "workspace-a",
    tenantId: "tenant-a",
    providerKeys: ["heygen"],
  });

  const created = await repository.enqueue({
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: "tenant-a",
    providerKey: "heygen",
    payload: { title: "Launch", sequence: 1 },
    maxAttempts: 5,
    maxLeaseRecoveries: 7,
  }, 1_000);

  assert.equal(created.tenantId, "tenant-a");
  assert.equal(created.providerKey, "heygen");
  assert.deepEqual(created.payload, { title: "Launch", sequence: 1 });
  assert.equal(created.leaseRecoveries, 0);
  assert.equal(created.maxLeaseRecoveries, 7);
  const insert = fake.queries[0];
  assert.match(insert.text, /ON CONFLICT \(id\) DO NOTHING RETURNING \*/i);
  assert.ok(insert.params.some((value) => typeof value === "string" && value.includes("maxLeaseRecoveries")));
});

test("admission-held render work is represented honestly and remains outside claim candidates", async () => {
  const fake = new FakeTransactionalDatabase((query) => {
    if (query.text.startsWith("SELECT *")) return { rows: [row({ stage: "admission_held", attempts: 0 })] };
    return { rows: [] };
  });
  const repository = new DrizzleRenderWorkRepository<Payload>(fake.asDrizzle(), {
    workspaceId: "workspace-a", tenantId: "tenant-a", providerKeys: ["heygen"],
  });
  assert.equal((await repository.get("00000000-0000-4000-8000-000000000001"))?.state, "admission_held");
  await repository.claimDue({ workerId: "worker-a", nowMs: 2_000, leaseDurationMs: 1_000, quotas: wideQuotas });
  const claim = fake.queries.find((query) => query.text.includes("WITH active_leases AS MATERIALIZED"));
  assert.ok(claim);
  assert.match(claim.text, /stage IN \('queued', 'retry_wait'\)/i);
  assert.doesNotMatch(claim.text, /stage IN \([^)]*admission_held/i);
});

test("concurrent claims serialize quota accounting and only one fake row is claimed", async () => {
  let claimed = false;
  const fake = new FakeTransactionalDatabase((query) => {
    if (query.text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (query.text.includes("WITH active_leases AS MATERIALIZED")) {
      if (claimed) return { rows: [] };
      claimed = true;
      const leaseToken = query.params.find((value) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value));
      return { rows: [row({
        stage: "leased",
        lease_owner: query.params.includes("worker-a") ? "worker-a" : "worker-b",
        lease_expires_at: new Date(2_000),
        result: { __renderQueue: { leaseToken, leaseRecoveries: 0, maxLeaseRecoveries: 3 } },
      })] };
    }
    return { rows: [] };
  });
  const repository = new DrizzleRenderWorkRepository<Payload>(fake.asDrizzle(), { workspaceId: "workspace-a" });

  const [first, second] = await Promise.all([
    repository.claimDue({ workerId: "worker-a", nowMs: 1_000, leaseDurationMs: 1_000, quotas: wideQuotas }),
    repository.claimDue({ workerId: "worker-b", nowMs: 1_000, leaseDurationMs: 1_000, quotas: wideQuotas }),
  ]);

  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(fake.transactionCalls, 2);
  assert.equal(fake.maxActiveTransactions, 1, "the fake confirms claims cross the same atomic transaction gate");
  const claimSql = fake.queries.find((query) => query.text.includes("WITH active_leases AS MATERIALIZED"));
  assert.ok(claimSql);
  assert.match(claimSql.text, /FOR UPDATE SKIP LOCKED/i);
  assert.match(claimSql.text, /provider_key = job\.provider_key/i);
  assert.match(claimSql.text, /owner_user_id = job\.owner_user_id/i);
  assert.match(claimSql.text, /available_at <=/i);
  assert.match(claimSql.text, /stage IN \('queued', 'retry_wait'\)/i);
  assert.ok(fake.queries.filter((query) => query.text.includes("pg_advisory_xact_lock")).length === 2);
});

test("fencing token and lease expiry protect submitted and failure mutations", async () => {
  const fake = new FakeTransactionalDatabase((query) => {
    if (query.text.includes("SET stage = 'submitted'")) {
      if (query.params.includes("fresh-token")) return { rows: [row({
        stage: "submitted",
        provider_account_id: "00000000-0000-4000-8000-000000000050",
        provider_job_id: "provider-1",
      })] };
      return { rows: [] };
    }
    if (query.text.includes("SET stage = CASE")) {
      return { rows: [row({
        stage: "retry_wait",
        attempts: 2,
        available_at: new Date(3_000),
        error_message: "temporary",
      })] };
    }
    return { rows: [] };
  });
  const repository = new DrizzleRenderWorkRepository<Payload>(fake.asDrizzle(), {
    workspaceId: "workspace-a",
    tenantId: "tenant-a",
    providerKeys: ["heygen"],
  });

  assert.equal(await repository.markSubmitted({
    workId: "00000000-0000-4000-8000-000000000001",
    leaseToken: "stale-token",
    providerSubmissionId: "provider-stale",
    providerAccountId: "00000000-0000-4000-8000-000000000050",
    nowMs: 2_000,
  }), undefined);
  const submitted = await repository.markSubmitted({
    workId: "00000000-0000-4000-8000-000000000001",
    leaseToken: "fresh-token",
    providerSubmissionId: "provider-1",
    providerAccountId: "00000000-0000-4000-8000-000000000050",
    nowMs: 2_000,
  });
  assert.equal(submitted?.state, "submitted");
  assert.equal(submitted?.providerAccountId, "00000000-0000-4000-8000-000000000050");
  assert.equal(submitted?.providerSubmissionId, "provider-1");

  const submissionMutation = fake.queries.find((query) => query.text.includes("SET stage = 'submitted'"));
  assert.ok(submissionMutation);
  assert.match(submissionMutation.text, /provider_account_id =/i);
  assert.match(submissionMutation.text, /FROM "ai_media_provider_accounts" AS account/i);
  assert.match(submissionMutation.text, /account\.owner_user_id = job\.owner_user_id/i);
  assert.match(submissionMutation.text, /account\.workspace_id = job\.workspace_id/i);
  assert.match(submissionMutation.text, /account\.provider_key = job\.provider_key/i);

  const failed = await repository.recordFailure({
    workId: "00000000-0000-4000-8000-000000000001",
    leaseToken: "fresh-token",
    error: "temporary",
    retryable: true,
    retryAtMs: 3_000,
    nowMs: 2_000,
  });
  assert.equal(failed?.deadLettered, false);
  assert.equal(failed?.item.attempt, 2);
  assert.equal(failed?.item.availableAtMs, 3_000);

  for (const mutation of fake.queries.filter((query) => query.text.startsWith("UPDATE \"ai_media_render_jobs\""))) {
    assert.match(mutation.text, /result -> '__renderQueue' ->> 'leaseToken' =/i);
    assert.match(mutation.text, /lease_expires_at >/i);
    assert.match(mutation.text, /workspace_id =/i);
    assert.match(mutation.text, /owner_user_id =/i);
    assert.match(mutation.text, /provider_key IN/i);
  }
});

test("expired lease reconciliation increments a separate budget and dead-letters deterministically", async () => {
  const fake = new FakeTransactionalDatabase((query) => {
    if (query.text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (query.text.includes("WITH expired AS")) return { rows: [
      row({
        id: "recoverable",
        stage: "queued",
        __previousOwner: "crashed-a",
        __leaseRecovery: 1,
        __deadLettered: false,
        result: { __renderQueue: { leaseRecoveries: 1, maxLeaseRecoveries: 2 } },
      }),
      row({
        id: "exhausted",
        stage: "dead_letter",
        dead_letter_at: new Date(5_000),
        __previousOwner: "crashed-b",
        __leaseRecovery: 2,
        __deadLettered: true,
        result: { __renderQueue: { leaseRecoveries: 2, maxLeaseRecoveries: 2 } },
      }),
    ] };
    return { rows: [] };
  });
  const repository = new DrizzleRenderWorkRepository<Payload>(fake.asDrizzle(), { workspaceId: "workspace-a" });
  const recoveries = await repository.reconcileExpiredLeases(5_000);

  assert.deepEqual(recoveries, [
    { workId: "recoverable", previousOwner: "crashed-a", attempt: 1, deadLettered: false },
    { workId: "exhausted", previousOwner: "crashed-b", attempt: 1, deadLettered: true },
  ]);
  const reconcile = fake.queries.find((query) => query.text.includes("WITH expired AS"));
  assert.ok(reconcile);
  assert.match(reconcile.text, /leaseRecoveries/);
  assert.match(reconcile.text, /maxLeaseRecoveries/);
  assert.match(reconcile.text, /FOR UPDATE SKIP LOCKED/i);
  assert.match(reconcile.text, /Render lease recovery budget exhausted/);
});

test("dead-letter listing and counts remain workspace, tenant, and provider scoped", async () => {
  const fake = new FakeTransactionalDatabase((query) => {
    if (query.text.startsWith("SELECT *") && query.text.includes("stage = 'dead_letter'")) {
      return { rows: [row({ stage: "dead_letter", dead_letter_at: new Date(8_000) })] };
    }
    if (query.text.includes("GROUP BY job.stage")) {
      return { rows: [
        { stage: "queued", count: 2 },
        { stage: "leased", count: "1" },
        { stage: "dead_letter", count: 1 },
      ] };
    }
    return { rows: [] };
  });
  const repository = new DrizzleRenderWorkRepository<Payload>(fake.asDrizzle(), {
    workspaceId: "workspace-a",
    tenantId: "tenant-a",
    providerKeys: ["heygen", "tavus"],
  });

  const deadLetters = await repository.listDeadLetters();
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].state, "dead_letter");
  assert.deepEqual(await repository.counts(), {
    admission_held: 0,
    queued: 2,
    leased: 1,
    retry_wait: 0,
    submitted: 0,
    dead_letter: 1,
  });
  for (const query of fake.queries) {
    assert.match(query.text, /workspace_id =/i);
    assert.match(query.text, /owner_user_id =/i);
    assert.match(query.text, /provider_key IN/i);
  }
});
