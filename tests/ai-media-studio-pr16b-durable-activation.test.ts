import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveOAuthProviderActivationIndeterminateDigest,
  deriveOAuthProviderAuthorizedDigest,
  deriveOAuthProviderSelectionDigest,
  oauthProviderActivationVaultReference,
} from "../server/ai-media-studio/oauth/provider-connection-contracts";

const source = readFileSync(new URL("../server/ai-media-studio/oauth/drizzle-provider-activation-repository.ts", import.meta.url), "utf8");
const connectionSource = readFileSync(new URL("../server/ai-media-studio/oauth/drizzle-provider-connection-repository.ts", import.meta.url), "utf8");
const forward = readFileSync(new URL("../migrations/ai-media-studio/20260721_pr16b_durable_activation_forward.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/ai-media-studio/20260721_pr16b_durable_activation_rollback.sql", import.meta.url), "utf8");

test("PR16B stages the complete secret-free graph before vault I/O and forces immediate validation", () => {
  for (const table of ["aiMediaProviderAccountCredentialBindings", "aiMediaOAuthCredentialArtifacts", "aiMediaOAuthVaultOperationsV2"]) {
    assert.ok(source.includes(`INSERT INTO \${${table}}`));
  }
  assert.match(source, /credentialBindingId.*artifactId.*cleanupOperationId/su);
  assert.match(source, /'cleanup_pending'/u);
  assert.match(source, /SET CONSTRAINTS ALL IMMEDIATE/u);
  assert.doesNotMatch(source, /access[_ ]?token|refresh[_ ]?token|client[_ ]?secret|provider[_ ]?(payload|json)/iu);
});

test("PR16B lock order and CAS paths are explicit and partial writes throw for rollback", () => {
  const account = source.indexOf("lockAccountFirst");
  const attempt = source.indexOf("FROM ${aiMediaOAuthConnectionAttempts}", account);
  const selection = source.indexOf("FROM ${aiMediaOAuthTargetSelections}", attempt);
  const binding = source.indexOf("FROM ${aiMediaProviderAccountCredentialBindings}", selection);
  const artifacts = source.indexOf("FROM ${aiMediaOAuthCredentialArtifacts}", binding);
  const operations = source.indexOf("FROM ${aiMediaOAuthVaultOperationsV2}", artifacts);
  assert.ok(account >= 0 && account < attempt && attempt < selection && selection < binding && binding < artifacts && artifacts < operations);
  assert.match(source, /if \(!updatedAccount\) throw new ActivationCasLost/u);
  assert.match(source, /if \(!terminal\) throw new ActivationCasLost/u);
  assert.match(source, /updatedArtifacts\.length !== artifactRows\.length/u);
  assert.match(source, /updatedOperations\.length !== operationRows\.length/u);
  assert.match(source, /binding\.state === "authorized"[\s\S]*attempt\.stage !== "activation_in_progress"[\s\S]*Date\.parse\(attempt\.leaseExpiresAt\) <= Date\.parse\(databaseNow\)/u);
});

test("selection and authorization digests are canonical and indeterminate evidence has its own domain", () => {
  const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
  const selection = deriveOAuthProviderSelectionDigest({ attemptId: "attempt-1", scope, actorUserId: "actor-1",
    providerAccountId: "account-1", oauthSessionId: "session-1", platform: "tiktok", grantFamily: "tiktok_user",
    candidateId: "candidate-1", targetId: "target-1", targetKind: "tiktok_user", eligibilityDigest: "e".repeat(64),
    selectedStageVersion: 7, selectedAt: "2026-07-21T12:00:00.000Z", manifestRevision: "tiktok-v2",
    tokenBindingId: "16000000-0001-4000-8000-000000000001", expectedCredentialVersion: 0,
    targetCredentialVersion: 1, actualScopes: ["video.publish", "user.info.basic"], capabilities: ["publish_video"] });
  assert.equal(selection, deriveOAuthProviderSelectionDigest({ attemptId: "attempt-1", scope, actorUserId: "actor-1",
    providerAccountId: "account-1", oauthSessionId: "session-1", platform: "tiktok", grantFamily: "tiktok_user",
    candidateId: "candidate-1", targetId: "target-1", targetKind: "tiktok_user", eligibilityDigest: "e".repeat(64),
    selectedStageVersion: 7, selectedAt: "2026-07-21T12:00:00.000Z", manifestRevision: "tiktok-v2",
    tokenBindingId: "16000000-0001-4000-8000-000000000001", expectedCredentialVersion: 0,
    targetCredentialVersion: 1, actualScopes: ["user.info.basic", "video.publish"], capabilities: ["publish_video"] }));
  const indeterminate = deriveOAuthProviderActivationIndeterminateDigest({ attemptId: "attempt-1", scope,
    credentialBindingId: "16000000-0002-4000-8000-000000000002", artifactBindingId: "16000000-0003-4000-8000-000000000003",
    leaseFencing: 4, artifactIds: ["b", "a"], cleanupOperationIds: ["d", "c"] });
  assert.match(indeterminate, /^[0-9a-f]{64}$/u);
  const artifactBindingId = "16000000-0003-4000-8000-000000000003";
  const command = { attemptId: "attempt-1", scope, actorUserId: "actor-1", leaseToken: "16000000-0004-4000-8000-000000000004",
    leaseFencing: 4, now: "2026-07-21T12:01:00.000Z", activationStageVersion: 8, selectedCandidateId: "candidate-1",
    selectedTargetId: "target-1", selectedTargetKind: "tiktok_user" as const, selectedEligibilityDigest: "e".repeat(64),
    selectedStageVersion: 7, selectionDigest: selection, tokenBindingId: "16000000-0001-4000-8000-000000000001",
    artifactBindingId, artifacts: [{ role: "operational_access" as const, artifactBindingId,
      vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "operational_access"), manifestRevision: "tiktok-v2",
      lifetime: { kind: "expires_at" as const, expiresAt: "2026-08-21T12:00:00.000Z", revalidateAt: "2026-08-01T12:00:00.000Z" } },
    { role: "refresh" as const, artifactBindingId, vaultReference: oauthProviderActivationVaultReference(artifactBindingId, "refresh"),
      manifestRevision: "tiktok-v2", lifetime: { kind: "expires_at" as const, expiresAt: "2027-07-21T12:00:00.000Z",
        revalidateAt: "2026-09-01T12:00:00.000Z" } }], actualScopes: ["video.publish", "user.info.basic"],
    capabilities: ["publish_video" as const], manifestRevision: "tiktok-v2", expectedCredentialVersion: 0, targetCredentialVersion: 1 };
  assert.match(deriveOAuthProviderAuthorizedDigest(command), /^[0-9a-f]{64}$/u);
  assert.notEqual(deriveOAuthProviderAuthorizedDigest(command), indeterminate);
});

test("PR16B migration owns selection time/digest, blocks staged cleanup, and rollback preserves evidence", () => {
  assert.match(forward, /date_trunc\('milliseconds',clock_timestamp\(\)\)/u);
  assert.match(forward, /SELECT \* INTO STRICT candidate_row/u);
  assert.match(forward, /binding_state IS DISTINCT FROM 'abandoned'/u);
  assert.match(forward, /refuses deployment while a PR16A activation is staged/u);
  assert.doesNotMatch(rollback, /DROP TABLE|DELETE FROM|TRUNCATE/u);
  assert.match(connectionSource, /deriveOAuthProviderSelectionDigest/u);
  assert.match(connectionSource, /NOT EXISTS[\s\S]*bindings\.state='staged'/u);
});
