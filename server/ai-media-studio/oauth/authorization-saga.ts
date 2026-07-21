import { createHash, randomUUID } from "node:crypto";
import type { AiMediaOAuthCallbackResponse, AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";
import {
  OAuthFlowError,
  type OAuthAuthorizationClaim,
  type OAuthAuthorizationCodeVault,
  type OAuthAuthorizationCodeVaultContext,
  type OAuthAuthorizationFailureCode,
  type OAuthAuthorizationSagaRepository,
  type OAuthLeaseCommand,
  type OAuthProviderConnector,
  type OAuthProviderExchangeResult,
  type OAuthSafeTokenDescriptor,
  type OAuthTokenVault,
  type OAuthTokenVaultContext,
  type OAuthTokenVaultRecord,
  type OAuthVault,
  type OAuthVaultContext,
} from "./contracts";
import { digestOAuthState } from "./crypto";

const LEASE_MS = 60_000;
const CODE_REF = /^vault:\/\/ai-media-studio\/oauth-code\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TOKEN_REF = /^vault:\/\/ai-media-studio\/oauth-token\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_VALUE = /^[A-Za-z0-9._:/-]+$/u;
const PUBLISHING_CAPABILITIES = new Set(["publish_video", "schedule_post", "read_analytics", "webhook_events"]);

function required(value: string, max = 255): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) throw new OAuthFlowError();
  return normalized;
}

function exactSecret(value: string, max = 16_384): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new OAuthFlowError();
  }
  return value;
}

function codeDigest(code: string): string {
  return createHash("sha256").update(exactSecret(code), "utf8").digest("hex");
}

function exactSafeList(values: readonly string[], max = 100): string[] {
  if (!Array.isArray(values) || !values.length || values.length > max) throw new OAuthFlowError();
  const result = values.map((value) => required(value, 200));
  if (new Set(result).size !== result.length || result.some((value) => !SAFE_VALUE.test(value))) throw new OAuthFlowError();
  return result;
}

function normalizeResult(
  result: OAuthProviderExchangeResult,
  claim: OAuthAuthorizationClaim,
  nowMs: number,
): { descriptor: OAuthSafeTokenDescriptor; bundle: OAuthProviderExchangeResult["tokenBundle"] } {
  if (result.platform !== claim.session.platform || result.tokenKind !== "Bearer") throw new OAuthFlowError();
  const externalAccountId = required(result.externalAccountId, 255);
  const scopes = exactSafeList(result.scopes).sort();
  const requested = exactSafeList(claim.session.requestedScopes, 50);
  if (requested.length !== scopes.length || requested.some((scope) => !scopes.includes(scope))) throw new OAuthFlowError();
  const capabilities = result.capabilities.length ? exactSafeList(result.capabilities).sort() : [];
  if (!capabilities.includes("publish_video") || capabilities.some((capability) => !PUBLISHING_CAPABILITIES.has(capability))) {
    throw new OAuthFlowError();
  }
  const manifestRevision = required(result.manifestRevision, 100);
  if (!SAFE_VALUE.test(manifestRevision)) throw new OAuthFlowError();
  exactSecret(result.tokenBundle.accessToken);
  if (result.tokenBundle.refreshToken !== undefined) exactSecret(result.tokenBundle.refreshToken);
  for (const timestamp of [result.accessTokenExpiresAt, result.refreshTokenExpiresAt]) {
    if (timestamp !== null && Number.isNaN(Date.parse(timestamp))) throw new OAuthFlowError();
  }
  if (result.accessTokenExpiresAt === null || Date.parse(result.accessTokenExpiresAt) <= nowMs) throw new OAuthFlowError();
  if (result.refreshTokenExpiresAt !== null && Date.parse(result.refreshTokenExpiresAt) <= nowMs) throw new OAuthFlowError();
  return {
    descriptor: {
      tokenBindingId: claim.tokenBindingId,
      platform: result.platform,
      externalAccountId,
      scopes,
      capabilities,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
      tokenKind: "Bearer",
      manifestRevision,
    },
    bundle: result.tokenBundle,
  };
}

function descriptorMatches(left: OAuthSafeTokenDescriptor, right: OAuthSafeTokenDescriptor): boolean {
  return left.tokenBindingId === right.tokenBindingId && left.platform === right.platform
    && left.externalAccountId === right.externalAccountId && left.tokenKind === right.tokenKind
    && left.manifestRevision === right.manifestRevision && left.accessTokenExpiresAt === right.accessTokenExpiresAt
    && left.refreshTokenExpiresAt === right.refreshTokenExpiresAt
    && [...left.scopes].sort().join("\u0000") === [...right.scopes].sort().join("\u0000")
    && [...left.capabilities].sort().join("\u0000") === [...right.capabilities].sort().join("\u0000");
}

function validateDescriptorForClaim(descriptor: OAuthSafeTokenDescriptor, claim: OAuthAuthorizationClaim, nowMs: number): boolean {
  try {
    if (descriptor.tokenBindingId !== claim.tokenBindingId || descriptor.platform !== claim.session.platform
      || descriptor.tokenKind !== "Bearer" || !required(descriptor.externalAccountId, 255)
      || !SAFE_VALUE.test(required(descriptor.manifestRevision, 100))) return false;
    const scopes = exactSafeList(descriptor.scopes).sort();
    const requested = exactSafeList(claim.session.requestedScopes, 50).sort();
    const capabilities = descriptor.capabilities.length ? exactSafeList(descriptor.capabilities).sort() : [];
    return scopes.length === requested.length && scopes.every((scope, index) => scope === requested[index])
      && capabilities.includes("publish_video")
      && capabilities.every((capability) => PUBLISHING_CAPABILITIES.has(capability))
      && descriptor.accessTokenExpiresAt !== null && Date.parse(descriptor.accessTokenExpiresAt) > nowMs
      && (descriptor.refreshTokenExpiresAt === null || Date.parse(descriptor.refreshTokenExpiresAt) > nowMs);
  } catch { return false; }
}

export function createOAuthAuthorizationSaga(dependencies: {
  repository: OAuthAuthorizationSagaRepository;
  authorizationCodeVault: OAuthAuthorizationCodeVault;
  pkceVault: OAuthVault;
  connector: OAuthProviderConnector;
  tokenVault: OAuthTokenVault;
  now?: () => Date;
  leaseMs?: number;
  }) {
  const leaseMs = dependencies.leaseMs ?? LEASE_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 5 * 60_000) throw new OAuthFlowError();
  const clock = dependencies.now ?? (() => new Date());

  async function authorize(input: {
    state: string;
    authorizationCode: string;
    scope: TenantScope;
    actorUserId: string;
    providerAccountId: string;
    platform: AiMediaOAuthPlatform;
    leaseOwner: string;
  }): Promise<AiMediaOAuthCallbackResponse> {
    const now = trustedNow(clock);
    const scope = { ownerUserId: required(input.scope.ownerUserId), workspaceId: required(input.scope.workspaceId) };
    const actorUserId = required(input.actorUserId);
    const providerAccountId = required(input.providerAccountId);
    const leaseOwner = required(input.leaseOwner);
    let stateDigest: string;
    try { stateDigest = digestOAuthState(input.state); } catch { throw new OAuthFlowError(); }
    const digest = codeDigest(input.authorizationCode);
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const claim = await dependencies.repository.claim({
      stateDigest, scope, actorUserId, providerAccountId, platform: input.platform, codeDigest: digest,
      leaseToken, leaseOwner, leaseExpiresAt, now: now.toISOString(),
    });
    if (!claim) throw new OAuthFlowError();
    if (claim.recovery === "post_exchange") {
      const tokenContext = tokenContextFor(claim);
      const candidate = await safeFind(dependencies.tokenVault, tokenContext);
      if (!candidate || !validateDescriptorForClaim(candidate.descriptor, claim, trustedNow(clock).getTime())) {
        const terminal = await markIndeterminate(dependencies.repository, leaseCommand(claim, trustedNow(clock).toISOString()), "candidate_missing");
        if (terminal) await cleanupTerminal(claim, dependencies, candidate?.reference);
        throw new OAuthFlowError();
      }
      const completedAt = trustedNow(clock).toISOString();
      return finalize(claim, leaseCommand(claim, completedAt), candidate, dependencies, completedAt);
    }

    const codeContext = codeContextFor(claim);
    let codeRef = claim.session.authorizationCodeRef;
    let attached = claim;
    if (!codeRef) {
      try {
        codeRef = await dependencies.authorizationCodeVault.putOnce(input.authorizationCode, codeContext);
        if (!CODE_REF.test(codeRef)) throw new OAuthFlowError();
      } catch { throw new OAuthFlowError(); }
      const persisted = await dependencies.repository.attachAuthorizationCode({
        ...leaseCommand(claim, trustedNow(clock).toISOString()), authorizationCodeRef: codeRef,
      });
      if (!persisted) {
        // The lease may have expired while putOnce was in flight. A newer fence can
        // legitimately own the same content-addressed reference now, so only the
        // vault TTL/reconciler may clean this pre-attach orphan safely.
        throw new OAuthFlowError();
      }
      attached = persisted;
    }
    if (!CODE_REF.test(codeRef)) throw new OAuthFlowError();
    let authorizationCode: string;
    try {
      authorizationCode = exactSecret(await dependencies.authorizationCodeVault.read(codeRef, codeContext));
      if (codeDigest(authorizationCode) !== digest) throw new OAuthFlowError();
    } catch { throw new OAuthFlowError(); }

    let verifier: string | undefined;
    if (attached.session.pkceMode === "required_s256") {
      if (!attached.session.pkceVerifierRef) throw new OAuthFlowError();
      const pkceContext = pkceContextFor(attached);
      try { verifier = required(await dependencies.pkceVault.read(attached.session.pkceVerifierRef, pkceContext), 512); }
      catch { throw new OAuthFlowError(); }
    }

    const started = await dependencies.repository.markExchangeStarted(leaseCommand(attached, trustedNow(clock).toISOString()));
    if (!started) throw new OAuthFlowError();
    let candidate: OAuthTokenVaultRecord | undefined;
    let expectedDescriptor: OAuthSafeTokenDescriptor | undefined;
    let failureCode: OAuthAuthorizationFailureCode = "provider_rejected";
    try {
      const exchanged = await dependencies.connector.exchange({
        platform: started.session.platform, authorizationCode,
        ...(verifier ? { pkceVerifier: verifier } : {}), redirectUri: started.session.redirectUri,
      });
      const normalized = normalizeResult(exchanged, started, trustedNow(clock).getTime());
      expectedDescriptor = normalized.descriptor;
      failureCode = "vault_unavailable";
      const tokenContext = tokenContextFor(started);
      candidate = await dependencies.tokenVault.putOnce({
        context: tokenContext, bundle: normalized.bundle, descriptor: normalized.descriptor,
      });
      if (!TOKEN_REF.test(candidate.reference) || !descriptorMatches(candidate.descriptor, normalized.descriptor)) throw new OAuthFlowError();
      const readback = await dependencies.tokenVault.readDescriptor(candidate.reference, tokenContext);
      if (!descriptorMatches(readback, normalized.descriptor)) throw new OAuthFlowError();
    } catch {
      candidate = await safeFind(dependencies.tokenVault, tokenContextFor(started));
      if (!candidate || (expectedDescriptor && !descriptorMatches(candidate.descriptor, expectedDescriptor))) {
        const terminal = await markIndeterminate(
          dependencies.repository,
          leaseCommand(started, trustedNow(clock).toISOString()),
          candidate ? "invalid_provider_result" : failureCode,
        );
        if (terminal) await cleanupTerminal(started, dependencies, candidate?.reference);
        throw new OAuthFlowError();
      }
    }
    const completedAt = trustedNow(clock).toISOString();
    return finalize(started, leaseCommand(started, completedAt), candidate, dependencies, completedAt);
  }

  return { authorize };
}

function trustedNow(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new OAuthFlowError();
  return now;
}

function leaseCommand(claim: OAuthAuthorizationClaim, now: string): OAuthLeaseCommand {
  return {
    sessionId: claim.session.id, scope: claim.session.scope, actorUserId: claim.session.actorUserId,
    providerAccountId: claim.session.providerAccountId, platform: claim.session.platform,
    leaseToken: claim.leaseToken, leaseFencing: claim.leaseFencing, now,
  };
}

function pkceContextFor(claim: OAuthAuthorizationClaim): OAuthVaultContext {
  return {
    purpose: "ai_media_oauth_pkce", ...claim.session.scope, actorUserId: claim.session.actorUserId,
    providerAccountId: claim.session.providerAccountId, platform: claim.session.platform,
    sessionId: claim.session.id, expiresAt: claim.session.expiresAt,
  };
}

function codeContextFor(claim: OAuthAuthorizationClaim): OAuthAuthorizationCodeVaultContext {
  if (!claim.session.authorizationCodeDigest) throw new OAuthFlowError();
  return {
    purpose: "ai_media_oauth_authorization_code", ...claim.session.scope,
    actorUserId: claim.session.actorUserId, providerAccountId: claim.session.providerAccountId,
    platform: claim.session.platform, sessionId: claim.session.id, tokenBindingId: claim.tokenBindingId,
    codeDigest: claim.session.authorizationCodeDigest, expiresAt: claim.session.expiresAt,
  };
}

function tokenContextFor(claim: OAuthAuthorizationClaim): OAuthTokenVaultContext {
  return {
    purpose: "ai_media_oauth_token", ...claim.session.scope,
    actorUserId: claim.session.actorUserId,
    providerAccountId: claim.session.providerAccountId, platform: claim.session.platform,
    sessionId: claim.session.id, targetCredentialVersion: claim.targetCredentialVersion,
    tokenBindingId: claim.tokenBindingId,
  };
}

async function safeFind(vault: OAuthTokenVault, context: OAuthTokenVaultContext): Promise<OAuthTokenVaultRecord | undefined> {
  try { return await vault.find(context); } catch { return undefined; }
}

async function markIndeterminate(repository: OAuthAuthorizationSagaRepository, command: OAuthLeaseCommand, code: OAuthAuthorizationFailureCode): Promise<boolean> {
  try { return Boolean(await repository.markIndeterminate({ ...command, failureCode: code })); }
  catch { return false; /* A reconciler owns unresolved durable state. */ }
}

async function finalize(
  claim: OAuthAuthorizationClaim,
  command: OAuthLeaseCommand,
  candidate: OAuthTokenVaultRecord,
  dependencies: Parameters<typeof createOAuthAuthorizationSaga>[0],
  consumedAt: string,
): Promise<AiMediaOAuthCallbackResponse> {
  if (!TOKEN_REF.test(candidate.reference) || !validateDescriptorForClaim(candidate.descriptor, claim, Date.parse(consumedAt))) {
    const terminal = await markIndeterminate(dependencies.repository, command, "invalid_provider_result");
    if (terminal) await cleanupTerminal(claim, dependencies, candidate.reference);
    throw new OAuthFlowError();
  }
  const completed = await dependencies.repository.finalizeAuthorized({
    ...command, tokenReference: candidate.reference, descriptor: candidate.descriptor, consumedAt,
  });
  if (!completed) {
    const terminal = await markIndeterminate(dependencies.repository, command, "credential_conflict");
    if (terminal) await cleanupTerminal(claim, dependencies, candidate.reference);
    throw new OAuthFlowError();
  }
  await cleanupTerminal(claim, dependencies);
  return { sessionId: completed.id, platform: completed.platform, outcome: "authorized", consumedAt };
}

async function cleanupTerminal(
  claim: OAuthAuthorizationClaim,
  dependencies: Pick<Parameters<typeof createOAuthAuthorizationSaga>[0], "authorizationCodeVault" | "pkceVault" | "tokenVault">,
  candidateRef?: string,
): Promise<void> {
  const codeContext = codeContextFor(claim);
  if (claim.session.authorizationCodeRef) {
    try { await dependencies.authorizationCodeVault.delete(claim.session.authorizationCodeRef, codeContext); } catch { /* TTL cleanup. */ }
  }
  if (claim.session.pkceVerifierRef) {
    try { await dependencies.pkceVault.delete(claim.session.pkceVerifierRef, pkceContextFor(claim)); } catch { /* TTL cleanup. */ }
  }
  if (candidateRef && TOKEN_REF.test(candidateRef)) {
    try { await dependencies.tokenVault.delete(candidateRef, tokenContextFor(claim)); } catch { /* Durable reconciliation remains required. */ }
  }
}
