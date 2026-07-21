import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleOAuthProviderConnectionRepository,
  type OAuthProviderConnectionDatabase,
  type OAuthProviderConnectionTransactionalDatabase,
} from "../server/ai-media-studio/oauth/drizzle-provider-connection-repository";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
const attemptId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const bindingId = "44444444-4444-4444-8444-444444444444";
const leaseToken = "55555555-5555-4555-8555-555555555555";
const candidateId = "66666666-6666-4666-8666-666666666666";

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: attemptId, owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    actor_user_id: "actor-1", provider_account_id: accountId, platform: "youtube_shorts",
    oauth_session_id: sessionId, stage: "exchange_pending", stage_version: 1,
    grant_family: "google_user", manifest_revision: "google-youtube-v1",
    required_scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    allowed_scopes: ["https://www.googleapis.com/auth/youtube.upload"], actual_scopes: null,
    token_artifacts: null, token_binding_id: bindingId, expected_credential_version: 3,
    target_credential_version: 4, lease_token: null, lease_owner: null, lease_expires_at: null,
    lease_fencing: 0, failure_code: null, terminal_outcome: null, terminal_evidence_digest: null,
    terminal_at: null, expires_at: new Date("2026-07-21T12:15:00.000Z"),
    database_now: new Date("2026-07-21T12:01:00.000Z"),
    created_at: new Date("2026-07-21T12:00:00.000Z"), updated_at: new Date("2026-07-21T12:00:00.000Z"),
    ...overrides,
  };
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: candidateId, owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    actor_user_id: "actor-1", provider_account_id: accountId, platform: "youtube_shorts",
    oauth_session_id: sessionId, attempt_id: attemptId, target_kind: "youtube_channel",
    target_external_id: "channel-1", safe_label: "Robert Channel", parent_target_id: null,
    eligibility_digest: "e".repeat(64), verified_tasks: ["youtube.upload"], capabilities: ["publish_video"],
    manifest_revision: "google-youtube-v1", discovered_at: new Date("2026-07-21T12:03:00.000Z"),
    created_at: new Date("2026-07-21T12:03:00.000Z"), ...overrides,
  };
}

function makeDb(handler: (call: number, rendered: ReturnType<PgDialect["sqlToQuery"]>) => { rows: unknown[] }) {
  let call = 0;
  const calls: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const execute = async (query: Parameters<OAuthProviderConnectionDatabase["execute"]>[0]) => {
    const rendered = dialect.sqlToQuery(query); calls.push(rendered); call += 1; return handler(call, rendered);
  };
  const db: OAuthProviderConnectionTransactionalDatabase = {
    execute,
    async transaction(callback) { return callback({ execute }); },
  };
  return { db, calls };
}

test("create copies provenance only from the exact existing OAuth session and credential version", async () => {
  const { db, calls } = makeDb(() => ({ rows: [attemptRow()] }));
  const created = await new DrizzleOAuthProviderConnectionRepository(db).create({
    id: attemptId, scope, actorUserId: "actor-1", providerAccountId: accountId,
    oauthSessionId: sessionId, platform: "youtube_shorts", grantFamily: "google_user",
    manifestRevision: "google-youtube-v1",
    allowedScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"], tokenBindingId: bindingId,
    expectedCredentialVersion: 3, targetCredentialVersion: 4,
    expiresAt: "2026-07-21T12:15:00.000Z", createdAt: "2026-07-21T12:00:00.000Z",
  });
  assert.equal(created.oauthSessionId, sessionId);
  const normalized = calls[0].sql.replace(/\s+/g, " ");
  assert.match(normalized, /insert into .*ai_media_oauth_connection_attempts.* select/i);
  assert.match(normalized, /inner join .*ai_media_provider_accounts/i);
  for (const column of ["owner_user_id", "workspace_id", "actor_user_id", "provider_account_id", "platform",
    "token_binding_id", "expected_credential_version", "target_credential_version", "credential_version"]) {
    assert.match(normalized, new RegExp(column, "i"));
  }
  assert.match(normalized, /clock_timestamp\(\)/i);
});

test("create rejects malformed identity or non-increasing ISO lifetime before issuing SQL", async () => {
  for (const invalid of [
    { actorUserId: "actor with spaces" },
    { expiresAt: "2026-07-21T11:59:59.000Z" },
    { createdAt: "not-an-iso-date" },
  ]) {
    const { db, calls } = makeDb(() => ({ rows: [] }));
    await assert.rejects(new DrizzleOAuthProviderConnectionRepository(db).create({
      id: attemptId, scope, actorUserId: "actor-1", providerAccountId: accountId,
      oauthSessionId: sessionId, platform: "youtube_shorts", grantFamily: "google_user",
      manifestRevision: "google-youtube-v1", allowedScopes: ["https://www.googleapis.com/auth/youtube.upload"],
      requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"], tokenBindingId: bindingId,
      expectedCredentialVersion: 3, targetCredentialVersion: 4,
      expiresAt: "2026-07-21T12:15:00.000Z", createdAt: "2026-07-21T12:00:00.000Z", ...invalid,
    }), /rejected/);
    assert.equal(calls.length, 0);
  }
});

test("claim uses the database clock, bounded expiry, recovery fence, and increments live fencing", async () => {
  const claimedRow = attemptRow({ stage: "exchange_in_progress", stage_version: 2, lease_token: leaseToken,
    lease_owner: "worker-1", lease_expires_at: new Date("2026-07-21T12:02:00.000Z"), lease_fencing: 1 });
  const { db, calls } = makeDb((call) => ({ rows: call === 1 ? [claimedRow] : [] }));
  const claim = await new DrizzleOAuthProviderConnectionRepository(db).claim({
    attemptId, scope, stage: "exchange_pending", leaseToken, leaseOwner: "worker-1",
    leaseExpiresAt: "2026-07-21T12:02:00.000Z", now: "2026-07-21T12:01:00.000Z",
  });
  assert.equal(claim?.leaseFencing, 1);
  const sql = calls[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /lease_fencing\s*=\s*lease_fencing\s*\+\s*1/i);
  assert.match(sql, /clock_timestamp\(\).*interval '5 minutes'/i);
  assert.match(sql, /lease_expires_at\s*<=\s*clock_timestamp\(\)/i);
  assert.match(sql, /stage_version\s*=\s*stage_version\s*\+\s*1/i);
});

test("exchange completion persists only safe descriptors after required subset and allowlist validation", async () => {
  const exchange = attemptRow({ stage: "exchange_in_progress", stage_version: 2, lease_token: leaseToken,
    lease_owner: "worker-1", lease_expires_at: new Date("2026-07-21T12:02:00.000Z"), lease_fencing: 7 });
  const completed = attemptRow({ stage: "discovery_pending", stage_version: 3,
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    token_artifacts: [{ role: "operational_access", lifetime: { kind: "expires_at",
      expiresAt: "2026-07-21T13:00:00.000Z", revalidateAt: "2026-07-21T12:30:00.000Z" } }] });
  const { db, calls } = makeDb((call) => ({
    rows: call === 1 ? [{ database_now: new Date("2026-07-21T12:01:00.000Z") }]
      : call === 2 ? [exchange] : call === 5 ? [completed] : [],
  }));
  const unsafeArtifact = { role: "operational_access" as const, lifetime: { kind: "expires_at" as const,
    expiresAt: "2026-07-21T13:00:00.000Z", revalidateAt: "2026-07-21T12:30:00.000Z" },
    access_token: "must-never-persist" };
  const result = await new DrizzleOAuthProviderConnectionRepository(db).markExchangeComplete({
    attemptId, scope, leaseToken, leaseFencing: 7, now: "2020-01-01T00:00:00.000Z",
    actualScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    tokenArtifacts: [unsafeArtifact,
      { role: "refresh", lifetime: { kind: "expires_at",
        expiresAt: "2027-07-21T12:00:00.000Z", revalidateAt: "2026-08-21T12:00:00.000Z" } }],
  });
  assert.equal(result?.stage, "discovery_pending");
  const rendered = JSON.stringify(calls);
  assert.doesNotMatch(rendered, /vault:\/\/|access-token|refresh-token|provider_json/i);
  assert.doesNotMatch(rendered, /must-never-persist|access_token/i);
  const mutation = calls[4].sql.replace(/\s+/g, " ");
  assert.match(mutation, /lease_token.*lease_fencing.*lease_expires_at.*clock_timestamp/i);
  assert.match(mutation, /actual_scopes.*token_artifacts/i);
});

test("discovery atomically inserts exact candidates with locally derived capabilities and advances stage", async () => {
  const discovery = attemptRow({ stage: "discovery_in_progress", stage_version: 4, lease_token: leaseToken,
    lease_owner: "worker-1", lease_expires_at: new Date("2026-07-21T12:05:00.000Z"), lease_fencing: 2,
    database_now: new Date("2026-07-21T12:03:00.000Z"),
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{ role: "operational_access",
      lifetime: { kind: "expires_at", expiresAt: "2026-07-21T13:00:00.000Z", revalidateAt: "2026-07-21T12:30:00.000Z" } }] });
  const awaiting = attemptRow({ stage: "awaiting_target", stage_version: 5,
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
  const { db, calls } = makeDb((call) => {
    if (call === 1) return { rows: [discovery] };
    if (call === 3) return { rows: [{ id: attemptId }] };
    if (call === 4) return { rows: [awaiting] };
    if (call === 5) return { rows: [candidateRow()] };
    return { rows: [] };
  });
  await new DrizzleOAuthProviderConnectionRepository(db).recordDiscovery({
    attemptId, scope, leaseToken, leaseFencing: 2, now: "2026-07-21T12:03:00.000Z",
    candidates: [{ candidateId, targetId: "channel-1", kind: "youtube_channel", displayName: "Robert Channel",
      verifiedTasks: ["youtube.upload"], eligibilityDigest: "e".repeat(64),
      manifestRevision: "google-youtube-v1", discoveredAt: "2026-07-21T12:03:00.000Z" }],
  });
  const insert = calls[1].sql.replace(/\s+/g, " ");
  assert.match(insert, /insert into .*ai_media_oauth_target_candidates/i);
  assert.ok(calls[1].params.some((parameter) => String(parameter).includes("publish_video")));
  assert.match(calls[2].sql.replace(/\s+/g, " "), /stage\s*=.*awaiting_target/i);
});

test("zero discovery candidates terminalizes as failed/no_targets instead of awaiting selection", async () => {
  const discovery = attemptRow({ stage: "discovery_in_progress", stage_version: 4, lease_token: leaseToken,
    lease_owner: "worker-1", lease_expires_at: new Date("2026-07-21T12:05:00.000Z"), lease_fencing: 2,
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
  const failed = attemptRow({ stage: "failed", stage_version: 5, failure_code: "no_targets", terminal_outcome: "not_connectable",
    terminal_evidence_digest: "f".repeat(64), terminal_at: new Date("2026-07-21T12:03:00.000Z"),
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
  const { db, calls } = makeDb((call) => ({ rows: call === 1 ? [discovery] : call === 2 ? [failed] : [] }));
  const result = await new DrizzleOAuthProviderConnectionRepository(db).recordDiscovery({
    attemptId, scope, leaseToken, leaseFencing: 2, now: "2026-07-21T12:03:00.000Z", candidates: [],
  });
  assert.equal(result?.failureCode, "no_targets");
  const mutation = calls[1].sql.replace(/\s+/g, " ");
  assert.match(mutation, /stage\s*=.*failed/i);
  assert.match(mutation, /failure_code\s*=.*no_targets/i);
  assert.doesNotMatch(mutation, /awaiting_target/i);
});

test("discovery rejects more than 100 candidates before SQL and rejects unsafe or future candidate evidence", async () => {
  const baseCandidate = { candidateId, targetId: "channel-1", kind: "youtube_channel" as const,
    displayName: "Robert Channel", verifiedTasks: ["youtube.upload"], eligibilityDigest: "e".repeat(64),
    manifestRevision: "google-youtube-v1", discoveredAt: "2026-07-21T12:01:00.000Z" };
  {
    const { db, calls } = makeDb(() => ({ rows: [] }));
    await assert.rejects(new DrizzleOAuthProviderConnectionRepository(db).recordDiscovery({
      attemptId, scope, leaseToken, leaseFencing: 2, now: "2099-01-01T00:00:00.000Z",
      candidates: Array.from({ length: 101 }, (_, index) => ({ ...baseCandidate,
        candidateId: `candidate-${index}`, targetId: `channel-${index}` })),
    }), /rejected/);
    assert.equal(calls.length, 0);
  }
  for (const invalid of [
    { displayName: "unsafe\u0000label" },
    { discoveredAt: "2026-07-21T12:01:00.001Z" },
    { eligibilityDigest: "not-a-digest" },
  ]) {
    const discovery = attemptRow({ stage: "discovery_in_progress", stage_version: 4, lease_token: leaseToken,
      lease_owner: "worker-1", lease_expires_at: new Date("2026-07-21T12:05:00.000Z"), lease_fencing: 2,
      actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
    const { db } = makeDb((call) => ({ rows: call === 1 ? [discovery] : [] }));
    await assert.rejects(new DrizzleOAuthProviderConnectionRepository(db).recordDiscovery({
      attemptId, scope, leaseToken, leaseFencing: 2, now: "2099-01-01T00:00:00.000Z",
      candidates: [{ ...baseCandidate, ...invalid }],
    }), /rejected/);
  }
});

test("selection is explicit, exact, immutable, replay-safe, and never chooses a first row", async () => {
  const awaiting = attemptRow({ stage: "awaiting_target", stage_version: 5,
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
  const activated = attemptRow({ stage: "activation_pending", stage_version: 6,
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
  const selection = { ...candidateRow(), selected_actor_user_id: "actor-1",
    selected_at: new Date("2026-07-21T12:04:00.000Z"), selected_stage_version: 5 };
  const { db, calls } = makeDb((call) => {
    if (call === 1) return { rows: [awaiting] };
    if (call === 3) return { rows: [{ eligibility_digest: "e".repeat(64) }] };
    if (call === 4) return { rows: [{ selection_digest: "s".repeat(64) }] };
    if (call === 5) return { rows: [{ id: attemptId }] };
    if (call === 6) return { rows: [activated] };
    if (call === 7) return { rows: [candidateRow()] };
    if (call === 8) return { rows: [selection] };
    return { rows: [] };
  });
  const selected = await new DrizzleOAuthProviderConnectionRepository(db).selectTarget({
    attemptId, scope, actorUserId: "actor-1", expectedStageVersion: 5,
    candidateId, targetId: "channel-1", targetKind: "youtube_channel", now: "2026-07-21T12:04:00.000Z",
  });
  assert.equal(selected?.selectedCandidateId, candidateId);
  const rendered = calls.map((call) => call.sql.replace(/\s+/g, " ")).join(" ");
  assert.doesNotMatch(rendered, /\blimit\s+1\b|\bfirst\b/i);
  for (const column of ["candidate_id", "target_kind", "target_external_id", "actor_user_id", "stage_version"]) {
    assert.match(rendered, new RegExp(column, "i"));
  }
  assert.match(rendered, /on conflict .* do nothing/i);
});

test("exact selection replay returns the existing choice while a different replay loses", async () => {
  const activation = attemptRow({ stage: "activation_pending", stage_version: 6,
    actual_scopes: ["https://www.googleapis.com/auth/youtube.upload"], token_artifacts: [{}] });
  const replaySelection = { ...candidateRow(), selected_actor_user_id: "actor-1",
    selected_at: new Date("2026-07-21T12:04:00.000Z"), selected_stage_version: 5 };
  for (const [targetId, expectedStageVersion] of [["channel-1", 5], ["channel-other", 5], ["channel-1", 4]] as const) {
    const { db } = makeDb((call) => {
      if (call === 1) return { rows: [activation] };
      if (call === 2) return { rows: [replaySelection] };
      if (call === 3) return { rows: [candidateRow()] };
      if (call === 4) return { rows: [replaySelection] };
      return { rows: [] };
    });
    const replayed = await new DrizzleOAuthProviderConnectionRepository(db).selectTarget({
      attemptId, scope, actorUserId: "actor-1", expectedStageVersion,
      candidateId, targetId, targetKind: "youtube_channel", now: "2026-07-21T12:04:00.000Z",
    });
    assert.equal(Boolean(replayed), targetId === "channel-1" && expectedStageVersion === 5);
  }
});

test("exchange-indeterminate and failure mutations require exact live lease and fencing", async () => {
  for (const operation of ["indeterminate", "failed"] as const) {
    const { db, calls } = makeDb(() => ({ rows: [] }));
    const repository = new DrizzleOAuthProviderConnectionRepository(db);
    if (operation === "indeterminate") await repository.markExchangeIndeterminate({
      attemptId, scope, leaseToken, leaseFencing: 9, now: "2026-07-21T12:01:00.000Z",
    });
    else await repository.markFailed({ attemptId, scope, leaseToken, leaseFencing: 9,
      now: "2026-07-21T12:01:00.000Z", failureCode: "provider_rejected" });
    const sql = calls[0].sql.replace(/\s+/g, " ");
    assert.match(sql, /lease_token\s*=/i);
    assert.match(sql, /lease_fencing\s*=/i);
    assert.match(sql, /lease_expires_at\s*>\s*clock_timestamp\(\)/i);
  }
});
