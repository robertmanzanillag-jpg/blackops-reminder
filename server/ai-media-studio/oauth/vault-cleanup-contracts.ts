import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";
import type { OAuthAuthorizationCodeVaultContext, OAuthTokenVaultContext, OAuthVaultContext } from "./contracts";

export const OAUTH_VAULT_OPERATION_BUDGET_MS = 15_000;
export const OAUTH_VAULT_SETTLE_MS = 60_000;
export type OAuthVaultCleanupKind = "pkce_verifier" | "authorization_code" | "token_credential";
export type OAuthVaultCleanupState = "scheduled" | "leased" | "retry_wait" | "verify_wait" | "retained" | "completed" | "dead_letter";
export type OAuthVaultCleanupErrorCode = "vault_rejected" | "vault_timeout" | "lease_lost" | "invalid_obligation";

export type OAuthVaultCleanupItem = Readonly<{
  id: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  sessionId: string;
  kind: OAuthVaultCleanupKind;
  reference: string;
  context: OAuthVaultContext | OAuthAuthorizationCodeVaultContext | OAuthTokenVaultContext;
  state: OAuthVaultCleanupState;
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

export type OAuthVaultCleanupLease = Readonly<{
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
}>;

export type OAuthVaultCleanupCas = Readonly<{
  id: string;
  leaseToken: string;
  leaseFencing: number;
}>;

export interface OAuthVaultCleanupRepository {
  claimDue(input: { limit: number; lease: OAuthVaultCleanupLease }): Promise<readonly OAuthVaultCleanupItem[]>;
  acknowledgeDelete(input: OAuthVaultCleanupCas): Promise<"verify_wait" | "completed" | undefined>;
  recordFailure(input: OAuthVaultCleanupCas & { errorCode: OAuthVaultCleanupErrorCode }): Promise<"retry_wait" | "dead_letter" | undefined>;
}
