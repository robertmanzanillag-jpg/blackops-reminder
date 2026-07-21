import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";
import {
  OAUTH_PROVIDER_CONNECTION_CAPABILITIES,
  OAUTH_PROVIDER_SCOPE_ALLOWLISTS,
  OAUTH_PROVIDER_MANIFEST_REVISIONS,
  OAuthProviderConnectionError,
  deriveOAuthProviderCapabilities,
  deriveOAuthProviderAuthorizedDigest,
  deriveOAuthProviderSelectionDigest,
  isCompatibleOAuthProviderTarget,
  toOAuthProviderTargetDto,
  validateOAuthProviderActivationArtifacts,
  validateOAuthProviderScopes,
  validateOAuthProviderTokenArtifacts,
  type ClaimOAuthProviderConnectionStage,
  type CreateOAuthProviderActivationAccount,
  type CreateOAuthProviderConnectionAttempt,
  type FinalizeOAuthProviderActivation,
  type OAuthProviderActivationAccount,
  type OAuthProviderActivationArtifactEvidence,
  type OAuthProviderActivationRepository,
  type OAuthProviderActivationResult,
  type OAuthProviderConnectionCapability,
  type MarkOAuthProviderExchangeComplete,
  type OAuthProviderConnectionAttempt,
  type OAuthProviderConnectionClaim,
  type OAuthProviderConnectionFence,
  type OAuthProviderConnectionFailureCode,
  type OAuthProviderConnectionStage,
  type OAuthProviderTargetKind,
  type RecordOAuthProviderDiscovery,
  type SelectOAuthProviderTarget,
} from "./provider-connection-contracts";

const MAX_CANDIDATES = 100;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9._:/-]+$/u;
const PROGRESS: Readonly<Record<ClaimOAuthProviderConnectionStage["stage"], OAuthProviderConnectionStage>> = Object.freeze({
  exchange_pending: "exchange_in_progress",
  discovery_pending: "discovery_in_progress",
  activation_pending: "activation_in_progress",
});

function key(scope: TenantScope, attemptId: string): string {
  return `${scope.ownerUserId}\u0000${scope.workspaceId}\u0000${attemptId}`;
}

function clone(attempt: OAuthProviderConnectionAttempt): OAuthProviderConnectionAttempt {
  return structuredClone(attempt);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!value || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new OAuthProviderConnectionError();
  return parsed;
}

function required(value: string, max = 255): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !SAFE.test(value)) throw new OAuthProviderConnectionError();
  return value;
}

function displayText(value: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 200
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new OAuthProviderConnectionError();
  return value;
}

function exactList(values: readonly string[], max = 50): readonly string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > max || new Set(values).size !== values.length) {
    throw new OAuthProviderConnectionError();
  }
  for (const value of values) required(value, 200);
  return Object.freeze([...values]);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasFence(attempt: OAuthProviderConnectionAttempt, input: OAuthProviderConnectionFence, stage: OAuthProviderConnectionStage): boolean {
  return attempt.stage === stage && attempt.leaseToken === input.leaseToken && attempt.leaseFencing === input.leaseFencing
    && timestamp(attempt.leaseExpiresAt ?? "") > timestamp(input.now)
    && timestamp(attempt.expiresAt) > timestamp(input.now);
}

export class InMemoryOAuthProviderConnectionRepository implements OAuthProviderActivationRepository {
  private readonly attempts = new Map<string, OAuthProviderConnectionAttempt>();
  private readonly accounts = new Map<string, OAuthProviderActivationAccount>();

  async createActivationAccount(input: CreateOAuthProviderActivationAccount): Promise<OAuthProviderActivationAccount> {
    required(input.scope.ownerUserId); required(input.scope.workspaceId); required(input.providerAccountId);
    if (!Number.isSafeInteger(input.credentialVersion) || input.credentialVersion < 0) throw new OAuthProviderConnectionError();
    const storageKey = accountKey(input.scope, input.providerAccountId, input.platform);
    if (this.accounts.has(storageKey)) throw new OAuthProviderConnectionError();
    const account: OAuthProviderActivationAccount = {
      scope: { ...input.scope }, providerAccountId: input.providerAccountId, platform: input.platform,
      credentialVersion: input.credentialVersion, status: "disconnected", targetId: null, targetKind: null,
      actorUserId: null, oauthSessionId: null, tokenBindingId: null, artifactBindingId: null,
      artifacts: Object.freeze([]), grantedScopes: Object.freeze([]), capabilities: Object.freeze([]),
      manifestRevision: null, authorizedDigest: null, authorizedAt: null,
    };
    this.accounts.set(storageKey, account);
    return cloneAccount(account);
  }

  async create(input: CreateOAuthProviderConnectionAttempt): Promise<OAuthProviderConnectionAttempt> {
    const storageKey = key(input.scope, input.id);
    if (this.attempts.has(storageKey) || [...this.attempts.values()].some((attempt) =>
      attempt.tokenBindingId === input.tokenBindingId || (attempt.scope.ownerUserId === input.scope.ownerUserId
      && attempt.scope.workspaceId === input.scope.workspaceId && attempt.oauthSessionId === input.oauthSessionId))) {
      throw new OAuthProviderConnectionError();
    }
    const createdMs = timestamp(input.createdAt);
    if (timestamp(input.expiresAt) <= createdMs || !isCompatibleOAuthProviderTarget(input.platform, input.grantFamily, targetKindFor(input.platform))) {
      throw new OAuthProviderConnectionError();
    }
    required(input.id); required(input.scope.ownerUserId); required(input.scope.workspaceId);
    required(input.actorUserId); required(input.providerAccountId); required(input.oauthSessionId);
    required(input.manifestRevision, 100); required(input.tokenBindingId);
    if (input.manifestRevision !== OAUTH_PROVIDER_MANIFEST_REVISIONS[input.platform]) throw new OAuthProviderConnectionError();
    if (!Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 0
      || input.targetCredentialVersion !== input.expectedCredentialVersion + 1) throw new OAuthProviderConnectionError();
    const allowedScopes = exactList(input.allowedScopes);
    const immutableAllowlist = OAUTH_PROVIDER_SCOPE_ALLOWLISTS[input.grantFamily];
    if (allowedScopes.some((scope) => !immutableAllowlist.includes(scope))) throw new OAuthProviderConnectionError();
    const requiredScopes = exactList(input.requiredScopes);
    validateOAuthProviderScopes(input.grantFamily, requiredScopes, requiredScopes, allowedScopes);
    const attempt: OAuthProviderConnectionAttempt = {
      id: input.id,
      scope: { ...input.scope },
      actorUserId: input.actorUserId,
      providerAccountId: input.providerAccountId,
      oauthSessionId: input.oauthSessionId,
      platform: input.platform,
      grantFamily: input.grantFamily,
      stage: "exchange_pending",
      stageVersion: 1,
      manifestRevision: input.manifestRevision,
      allowedScopes,
      requiredScopes,
      actualScopes: Object.freeze([]),
      tokenBindingId: input.tokenBindingId,
      expectedCredentialVersion: input.expectedCredentialVersion,
      targetCredentialVersion: input.targetCredentialVersion,
      tokenArtifacts: Object.freeze([]),
      candidates: Object.freeze([]),
      selectedCandidateId: null,
      selectedTargetId: null,
      selectedTargetKind: null,
      selectedByActorUserId: null,
      selectedAt: null,
      selectedEligibilityDigest: null,
      selectedStageVersion: null,
      selectionDigest: null,
      activationArtifactBindingId: null,
      activationArtifacts: Object.freeze([]),
      authorizedDigest: null,
      authorizedAt: null,
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseFencing: 0,
      failureCode: null,
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.attempts.set(storageKey, attempt);
    return clone(attempt);
  }

  async get(scope: TenantScope, attemptId: string): Promise<OAuthProviderConnectionAttempt | undefined> {
    const attempt = this.attempts.get(key(scope, attemptId));
    return attempt ? clone(attempt) : undefined;
  }

  async getActivationAccount(
    scope: TenantScope,
    providerAccountId: string,
    platform: AiMediaOAuthPlatform,
  ): Promise<OAuthProviderActivationAccount | undefined> {
    const account = this.accounts.get(accountKey(scope, providerAccountId, platform));
    return account ? cloneAccount(account) : undefined;
  }

  async claim(input: ClaimOAuthProviderConnectionStage): Promise<OAuthProviderConnectionClaim | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt) return undefined;
    const nowMs = timestamp(input.now);
    const expiresMs = timestamp(input.leaseExpiresAt);
    if (expiresMs <= nowMs || expiresMs > nowMs + 5 * 60 * 1_000 || expiresMs > timestamp(attempt.expiresAt)
      || timestamp(attempt.expiresAt) <= nowMs) throw new OAuthProviderConnectionError();
    required(input.leaseToken); required(input.leaseOwner);
    const progressStage = PROGRESS[input.stage];
    const reclaim = attempt.stage === progressStage && attempt.leaseExpiresAt !== null && timestamp(attempt.leaseExpiresAt) <= nowMs;
    if (attempt.stage !== input.stage && !reclaim) return undefined;
    const updated: OAuthProviderConnectionAttempt = {
      ...attempt,
      stage: progressStage,
      stageVersion: attempt.stageVersion + 1,
      leaseToken: input.leaseToken,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      leaseFencing: attempt.leaseFencing + 1,
      updatedAt: input.now,
    };
    this.attempts.set(storageKey, updated);
    return { attempt: clone(updated), leaseToken: updated.leaseToken!, leaseOwner: updated.leaseOwner!, leaseExpiresAt: updated.leaseExpiresAt!, leaseFencing: updated.leaseFencing };
  }

  async markExchangeComplete(input: MarkOAuthProviderExchangeComplete): Promise<OAuthProviderConnectionAttempt | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt || !hasFence(attempt, input, "exchange_in_progress")) return undefined;
    const actualScopes = exactList(input.actualScopes);
    validateOAuthProviderScopes(attempt.grantFamily, attempt.requiredScopes, actualScopes, attempt.allowedScopes);
    validateOAuthProviderTokenArtifacts(attempt.grantFamily, input.tokenArtifacts, input.now);
    const updated = advance(attempt, "discovery_pending", input.now, {
      actualScopes,
      tokenArtifacts: Object.freeze(input.tokenArtifacts.map((artifact) => Object.freeze({
        role: artifact.role,
        lifetime: Object.freeze(artifact.lifetime.kind === "expires_at"
          ? { kind: "expires_at" as const, expiresAt: artifact.lifetime.expiresAt, revalidateAt: artifact.lifetime.revalidateAt }
          : { kind: artifact.lifetime.kind, revalidateAt: artifact.lifetime.revalidateAt }),
      }))),
    });
    this.attempts.set(storageKey, updated);
    return clone(updated);
  }

  async markExchangeIndeterminate(input: OAuthProviderConnectionFence): Promise<OAuthProviderConnectionAttempt | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt || !hasFence(attempt, input, "exchange_in_progress")) return undefined;
    const updated = advance(attempt, "exchange_indeterminate", input.now);
    this.attempts.set(storageKey, updated);
    return clone(updated);
  }

  async recordDiscovery(input: RecordOAuthProviderDiscovery): Promise<OAuthProviderConnectionAttempt | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt || !hasFence(attempt, input, "discovery_in_progress")) return undefined;
    if (!Array.isArray(input.candidates) || input.candidates.length > MAX_CANDIDATES) throw new OAuthProviderConnectionError();
    const candidateIds = new Set<string>();
    const targetKeys = new Set<string>();
    const candidates = input.candidates.map((candidate) => {
      required(candidate.candidateId); required(candidate.targetId); displayText(candidate.displayName);
      if (candidate.parentTargetId !== undefined) required(candidate.parentTargetId);
      if (!SHA256.test(candidate.eligibilityDigest) || candidate.manifestRevision !== attempt.manifestRevision
        || timestamp(candidate.discoveredAt) > timestamp(input.now)
        || !isCompatibleOAuthProviderTarget(attempt.platform, attempt.grantFamily, candidate.kind)) throw new OAuthProviderConnectionError();
      const identityKey = `${candidate.kind}\u0000${candidate.targetId}`;
      if (candidateIds.has(candidate.candidateId) || targetKeys.has(identityKey)) throw new OAuthProviderConnectionError();
      candidateIds.add(candidate.candidateId); targetKeys.add(identityKey);
      const verifiedTasks = exactList(candidate.verifiedTasks);
      return Object.freeze({
        candidateId: candidate.candidateId,
        targetId: candidate.targetId,
        kind: candidate.kind,
        displayName: candidate.displayName,
        ...(candidate.parentTargetId === undefined ? {} : { parentTargetId: candidate.parentTargetId }),
        verifiedTasks,
        capabilities: deriveOAuthProviderCapabilities(candidate.kind, verifiedTasks, attempt.actualScopes),
        eligibilityDigest: candidate.eligibilityDigest,
        manifestRevision: candidate.manifestRevision,
        discoveredAt: candidate.discoveredAt,
      });
    });
    const updated = candidates.length === 0
      ? advance(attempt, "failed", input.now, { candidates: Object.freeze(candidates), failureCode: "no_targets" })
      : advance(attempt, "awaiting_target", input.now, { candidates: Object.freeze(candidates) });
    this.attempts.set(storageKey, updated);
    return clone(updated);
  }

  async selectTarget(input: SelectOAuthProviderTarget): Promise<OAuthProviderConnectionAttempt | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt) return undefined;
    required(input.actorUserId); required(input.candidateId); required(input.targetId);
    const nowMs = timestamp(input.now);
    if (attempt.selectedCandidateId !== null) {
      if (attempt.selectedCandidateId === input.candidateId && attempt.selectedTargetId === input.targetId
        && attempt.selectedTargetKind === input.targetKind && attempt.selectedByActorUserId === input.actorUserId
        && attempt.selectedStageVersion === input.expectedStageVersion) return clone(attempt);
      throw new OAuthProviderConnectionError();
    }
    if (timestamp(attempt.expiresAt) <= nowMs || attempt.stage !== "awaiting_target" || attempt.stageVersion !== input.expectedStageVersion
      || attempt.actorUserId !== input.actorUserId) return undefined;
    const candidate = attempt.candidates.find((item) => item.candidateId === input.candidateId);
    if (!candidate || candidate.targetId !== input.targetId || candidate.kind !== input.targetKind) throw new OAuthProviderConnectionError();
    const updated: OAuthProviderConnectionAttempt = {
      ...advance(attempt, "activation_pending", input.now),
      selectedCandidateId: candidate.candidateId,
      selectedTargetId: candidate.targetId,
      selectedTargetKind: candidate.kind,
      selectedByActorUserId: input.actorUserId,
      selectedAt: input.now,
      selectedEligibilityDigest: candidate.eligibilityDigest,
      selectedStageVersion: attempt.stageVersion,
      selectionDigest: deriveOAuthProviderSelectionDigest({
        attemptId: attempt.id, scope: attempt.scope, actorUserId: input.actorUserId,
        providerAccountId: attempt.providerAccountId, oauthSessionId: attempt.oauthSessionId,
        platform: attempt.platform, grantFamily: attempt.grantFamily,
        candidateId: candidate.candidateId, targetId: candidate.targetId, targetKind: candidate.kind,
        eligibilityDigest: candidate.eligibilityDigest, selectedStageVersion: attempt.stageVersion,
        selectedAt: input.now, manifestRevision: attempt.manifestRevision, tokenBindingId: attempt.tokenBindingId,
        expectedCredentialVersion: attempt.expectedCredentialVersion,
        targetCredentialVersion: attempt.targetCredentialVersion,
        actualScopes: attempt.actualScopes, capabilities: candidate.capabilities,
      }),
    };
    this.attempts.set(storageKey, updated);
    return clone(updated);
  }

  async finalizeActivation(input: FinalizeOAuthProviderActivation): Promise<OAuthProviderActivationResult | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt) return undefined;
    const artifactValidationNow = attempt.stage === "authorized" && attempt.authorizedAt !== null
      ? attempt.authorizedAt
      : input.now;
    const canonical = validateActivationCommand(attempt, input, artifactValidationNow);
    const authorizedDigest = deriveOAuthProviderAuthorizedDigest(canonical);
    const accountStorageKey = accountKey(attempt.scope, attempt.providerAccountId, attempt.platform);
    const account = this.accounts.get(accountStorageKey);

    if (attempt.stage === "authorized") {
      if (attempt.authorizedDigest !== authorizedDigest || !account || !accountMatchesAuthorization(account, attempt, canonical, authorizedDigest)) {
        throw new OAuthProviderConnectionError();
      }
      return { attempt: clone(attempt), account: cloneAccount(account) };
    }
    if (!hasFence(attempt, input, "activation_in_progress") || attempt.stageVersion !== input.activationStageVersion) return undefined;
    if (!account || account.credentialVersion !== attempt.expectedCredentialVersion
      || (account.targetId !== null && (account.targetId !== attempt.selectedTargetId || account.targetKind !== attempt.selectedTargetKind))) {
      return undefined;
    }

    const updatedAccount: OAuthProviderActivationAccount = {
      scope: { ...account.scope }, providerAccountId: account.providerAccountId, platform: account.platform,
      credentialVersion: attempt.targetCredentialVersion, status: "active",
      targetId: canonical.selectedTargetId, targetKind: canonical.selectedTargetKind,
      actorUserId: canonical.actorUserId, oauthSessionId: attempt.oauthSessionId,
      tokenBindingId: canonical.tokenBindingId, artifactBindingId: canonical.artifactBindingId,
      artifacts: canonical.artifacts, grantedScopes: canonical.actualScopes,
      capabilities: canonical.capabilities, manifestRevision: canonical.manifestRevision,
      authorizedDigest, authorizedAt: canonical.now,
    };
    const updatedAttempt = advance(attempt, "authorized", canonical.now, {
      activationArtifactBindingId: canonical.artifactBindingId,
      activationArtifacts: canonical.artifacts,
      authorizedDigest,
      authorizedAt: canonical.now,
    });
    this.accounts.set(accountStorageKey, updatedAccount);
    this.attempts.set(storageKey, updatedAttempt);
    return { attempt: clone(updatedAttempt), account: cloneAccount(updatedAccount) };
  }

  async markActivationIndeterminate(input: OAuthProviderConnectionFence): Promise<OAuthProviderConnectionAttempt | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt || !hasFence(attempt, input, "activation_in_progress")) return undefined;
    const updated = advance(attempt, "activation_indeterminate", input.now);
    this.attempts.set(storageKey, updated);
    return clone(updated);
  }

  async markFailed(input: OAuthProviderConnectionFence & { failureCode: OAuthProviderConnectionFailureCode }): Promise<OAuthProviderConnectionAttempt | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt || !(["exchange_in_progress", "discovery_in_progress", "activation_in_progress"] as const).some((stage) => hasFence(attempt, input, stage))) return undefined;
    const updated = advance(attempt, "failed", input.now, { failureCode: input.failureCode });
    this.attempts.set(storageKey, updated);
    return clone(updated);
  }

  listTargetDtos(scope: TenantScope, attemptId: string): readonly ReturnType<typeof toOAuthProviderTargetDto>[] {
    return Object.freeze((this.attempts.get(key(scope, attemptId))?.candidates ?? []).map(toOAuthProviderTargetDto));
  }
}

function validateActivationCommand(
  attempt: OAuthProviderConnectionAttempt,
  input: FinalizeOAuthProviderActivation,
  artifactValidationNow: string,
): FinalizeOAuthProviderActivation {
  required(input.actorUserId); required(input.selectedCandidateId); required(input.selectedTargetId);
  required(input.tokenBindingId); required(input.manifestRevision, 100);
  if (!SHA256.test(input.selectedEligibilityDigest) || !SHA256.test(input.selectionDigest)
    || !Number.isSafeInteger(input.activationStageVersion) || input.activationStageVersion < 1
    || !Number.isSafeInteger(input.selectedStageVersion) || input.selectedStageVersion < 1
    || !Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 0
    || input.targetCredentialVersion !== input.expectedCredentialVersion + 1) throw new OAuthProviderConnectionError();
  timestamp(input.now);
  const actualScopes = canonicalSafeList(input.actualScopes);
  const capabilities = canonicalCapabilities(input.capabilities);
  const artifacts = validateOAuthProviderActivationArtifacts(
    attempt.grantFamily,
    input.artifactBindingId,
    input.artifacts,
    artifactValidationNow,
    attempt.manifestRevision,
  );
  const candidate = attempt.candidates.find((item) => item.candidateId === input.selectedCandidateId);
  const localCapabilities = candidate
    ? canonicalCapabilities(deriveOAuthProviderCapabilities(candidate.kind, candidate.verifiedTasks, attempt.actualScopes))
    : Object.freeze([] as OAuthProviderConnectionCapability[]);
  if (!candidate || candidate.targetId !== input.selectedTargetId || candidate.kind !== input.selectedTargetKind
    || candidate.eligibilityDigest !== input.selectedEligibilityDigest
    || attempt.actorUserId !== input.actorUserId || attempt.selectedByActorUserId !== input.actorUserId
    || attempt.selectedCandidateId !== input.selectedCandidateId || attempt.selectedTargetId !== input.selectedTargetId
    || attempt.selectedTargetKind !== input.selectedTargetKind
    || attempt.selectedEligibilityDigest !== input.selectedEligibilityDigest
    || attempt.selectedStageVersion !== input.selectedStageVersion || attempt.selectionDigest !== input.selectionDigest
    || attempt.tokenBindingId !== input.tokenBindingId
    || attempt.manifestRevision !== input.manifestRevision
    || OAUTH_PROVIDER_MANIFEST_REVISIONS[attempt.platform] !== input.manifestRevision
    || attempt.expectedCredentialVersion !== input.expectedCredentialVersion
    || attempt.targetCredentialVersion !== input.targetCredentialVersion
    || !sameCanonicalList(actualScopes, attempt.actualScopes)
    || !sameCanonicalList(capabilities, localCapabilities)) throw new OAuthProviderConnectionError();
  validateOAuthProviderScopes(attempt.grantFamily, attempt.requiredScopes, actualScopes, attempt.allowedScopes);
  if (attempt.grantFamily !== "meta_facebook_login") {
    for (const artifact of artifacts) {
      const descriptor = attempt.tokenArtifacts.find((item) => item.role === artifact.role);
      if (!descriptor || !sameLifetime(descriptor.lifetime, artifact.lifetime)) throw new OAuthProviderConnectionError();
    }
  }
  return Object.freeze({
    attemptId: attempt.id, scope: { ...attempt.scope }, actorUserId: input.actorUserId,
    leaseToken: input.leaseToken, leaseFencing: input.leaseFencing, now: input.now,
    activationStageVersion: input.activationStageVersion,
    selectedCandidateId: input.selectedCandidateId, selectedTargetId: input.selectedTargetId,
    selectedTargetKind: input.selectedTargetKind, selectedEligibilityDigest: input.selectedEligibilityDigest,
    selectedStageVersion: input.selectedStageVersion, selectionDigest: input.selectionDigest,
    tokenBindingId: input.tokenBindingId, artifactBindingId: input.artifactBindingId,
    artifacts, actualScopes, capabilities, manifestRevision: input.manifestRevision,
    expectedCredentialVersion: input.expectedCredentialVersion,
    targetCredentialVersion: input.targetCredentialVersion,
  });
}

function accountMatchesAuthorization(
  account: OAuthProviderActivationAccount,
  attempt: OAuthProviderConnectionAttempt,
  input: FinalizeOAuthProviderActivation,
  authorizedDigest: string,
): boolean {
  return account.status === "active" && account.credentialVersion === input.targetCredentialVersion
    && account.targetId === input.selectedTargetId && account.targetKind === input.selectedTargetKind
    && account.actorUserId === input.actorUserId && account.oauthSessionId === attempt.oauthSessionId
    && account.tokenBindingId === input.tokenBindingId && account.artifactBindingId === input.artifactBindingId
    && account.authorizedDigest === authorizedDigest && attempt.authorizedAt !== null
    && account.authorizedAt === attempt.authorizedAt
    && account.manifestRevision === input.manifestRevision
    && sameCanonicalList(account.grantedScopes, input.actualScopes)
    && sameCanonicalList(account.capabilities, input.capabilities)
    && sameArtifacts(account.artifacts, input.artifacts);
}

function canonicalSafeList(values: readonly string[]): readonly string[] {
  return Object.freeze([...exactList(values)].sort());
}

function canonicalCapabilities(values: readonly OAuthProviderConnectionCapability[]): readonly OAuthProviderConnectionCapability[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > OAUTH_PROVIDER_CONNECTION_CAPABILITIES.length
    || new Set(values).size !== values.length || values.some((value) => !OAUTH_PROVIDER_CONNECTION_CAPABILITIES.includes(value))) {
    throw new OAuthProviderConnectionError();
  }
  return Object.freeze([...values].sort());
}

function sameCanonicalList(left: readonly string[], right: readonly string[]): boolean {
  return sameList([...left].sort(), [...right].sort());
}

function sameLifetime(left: OAuthProviderActivationArtifactEvidence["lifetime"], right: OAuthProviderActivationArtifactEvidence["lifetime"]): boolean {
  return left.kind === right.kind && left.revalidateAt === right.revalidateAt
    && (left.kind !== "expires_at" || (right.kind === "expires_at" && left.expiresAt === right.expiresAt));
}

function sameArtifacts(left: readonly OAuthProviderActivationArtifactEvidence[], right: readonly OAuthProviderActivationArtifactEvidence[]): boolean {
  return left.length === right.length && left.every((artifact, index) => {
    const other = right[index];
    return other !== undefined && artifact.role === other.role && artifact.artifactBindingId === other.artifactBindingId
      && artifact.vaultReference === other.vaultReference && artifact.manifestRevision === other.manifestRevision
      && sameLifetime(artifact.lifetime, other.lifetime);
  });
}

function cloneAccount(account: OAuthProviderActivationAccount): OAuthProviderActivationAccount {
  return structuredClone(account);
}

function accountKey(scope: TenantScope, providerAccountId: string, platform: AiMediaOAuthPlatform): string {
  return `${scope.ownerUserId}\u0000${scope.workspaceId}\u0000${providerAccountId}\u0000${platform}`;
}

function advance(
  attempt: OAuthProviderConnectionAttempt,
  stage: OAuthProviderConnectionStage,
  now: string,
  patch: Partial<OAuthProviderConnectionAttempt> = {},
): OAuthProviderConnectionAttempt {
  timestamp(now);
  return {
    ...attempt,
    ...patch,
    stage,
    stageVersion: attempt.stageVersion + 1,
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: now,
  };
}

function targetKindFor(platform: OAuthProviderConnectionAttempt["platform"]): OAuthProviderTargetKind {
  if (platform === "tiktok") return "tiktok_user";
  if (platform === "youtube_shorts") return "youtube_channel";
  if (platform === "facebook") return "facebook_page";
  return "instagram_professional_account";
}
