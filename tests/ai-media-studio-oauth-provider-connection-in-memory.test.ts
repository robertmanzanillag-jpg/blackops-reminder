import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOAuthProviderConnectionRepository } from "../server/ai-media-studio/oauth/provider-connection-in-memory";
import { OAuthProviderConnectionError, type CreateOAuthProviderConnectionAttempt } from "../server/ai-media-studio/oauth/provider-connection-contracts";

const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };

function createInput(id = "attempt-1"): CreateOAuthProviderConnectionAttempt {
  return {
    id, scope, actorUserId: "actor-1", providerAccountId: "account-1", oauthSessionId: `session-${id}`,
    platform: "tiktok", grantFamily: "tiktok_user", manifestRevision: "tiktok-v2",
    allowedScopes: ["user.info.basic", "video.publish"], requiredScopes: ["video.publish"],
    tokenBindingId: `binding-${id}`, expectedCredentialVersion: 3, targetCredentialVersion: 4,
    expiresAt: "2026-07-21T14:00:00.000Z", createdAt: "2026-07-21T12:00:00.000Z",
  };
}

function claimInput(stage: "exchange_pending" | "discovery_pending" | "activation_pending", owner: string, now = "2026-07-21T12:01:00.000Z") {
  return { attemptId: "attempt-1", scope, stage, leaseToken: `lease-${owner}`, leaseOwner: owner, leaseExpiresAt: "2026-07-21T12:05:00.000Z", now } as const;
}

async function throughExchange(repository: InMemoryOAuthProviderConnectionRepository) {
  const claim = await repository.claim(claimInput("exchange_pending", "exchange"));
  assert.ok(claim);
  const completed = await repository.markExchangeComplete({
    attemptId: "attempt-1", scope, leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing,
    now: "2026-07-21T12:02:00.000Z", actualScopes: ["video.publish", "user.info.basic"],
    tokenArtifacts: [
      { role: "operational_access", lifetime: { kind: "expires_at", expiresAt: "2026-07-21T14:00:00.000Z", revalidateAt: "2026-07-21T13:00:00.000Z" } },
      { role: "refresh", lifetime: { kind: "expires_at", expiresAt: "2026-07-22T14:00:00.000Z", revalidateAt: "2026-07-22T12:00:00.000Z" } },
    ],
  });
  assert.equal(completed?.stage, "discovery_pending");
}

test("only one worker wins a pending-stage race", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  await repository.create(createInput());
  await assert.rejects(repository.claim({ ...claimInput("exchange_pending", "too-long"), leaseExpiresAt: "2026-07-21T12:06:00.001Z" }), OAuthProviderConnectionError);
  const [one, two] = await Promise.all([
    repository.claim(claimInput("exchange_pending", "one")),
    repository.claim(claimInput("exchange_pending", "two")),
  ]);
  assert.equal([one, two].filter(Boolean).length, 1);
});

test("attempt creation rejects duplicate session or token binding inside a tenant", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  const first = createInput();
  await repository.create(first);
  await assert.rejects(repository.create({ ...createInput("attempt-2"), oauthSessionId: first.oauthSessionId }), OAuthProviderConnectionError);
  await assert.rejects(repository.create({ ...createInput("attempt-3"), tokenBindingId: first.tokenBindingId }), OAuthProviderConnectionError);
  await assert.rejects(repository.create({ ...createInput("attempt-4"), scope: { ownerUserId: "owner-2", workspaceId: "workspace-2" }, tokenBindingId: first.tokenBindingId }), OAuthProviderConnectionError);
  await assert.rejects(repository.create({ ...createInput("attempt-5"), manifestRevision: "caller-invented-v99" }), OAuthProviderConnectionError);
});

test("an expired stage can be reclaimed and its stale fence cannot write", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  await repository.create(createInput());
  const stale = await repository.claim({ ...claimInput("exchange_pending", "stale"), leaseExpiresAt: "2026-07-21T12:02:00.000Z" });
  assert.ok(stale);
  const winner = await repository.claim({ ...claimInput("exchange_pending", "winner", "2026-07-21T12:03:00.000Z"), leaseExpiresAt: "2026-07-21T12:06:00.000Z" });
  assert.ok(winner);
  assert.equal(await repository.markExchangeIndeterminate({ attemptId: "attempt-1", scope, leaseToken: stale.leaseToken, leaseFencing: stale.leaseFencing, now: "2026-07-21T12:03:30.000Z" }), undefined);
  assert.equal((await repository.markExchangeIndeterminate({ attemptId: "attempt-1", scope, leaseToken: winner.leaseToken, leaseFencing: winner.leaseFencing, now: "2026-07-21T12:03:30.000Z" }))?.stage, "exchange_indeterminate");
});

test("zero, one, and many discovery candidates are recorded atomically and selection stays explicit", async () => {
  for (const count of [0, 1, 3]) {
    const repository = new InMemoryOAuthProviderConnectionRepository();
    await repository.create(createInput());
    await throughExchange(repository);
    const discovery = await repository.claim(claimInput("discovery_pending", "discover"));
    assert.ok(discovery);
    const candidates = Array.from({ length: count }, (_, index) => ({
      candidateId: `candidate-${index}`, targetId: `target-${index}`, kind: "tiktok_user" as const,
      displayName: `Target ${index}`, verifiedTasks: ["video.publish"], eligibilityDigest: String(index + 1).repeat(64),
      manifestRevision: "tiktok-v2", discoveredAt: "2026-07-21T12:02:00.000Z",
    }));
    const recorded = await repository.recordDiscovery({ attemptId: "attempt-1", scope, leaseToken: discovery.leaseToken, leaseFencing: discovery.leaseFencing, now: "2026-07-21T12:03:00.000Z", candidates });
    assert.equal(recorded?.stage, count === 0 ? "failed" : "awaiting_target");
    assert.equal(recorded?.failureCode, count === 0 ? "no_targets" : null);
    assert.equal(recorded?.candidates.length, count);
    assert.equal(recorded?.selectedTargetId, null, "a singleton must not be auto-selected");
    if (count === 1 && recorded) {
      const selected = await repository.selectTarget({ attemptId: "attempt-1", scope, actorUserId: "actor-1", expectedStageVersion: recorded.stageVersion, candidateId: "candidate-0", targetId: "target-0", targetKind: "tiktok_user", now: "2026-07-21T12:04:00.000Z" });
      assert.equal(selected?.stage, "activation_pending");
    }
  }
});

test("selection is exact, immutable, and idempotent only for an exact retry", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  await repository.create(createInput());
  await throughExchange(repository);
  const discovery = await repository.claim(claimInput("discovery_pending", "discover"));
  assert.ok(discovery);
  const recorded = await repository.recordDiscovery({ attemptId: "attempt-1", scope, leaseToken: discovery.leaseToken, leaseFencing: discovery.leaseFencing, now: "2026-07-21T12:03:00.000Z", candidates: [
    { candidateId: "candidate-1", targetId: "target-1", kind: "tiktok_user", displayName: "Target One", verifiedTasks: ["video.publish"], eligibilityDigest: "a".repeat(64), manifestRevision: "tiktok-v2", discoveredAt: "2026-07-21T12:02:00.000Z" },
  ] });
  assert.ok(recorded);
  const command = { attemptId: "attempt-1", scope, actorUserId: "actor-1", expectedStageVersion: recorded.stageVersion, candidateId: "candidate-1", targetId: "target-1", targetKind: "tiktok_user" as const, now: "2026-07-21T12:04:00.000Z" };
  assert.equal(await repository.selectTarget({ ...command, now: "2026-07-21T14:00:00.000Z" }), undefined);
  assert.deepEqual(await repository.selectTarget(command), await repository.selectTarget(command));
  await assert.rejects(repository.selectTarget({ ...command, targetId: "target-other" }), OAuthProviderConnectionError);
  await assert.rejects(repository.selectTarget({ ...command, expectedStageVersion: command.expectedStageVersion + 1 }), OAuthProviderConnectionError);
});

test("exchange rejects scope escalation and invalid artifact lifetime generically", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  await repository.create(createInput());
  const claim = await repository.claim(claimInput("exchange_pending", "exchange"));
  assert.ok(claim);
  const refresh = { role: "refresh" as const, lifetime: { kind: "expires_at" as const, expiresAt: "2026-07-22T13:00:00.000Z", revalidateAt: "2026-07-22T12:00:00.000Z" } };
  await assert.rejects(repository.markExchangeComplete({ attemptId: "attempt-1", scope, leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing, now: "2026-07-21T12:02:00.000Z", actualScopes: ["video.publish", "video.upload"], tokenArtifacts: [{ role: "operational_access", lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-07-22T12:00:00.000Z" } }, refresh] }), OAuthProviderConnectionError);
  await assert.rejects(repository.markExchangeComplete({ attemptId: "attempt-1", scope, leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing, now: "2026-07-21T12:02:00.000Z", actualScopes: ["video.publish"], tokenArtifacts: [{ role: "operational_access", lifetime: { kind: "expires_at", expiresAt: "2026-07-21T13:00:00.000Z", revalidateAt: "2026-07-21T13:30:00.000Z" } }, refresh] }), OAuthProviderConnectionError);
});

test("in-memory persistence canonicalizes caller objects and never retains secret-shaped extras", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  const unsafeCreate = { ...createInput(), client_secret: "never-store-create" };
  await repository.create(unsafeCreate);
  const exchange = await repository.claim({ attemptId: "attempt-1", scope, stage: "exchange_pending", leaseToken: "lease-1", leaseOwner: "worker-1", leaseExpiresAt: "2026-07-21T12:05:00.000Z", now: "2026-07-21T12:01:00.000Z" });
  assert.ok(exchange);
  const unsafeArtifact = {
    role: "operational_access" as const,
    lifetime: { kind: "expires_at" as const, expiresAt: "2026-07-22T12:00:00.000Z", revalidateAt: "2026-07-21T13:00:00.000Z" },
    access_token: "never-store-artifact",
  };
  await repository.markExchangeComplete({ attemptId: "attempt-1", scope, leaseToken: exchange.leaseToken, leaseFencing: exchange.leaseFencing,
    now: "2026-07-21T12:02:00.000Z", actualScopes: ["video.publish"], tokenArtifacts: [
      unsafeArtifact,
      { role: "refresh", lifetime: { kind: "expires_at", expiresAt: "2027-07-21T12:00:00.000Z", revalidateAt: "2026-08-21T12:00:00.000Z" }, refresh_token: "never-store-refresh" },
    ] });
  const discovery = await repository.claim({ attemptId: "attempt-1", scope, stage: "discovery_pending", leaseToken: "lease-2", leaseOwner: "worker-2", leaseExpiresAt: "2026-07-21T12:08:00.000Z", now: "2026-07-21T12:03:00.000Z" });
  assert.ok(discovery);
  await repository.recordDiscovery({ attemptId: "attempt-1", scope, leaseToken: discovery.leaseToken, leaseFencing: discovery.leaseFencing,
    now: "2026-07-21T12:04:00.000Z", candidates: [{ candidateId: "candidate-1", targetId: "target-1", kind: "tiktok_user",
      displayName: "Robert", verifiedTasks: ["video.publish"], eligibilityDigest: "a".repeat(64), manifestRevision: "tiktok-v2",
      discoveredAt: "2026-07-21T12:03:00.000Z", provider_json: "never-store-provider" }] });
  const persisted = JSON.stringify(await repository.get(scope, "attempt-1"));
  assert.doesNotMatch(persisted, /never-store|client_secret|access_token|refresh_token|provider_json/i);
});
