import { randomUUID } from "node:crypto";
import type { OAuthRoleTokenVault } from "./role-token-vault-contracts";
import {
  OAUTH_ROLE_TOKEN_CLEANUP_MAX_BATCH,
  OAUTH_ROLE_TOKEN_CLEANUP_OPERATION_BUDGET_MS,
  type OAuthRoleTokenCleanupErrorCode,
  type OAuthRoleTokenCleanupItem,
  type OAuthRoleTokenCleanupRepository,
} from "./role-token-cleanup-contracts";

class RoleTokenCleanupTimeout extends Error {}

export type OAuthRoleTokenCleanupRunResult = Readonly<{
  claimed: number;
  completed: number;
  verifyWait: number;
  failed: number;
  deadLettered: number;
  leaseLost: number;
}>;

export function createOAuthRoleTokenCleanupWorker(dependencies: {
  repository: OAuthRoleTokenCleanupRepository;
  roleTokenVault: OAuthRoleTokenVault;
  clock?: () => Date;
  operationBudgetMs?: number;
}) {
  const clock = dependencies.clock ?? (() => new Date());
  const budgetMs = dependencies.operationBudgetMs ?? OAUTH_ROLE_TOKEN_CLEANUP_OPERATION_BUDGET_MS;
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > OAUTH_ROLE_TOKEN_CLEANUP_OPERATION_BUDGET_MS) {
    throw new Error("Invalid role token cleanup worker");
  }

  return Object.freeze({
    async runOnce(input: { limit: number; leaseOwner: string; leaseMs?: number }): Promise<OAuthRoleTokenCleanupRunResult> {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > OAUTH_ROLE_TOKEN_CLEANUP_MAX_BATCH
        || typeof input.leaseOwner !== "string" || input.leaseOwner.trim().length < 1 || input.leaseOwner.length > 255) {
        throw new Error("Invalid role token cleanup run");
      }
      const now = clock();
      const leaseMs = input.leaseMs ?? 120_000;
      if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(leaseMs) || leaseMs < 30_000 || leaseMs > 300_000) {
        throw new Error("Invalid role token cleanup run");
      }
      const claimed = await dependencies.repository.claimDue({
        limit: input.limit,
        lease: {
          leaseToken: randomUUID(),
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        },
      });
      let completed = 0; let verifyWait = 0; let failed = 0; let deadLettered = 0; let leaseLost = 0;
      for (const item of claimed) {
        const cas = { id: item.id, leaseToken: item.leaseToken, leaseFencing: item.leaseFencing };
        try {
          await deleteWithinBudget(item, dependencies.roleTokenVault, budgetMs);
          const state = await dependencies.repository.acknowledgeDelete(cas);
          if (state === "completed") completed += 1;
          else if (state === "verify_wait") verifyWait += 1;
          else leaseLost += 1;
        } catch (error) {
          const errorCode: OAuthRoleTokenCleanupErrorCode = error instanceof RoleTokenCleanupTimeout
            ? "vault_timeout"
            : validItem(item) ? "vault_rejected" : "invalid_obligation";
          const state = await dependencies.repository.recordFailure({ ...cas, errorCode });
          if (state === "dead_letter") deadLettered += 1;
          else if (state === "retry_wait") failed += 1;
          else leaseLost += 1;
        }
      }
      return Object.freeze({ claimed: claimed.length, completed, verifyWait, failed, deadLettered, leaseLost });
    },
  });
}

async function deleteWithinBudget(
  item: OAuthRoleTokenCleanupItem,
  vault: OAuthRoleTokenVault,
  budgetMs: number,
): Promise<void> {
  if (!validItem(item)) throw new Error("Invalid role token cleanup obligation");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RoleTokenCleanupTimeout()), budgetMs);
    timer.unref?.();
  });
  try {
    await Promise.race([vault.delete(item.vaultReference, item.context), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validItem(item: OAuthRoleTokenCleanupItem): boolean {
  return item?.state === "leased" && (item.deletePass === 0 || item.deletePass === 1)
    && typeof item.vaultReference === "string"
    && item.vaultReference.startsWith("vault://ai-media-studio/oauth-role-token/v2/")
    && item.context?.purpose === "ai_media_oauth_role_token_v2"
    && item.context.artifactBindingId === item.artifactBindingId
    && item.context.role === item.role;
}
