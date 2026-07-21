import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";

export const OAUTH_PROVIDER_CONNECTION_STAGES = [
  "exchange_pending", "exchange_in_progress", "exchange_indeterminate",
  "discovery_pending", "discovery_in_progress", "awaiting_target",
  "activation_pending", "activation_in_progress", "authorized", "failed",
] as const;
export type OAuthProviderConnectionStage = typeof OAUTH_PROVIDER_CONNECTION_STAGES[number];

export const OAUTH_PROVIDER_GRANT_FAMILIES = ["tiktok_user", "google_user", "meta_facebook_login"] as const;
export type OAuthProviderGrantFamily = typeof OAUTH_PROVIDER_GRANT_FAMILIES[number];

export const OAUTH_PROVIDER_TARGET_KINDS = [
  "tiktok_user", "youtube_channel", "facebook_page", "instagram_professional_account",
] as const;
export type OAuthProviderTargetKind = typeof OAUTH_PROVIDER_TARGET_KINDS[number];

export const OAUTH_PROVIDER_TOKEN_ARTIFACT_ROLES = ["operational_access", "refresh", "grant_user_access"] as const;
export type OAuthProviderTokenArtifactRole = typeof OAUTH_PROVIDER_TOKEN_ARTIFACT_ROLES[number];

export type OAuthProviderTokenLifetime =
  | Readonly<{ kind: "expires_at"; expiresAt: string; revalidateAt: string }>
  | Readonly<{ kind: "provider_non_expiring"; revalidateAt: string }>;

/** Safe metadata only. Secret values and vault references belong to a later vault slice. */
export type OAuthProviderTokenArtifactDescriptor = Readonly<{
  role: OAuthProviderTokenArtifactRole;
  lifetime: OAuthProviderTokenLifetime;
}>;

export type OAuthProviderTargetCandidate = Readonly<{
  candidateId: string;
  targetId: string;
  kind: OAuthProviderTargetKind;
  displayName: string;
  parentTargetId?: string;
  verifiedTasks: readonly string[];
  capabilities: readonly OAuthProviderConnectionCapability[];
  eligibilityDigest: string;
  manifestRevision: string;
  discoveredAt: string;
}>;

/** Safe target projection: deliberately contains no token/vault references or provider JSON. */
export type OAuthProviderTargetDto = Readonly<{
  targetId: string;
  kind: OAuthProviderTargetKind;
  displayName: string;
  capabilities: readonly OAuthProviderConnectionCapability[];
}>;

export const OAUTH_PROVIDER_CONNECTION_CAPABILITIES = [
  "publish_video", "schedule_post", "read_analytics", "webhook_events",
] as const;
export type OAuthProviderConnectionCapability = typeof OAUTH_PROVIDER_CONNECTION_CAPABILITIES[number];

export type OAuthProviderConnectionAttempt = Readonly<{
  id: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  oauthSessionId: string;
  platform: AiMediaOAuthPlatform;
  grantFamily: OAuthProviderGrantFamily;
  stage: OAuthProviderConnectionStage;
  stageVersion: number;
  manifestRevision: string;
  allowedScopes: readonly string[];
  requiredScopes: readonly string[];
  actualScopes: readonly string[];
  tokenBindingId: string;
  expectedCredentialVersion: number;
  targetCredentialVersion: number;
  tokenArtifacts: readonly OAuthProviderTokenArtifactDescriptor[];
  candidates: readonly OAuthProviderTargetCandidate[];
  selectedCandidateId: string | null;
  selectedTargetId: string | null;
  selectedTargetKind: OAuthProviderTargetKind | null;
  selectedByActorUserId: string | null;
  selectedAt: string | null;
  selectedEligibilityDigest: string | null;
  selectedStageVersion: number | null;
  leaseToken: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  leaseFencing: number;
  failureCode: OAuthProviderConnectionFailureCode | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateOAuthProviderConnectionAttempt = Readonly<{
  id: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  oauthSessionId: string;
  platform: AiMediaOAuthPlatform;
  grantFamily: OAuthProviderGrantFamily;
  manifestRevision: string;
  allowedScopes: readonly string[];
  requiredScopes: readonly string[];
  tokenBindingId: string;
  expectedCredentialVersion: number;
  targetCredentialVersion: number;
  expiresAt: string;
  createdAt: string;
}>;

export type OAuthProviderConnectionActionableStage =
  | "exchange_pending" | "discovery_pending" | "activation_pending";
export type OAuthProviderConnectionInProgressStage =
  | "exchange_in_progress" | "discovery_in_progress" | "activation_in_progress";

export type ClaimOAuthProviderConnectionStage = Readonly<{
  attemptId: string;
  scope: TenantScope;
  stage: OAuthProviderConnectionActionableStage;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: string;
}>;

export type OAuthProviderConnectionClaim = Readonly<{
  attempt: OAuthProviderConnectionAttempt;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  leaseFencing: number;
}>;

export type OAuthProviderConnectionFence = Readonly<{
  attemptId: string;
  scope: TenantScope;
  leaseToken: string;
  leaseFencing: number;
  now: string;
}>;

export type MarkOAuthProviderExchangeComplete = OAuthProviderConnectionFence & Readonly<{
  actualScopes: readonly string[];
  tokenArtifacts: readonly OAuthProviderTokenArtifactDescriptor[];
}>;

export type RecordOAuthProviderDiscovery = OAuthProviderConnectionFence & Readonly<{
  candidates: readonly Readonly<{
    candidateId: string;
    targetId: string;
    kind: OAuthProviderTargetKind;
    displayName: string;
    parentTargetId?: string;
    verifiedTasks: readonly string[];
    eligibilityDigest: string;
    manifestRevision: string;
    discoveredAt: string;
  }>[];
}>;

export type SelectOAuthProviderTarget = Readonly<{
  attemptId: string;
  scope: TenantScope;
  actorUserId: string;
  expectedStageVersion: number;
  candidateId: string;
  targetId: string;
  targetKind: OAuthProviderTargetKind;
  now: string;
}>;

export type OAuthProviderConnectionFailureCode =
  | "invalid_exchange" | "exchange_ambiguous" | "scope_mismatch" | "invalid_artifact"
  | "invalid_discovery" | "no_targets" | "target_not_found" | "target_mismatch" | "activation_rejected"
  | "provider_rejected" | "internal_failure";

export interface OAuthProviderConnectionRepository {
  create(input: CreateOAuthProviderConnectionAttempt): Promise<OAuthProviderConnectionAttempt>;
  get(scope: TenantScope, attemptId: string): Promise<OAuthProviderConnectionAttempt | undefined>;
  claim(input: ClaimOAuthProviderConnectionStage): Promise<OAuthProviderConnectionClaim | undefined>;
  markExchangeComplete(input: MarkOAuthProviderExchangeComplete): Promise<OAuthProviderConnectionAttempt | undefined>;
  markExchangeIndeterminate(input: OAuthProviderConnectionFence): Promise<OAuthProviderConnectionAttempt | undefined>;
  recordDiscovery(input: RecordOAuthProviderDiscovery): Promise<OAuthProviderConnectionAttempt | undefined>;
  selectTarget(input: SelectOAuthProviderTarget): Promise<OAuthProviderConnectionAttempt | undefined>;
  markFailed(input: OAuthProviderConnectionFence & { failureCode: OAuthProviderConnectionFailureCode }): Promise<OAuthProviderConnectionAttempt | undefined>;
}

export class OAuthProviderConnectionError extends Error {
  constructor() { super("OAuth provider connection operation rejected"); this.name = "OAuthProviderConnectionError"; }
}

export const OAUTH_PROVIDER_SCOPE_ALLOWLISTS: Readonly<Record<OAuthProviderGrantFamily, readonly string[]>> = Object.freeze({
  tiktok_user: Object.freeze(["user.info.basic", "video.upload", "video.publish"]),
  google_user: Object.freeze(["https://www.googleapis.com/auth/youtube.upload"]),
  meta_facebook_login: Object.freeze([
    "pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish",
  ]),
});

export const OAUTH_PROVIDER_VERIFIED_TASK_CAPABILITIES: Readonly<Record<OAuthProviderTargetKind, Readonly<Record<string, readonly OAuthProviderConnectionCapability[]>>>> = Object.freeze({
  tiktok_user: Object.freeze({ "video.publish": Object.freeze(["publish_video"]), "video.upload": Object.freeze(["publish_video"]) }),
  youtube_channel: Object.freeze({ "youtube.upload": Object.freeze(["publish_video"]) }),
  facebook_page: Object.freeze({ CREATE_CONTENT: Object.freeze(["publish_video"]), MODERATE: Object.freeze(["webhook_events"]), ANALYZE: Object.freeze(["read_analytics"]) }),
  instagram_professional_account: Object.freeze({ instagram_content_publish: Object.freeze(["publish_video"]), instagram_manage_insights: Object.freeze(["read_analytics"]) }),
});

export function isCompatibleOAuthProviderTarget(
  platform: AiMediaOAuthPlatform,
  grantFamily: OAuthProviderGrantFamily,
  kind: OAuthProviderTargetKind,
): boolean {
  return (platform === "tiktok" && grantFamily === "tiktok_user" && kind === "tiktok_user")
    || (platform === "youtube_shorts" && grantFamily === "google_user" && kind === "youtube_channel")
    || (platform === "facebook" && grantFamily === "meta_facebook_login" && kind === "facebook_page")
    || (platform === "instagram" && grantFamily === "meta_facebook_login" && kind === "instagram_professional_account");
}

export function validateOAuthProviderScopes(
  grantFamily: OAuthProviderGrantFamily,
  requiredScopes: readonly string[],
  actualScopes: readonly string[],
  allowedScopes: readonly string[] = OAUTH_PROVIDER_SCOPE_ALLOWLISTS[grantFamily],
): void {
  const allowlist = OAUTH_PROVIDER_SCOPE_ALLOWLISTS[grantFamily];
  if (!isUniqueSafeList(requiredScopes, 50) || !isUniqueSafeList(actualScopes, 50) || !isUniqueSafeList(allowedScopes, 50)) throw new OAuthProviderConnectionError();
  if (allowedScopes.some((scope) => !allowlist.includes(scope)) || requiredScopes.some((scope) => !actualScopes.includes(scope))
    || actualScopes.some((scope) => !allowedScopes.includes(scope))) {
    throw new OAuthProviderConnectionError();
  }
}

export function deriveOAuthProviderCapabilities(
  kind: OAuthProviderTargetKind,
  verifiedTasks: readonly string[],
): readonly OAuthProviderConnectionCapability[] {
  if (!isUniqueSafeList(verifiedTasks, 50)) throw new OAuthProviderConnectionError();
  const taskMap = OAUTH_PROVIDER_VERIFIED_TASK_CAPABILITIES[kind];
  if (verifiedTasks.some((task) => !(task in taskMap))) throw new OAuthProviderConnectionError();
  return Object.freeze([...new Set(verifiedTasks.flatMap((task) => taskMap[task] ?? []))].sort()) as readonly OAuthProviderConnectionCapability[];
}

export function validateOAuthProviderTokenArtifacts(
  grantFamily: OAuthProviderGrantFamily,
  artifacts: readonly OAuthProviderTokenArtifactDescriptor[],
  now: string,
): void {
  const nowMs = parseIso(now);
  if (!Array.isArray(artifacts) || artifacts.length < 1 || artifacts.length > 3) throw new OAuthProviderConnectionError();
  const roles = new Set<string>();
  for (const artifact of artifacts) {
    if (!OAUTH_PROVIDER_TOKEN_ARTIFACT_ROLES.includes(artifact.role) || roles.has(artifact.role)) throw new OAuthProviderConnectionError();
    roles.add(artifact.role);
    const revalidateMs = parseIso(artifact.lifetime.revalidateAt);
    if (revalidateMs <= nowMs || revalidateMs > nowMs + 366 * 24 * 60 * 60 * 1_000) throw new OAuthProviderConnectionError();
    if (artifact.lifetime.kind === "expires_at") {
      const expiryMs = parseIso(artifact.lifetime.expiresAt);
      if (expiryMs <= nowMs || revalidateMs > expiryMs) throw new OAuthProviderConnectionError();
    } else if (artifact.lifetime.kind !== "provider_non_expiring" || grantFamily !== "meta_facebook_login") {
      throw new OAuthProviderConnectionError();
    }
  }
  if (grantFamily === "meta_facebook_login") {
    if (!roles.has("operational_access") || roles.has("refresh")) throw new OAuthProviderConnectionError();
  } else if (roles.size !== 2 || !roles.has("operational_access") || !roles.has("refresh") || roles.has("grant_user_access")) {
    throw new OAuthProviderConnectionError();
  }
}

export function toOAuthProviderTargetDto(candidate: OAuthProviderTargetCandidate): OAuthProviderTargetDto {
  return Object.freeze({ targetId: candidate.targetId, kind: candidate.kind, displayName: candidate.displayName, capabilities: Object.freeze([...candidate.capabilities]) });
}

function isUniqueSafeList(values: readonly string[], max: number): boolean {
  return Array.isArray(values) && values.length > 0 && values.length <= max
    && new Set(values).size === values.length
    && values.every((value) => typeof value === "string" && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:/-]+$/u.test(value));
}

function parseIso(value: string): number {
  const parsed = Date.parse(value);
  if (!value || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new OAuthProviderConnectionError();
  return parsed;
}
