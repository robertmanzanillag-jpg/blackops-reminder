import type { TenantScope } from "../core/resource-domain";
import {
  OAUTH_PROVIDER_SCOPE_ALLOWLISTS,
  OAuthProviderConnectionError,
  deriveOAuthProviderCapabilities,
  isCompatibleOAuthProviderTarget,
  toOAuthProviderTargetDto,
  validateOAuthProviderScopes,
  validateOAuthProviderTokenArtifacts,
  type ClaimOAuthProviderConnectionStage,
  type CreateOAuthProviderConnectionAttempt,
  type MarkOAuthProviderExchangeComplete,
  type OAuthProviderConnectionAttempt,
  type OAuthProviderConnectionClaim,
  type OAuthProviderConnectionFence,
  type OAuthProviderConnectionFailureCode,
  type OAuthProviderConnectionRepository,
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
    && timestamp(attempt.leaseExpiresAt ?? "") > timestamp(input.now);
}

export class InMemoryOAuthProviderConnectionRepository implements OAuthProviderConnectionRepository {
  private readonly attempts = new Map<string, OAuthProviderConnectionAttempt>();

  async create(input: CreateOAuthProviderConnectionAttempt): Promise<OAuthProviderConnectionAttempt> {
    const storageKey = key(input.scope, input.id);
    if (this.attempts.has(storageKey)) throw new OAuthProviderConnectionError();
    const createdMs = timestamp(input.createdAt);
    if (timestamp(input.expiresAt) <= createdMs || !isCompatibleOAuthProviderTarget(input.platform, input.grantFamily, targetKindFor(input.platform))) {
      throw new OAuthProviderConnectionError();
    }
    required(input.id); required(input.scope.ownerUserId); required(input.scope.workspaceId);
    required(input.actorUserId); required(input.providerAccountId); required(input.oauthSessionId);
    required(input.manifestRevision, 100); required(input.tokenBindingId);
    if (!Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 0
      || input.targetCredentialVersion !== input.expectedCredentialVersion + 1) throw new OAuthProviderConnectionError();
    const allowedScopes = exactList(input.allowedScopes);
    const immutableAllowlist = OAUTH_PROVIDER_SCOPE_ALLOWLISTS[input.grantFamily];
    if (allowedScopes.some((scope) => !immutableAllowlist.includes(scope))) throw new OAuthProviderConnectionError();
    const requiredScopes = exactList(input.requiredScopes);
    validateOAuthProviderScopes(input.grantFamily, requiredScopes, requiredScopes, allowedScopes);
    const attempt: OAuthProviderConnectionAttempt = {
      ...input,
      scope: { ...input.scope },
      stage: "exchange_pending",
      stageVersion: 1,
      allowedScopes,
      requiredScopes,
      actualScopes: Object.freeze([]),
      tokenArtifacts: Object.freeze([]),
      candidates: Object.freeze([]),
      selectedCandidateId: null,
      selectedTargetId: null,
      selectedTargetKind: null,
      selectedByActorUserId: null,
      selectedAt: null,
      selectedEligibilityDigest: null,
      selectedStageVersion: null,
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseFencing: 0,
      failureCode: null,
      updatedAt: input.createdAt,
    };
    this.attempts.set(storageKey, attempt);
    return clone(attempt);
  }

  async get(scope: TenantScope, attemptId: string): Promise<OAuthProviderConnectionAttempt | undefined> {
    const attempt = this.attempts.get(key(scope, attemptId));
    return attempt ? clone(attempt) : undefined;
  }

  async claim(input: ClaimOAuthProviderConnectionStage): Promise<OAuthProviderConnectionClaim | undefined> {
    const storageKey = key(input.scope, input.attemptId);
    const attempt = this.attempts.get(storageKey);
    if (!attempt) return undefined;
    const nowMs = timestamp(input.now);
    const expiresMs = timestamp(input.leaseExpiresAt);
    if (expiresMs <= nowMs || timestamp(attempt.expiresAt) <= nowMs) throw new OAuthProviderConnectionError();
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
      tokenArtifacts: Object.freeze(structuredClone(input.tokenArtifacts)),
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
        ...candidate,
        verifiedTasks,
        capabilities: deriveOAuthProviderCapabilities(candidate.kind, verifiedTasks),
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
    timestamp(input.now);
    if (attempt.selectedCandidateId !== null) {
      if (attempt.selectedCandidateId === input.candidateId && attempt.selectedTargetId === input.targetId
        && attempt.selectedTargetKind === input.targetKind && attempt.selectedByActorUserId === input.actorUserId) return clone(attempt);
      throw new OAuthProviderConnectionError();
    }
    if (attempt.stage !== "awaiting_target" || attempt.stageVersion !== input.expectedStageVersion
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
    };
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
