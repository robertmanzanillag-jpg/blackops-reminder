import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleExactAssetStageTargetLoader,
  type ExactAssetTargetDatabase,
  type ExactAssetTargetTransactionalDatabase,
} from "../server/ai-media-studio/assets/drizzle-exact-asset-stage-target-loader";
import type { ExactOneVideoRunLease, ExactOneVideoStageContext } from "../server/ai-media-studio/workers/one-video-run-once-executor";

const digest = (c: string) => `sha256:${c.repeat(64)}` as const;
const ids = {
  execution: "10000000-0000-4000-8000-000000000001", lease: "20000000-0000-4000-8000-000000000002",
  reservation: "30000000-0000-4000-8000-000000000003", render: "40000000-0000-4000-8000-000000000004",
  slot: "50000000-0000-4000-8000-000000000005", ingest: "60000000-0000-4000-8000-000000000006",
} as const;
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
function context(action: "ingest_asset" | "link_asset"): ExactOneVideoStageContext {
  return {
    action, actorUserId: "robert", commandId: `command-${action}`, commandDigest: digest("a"),
    target: { scope, budgetReservationId: ids.reservation, renderJobId: ids.render,
      dailyPlanSlotId: ids.slot, slotAttempt: 1, workHandoffDigest: digest("b") },
    lease: { executionId: ids.execution, commandId: `command-${action}`, commandDigest: digest("a"),
      fencingToken: 9n, leaseToken: ids.lease } as ExactOneVideoRunLease,
  };
}
function row(action: "ingest_asset" | "link_asset", changes: Record<string, unknown> = {}) {
  return {
    execution_id: ids.execution, run_lease_token: ids.lease, run_fencing_token: "9",
    command_digest: digest("a"), actor_user_id: "robert", owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId, budget_reservation_id: ids.reservation, render_job_id: ids.render,
    daily_plan_slot_id: ids.slot, slot_attempt: 1, work_handoff_digest: digest("b"),
    action, ingest_job_id: ids.ingest, ...changes,
  };
}
function harness(rows: unknown[]) {
  const dialect = new PgDialect(); const calls: { sql: string; params: unknown[] }[] = [];
  const execute = async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    calls.push({ sql: compiled.sql.replace(/\s+/gu, " ").trim(), params: compiled.params });
    return { rows };
  };
  const db: ExactAssetTargetTransactionalDatabase = {
    execute,
    async transaction<T>(callback: (tx: ExactAssetTargetDatabase) => Promise<T>) { return callback({ execute }); },
  };
  return { loader: new DrizzleExactAssetStageTargetLoader(db, scope), calls };
}
test("derives both targets with full identity and never accepts a caller job id", async () => {
  for (const action of ["ingest_asset", "link_asset"] as const) {
    const h = harness([row(action)]);
    const target = action === "ingest_asset"
      ? await h.loader.loadIngestTarget(context(action)) : await h.loader.loadLinkTarget(context(action));
    assert.deepEqual(target, { ingestJobId: ids.ingest });
    assert.match(h.calls[0].sql, /^SELECT \* FROM ai_media_worker_api\.load_exact_one_video_asset_target_v1/u);
    assert.ok(!h.calls[0].params.includes(ids.ingest));
    assert.doesNotMatch(h.calls[0].sql, /\b(?:INSERT|UPDATE|DELETE|ORDER BY|SKIP LOCKED|LIMIT)\b/iu);
  }
});
test("missing, substituted, malformed, or multiple durable targets fail closed", async () => {
  assert.equal(await harness([]).loader.loadIngestTarget(context("ingest_asset")), undefined);
  await assert.rejects(() => harness([row("link_asset", { render_job_id: ids.ingest })])
    .loader.loadLinkTarget(context("link_asset")), /returned another execution/u);
  await assert.rejects(() => harness([row("ingest_asset", { ingest_job_id: "browser-id" })])
    .loader.loadIngestTarget(context("ingest_asset")), /Invalid ingest_job_id/u);
  await assert.rejects(() => harness([row("ingest_asset"), row("ingest_asset")])
    .loader.loadIngestTarget(context("ingest_asset")), /Invalid exact asset target result/u);
});
