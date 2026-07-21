import type {
  AiMediaOAuthExchangeStatus,
  AiMediaOAuthOutcome,
  AiMediaOAuthPkceMode,
  AiMediaOAuthPlatform,
} from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";

export type OAuthSessionStatus = "pending" | "processing" | "consumed";
export type OAuthDeniedOrErrorOutcome = Exclude<AiMediaOAuthOutcome, "authorized">;

/** Internal durable record. References are opaque; no secret value is represented here. */
export type OAuthSession = Readonly<{
  id: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  stateDigest: string;
  redirectUri: string;
  requestedScopes: readonly string[];
  pkceMode: AiMediaOAuthPkceMode;
  codeChallenge: string | null;
  codeChallengeMethod: "S256" | null;
  pkceVerifierRef: string | null;
  status: OAuthSessionStatus;
  exchangeStatus: AiMediaOAuthExchangeStatus;
  leaseToken: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  leaseFencing: number;
  authorizationCodeDigest: string | null;
  authorizationCodeRef: string | null;
  expectedCredentialVersion: number | null;
  targetCredentialVersion: number | null;
  tokenBindingId: string | null;
  failureCode: OAuthAuthorizationFailureCode | null;
  outcome: AiMediaOAuthOutcome | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateOAuthSession = Omit<OAuthSession,
  "status" | "exchangeStatus" | "leaseToken" | "leaseOwner" | "leaseExpiresAt" | "leaseFencing"
  | "authorizationCodeDigest" | "authorizationCodeRef" | "expectedCredentialVersion"
  | "targetCredentialVersion" | "tokenBindingId" | "failureCode" | "outcome" | "consumedAt" | "updatedAt">;

export type ConsumeDeniedOrErrorOAuthSession = Readonly<{
  stateDigest: string;
  platform: AiMediaOAuthPlatform;
  outcome: OAuthDeniedOrErrorOutcome;
  now: string;
}>;

export interface OAuthSessionRepository {
  create(session: CreateOAuthSession): Promise<OAuthSession>;
  consumeDeniedOrError(input: ConsumeDeniedOrErrorOAuthSession): Promise<OAuthSession | undefined>;
}

export type OAuthAuthorizationFailureCode =
  | "provider_rejected" | "vault_unavailable" | "candidate_missing" | "credential_conflict"
  | "identity_conflict" | "invalid_provider_result";

export type OAuthAuthorizationClaim = Readonly<{
  session: OAuthSession;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  leaseFencing: number;
  expectedCredentialVersion: number;
  targetCredentialVersion: number;
  tokenBindingId: string;
  recovery: "pre_exchange" | "post_exchange";
}>;

export type ClaimOAuthAuthorization = Readonly<{
  stateDigest: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  codeDigest: string;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: string;
}>;

export type OAuthLeaseCommand = Readonly<{
  sessionId: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  leaseToken: string;
  leaseFencing: number;
  now: string;
}>;

export type OAuthSafeTokenDescriptor = Readonly<{
  tokenBindingId: string;
  platform: AiMediaOAuthPlatform;
  externalAccountId: string;
  scopes: readonly string[];
  capabilities: readonly string[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  tokenKind: "Bearer";
  manifestRevision: string;
}>;

export type OAuthFinalizeAuthorization = OAuthLeaseCommand & Readonly<{
  tokenReference: string;
  descriptor: OAuthSafeTokenDescriptor;
  consumedAt: string;
}>;

export interface OAuthAuthorizationSagaRepository {
  claim(input: ClaimOAuthAuthorization): Promise<OAuthAuthorizationClaim | undefined>;
  attachAuthorizationCode(input: OAuthLeaseCommand & { authorizationCodeRef: string }): Promise<OAuthAuthorizationClaim | undefined>;
  markExchangeStarted(input: OAuthLeaseCommand): Promise<OAuthAuthorizationClaim | undefined>;
  finalizeAuthorized(input: OAuthFinalizeAuthorization): Promise<OAuthSession | undefined>;
  markIndeterminate(input: OAuthLeaseCommand & { failureCode: OAuthAuthorizationFailureCode }): Promise<OAuthSession | undefined>;
}

export type OAuthAuthorizationCodeVaultContext = Readonly<{
  purpose: "ai_media_oauth_authorization_code";
  ownerUserId: string;
  workspaceId: string;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  sessionId: string;
  tokenBindingId: string;
  codeDigest: string;
  expiresAt: string;
}>;
export interface OAuthAuthorizationCodeVault {
  putOnce(value: string, context: OAuthAuthorizationCodeVaultContext): Promise<string>;
  read(reference: string, context: OAuthAuthorizationCodeVaultContext): Promise<string>;
  delete(reference: string, context: OAuthAuthorizationCodeVaultContext): Promise<void>;
}

export type OAuthSecretTokenBundle = Readonly<{
  accessToken: string;
  refreshToken?: string;
}>;
export type OAuthProviderExchangeResult = Readonly<{
  platform: AiMediaOAuthPlatform;
  externalAccountId: string;
  scopes: readonly string[];
  capabilities: readonly string[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  tokenKind: "Bearer";
  manifestRevision: string;
  tokenBundle: OAuthSecretTokenBundle;
}>;
export interface OAuthProviderConnector {
  exchange(input: {
    platform: AiMediaOAuthPlatform;
    authorizationCode: string;
    pkceVerifier?: string;
    redirectUri: string;
  }): Promise<OAuthProviderExchangeResult>;
}

export type OAuthTokenVaultRecord = Readonly<{
  reference: string;
  descriptor: OAuthSafeTokenDescriptor;
}>;
export type OAuthTokenVaultContext = Readonly<{
  purpose: "ai_media_oauth_token";
  ownerUserId: string;
  workspaceId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  sessionId: string;
  targetCredentialVersion: number;
  tokenBindingId: string;
}>;
export interface OAuthTokenVault {
  putOnce(input: {
    context: OAuthTokenVaultContext;
    bundle: OAuthSecretTokenBundle;
    descriptor: OAuthSafeTokenDescriptor;
  }): Promise<OAuthTokenVaultRecord>;
  find(context: OAuthTokenVaultContext): Promise<OAuthTokenVaultRecord | undefined>;
  readDescriptor(reference: string, context: OAuthTokenVaultContext): Promise<OAuthSafeTokenDescriptor>;
  delete(reference: string, context: OAuthTokenVaultContext): Promise<void>;
}

export type OAuthVaultContext = Readonly<{
  purpose: "ai_media_oauth_pkce";
  ownerUserId: string;
  workspaceId: string;
  actorUserId: string;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  sessionId: string;
  expiresAt: string;
}>;

export interface OAuthVault {
  put(value: string, context: OAuthVaultContext): Promise<string>;
  read(reference: string, context: OAuthVaultContext): Promise<string>;
  delete(reference: string, context: OAuthVaultContext): Promise<void>;
}

export interface OAuthAccountBindingVerifier {
  assertConnectable(input: {
    scope: TenantScope;
    actorUserId: string;
    providerAccountId: string;
    platform: AiMediaOAuthPlatform;
  }): Promise<void>;
}

export type OAuthPlatformPolicy = Readonly<{
  redirectUris: readonly string[];
  scopes: readonly string[];
  pkce: AiMediaOAuthPkceMode;
}>;

export type OAuthPlatformPolicies = Readonly<Partial<Record<AiMediaOAuthPlatform, OAuthPlatformPolicy>>>;

export class OAuthFlowError extends Error {
  readonly code = "AI_MEDIA_OAUTH_REJECTED";
  constructor(message = "OAuth request was rejected") { super(message); }
}
