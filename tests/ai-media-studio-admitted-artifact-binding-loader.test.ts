import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleAdmittedProviderArtifactBindingLoader,
} from "../server/ai-media-studio/assets/drizzle-admitted-artifact-binding-loader";
import { durableProviderArtifactRef } from "../server/ai-media-studio/assets/provider-artifact-identity";

const ids = {
  ingest: "11111111-1111-4111-8111-111111111111",
  render: "22222222-2222-4222-8222-222222222222",
  attempt: "33333333-3333-4333-8333-333333333333",
  account: "44444444-4444-4444-8444-444444444444",
} as const;
const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const providerJobId = "video-123";
const authorizationDigest = `sha256:${"a".repeat(64)}`;
const providerEvidenceDigest = `sha256:${"b".repeat(64)}`;
const remoteArtifactRef = durableProviderArtifactRef({
  scope,
  renderJobId: ids.render,
  providerAccountId: ids.account,
  providerKey: "heygen",
  providerJobId,
});
const request = {
  jobId: ids.ingest,
  tenantId: JSON.stringify([scope.workspaceId, scope.ownerUserId]),
  renderJobId: ids.render,
  remoteArtifactRef,
  expectedMimeType: "video/mp4",
} as const;

function boundDigest(): string {
  return `sha256:${createHash("sha256").update([
    "provider-terminal:v1",
    scope.ownerUserId,
    scope.workspaceId,
    ids.attempt,
    authorizationDigest,
    ids.account,
    "heygen",
    "7",
    providerJobId,
    "completed",
    remoteArtifactRef,
    providerEvidenceDigest,
  ].join(":")).digest("hex")}`;
}

function exactRow() {
  return {
    job_id: ids.ingest,
    owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId,
    render_job_id: ids.render,
    remote_artifact_ref: remoteArtifactRef,
    submission_attempt_id: ids.attempt,
    provider_evidence_digest: providerEvidenceDigest,
    bound_evidence_digest: boundDigest(),
    provider_job_id: providerJobId,
    provider_account_id: ids.account,
    provider_key: "heygen",
    provider_credential_version: 7,
    authorization_digest: authorizationDigest,
  };
}

test("exact terminal evidence graph returns one immutable provider-neutral binding", async () => {
  let query: SQL | undefined;
  const loader = new DrizzleAdmittedProviderArtifactBindingLoader({
    async execute(input) {
      query = input;
      return { rows: [exactRow()] };
    },
  });
  assert.equal(query, undefined);
  const binding = await loader.load(request);
  assert.deepEqual(binding, {
    jobId: ids.ingest,
    tenantId: request.tenantId,
    renderJobId: ids.render,
    remoteArtifactRef,
    providerJobId,
    scope,
    providerAccountId: ids.account,
    providerKey: "heygen",
    providerCredentialVersion: 7,
    authorizationDigest,
  });
  assert.ok(Object.isFrozen(binding));
  assert.ok(Object.isFrozen(binding?.scope));

  const compiled = new PgDialect().sqlToQuery(query!);
  for (const required of [
    "ai_media_asset_ingest_jobs",
    "ai_media_provider_terminal_events",
    "ai_media_provider_submission_attempts",
    "ai_media_provider_terminal_checks",
    "ai_media_render_jobs",
    "ai_media_outbox",
    "ai_media_daily_plan_slots",
    "attempt.state='confirmed'",
    "terminal_check.state='terminal'",
    "terminal.terminal_state='completed'",
    "ingest.state='leased'",
    "ingest.lease_expires_at>transaction_timestamp()",
    "render.provider_terminal_evidence_digest=terminal.bound_evidence_digest",
    "outbox.provider_terminal_evidence_digest=terminal.bound_evidence_digest",
    "slot.provider_terminal_evidence_digest=terminal.bound_evidence_digest",
    "LIMIT 2",
  ]) assert.match(compiled.sql, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  for (const parameter of [
    ids.ingest, ids.render, remoteArtifactRef, scope.ownerUserId, scope.workspaceId, "video/mp4",
  ]) assert.ok(compiled.params.includes(parameter));
});

test("malformed request identities never reach the database", async () => {
  let calls = 0;
  const loader = new DrizzleAdmittedProviderArtifactBindingLoader({
    async execute() {
      calls += 1;
      return { rows: [exactRow()] };
    },
  });
  const malformed = [
    { ...request, jobId: "not-a-uuid" },
    { ...request, renderJobId: "not-a-uuid" },
    { ...request, tenantId: JSON.stringify([scope.ownerUserId, scope.workspaceId]) },
    { ...request, tenantId: "personal" },
    { ...request, remoteArtifactRef: ` ${remoteArtifactRef}` },
    { ...request, expectedMimeType: "video/webm" as never },
  ];
  for (const input of malformed) assert.equal(await loader.load(input), undefined);
  assert.equal(calls, 1, "a reversed but structurally valid tenant remains a safe exact DB miss");
});

test("zero, ambiguous, or malformed rows fail closed", async (t) => {
  const cases: Array<{ name: string; rows: Record<string, unknown>[] }> = [
    { name: "zero", rows: [] },
    { name: "ambiguous", rows: [exactRow(), exactRow()] },
    { name: "owner", rows: [{ ...exactRow(), owner_user_id: "other-owner" }] },
    { name: "workspace", rows: [{ ...exactRow(), workspace_id: "other-workspace" }] },
    { name: "attempt", rows: [{ ...exactRow(), submission_attempt_id: "invalid" }] },
    { name: "account", rows: [{ ...exactRow(), provider_account_id: "invalid" }] },
    { name: "version", rows: [{ ...exactRow(), provider_credential_version: 0 }] },
    { name: "authorization", rows: [{ ...exactRow(), authorization_digest: "invalid" }] },
    { name: "provider evidence", rows: [{ ...exactRow(), provider_evidence_digest: "invalid" }] },
    { name: "bound evidence", rows: [{ ...exactRow(), bound_evidence_digest: `sha256:${"c".repeat(64)}` }] },
    { name: "durable ref", rows: [{ ...exactRow(), remote_artifact_ref: `${remoteArtifactRef}x` }] },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const loader = new DrizzleAdmittedProviderArtifactBindingLoader({
        async execute() { return { rows: item.rows }; },
      });
      assert.equal(await loader.load(request), undefined);
    });
  }
});

test("database failures are redacted", async () => {
  const loader = new DrizzleAdmittedProviderArtifactBindingLoader({
    async execute() {
      throw new Error("postgresql://private-user:private-password@private-host/database");
    },
  });
  await assert.rejects(loader.load(request), (error: unknown) => {
    assert(error instanceof Error);
    assert.equal(error.message, "Admitted provider artifact binding unavailable");
    assert.doesNotMatch(error.message, /private|postgres|password/iu);
    return true;
  });
});
