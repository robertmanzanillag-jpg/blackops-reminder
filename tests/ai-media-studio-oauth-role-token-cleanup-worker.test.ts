import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthRoleTokenCleanupWorker } from "../server/ai-media-studio/oauth/role-token-cleanup-worker";
import type { OAuthRoleTokenCleanupItem, OAuthRoleTokenCleanupRepository } from "../server/ai-media-studio/oauth/role-token-cleanup-contracts";
import type { OAuthRoleTokenVault } from "../server/ai-media-studio/oauth/role-token-vault-contracts";

const IDS = {
  operation: "11111111-1111-4111-8111-111111111111",
  account: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
  binding: "55555555-5555-4555-8555-555555555555",
  artifact: "66666666-6666-4666-8666-666666666666",
  artifactBinding: "77777777-7777-4777-8777-777777777777",
  tokenBinding: "88888888-8888-4888-8888-888888888888",
  candidate: "99999999-9999-4999-8999-999999999999",
};

function item(deletePass: 0 | 1 = 0): OAuthRoleTokenCleanupItem {
  const context = {
    purpose: "ai_media_oauth_role_token_v2" as const,
    ownerUserId: "owner", workspaceId: "workspace", actorUserId: "actor",
    providerAccountId: IDS.account, platform: "tiktok" as const, sessionId: IDS.session,
    attemptId: IDS.attempt, targetCredentialVersion: 1, tokenBindingId: IDS.tokenBinding,
    artifactBindingId: IDS.artifactBinding, role: "operational_access" as const,
    candidateId: IDS.candidate, targetKind: "tiktok_user" as const, targetId: "target-1",
    selectionDigest: "a".repeat(64), manifestRevision: "tiktok-v2",
  };
  return Object.freeze({
    id: IDS.operation, scope: { ownerUserId: "owner", workspaceId: "workspace" }, actorUserId: "actor",
    providerAccountId: IDS.account, platform: "tiktok", oauthSessionId: IDS.session, attemptId: IDS.attempt,
    credentialBindingId: IDS.binding, artifactId: IDS.artifact, artifactBindingId: IDS.artifactBinding,
    role: "operational_access", vaultReference: `vault://ai-media-studio/oauth-role-token/v2/${"b".repeat(64)}`,
    context, state: "leased", attempt: 1, maxAttempts: 8, deletePass,
    availableAt: "2026-07-21T12:00:00.000Z", quiescentUntil: "2026-07-21T12:00:00.000Z",
    leaseToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", leaseOwner: "worker",
    leaseExpiresAt: "2026-07-21T12:05:00.000Z", leaseFencing: 1,
  });
}

function vault(deleteFn: OAuthRoleTokenVault["delete"]): OAuthRoleTokenVault {
  return { async putOnce() { throw new Error("unused"); }, async find() { return undefined; },
    async readDescriptor() { throw new Error("secret-reader-sentinel"); }, delete: deleteFn };
}

test("worker is inert until run, invokes only exact roleTokenVault.delete context, and completes independent work", async () => {
  let claims = 0; const acknowledgements: unknown[] = []; const deletes: unknown[][] = [];
  const repository: OAuthRoleTokenCleanupRepository = {
    async claimDue() { claims += 1; return [item()]; },
    async acknowledgeDelete(input) { acknowledgements.push(input); return "verify_wait"; },
    async recordFailure() { return "retry_wait"; },
  };
  const worker = createOAuthRoleTokenCleanupWorker({ repository, roleTokenVault: vault(async (...args) => { deletes.push(args); }) });
  assert.equal(claims, 0);
  const result = await worker.runOnce({ limit: 1, leaseOwner: "worker" });
  assert.equal(result.verifyWait, 1);
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0], [item().vaultReference, item().context]);
  assert.equal(JSON.stringify(acknowledgements).includes("secret-reader-sentinel"), false);
});

test("worker repeats idempotent delete after lost acknowledgement and on the verification pass", async () => {
  let deletes = 0; let acknowledgements = 0;
  const repository: OAuthRoleTokenCleanupRepository = {
    async claimDue() { return [item(acknowledgements >= 2 ? 1 : 0)]; },
    async acknowledgeDelete() { acknowledgements += 1; return acknowledgements === 1 ? undefined : acknowledgements === 2 ? "verify_wait" : "completed"; },
    async recordFailure() { return "retry_wait"; },
  };
  const worker = createOAuthRoleTokenCleanupWorker({ repository, roleTokenVault: vault(async () => { deletes += 1; }) });
  assert.equal((await worker.runOnce({ limit: 1, leaseOwner: "worker" })).leaseLost, 1);
  assert.equal((await worker.runOnce({ limit: 1, leaseOwner: "worker" })).verifyWait, 1);
  assert.equal((await worker.runOnce({ limit: 1, leaseOwner: "worker" })).completed, 1);
  assert.equal(deletes, 3);
});

test("worker bounds vault delete and records only safe timeout code", async () => {
  const failures: unknown[] = [];
  const repository: OAuthRoleTokenCleanupRepository = {
    async claimDue() { return [item()]; }, async acknowledgeDelete() { return "completed"; },
    async recordFailure(input) { failures.push(input); return "retry_wait"; },
  };
  const worker = createOAuthRoleTokenCleanupWorker({ repository,
    roleTokenVault: vault(async () => new Promise<void>(() => {})), operationBudgetMs: 5 });
  const result = await worker.runOnce({ limit: 1, leaseOwner: "worker" });
  assert.equal(result.failed, 1);
  assert.equal((failures[0] as { errorCode: string }).errorCode, "vault_timeout");
});
