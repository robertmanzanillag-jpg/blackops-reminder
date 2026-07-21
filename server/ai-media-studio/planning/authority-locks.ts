import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";

export interface AuthorityLockExecutor {
  execute(query: SQL): Promise<unknown>;
}

/**
 * These lock-key formats are part of the durable admission protocol. Writers
 * and readers must share them exactly or an append-only revision can race an
 * admission decision.
 */
export function authorityWorkspaceLockKey(scope: TenantScope): string {
  return `ai-media:daily-admission:workspace:${scope.ownerUserId}:${scope.workspaceId}`;
}

export function governanceProfileLockKey(scope: TenantScope, influencerId: string): string {
  return `ai-media-governance:profile:${scope.ownerUserId}:${scope.workspaceId}:${influencerId}`;
}

export function authorityIdempotencyLockKey(
  scope: TenantScope,
  operation: string,
  idempotencyKey: string,
): string {
  return `ai-media:launch-authority:idempotency:${scope.ownerUserId}:${scope.workspaceId}:${operation}:${idempotencyKey}`;
}

export async function lockAuthorityWorkspace(
  tx: AuthorityLockExecutor,
  scope: TenantScope,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${authorityWorkspaceLockKey(scope)}, 0))
      AS workspace_locked
  `);
}

export async function lockGovernanceProfile(
  tx: AuthorityLockExecutor,
  scope: TenantScope,
  influencerId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${governanceProfileLockKey(scope, influencerId)}, 0))
      AS governance_profile_locked
  `);
}

export async function lockAuthorityIdempotency(
  tx: AuthorityLockExecutor,
  scope: TenantScope,
  operation: string,
  idempotencyKey: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(
      ${authorityIdempotencyLockKey(scope, operation, idempotencyKey)}, 0
    )) AS authority_idempotency_locked
  `);
}
