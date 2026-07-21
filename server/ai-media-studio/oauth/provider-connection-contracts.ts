import { createHash } from "node:crypto";
import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";

export const OAUTH_PROVIDER_CONNECTION_STAGES = [
  "exchange_pending", "exchange_in_progress", "exchange_indeterminate",
  "discovery_pending", "discovery_in_progress", "awaiting_target",
  "activation_pending", "activation_in_progress", "activation_indeterminate", "authorized", "failed",
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
  | Readonly<{ kind: "provider_non_expiring"; revalidateAt: string }>
  | Readonly<{ kind: "revocation_bound"; revalidateAt: string }>;

/** Safe metadata only. Secret values and vault references belong to a later vault slice. */
export type OAuthProviderTokenArtifactDescriptor = Readonly<{
  role: OAuthProviderTokenArtifactRole;
  lifetime: OAuthProviderTokenLifetime;
}>;

/**
 * Durable evidence for one role-specific v2 vault object. The reference is opaque
 * and contains no token value; the role is part of the immutable object identity.
 */
export type OAuthProviderActivationArtifactEvidence = Readonly<{
  role: OAuthProviderTokenArtifactRole;
  artifactBindingId: string;
  vaultReference: string;
  manifestRevision: string;
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
  selectionDigest: string | null;
  activationArtifactBindingId: string | null;
  activationArtifacts: readonly OAuthProviderActivationArtifactEvidence[];
  authorizedDigest: string | null;
  authorizedAt: string | null;
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

export type OAuthProviderActivationAccount = Readonly<{
  scope: TenantScope;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  credentialVersion: number;
  status: "disconnected" | "active";
  targetId: string | null;
  targetKind: OAuthProviderTargetKind | null;
  actorUserId: string | null;
  oauthSessionId: string | null;
  tokenBindingId: string | null;
  artifactBindingId: string | null;
  artifacts: readonly OAuthProviderActivationArtifactEvidence[];
  grantedScopes: readonly string[];
  capabilities: readonly OAuthProviderConnectionCapability[];
  manifestRevision: string | null;
  authorizedDigest: string | null;
  authorizedAt: string | null;
}>;

export type CreateOAuthProviderActivationAccount = Readonly<{
  scope: TenantScope;
  providerAccountId: string;
  platform: AiMediaOAuthPlatform;
  credentialVersion: number;
}>;

/** All public evidence required by the single atomic attempt/account activation CAS. */
export type FinalizeOAuthProviderActivation = OAuthProviderConnectionFence & Readonly<{
  actorUserId: string;
  activationStageVersion: number;
  selectedCandidateId: string;
  selectedTargetId: string;
  selectedTargetKind: OAuthProviderTargetKind;
  selectedEligibilityDigest: string;
  selectedStageVersion: number;
  selectionDigest: string;
  tokenBindingId: string;
  artifactBindingId: string;
  artifacts: readonly OAuthProviderActivationArtifactEvidence[];
  actualScopes: readonly string[];
  capabilities: readonly OAuthProviderConnectionCapability[];
  manifestRevision: string;
  expectedCredentialVersion: number;
  targetCredentialVersion: number;
}>;

export type OAuthProviderActivationResult = Readonly<{
  attempt: OAuthProviderConnectionAttempt;
  account: OAuthProviderActivationAccount;
}>;

export type OAuthProviderConnectionFailureCode =
  | "invalid_exchange" | "exchange_ambiguous" | "scope_mismatch" | "invalid_artifact"
  | "invalid_discovery" | "no_targets" | "target_not_found" | "target_mismatch" | "activation_rejected"
  | "activation_ambiguous" | "provider_rejected" | "internal_failure";

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

/** Kept as an extension so PR15 repositories remain valid until their PR16 CAS is implemented. */
export interface OAuthProviderActivationRepository extends OAuthProviderConnectionRepository {
  getActivationAccount(scope: TenantScope, providerAccountId: string, platform: AiMediaOAuthPlatform): Promise<OAuthProviderActivationAccount | undefined>;
  finalizeActivation(input: FinalizeOAuthProviderActivation): Promise<OAuthProviderActivationResult | undefined>;
  markActivationIndeterminate(input: OAuthProviderConnectionFence): Promise<OAuthProviderConnectionAttempt | undefined>;
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

export const OAUTH_PROVIDER_MANIFEST_REVISIONS: Readonly<Record<AiMediaOAuthPlatform, string>> = Object.freeze({
  tiktok: "tiktok-v2",
  youtube_shorts: "google-youtube-v1",
  facebook: "meta-graph-v23",
  instagram: "meta-graph-v23",
});

export const OAUTH_PROVIDER_VERIFIED_TASK_CAPABILITIES: Readonly<Record<OAuthProviderTargetKind, Readonly<Record<string, readonly OAuthProviderConnectionCapability[]>>>> = Object.freeze({
  tiktok_user: Object.freeze({ "video.publish": Object.freeze(["publish_video"] as const) }),
  youtube_channel: Object.freeze({ "youtube.upload": Object.freeze(["publish_video"] as const) }),
  facebook_page: Object.freeze({ CREATE_CONTENT: Object.freeze(["publish_video"] as const) }),
  instagram_professional_account: Object.freeze({ instagram_content_publish: Object.freeze(["publish_video"] as const) }),
});

const OAUTH_PROVIDER_TASK_SCOPE_REQUIREMENTS: Readonly<Record<OAuthProviderTargetKind, Readonly<Record<string, readonly string[]>>>> = Object.freeze({
  tiktok_user: Object.freeze({ "video.publish": Object.freeze(["video.publish"]) }),
  youtube_channel: Object.freeze({ "youtube.upload": Object.freeze(["https://www.googleapis.com/auth/youtube.upload"]) }),
  facebook_page: Object.freeze({ CREATE_CONTENT: Object.freeze(["pages_manage_posts"]) }),
  instagram_professional_account: Object.freeze({ instagram_content_publish: Object.freeze(["instagram_content_publish"]) }),
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
  actualScopes: readonly string[],
): readonly OAuthProviderConnectionCapability[] {
  if (!isUniqueSafeList(verifiedTasks, 50) || !isUniqueSafeList(actualScopes, 50)) throw new OAuthProviderConnectionError();
  const taskMap = OAUTH_PROVIDER_VERIFIED_TASK_CAPABILITIES[kind];
  if (verifiedTasks.some((task) => !(task in taskMap))) throw new OAuthProviderConnectionError();
  const scopeRequirements = OAUTH_PROVIDER_TASK_SCOPE_REQUIREMENTS[kind];
  const capabilities = [...new Set(verifiedTasks.flatMap((task) =>
    (scopeRequirements[task] ?? []).every((scope) => actualScopes.includes(scope)) ? taskMap[task] ?? [] : [],
  ))].sort() as OAuthProviderConnectionCapability[];
  if (capabilities.length === 0) throw new OAuthProviderConnectionError();
  return Object.freeze(capabilities);
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
    } else if (artifact.lifetime.kind === "provider_non_expiring") {
      if (grantFamily !== "meta_facebook_login" || artifact.role !== "operational_access") throw new OAuthProviderConnectionError();
    } else if (artifact.lifetime.kind === "revocation_bound") {
      const allowedRevocationBound = grantFamily === "google_user" && artifact.role === "refresh";
      if (!allowedRevocationBound) throw new OAuthProviderConnectionError();
    } else {
      throw new OAuthProviderConnectionError();
    }
  }
  if (grantFamily === "meta_facebook_login") {
    if (roles.size !== 1 || !roles.has("grant_user_access") || artifacts[0]?.lifetime.kind !== "expires_at") {
      throw new OAuthProviderConnectionError();
    }
  } else if (roles.size !== 2 || !roles.has("operational_access") || !roles.has("refresh") || roles.has("grant_user_access")) {
    throw new OAuthProviderConnectionError();
  }
}

export function validateOAuthProviderActivationArtifacts(
  grantFamily: OAuthProviderGrantFamily,
  artifactBindingId: string,
  artifacts: readonly OAuthProviderActivationArtifactEvidence[],
  now: string,
  manifestRevision: string,
): readonly OAuthProviderActivationArtifactEvidence[] {
  if (!UUID.test(artifactBindingId) || !Array.isArray(artifacts)
    || typeof manifestRevision !== "string" || manifestRevision.length < 1 || manifestRevision.length > 100) {
    throw new OAuthProviderConnectionError();
  }
  const expectedRoles: readonly OAuthProviderTokenArtifactRole[] = grantFamily === "meta_facebook_login"
    ? ["operational_access"]
    : ["operational_access", "refresh"];
  if (artifacts.length !== expectedRoles.length) throw new OAuthProviderConnectionError();
  const byRole = new Map<OAuthProviderTokenArtifactRole, OAuthProviderActivationArtifactEvidence>();
  for (const artifact of artifacts) {
    if (!artifact || !expectedRoles.includes(artifact.role) || byRole.has(artifact.role)
      || artifact.artifactBindingId !== artifactBindingId
      || artifact.manifestRevision !== manifestRevision
      || artifact.vaultReference !== oauthProviderActivationVaultReference(artifactBindingId, artifact.role)) {
      throw new OAuthProviderConnectionError();
    }
    byRole.set(artifact.role, artifact);
  }
  const canonical = expectedRoles.map((role) => {
    const artifact = byRole.get(role);
    if (!artifact) throw new OAuthProviderConnectionError();
    validateActivationLifetime(grantFamily, role, artifact.lifetime, now);
    return Object.freeze({
      role,
      artifactBindingId,
      vaultReference: oauthProviderActivationVaultReference(artifactBindingId, role),
      manifestRevision,
      lifetime: cloneLifetime(artifact.lifetime),
    });
  });
  return Object.freeze(canonical);
}

export function oauthProviderActivationVaultReference(
  artifactBindingId: string,
  role: OAuthProviderTokenArtifactRole,
): string {
  if (!UUID.test(artifactBindingId) || !OAUTH_PROVIDER_TOKEN_ARTIFACT_ROLES.includes(role)) throw new OAuthProviderConnectionError();
  const opaqueBinding = createHash("sha256").update(JSON.stringify([artifactBindingId, role]), "utf8").digest("hex");
  return `vault://ai-media-studio/oauth-role-token/v2/${opaqueBinding}`;
}

export type OAuthProviderSelectionDigestEvidence = Readonly<{
  attemptId: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  oauthSessionId: string;
  platform: AiMediaOAuthPlatform;
  grantFamily: OAuthProviderGrantFamily;
  candidateId: string;
  targetId: string;
  targetKind: OAuthProviderTargetKind;
  eligibilityDigest: string;
  selectedStageVersion: number;
  selectedAt: string;
  manifestRevision: string;
  tokenBindingId: string;
  expectedCredentialVersion: number;
  targetCredentialVersion: number;
  actualScopes: readonly string[];
  capabilities: readonly OAuthProviderConnectionCapability[];
}>;

export function deriveOAuthProviderSelectionDigest(evidence: OAuthProviderSelectionDigestEvidence): string {
  return digestCanonical("ai-media-oauth-provider-selection-v1", [
    evidence.attemptId, evidence.scope.ownerUserId, evidence.scope.workspaceId, evidence.actorUserId,
    evidence.providerAccountId, evidence.oauthSessionId, evidence.platform, evidence.grantFamily,
    evidence.candidateId, evidence.targetId, evidence.targetKind, evidence.eligibilityDigest,
    evidence.selectedStageVersion, evidence.selectedAt, evidence.manifestRevision, evidence.tokenBindingId,
    evidence.expectedCredentialVersion, evidence.targetCredentialVersion,
    canonicalDigestList(evidence.actualScopes), canonicalDigestList(evidence.capabilities),
  ]);
}

export function deriveOAuthProviderAuthorizedDigest(input: FinalizeOAuthProviderActivation): string {
  return digestCanonical("ai-media-oauth-provider-authorization-v1", [
    input.attemptId, input.scope.ownerUserId, input.scope.workspaceId, input.actorUserId,
    input.activationStageVersion,
    input.selectedCandidateId, input.selectedTargetId, input.selectedTargetKind,
    input.selectedEligibilityDigest, input.selectedStageVersion, input.selectionDigest,
    input.tokenBindingId, input.artifactBindingId,
    input.artifacts.map((artifact) => [artifact.role, artifact.artifactBindingId, artifact.vaultReference, artifact.manifestRevision,
      artifact.lifetime.kind, artifact.lifetime.revalidateAt,
      artifact.lifetime.kind === "expires_at" ? artifact.lifetime.expiresAt : null]),
    canonicalDigestList(input.actualScopes), canonicalDigestList(input.capabilities), input.manifestRevision,
    input.expectedCredentialVersion, input.targetCredentialVersion,
  ]);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validateActivationLifetime(
  grantFamily: OAuthProviderGrantFamily,
  role: OAuthProviderTokenArtifactRole,
  lifetime: OAuthProviderTokenLifetime,
  now: string,
): void {
  const nowMs = parseIso(now);
  const revalidateMs = parseIso(lifetime.revalidateAt);
  if (revalidateMs <= nowMs || revalidateMs > nowMs + 366 * 24 * 60 * 60 * 1_000) throw new OAuthProviderConnectionError();
  if (lifetime.kind === "expires_at") {
    const expiryMs = parseIso(lifetime.expiresAt);
    if (expiryMs <= nowMs || revalidateMs > expiryMs) throw new OAuthProviderConnectionError();
    return;
  }
  if (lifetime.kind === "provider_non_expiring") {
    if (grantFamily !== "meta_facebook_login" || role !== "operational_access") throw new OAuthProviderConnectionError();
    return;
  }
  if (lifetime.kind === "revocation_bound") {
    if (grantFamily !== "google_user" || role !== "refresh") throw new OAuthProviderConnectionError();
    return;
  }
  throw new OAuthProviderConnectionError();
}

function cloneLifetime(lifetime: OAuthProviderTokenLifetime): OAuthProviderTokenLifetime {
  return Object.freeze(lifetime.kind === "expires_at"
    ? { kind: "expires_at" as const, expiresAt: lifetime.expiresAt, revalidateAt: lifetime.revalidateAt }
    : { kind: lifetime.kind, revalidateAt: lifetime.revalidateAt });
}

function canonicalDigestList(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || new Set(values).size !== values.length) throw new OAuthProviderConnectionError();
  return Object.freeze([...values].sort());
}

function digestCanonical(domain: string, values: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify([domain, ...values]), "utf8").digest("hex");
}
