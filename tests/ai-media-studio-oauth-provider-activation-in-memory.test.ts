import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOAuthProviderConnectionRepository } from "../server/ai-media-studio/oauth/provider-connection-in-memory";
import {
  OAuthProviderConnectionError,
  oauthProviderActivationVaultReference,
  validateOAuthProviderActivationArtifacts,
  type CreateOAuthProviderConnectionAttempt,
  type FinalizeOAuthProviderActivation,
  type OAuthProviderActivationArtifactEvidence,
} from "../server/ai-media-studio/oauth/provider-connection-contracts";

const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
const artifactBindingId = "11111111-1111-4111-8111-111111111111";

function tiktokAttempt(id = "attempt-1", expectedCredentialVersion = 3): CreateOAuthProviderConnectionAttempt {
  return {
    id, scope, actorUserId: "actor-1", providerAccountId: "account-1", oauthSessionId: `session-${id}`,
    platform: "tiktok", grantFamily: "tiktok_user", manifestRevision: "tiktok-v2",
    allowedScopes: ["user.info.basic", "video.publish"], requiredScopes: ["video.publish"],
    tokenBindingId: `binding-${id}`, expectedCredentialVersion, targetCredentialVersion: expectedCredentialVersion + 1,
    expiresAt: "2026-07-21T14:00:00.000Z", createdAt: "2026-07-21T12:00:00.000Z",
  };
}

const tiktokArtifacts: readonly OAuthProviderActivationArtifactEvidence[] = [
  {
    role: "operational_access", artifactBindingId,
    vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "operational_access"),
    lifetime: { kind: "expires_at", expiresAt: "2026-07-21T14:00:00.000Z", revalidateAt: "2026-07-21T13:00:00.000Z" },
  },
  {
    role: "refresh", artifactBindingId,
    vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "refresh"),
    lifetime: { kind: "expires_at", expiresAt: "2026-07-22T14:00:00.000Z", revalidateAt: "2026-07-22T12:00:00.000Z" },
  },
];

async function selectedTikTok(repository: InMemoryOAuthProviderConnectionRepository, attempt = tiktokAttempt()) {
  await repository.create(attempt);
  const exchange = await repository.claim({ attemptId: attempt.id, scope, stage: "exchange_pending", leaseToken: "lease-exchange",
    leaseOwner: "exchange", leaseExpiresAt: "2026-07-21T12:05:00.000Z", now: "2026-07-21T12:01:00.000Z" });
  assert.ok(exchange);
  await repository.markExchangeComplete({ attemptId: attempt.id, scope, leaseToken: exchange.leaseToken,
    leaseFencing: exchange.leaseFencing, now: "2026-07-21T12:02:00.000Z",
    actualScopes: ["video.publish", "user.info.basic"], tokenArtifacts: tiktokArtifacts.map(({ role, lifetime }) => ({ role, lifetime })) });
  const discovery = await repository.claim({ attemptId: attempt.id, scope, stage: "discovery_pending", leaseToken: "lease-discovery",
    leaseOwner: "discovery", leaseExpiresAt: "2026-07-21T12:07:00.000Z", now: "2026-07-21T12:03:00.000Z" });
  assert.ok(discovery);
  const recorded = await repository.recordDiscovery({ attemptId: attempt.id, scope, leaseToken: discovery.leaseToken,
    leaseFencing: discovery.leaseFencing, now: "2026-07-21T12:04:00.000Z", candidates: [{
      candidateId: "candidate-1", targetId: "target-1", kind: "tiktok_user", displayName: "Kong TikTok",
      verifiedTasks: ["video.publish"], eligibilityDigest: "a".repeat(64), manifestRevision: "tiktok-v2",
      discoveredAt: "2026-07-21T12:03:30.000Z",
    }] });
  assert.ok(recorded);
  const selected = await repository.selectTarget({ attemptId: attempt.id, scope, actorUserId: "actor-1",
    expectedStageVersion: recorded.stageVersion, candidateId: "candidate-1", targetId: "target-1",
    targetKind: "tiktok_user", now: "2026-07-21T12:05:00.000Z" });
  assert.ok(selected);
  assert.match(selected.selectionDigest ?? "", /^[0-9a-f]{64}$/u);
  return selected;
}

async function activationClaim(repository: InMemoryOAuthProviderConnectionRepository, leaseToken = "lease-activation",
  now = "2026-07-21T12:06:00.000Z", leaseExpiresAt = "2026-07-21T12:10:00.000Z") {
  const claim = await repository.claim({ attemptId: "attempt-1", scope, stage: "activation_pending", leaseToken,
    leaseOwner: "activation", leaseExpiresAt, now });
  assert.ok(claim);
  return claim;
}

function activationCommand(
  claim: Awaited<ReturnType<typeof activationClaim>>,
  artifacts: readonly OAuthProviderActivationArtifactEvidence[] = tiktokArtifacts,
): FinalizeOAuthProviderActivation {
  const attempt = claim.attempt;
  assert.ok(attempt.selectedCandidateId && attempt.selectedTargetId && attempt.selectedTargetKind
    && attempt.selectedEligibilityDigest && attempt.selectedStageVersion && attempt.selectionDigest);
  return {
    attemptId: attempt.id, scope, leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing,
    now: "2026-07-21T12:07:00.000Z", actorUserId: "actor-1", activationStageVersion: attempt.stageVersion,
    selectedCandidateId: attempt.selectedCandidateId, selectedTargetId: attempt.selectedTargetId,
    selectedTargetKind: attempt.selectedTargetKind, selectedEligibilityDigest: attempt.selectedEligibilityDigest,
    selectedStageVersion: attempt.selectedStageVersion, selectionDigest: attempt.selectionDigest,
    tokenBindingId: attempt.tokenBindingId, artifactBindingId, artifacts,
    actualScopes: ["user.info.basic", "video.publish"], capabilities: ["publish_video"],
    manifestRevision: "tiktok-v2", expectedCredentialVersion: 3, targetCredentialVersion: 4,
  };
}

test("activation atomically authorizes the exact selected target and exact replay is idempotent", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  await repository.createActivationAccount({ scope, providerAccountId: "account-1", platform: "tiktok", credentialVersion: 3 });
  await selectedTikTok(repository);
  const claim = await activationClaim(repository);
  const unsafeArtifacts = tiktokArtifacts.map((artifact, index) => ({ ...artifact,
    ...(index === 0 ? { access_token: "never-store-access" } : { refresh_token: "never-store-refresh" }) }));
  const command = { ...activationCommand(claim, unsafeArtifacts), client_secret: "never-store-client-secret" };
  const first = await repository.finalizeActivation(command);
  assert.equal(first?.attempt.stage, "authorized");
  assert.equal(first?.attempt.stageVersion, claim.attempt.stageVersion + 1);
  assert.match(first?.attempt.authorizedDigest ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(first?.attempt.authorizedAt, command.now);
  assert.equal(first?.account.credentialVersion, 4);
  assert.equal(first?.account.targetId, "target-1");
  assert.equal(first?.account.artifactBindingId, artifactBindingId);
  assert.deepEqual(first?.account.grantedScopes, ["user.info.basic", "video.publish"]);
  assert.deepEqual(await repository.finalizeActivation(command), first);
  assert.deepEqual(await repository.finalizeActivation({ ...command,
    leaseToken: "reconciliation-lease", leaseFencing: command.leaseFencing + 99,
    now: "2026-07-21T12:07:01.000Z" }), first);
  const persisted = JSON.stringify({ attempt: await repository.get(scope, "attempt-1"),
    account: await repository.getActivationAccount(scope, "account-1", "tiktok") });
  assert.doesNotMatch(persisted, /never-store|access_token|refresh_token|client_secret/i);
  await assert.rejects(repository.finalizeActivation({ ...command, selectedTargetId: "target-other" }), OAuthProviderConnectionError);
});

test("activation rejects partial roles, altered selection, manifest, scopes and capabilities", async () => {
  for (const mutate of [
    (command: FinalizeOAuthProviderActivation) => ({ ...command, artifacts: [command.artifacts[0]!] }),
    (command: FinalizeOAuthProviderActivation) => ({ ...command, selectionDigest: "b".repeat(64) }),
    (command: FinalizeOAuthProviderActivation) => ({ ...command, selectedStageVersion: command.selectedStageVersion + 1 }),
    (command: FinalizeOAuthProviderActivation) => ({ ...command, manifestRevision: "caller-v99" }),
    (command: FinalizeOAuthProviderActivation) => ({ ...command, actualScopes: ["video.publish"] }),
    (command: FinalizeOAuthProviderActivation) => ({ ...command, capabilities: ["read_analytics" as const] }),
    (command: FinalizeOAuthProviderActivation) => ({ ...command, expectedCredentialVersion: 2, targetCredentialVersion: 3 }),
  ]) {
    const repository = new InMemoryOAuthProviderConnectionRepository();
    await repository.createActivationAccount({ scope, providerAccountId: "account-1", platform: "tiktok", credentialVersion: 3 });
    await selectedTikTok(repository);
    const claim = await activationClaim(repository);
    await assert.rejects(repository.finalizeActivation(mutate(activationCommand(claim))), OAuthProviderConnectionError);
    assert.equal((await repository.get(scope, "attempt-1"))?.stage, "activation_in_progress");
    assert.equal((await repository.getActivationAccount(scope, "account-1", "tiktok"))?.credentialVersion, 3);
  }
});

test("stale fences, expired attempts and account version conflicts cannot activate", async () => {
  const staleRepository = new InMemoryOAuthProviderConnectionRepository();
  await staleRepository.createActivationAccount({ scope, providerAccountId: "account-1", platform: "tiktok", credentialVersion: 3 });
  await selectedTikTok(staleRepository);
  const stale = await activationClaim(staleRepository, "lease-stale", "2026-07-21T12:06:00.000Z", "2026-07-21T12:08:00.000Z");
  const winner = await activationClaim(staleRepository, "lease-winner", "2026-07-21T12:09:00.000Z", "2026-07-21T12:12:00.000Z");
  assert.equal(await staleRepository.finalizeActivation(activationCommand(stale)), undefined);
  assert.equal((await staleRepository.finalizeActivation({ ...activationCommand(winner), now: "2026-07-21T12:10:00.000Z" }))?.attempt.stage, "authorized");

  const conflictRepository = new InMemoryOAuthProviderConnectionRepository();
  await conflictRepository.createActivationAccount({ scope, providerAccountId: "account-1", platform: "tiktok", credentialVersion: 2 });
  await selectedTikTok(conflictRepository);
  const conflict = await activationClaim(conflictRepository);
  assert.equal(await conflictRepository.finalizeActivation(activationCommand(conflict)), undefined);
  assert.equal((await conflictRepository.get(scope, "attempt-1"))?.stage, "activation_in_progress");

  const expiredRepository = new InMemoryOAuthProviderConnectionRepository();
  await selectedTikTok(expiredRepository);
  await assert.rejects(expiredRepository.claim({ attemptId: "attempt-1", scope, stage: "activation_pending",
    leaseToken: "lease-expired", leaseOwner: "activation", leaseExpiresAt: "2026-07-21T14:01:00.000Z",
    now: "2026-07-21T14:00:00.000Z" }), OAuthProviderConnectionError);
});

test("an ambiguous activation is terminal and is never reclaimed automatically", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  await repository.createActivationAccount({ scope, providerAccountId: "account-1", platform: "tiktok", credentialVersion: 3 });
  await selectedTikTok(repository);
  const claim = await activationClaim(repository);
  const indeterminate = await repository.markActivationIndeterminate({ attemptId: "attempt-1", scope,
    leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing, now: "2026-07-21T12:07:00.000Z" });
  assert.equal(indeterminate?.stage, "activation_indeterminate");
  assert.equal(await repository.claim({ attemptId: "attempt-1", scope, stage: "activation_pending",
    leaseToken: "lease-retry", leaseOwner: "activation", leaseExpiresAt: "2026-07-21T12:15:00.000Z",
    now: "2026-07-21T12:11:00.000Z" }), undefined);
  assert.equal(await repository.finalizeActivation(activationCommand(claim)), undefined);
  assert.equal((await repository.getActivationAccount(scope, "account-1", "tiktok"))?.credentialVersion, 3);
});

test("activation artifact contracts enforce provider-specific role sets and exact v2 references", () => {
  assert.deepEqual(validateOAuthProviderActivationArtifacts("tiktok_user", artifactBindingId,
    [tiktokArtifacts[1]!, tiktokArtifacts[0]!], "2026-07-21T12:07:00.000Z").map((artifact) => artifact.role),
  ["operational_access", "refresh"]);
  assert.throws(() => validateOAuthProviderActivationArtifacts("google_user", artifactBindingId,
    [tiktokArtifacts[0]!], "2026-07-21T12:07:00.000Z"), OAuthProviderConnectionError);
  const google = [tiktokArtifacts[0]!, {
    role: "refresh" as const, artifactBindingId,
    vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "refresh"),
    lifetime: { kind: "revocation_bound" as const, revalidateAt: "2026-08-21T12:00:00.000Z" },
  }];
  assert.deepEqual(validateOAuthProviderActivationArtifacts("google_user", artifactBindingId, google,
    "2026-07-21T12:07:00.000Z").map((artifact) => artifact.role), ["operational_access", "refresh"]);
  const meta = [{ role: "operational_access" as const, artifactBindingId,
    vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "operational_access"),
    lifetime: { kind: "provider_non_expiring" as const, revalidateAt: "2026-08-21T12:00:00.000Z" } }];
  assert.equal(validateOAuthProviderActivationArtifacts("meta_facebook_login", artifactBindingId, meta,
    "2026-07-21T12:07:00.000Z").length, 1);
  assert.throws(() => validateOAuthProviderActivationArtifacts("meta_facebook_login", artifactBindingId,
    tiktokArtifacts, "2026-07-21T12:07:00.000Z"), OAuthProviderConnectionError);
  assert.throws(() => validateOAuthProviderActivationArtifacts("tiktok_user", artifactBindingId,
    [{ ...tiktokArtifacts[0]!, vaultReference: "vault://ai-media-studio/oauth-token/v1/legacy" }, tiktokArtifacts[1]!],
    "2026-07-21T12:07:00.000Z"), OAuthProviderConnectionError);
});

test("Meta activation replaces grant evidence with exactly one target operational artifact", async () => {
  const repository = new InMemoryOAuthProviderConnectionRepository();
  const attempt: CreateOAuthProviderConnectionAttempt = {
    id: "attempt-meta", scope, actorUserId: "actor-1", providerAccountId: "account-meta",
    oauthSessionId: "session-meta", platform: "instagram", grantFamily: "meta_facebook_login",
    manifestRevision: "meta-graph-v23",
    allowedScopes: ["pages_show_list", "instagram_basic", "instagram_content_publish"],
    requiredScopes: ["instagram_basic", "instagram_content_publish"], tokenBindingId: "binding-meta",
    expectedCredentialVersion: 0, targetCredentialVersion: 1,
    expiresAt: "2026-07-21T14:00:00.000Z", createdAt: "2026-07-21T12:00:00.000Z",
  };
  await repository.createActivationAccount({ scope, providerAccountId: "account-meta", platform: "instagram", credentialVersion: 0 });
  await repository.create(attempt);
  const exchange = await repository.claim({ attemptId: attempt.id, scope, stage: "exchange_pending", leaseToken: "lease-meta-exchange",
    leaseOwner: "exchange", leaseExpiresAt: "2026-07-21T12:05:00.000Z", now: "2026-07-21T12:01:00.000Z" });
  assert.ok(exchange);
  await repository.markExchangeComplete({ attemptId: attempt.id, scope, leaseToken: exchange.leaseToken,
    leaseFencing: exchange.leaseFencing, now: "2026-07-21T12:02:00.000Z",
    actualScopes: ["instagram_content_publish", "pages_show_list", "instagram_basic"], tokenArtifacts: [{
      role: "grant_user_access", lifetime: { kind: "expires_at", expiresAt: "2026-09-21T12:00:00.000Z",
        revalidateAt: "2026-08-21T12:00:00.000Z" },
    }] });
  const discovery = await repository.claim({ attemptId: attempt.id, scope, stage: "discovery_pending", leaseToken: "lease-meta-discovery",
    leaseOwner: "discovery", leaseExpiresAt: "2026-07-21T12:07:00.000Z", now: "2026-07-21T12:03:00.000Z" });
  assert.ok(discovery);
  const recorded = await repository.recordDiscovery({ attemptId: attempt.id, scope, leaseToken: discovery.leaseToken,
    leaseFencing: discovery.leaseFencing, now: "2026-07-21T12:04:00.000Z", candidates: [{
      candidateId: "candidate-meta", targetId: "ig-1", kind: "instagram_professional_account", displayName: "Kong IG",
      parentTargetId: "page-1", verifiedTasks: ["instagram_content_publish"], eligibilityDigest: "c".repeat(64),
      manifestRevision: "meta-graph-v23", discoveredAt: "2026-07-21T12:03:30.000Z",
    }] });
  assert.ok(recorded);
  const selected = await repository.selectTarget({ attemptId: attempt.id, scope, actorUserId: "actor-1",
    expectedStageVersion: recorded.stageVersion, candidateId: "candidate-meta", targetId: "ig-1",
    targetKind: "instagram_professional_account", now: "2026-07-21T12:05:00.000Z" });
  assert.ok(selected?.selectionDigest && selected.selectedStageVersion && selected.selectedEligibilityDigest);
  const claim = await repository.claim({ attemptId: attempt.id, scope, stage: "activation_pending", leaseToken: "lease-meta-activation",
    leaseOwner: "activation", leaseExpiresAt: "2026-07-21T12:10:00.000Z", now: "2026-07-21T12:06:00.000Z" });
  assert.ok(claim);
  const operational: OAuthProviderActivationArtifactEvidence = {
    role: "operational_access", artifactBindingId,
    vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "operational_access"),
    lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-08-21T12:00:00.000Z" },
  };
  const command: FinalizeOAuthProviderActivation = {
    attemptId: attempt.id, scope, leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing,
    now: "2026-07-21T12:07:00.000Z", actorUserId: "actor-1", activationStageVersion: claim.attempt.stageVersion,
    selectedCandidateId: "candidate-meta", selectedTargetId: "ig-1", selectedTargetKind: "instagram_professional_account",
    selectedEligibilityDigest: selected.selectedEligibilityDigest, selectedStageVersion: selected.selectedStageVersion,
    selectionDigest: selected.selectionDigest, tokenBindingId: "binding-meta", artifactBindingId,
    artifacts: [operational], actualScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    capabilities: ["publish_video"], manifestRevision: "meta-graph-v23",
    expectedCredentialVersion: 0, targetCredentialVersion: 1,
  };
  const activated = await repository.finalizeActivation(command);
  assert.equal(activated?.attempt.stage, "authorized");
  assert.deepEqual(activated?.account.artifacts.map((artifact) => artifact.role), ["operational_access"]);
  assert.equal(JSON.stringify(activated).includes("grant_user_access"), true, "attempt retains safe grant lifetime evidence");
  assert.deepEqual(activated?.account.capabilities, ["publish_video"]);
});
