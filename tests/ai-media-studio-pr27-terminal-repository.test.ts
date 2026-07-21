import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleAdmittedRenderTerminalRepository } from "../server/ai-media-studio/workers/drizzle-admitted-render-terminal-repository";
import type { AdmittedRenderTransactionalDatabase } from "../server/ai-media-studio/workers/drizzle-admitted-render-repository";

const dialect = new PgDialect();
const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (char: string) => `sha256:${char.repeat(64)}` as const;

class FunctionDatabase implements AdmittedRenderTransactionalDatabase {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly response: (sql: string) => Record<string, unknown> | undefined) {}
  async execute(query: SQL) {
    const rendered = dialect.sqlToQuery(query);
    const normalized = rendered.sql.replace(/\s+/gu, " ").trim();
    this.calls.push({ sql: normalized, params: rendered.params });
    const row = this.response(normalized);
    return { rows: row ? [row] : [] };
  }
  async transaction<T>(callback: (tx: FunctionDatabase) => Promise<T>): Promise<T> { return callback(this); }
}

function harness(response: (sql: string) => Record<string, unknown> | undefined) {
  const reconcile = new FunctionDatabase(response);
  return {
    reconcile,
    repository: new DrizzleAdmittedRenderTerminalRepository(
      { reconcile },
      { scope: { ownerUserId: "owner-a", workspaceId: "personal" }, reconcileCapabilityId: id("1") },
    ),
  };
}

function claimRow() {
  return {
    id: id("2"), submission_attempt_id: id("3"), budget_reservation_id: id("4"), render_job_id: id("5"),
    provider_account_id: id("6"), provider_key: "heygen", provider_credential_version: 2,
    provider_job_id: "video-123", send_authorization_digest: digest("a"), lease_token: id("7"),
    submission_fencing_token: "4", fencing_token: "9", lease_expires_at: new Date("2026-07-21T21:00:00Z"),
  };
}

test("terminal repository claims and finalizes only through reconcile capability functions", async () => {
  const h = harness((sql) => sql.includes("claim_terminal_check_v1") ? claimRow()
    : sql.includes("record_provider_terminal_v1") ? { outcome: "applied", terminal_event_id: id("8"), ingest_job_id: id("9") }
      : undefined);
  const claim = await h.repository.claimTerminal({ workerId: "terminal-a", leaseDurationMs: 60_000 });
  assert.ok(claim);
  assert.equal(claim.fencingToken, 4n);
  assert.equal(claim.terminalFencingToken, 9n);
  assert.equal(await h.repository.finalizeCompleted({ ...claim, finality: {
    kind: "completed", remoteArtifactRef: "provider-artifact://stable/video-123",
    ephemeralSourceUrl: "https://files.heygen.ai/video/video-123.mp4?token=temporary", mediaType: "video/mp4",
    observedAt: "2026-07-21T20:00:00.000Z", evidenceDigest: digest("b"),
    releaseCapacity: true, enqueueIngest: true,
  } }), "applied");
  assert.match(h.reconcile.calls[0].sql, /claim_terminal_check_v1/u);
  assert.match(h.reconcile.calls[1].sql, /record_provider_terminal_v1/u);
  for (const value of [id("1"), id("2"), id("3"), "owner-a", "personal", "video-123"]) {
    assert.ok(h.reconcile.calls.flatMap((call) => call.params).includes(value));
  }
});

test("terminal repository preserves replay/conflict and rejects forged claims before SQL", async () => {
  let outcome = "replayed";
  const h = harness((sql) => sql.includes("claim_terminal_check_v1") ? claimRow()
    : sql.includes("record_provider_terminal_v1") ? { outcome } : undefined);
  const claim = await h.repository.claimTerminal({ workerId: "terminal-a", leaseDurationMs: 60_000 });
  assert.ok(claim);
  const failed = { kind: "failed", observedAt: "2026-07-21T20:00:00.000Z", evidenceDigest: digest("c"),
    releaseCapacity: true, enqueueIngest: false } as const;
  assert.equal(await h.repository.finalizeFailed({ ...claim, finality: failed }), "duplicate");
  outcome = "conflict";
  assert.equal(await h.repository.finalizeFailed({ ...claim, finality: failed }), "conflict");
  const calls = h.reconcile.calls.length;
  assert.equal(await h.repository.finalizeFailed({ ...claim, scope: { ...claim.scope, ownerUserId: "owner-b" }, finality: failed }), "conflict");
  assert.equal(h.reconcile.calls.length, calls);
});

test("terminal unknown releases only the exact issued lease", async () => {
  const h = harness((sql) => sql.includes("claim_terminal_check_v1") ? claimRow()
    : sql.includes("release_terminal_check_unknown_v1") ? { applied: true } : undefined);
  const claim = await h.repository.claimTerminal({ workerId: "terminal-a", leaseDurationMs: 60_000 });
  assert.ok(claim);
  assert.equal(await h.repository.rescheduleTerminal({ ...claim, reason: "processing",
    observedAt: "2026-07-21T20:00:00.000Z", evidenceDigest: digest("d"), capacityHeld: true }), true);
  assert.match(h.reconcile.calls[1].sql, /release_terminal_check_unknown_v1/u);
});
