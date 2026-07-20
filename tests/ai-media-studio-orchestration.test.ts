import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ApprovalEvidence } from "../shared/ai-media-studio-operations";
import { aiMediaOrchestrationRuns } from "../shared/models/ai-media-studio-db";
import {
  DrizzleOrchestrationRepository,
  InMemoryOrchestrationRepository,
  OrchestrationConflictError,
  OrchestrationDeniedError,
  SourceOrchestrator,
  type OrchestrationRun,
} from "../server/ai-media-studio/orchestration";

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const contentDigest = `sha256:${"a".repeat(64)}` as const;
const publishDigest = `sha256:${"b".repeat(64)}` as const;
const now = new Date("2026-07-20T12:00:00.000Z");
const policy = { globalKillSwitchActive: false, policyVersion: "v1", evaluatedAt: now.toISOString() } as const;
const budget = {
  reservationId: "budget-1",
  amountUsd: 2.5,
  reservedAt: now.toISOString(),
  expiresAt: "2026-07-20T13:00:00.000Z",
} as const;

class OrchestrationFakeQuery implements PromiseLike<unknown[]> {
  table?: unknown;
  whereInput?: unknown;
  constructor(private readonly result: unknown[]) {}
  from(table: unknown): this { this.table = table; return this; }
  where(value: unknown): this { this.whereInput = value; return this; }
  limit(_value: number): this { return this; }
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return Promise.resolve(this.result).then(onfulfilled, onrejected); }
}

class OrchestrationFakeDb {
  lastQuery?: OrchestrationFakeQuery;
  select(): OrchestrationFakeQuery {
    this.lastQuery = new OrchestrationFakeQuery([]);
    return this.lastQuery;
  }
}

function approval(digest: typeof contentDigest | typeof publishDigest): ApprovalEvidence {
  return {
    decision: "approved",
    actorId: "human-reviewer",
    decidedAt: now.toISOString(),
    previewDigest: digest,
    reason: null,
  };
}

async function initialized(
  repository = new InMemoryOrchestrationRepository(),
  overrides: Partial<Parameters<SourceOrchestrator["initialize"]>[1]> = {},
): Promise<{ repository: InMemoryOrchestrationRepository; orchestrator: SourceOrchestrator; run: OrchestrationRun }> {
  const orchestrator = new SourceOrchestrator(repository, () => now);
  const run = await orchestrator.initialize(scope, {
    sourceItemId: "source-1",
    idempotencyKey: "initialize-1",
    rights: { evidenceId: "rights-1", status: "owned", assertedAt: now.toISOString() },
    moderation: { evidenceId: "moderation-1", status: "approved", evaluatedAt: now.toISOString() },
    ...overrides,
  });
  return { repository, orchestrator, run };
}

async function advanceToApproved(orchestrator: SourceOrchestrator, runId: string): Promise<void> {
  await orchestrator.transition(scope, runId, { type: "draft_idea", idempotencyKey: "idea-1" });
  await orchestrator.transition(scope, runId, { type: "draft_script", idempotencyKey: "script-1" });
  await orchestrator.transition(scope, runId, { type: "request_content_approval", idempotencyKey: "content-review-1", previewDigest: contentDigest });
  await orchestrator.transition(scope, runId, { type: "approve_content", idempotencyKey: "content-approved-1", approval: approval(contentDigest) });
}

test("orchestrator reaches publish queue exclusively through durable emitted commands", async () => {
  const { repository, orchestrator, run } = await initialized();
  assert.notEqual(run.id, run.sourceItemId);
  await advanceToApproved(orchestrator, run.id);
  await orchestrator.transition(scope, run.id, { type: "queue_render", idempotencyKey: "render-1", budget, policy });
  await orchestrator.transition(scope, run.id, { type: "record_asset_ready", idempotencyKey: "asset-1", assetId: "asset-1" });
  await orchestrator.transition(scope, run.id, { type: "request_publishing_approval", idempotencyKey: "publish-review-1", previewDigest: publishDigest });
  const queued = await orchestrator.transition(scope, run.id, {
    type: "queue_publish",
    idempotencyKey: "publish-1",
    approval: approval(publishDigest),
    policy,
  });
  assert.equal(queued.state, "queued");
  const emissions = await repository.listEmissions(scope, queued.id);
  assert.deepEqual(emissions.filter((item) => item.kind === "command").map((item) => item.type), [
    "ai_media.idea.draft.requested",
    "ai_media.script.draft.requested",
    "ai_media.render.requested",
    "ai_media.publish.requested",
  ]);
  assert.equal(emissions.some((item) => /provider|webhook/.test(item.type)), false);
});

test("transition idempotency never duplicates an outbox command", async () => {
  const { repository, orchestrator, run } = await initialized();
  const first = await orchestrator.transition(scope, run.id, { type: "draft_idea", idempotencyKey: "same-transition" });
  const second = await orchestrator.transition(scope, run.id, { type: "draft_idea", idempotencyKey: "same-transition" });
  assert.deepEqual(second, first);
  const emissions = await repository.listEmissions(scope, run.id);
  assert.equal(emissions.filter((item) => item.type === "ai_media.idea.draft.requested").length, 1);
});

test("concurrent initialization elects one canonical run and emits source-seen once", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const orchestrator = new SourceOrchestrator(repository, () => now);
  const input = {
    sourceItemId: "source-race",
    idempotencyKey: "initialize-race",
    rights: { evidenceId: "rights-race", status: "owned", assertedAt: now.toISOString() },
    moderation: { evidenceId: "moderation-race", status: "approved", evaluatedAt: now.toISOString() },
  } as const;

  const runs = await Promise.all(Array.from({ length: 24 }, () => orchestrator.initialize(scope, input)));
  assert.equal(new Set(runs.map((run) => run.id)).size, 1);
  assert.equal((await repository.getBySourceItem(scope, input.sourceItemId))?.id, runs[0]?.id);
  const emissions = await repository.listEmissions(scope, runs[0]!.id);
  assert.equal(emissions.filter((item) => item.type === "ai_media.source.seen").length, 1);
});

test("concurrent initialization with different keys permits one winner and no duplicate emission", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const orchestrator = new SourceOrchestrator(repository, () => now);
  const base = {
    sourceItemId: "source-competing-race",
    rights: { evidenceId: "rights-race", status: "owned", assertedAt: now.toISOString() },
    moderation: { evidenceId: "moderation-race", status: "approved", evaluatedAt: now.toISOString() },
  } as const;
  const results = await Promise.allSettled([
    orchestrator.initialize(scope, { ...base, idempotencyKey: "initialize-race-a" }),
    orchestrator.initialize(scope, { ...base, idempotencyKey: "initialize-race-b" }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const canonical = await repository.getBySourceItem(scope, base.sourceItemId);
  assert.ok(canonical);
  assert.equal((await repository.listEmissions(scope, canonical.id)).length, 1);
});

test("initialization idempotency keys cannot alias two different sources", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const orchestrator = new SourceOrchestrator(repository, () => now);
  const first = await orchestrator.initialize(scope, {
    sourceItemId: "source-idempotency-a",
    idempotencyKey: "shared-initialization-key",
    rights: { evidenceId: "rights-a", status: "owned", assertedAt: now.toISOString() },
    moderation: { evidenceId: "moderation-a", status: "approved", evaluatedAt: now.toISOString() },
  });
  await assert.rejects(() => orchestrator.initialize(scope, {
    sourceItemId: "source-idempotency-b",
    idempotencyKey: "shared-initialization-key",
    rights: { evidenceId: "rights-b", status: "owned", assertedAt: now.toISOString() },
    moderation: { evidenceId: "moderation-b", status: "approved", evaluatedAt: now.toISOString() },
  }), OrchestrationConflictError);
  assert.equal((await repository.listEmissions(scope, first.id)).length, 1);
  assert.equal(await repository.getBySourceItem(scope, "source-idempotency-b"), undefined);
});

test("a crash before atomic commit changes neither state nor outbox and retry succeeds", async () => {
  const { repository, orchestrator, run } = await initialized();
  repository.simulateCrashBeforeNextCommit();
  await assert.rejects(
    () => orchestrator.transition(scope, run.id, { type: "draft_idea", idempotencyKey: "retryable-idea" }),
    /simulated transaction crash/,
  );
  assert.equal((await repository.get(scope, run.id))!.state, "source_seen");
  assert.equal((await repository.listEmissions(scope, run.id)).length, 1);
  const retried = await orchestrator.transition(scope, run.id, { type: "draft_idea", idempotencyKey: "retryable-idea" });
  assert.equal(retried.state, "idea_draft");
  assert.equal((await repository.listEmissions(scope, run.id)).length, 2);
});

test("unknown rights and failed moderation deny work before draft commands", async () => {
  const unknown = await initialized(new InMemoryOrchestrationRepository(), {
    rights: { evidenceId: "rights-unknown", status: "unknown", assertedAt: now.toISOString() },
  });
  await assert.rejects(
    () => unknown.orchestrator.transition(scope, unknown.run.id, { type: "draft_idea", idempotencyKey: "idea-denied" }),
    (error) => error instanceof OrchestrationDeniedError && error.code === "rights_not_allowed",
  );

  const moderated = await initialized(new InMemoryOrchestrationRepository(), {
    moderation: { evidenceId: "moderation-failed", status: "rejected", evaluatedAt: now.toISOString() },
  });
  await assert.rejects(
    () => moderated.orchestrator.transition(scope, moderated.run.id, { type: "draft_idea", idempotencyKey: "idea-denied" }),
    (error) => error instanceof OrchestrationDeniedError && error.code === "moderation_not_approved",
  );
});

test("manual approval digest, budget evidence, and kill switch are hard render gates", async () => {
  const wrongApproval = await initialized();
  await wrongApproval.orchestrator.transition(scope, wrongApproval.run.id, { type: "draft_idea", idempotencyKey: "i" });
  await wrongApproval.orchestrator.transition(scope, wrongApproval.run.id, { type: "draft_script", idempotencyKey: "s" });
  await wrongApproval.orchestrator.transition(scope, wrongApproval.run.id, { type: "request_content_approval", idempotencyKey: "r", previewDigest: contentDigest });
  await assert.rejects(
    () => wrongApproval.orchestrator.transition(scope, wrongApproval.run.id, { type: "approve_content", idempotencyKey: "a", approval: approval(publishDigest) }),
    (error) => error instanceof OrchestrationDeniedError && error.code === "manual_approval_invalid",
  );

  const expired = await initialized();
  await advanceToApproved(expired.orchestrator, expired.run.id);
  await assert.rejects(
    () => expired.orchestrator.transition(scope, expired.run.id, {
      type: "queue_render",
      idempotencyKey: "expired",
      budget: { ...budget, expiresAt: "2026-07-20T11:59:59.000Z" },
      policy,
    }),
    (error) => error instanceof OrchestrationDeniedError && error.code === "budget_reservation_expired",
  );
  await assert.rejects(
    () => expired.orchestrator.transition(scope, expired.run.id, {
      type: "queue_render",
      idempotencyKey: "killed",
      budget,
      policy: { ...policy, globalKillSwitchActive: true },
    }),
    (error) => error instanceof OrchestrationDeniedError && error.code === "global_kill_switch_active",
  );
  assert.equal((await expired.repository.get(scope, expired.run.id))!.state, "approved");
  assert.equal((await expired.repository.listEmissions(scope, expired.run.id)).some((item) => item.type === "ai_media.render.requested"), false);
});

test("tenant scope prevents cross-owner run access", async () => {
  const { repository, run } = await initialized();
  assert.equal(await repository.get({ ownerUserId: "owner-b", workspaceId: "workspace-a" }, run.id), undefined);
  assert.equal(await repository.get({ ownerUserId: "owner-a", workspaceId: "workspace-b" }, run.id), undefined);
});

test("Drizzle run lookup targets orchestration run ID with tenant predicates", async () => {
  const db = new OrchestrationFakeDb();
  assert.equal(await new DrizzleOrchestrationRepository(db as never).get(scope, "run-123"), undefined);
  assert.equal(db.lastQuery?.table, aiMediaOrchestrationRuns);
  assert.ok(db.lastQuery?.whereInput);
  const rendered = new PgDialect().sqlToQuery(db.lastQuery.whereInput as never);
  assert.match(rendered.sql, /ai_media_orchestration_runs"\."id/);
  assert.deepEqual(rendered.params, ["run-123", scope.ownerUserId, scope.workspaceId]);
});
