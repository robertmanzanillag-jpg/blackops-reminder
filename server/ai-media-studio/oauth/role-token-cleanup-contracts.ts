import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";
import type { OAuthRoleTokenVaultContext } from "./role-token-vault-contracts";

export const OAUTH_ROLE_TOKEN_CLEANUP_OPERATION_BUDGET_MS = 15_000;
export const OAUTH_ROLE_TOKEN_CLEANUP_SETTLE_MS = 60_000;
export const OAUTH_ROLE_TOKEN_CLEANUP_MAX_BATCH = 100;

export type OAuthRoleTokenCleanupState =
  | "cleanup_pending" | "leased" | "retry_wait" | "verify_wait" | "completed" | "dead_letter";
export type OAuthRoleTokenCleanupErrorCode =
  | "vault_rejected" | "vault_timeout" | "lease_lost" | "invalid_obligation";

export type OAuthRoleTokenCleanupItem = Readonly<{
  id: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  oauthSessionId: string;
  attemptId: string;
  credentialBindingId: string;
  artifactId: string;
  artifactBindingId: string;
  role: OAuthRoleTokenVaultContext["role"];
  vaultReference: string;
  context: OAuthRoleTokenVaultContext;
  state: OAuthRoleTokenCleanupState;
  attempt: number;
  maxAttempts: number;
  deletePass: 0 | 1;
  availableAt: string;
  quiescentUntil: string;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  leaseFencing: number;
}>;

export type OAuthRoleTokenCleanupLease = Readonly<{
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
}>;

export type OAuthRoleTokenCleanupCas = Readonly<{
  id: string;
  leaseToken: string;
  leaseFencing: number;
}>;

export interface OAuthRoleTokenCleanupRepository {
  claimDue(input: {
    limit: number;
    lease: OAuthRoleTokenCleanupLease;
  }): Promise<readonly OAuthRoleTokenCleanupItem[]>;
  acknowledgeDelete(input: OAuthRoleTokenCleanupCas): Promise<"verify_wait" | "completed" | undefined>;
  recordFailure(input: OAuthRoleTokenCleanupCas & {
    errorCode: OAuthRoleTokenCleanupErrorCode;
  }): Promise<"retry_wait" | "dead_letter" | undefined>;
}
