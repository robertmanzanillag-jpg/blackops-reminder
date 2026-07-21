import { randomUUID } from "node:crypto";
import {
  aiMediaOAuthStartRequestSchema,
  type AiMediaOAuthCallbackResponse,
  type AiMediaOAuthOutcome,
  type AiMediaOAuthPlatform,
  type AiMediaOAuthStartResponse,
} from "../../../shared/ai-media-studio-oauth";
import type { TenantScope } from "../core/resource-domain";
import {
  type OAuthAccountBindingVerifier,
  OAuthFlowError,
  type OAuthPlatformPolicies,
  type OAuthSessionRepository,
  type OAuthVault,
  type OAuthVaultContext,
} from "./contracts";
import { createOAuthState, createPkceChallenge, createPkceVerifier, digestOAuthState } from "./crypto";

const MAX_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_TTL_MS = 10 * 60 * 1_000;
const PKCE_VAULT_REFERENCE = /^vault:\/\/ai-media-studio\/oauth-pkce\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmpty(value: string, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new OAuthFlowError(`${name} is required`);
  return normalized;
}

function exactScopeList(scopes: readonly string[]): string[] {
  const normalized = scopes.map((scope) => scope.trim());
  if (!normalized.length || normalized.some((scope) => !scope) || new Set(normalized).size !== normalized.length) {
    throw new OAuthFlowError("OAuth scopes are invalid");
  }
  return normalized;
}

function policyFor(policies: OAuthPlatformPolicies, platform: AiMediaOAuthPlatform) {
  const policy = policies[platform];
  if (!policy || !policy.redirectUris.length || !policy.scopes.length) {
    throw new OAuthFlowError("OAuth platform is not configured");
  }
  return policy;
}

function trustedRedirectUri(value: string): string {
  let redirect: URL;
  try { redirect = new URL(value); } catch { throw new OAuthFlowError("OAuth redirect is invalid"); }
  if (
    redirect.protocol !== "https:" ||
    redirect.username !== "" ||
    redirect.password !== "" ||
    redirect.search !== "" ||
    redirect.hash !== "" ||
    (redirect.port !== "" && redirect.port !== "443") ||
    redirect.href !== value
  ) {
    throw new OAuthFlowError("OAuth redirect is invalid");
  }
  return redirect.href;
}

function pkceVaultReference(value: string): string {
  const reference = nonEmpty(value, "PKCE verifier reference");
  if (!PKCE_VAULT_REFERENCE.test(reference)) {
    throw new OAuthFlowError("PKCE verifier reference is invalid");
  }
  return reference;
}

export function createOAuthService(dependencies: {
  repository?: OAuthSessionRepository;
  vault?: OAuthVault;
  accounts?: OAuthAccountBindingVerifier;
  policies?: OAuthPlatformPolicies;
  ttlMs?: number;
  now?: () => Date;
}) {
  if (!dependencies.repository || !dependencies.vault || !dependencies.accounts || !dependencies.policies) {
    throw new OAuthFlowError("OAuth dependencies are not configured");
  }
  const repository = dependencies.repository;
  const vault = dependencies.vault;
  const accounts = dependencies.accounts;
  const policies = dependencies.policies;
  const ttlMs = dependencies.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw new OAuthFlowError("OAuth session TTL is invalid");
  }
  const now = dependencies.now ?? (() => new Date());

  async function start(input: {
    scope: TenantScope;
    actorUserId: string;
    providerAccountId: string;
    platform: AiMediaOAuthPlatform;
  }): Promise<AiMediaOAuthStartResponse> {
    const scope = {
      ownerUserId: nonEmpty(input.scope.ownerUserId, "ownerUserId"),
      workspaceId: nonEmpty(input.scope.workspaceId, "workspaceId"),
    };
    const actorUserId = nonEmpty(input.actorUserId, "actorUserId");
    const parsed = aiMediaOAuthStartRequestSchema.parse({
      providerAccountId: input.providerAccountId,
      platform: input.platform,
    });
    const policy = policyFor(policies, parsed.platform);
    if (policy.redirectUris.length !== 1) throw new OAuthFlowError("OAuth platform redirect is ambiguous");
    const redirectUri = trustedRedirectUri(policy.redirectUris[0]);
    const requestedScopes = exactScopeList(policy.scopes);
    await accounts.assertConnectable({
      scope,
      actorUserId,
      providerAccountId: parsed.providerAccountId,
      platform: parsed.platform,
    });

    const createdAt = now();
    if (Number.isNaN(createdAt.getTime())) throw new OAuthFlowError("OAuth clock is invalid");
    const sessionId = randomUUID();
    const expiresAt = new Date(createdAt.getTime() + ttlMs).toISOString();
    const state = createOAuthState();
    const verifier = createPkceVerifier();
    const codeChallenge = createPkceChallenge(verifier);
    const context: OAuthVaultContext = {
      purpose: "ai_media_oauth_pkce",
      ...scope,
      actorUserId,
      providerAccountId: parsed.providerAccountId,
      platform: parsed.platform,
      sessionId,
      expiresAt,
    };
    const rawPkceVerifierRef = await vault.put(verifier, context);
    let pkceVerifierRef: string;
    try {
      pkceVerifierRef = pkceVaultReference(rawPkceVerifierRef);
    } catch (error) {
      try { await vault.delete(rawPkceVerifierRef, context); } catch { /* Vault TTL remains the final cleanup boundary. */ }
      throw error;
    }

    try {
      await repository.create({
        id: sessionId,
        scope,
        actorUserId,
        providerAccountId: parsed.providerAccountId,
        platform: parsed.platform,
        stateDigest: digestOAuthState(state),
        redirectUri,
        requestedScopes,
        codeChallenge,
        codeChallengeMethod: "S256",
        pkceVerifierRef,
        expiresAt,
        createdAt: createdAt.toISOString(),
      });
    } catch (error) {
      try { await vault.delete(pkceVerifierRef, context); } catch { /* Vault TTL remains the final cleanup boundary. */ }
      throw error;
    }

    return {
      sessionId,
      platform: parsed.platform,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri,
      requestedScopes,
      expiresAt,
    };
  }

  async function consume(input: {
    state: string;
    platform: AiMediaOAuthPlatform;
    outcome: AiMediaOAuthOutcome;
  }): Promise<AiMediaOAuthCallbackResponse> {
    policyFor(policies, input.platform);
    let stateDigest: string;
    try { stateDigest = digestOAuthState(input.state); } catch { throw new OAuthFlowError(); }
    const consumedAt = now().toISOString();
    const session = await repository.consume({
      stateDigest,
      platform: input.platform,
      outcome: input.outcome,
      now: consumedAt,
    });
    if (!session) throw new OAuthFlowError();
    if (input.outcome !== "authorized") {
      const context: OAuthVaultContext = {
        purpose: "ai_media_oauth_pkce",
        ...session.scope,
        actorUserId: session.actorUserId,
        providerAccountId: session.providerAccountId,
        platform: session.platform,
        sessionId: session.id,
        expiresAt: session.expiresAt,
      };
      try { await vault.delete(session.pkceVerifierRef, context); } catch { /* Expiring vault entry remains unusable after consume. */ }
    }
    return { sessionId: session.id, platform: session.platform, outcome: input.outcome, consumedAt };
  }

  return { start, consume };
}
