import type {
  AiMediaOAuthOutcome,
  AiMediaOAuthPlatform,
} from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";

export type OAuthSessionStatus = "pending" | "consumed";

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
  codeChallenge: string;
  codeChallengeMethod: "S256";
  pkceVerifierRef: string;
  status: OAuthSessionStatus;
  outcome: AiMediaOAuthOutcome | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateOAuthSession = Omit<OAuthSession, "status" | "outcome" | "consumedAt" | "updatedAt">;

export type ConsumeOAuthSession = Readonly<{
  stateDigest: string;
  platform: AiMediaOAuthPlatform;
  outcome: AiMediaOAuthOutcome;
  now: string;
}>;

export interface OAuthSessionRepository {
  create(session: CreateOAuthSession): Promise<OAuthSession>;
  consume(input: ConsumeOAuthSession): Promise<OAuthSession | undefined>;
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
}>;

export type OAuthPlatformPolicies = Readonly<Partial<Record<AiMediaOAuthPlatform, OAuthPlatformPolicy>>>;

export class OAuthFlowError extends Error {
  readonly code = "AI_MEDIA_OAUTH_REJECTED";
  constructor(message = "OAuth request was rejected") { super(message); }
}
