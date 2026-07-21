import { randomUUID } from "node:crypto";
import type {
  ClaimOAuthAuthorization,
  ConsumeDeniedOrErrorOAuthSession,
  CreateOAuthSession,
  OAuthAuthorizationClaim,
  OAuthAuthorizationSagaRepository,
  OAuthFinalizeAuthorization,
  OAuthLeaseCommand,
  OAuthSession,
  OAuthSessionRepository,
} from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function clone(session: OAuthSession): OAuthSession {
  return { ...session, scope: { ...session.scope }, requestedScopes: [...session.requestedScopes] };
}

type InMemoryOAuthAccount = {
  scope: OAuthSession["scope"];
  id: string;
  platform: OAuthSession["platform"];
  credentialVersion: number;
  externalAccountId: string | null;
  secretRef: string | null;
  credentialActorUserId?: string | null;
  credentialSourceSessionId?: string | null;
  tokenBindingId?: string | null;
  capabilities?: readonly string[];
  grantedScopes?: readonly string[];
  credentialExpiresAt?: string | null;
};
export type InMemoryOAuthVaultOperation=Readonly<{id:string;kind:"pkce_verifier"|"authorization_code"|"token_credential";reference:string;
  sessionId:string;state:"scheduled"|"retained";availableAt:string;quiescentUntil:string;tokenBindingId:string|null;authorizationCodeDigest:string|null}>;

export class InMemoryOAuthSessionRepository implements OAuthSessionRepository, OAuthAuthorizationSagaRepository {
  private readonly sessions = new Map<string, OAuthSession>();
  private readonly accounts = new Map<string, InMemoryOAuthAccount>();
  private readonly vaultOperations=new Map<string,InMemoryOAuthVaultOperation>();

  seedProviderAccount(account: InMemoryOAuthAccount): void {
    this.accounts.set(`${account.scope.ownerUserId}:${account.scope.workspaceId}:${account.id}:${account.platform}`, {
      ...account, scope: { ...account.scope },
    });
  }

  getProviderAccount(scope: OAuthSession["scope"], id: string, platform: OAuthSession["platform"]): InMemoryOAuthAccount | undefined {
    const account = this.accounts.get(`${scope.ownerUserId}:${scope.workspaceId}:${id}:${platform}`);
    return account ? { ...account, scope: { ...account.scope } } : undefined;
  }

  getSession(id: string): OAuthSession | undefined {
    const session = this.sessions.get(id);
    return session ? clone(session) : undefined;
  }
  getVaultOperations(sessionId:string):readonly InMemoryOAuthVaultOperation[]{return[...this.vaultOperations.values()].filter(item=>item.sessionId===sessionId).map(item=>({...item}));}

  async create(input: CreateOAuthSession): Promise<OAuthSession> {
    if ([...this.sessions.values()].some((session) => session.stateDigest === input.stateDigest)) {
      throw new Error("OAuth state digest already exists");
    }
    const session: OAuthSession = {
      ...input,
      scope: { ...input.scope },
      requestedScopes: [...input.requestedScopes],
      status: "pending",
      exchangeStatus: "not_started",
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseFencing: 0,
      authorizationCodeDigest: null,
      authorizationCodeRef: null,
      expectedCredentialVersion: null,
      targetCredentialVersion: null,
      tokenBindingId: null,
      failureCode: null,
      outcome: null,
      consumedAt: null,
      updatedAt: input.createdAt,
    };
    this.sessions.set(session.id, session);
    if(session.pkceVerifierRef)this.vaultOperations.set(`pkce_verifier:${session.pkceVerifierRef}`,{id:randomUUID(),kind:"pkce_verifier",reference:session.pkceVerifierRef,
      sessionId:session.id,state:"scheduled",availableAt:session.expiresAt,quiescentUntil:new Date(Date.parse(session.expiresAt)+60_000).toISOString(),tokenBindingId:null,authorizationCodeDigest:null});
    return clone(session);
  }

  async consumeDeniedOrError(input: ConsumeDeniedOrErrorOAuthSession): Promise<OAuthSession | undefined> {
    const session = [...this.sessions.values()].find((candidate) => candidate.stateDigest === input.stateDigest);
    if (!session || session.status !== "pending" || Date.parse(session.expiresAt) <= Date.parse(input.now)) return undefined;
    if (session.platform !== input.platform) return undefined;
    const consumed: OAuthSession = {
      ...session,
      status: "consumed",
      outcome: input.outcome,
      exchangeStatus: "not_required",
      consumedAt: input.now,
      updatedAt: input.now,
    };
    this.sessions.set(consumed.id, consumed);
    for(const [key,item]of this.vaultOperations)if(item.sessionId===consumed.id&&item.kind==="pkce_verifier")this.vaultOperations.set(key,{...item,availableAt:input.now,quiescentUntil:new Date(Date.parse(input.now)+60_000).toISOString()});
    return clone(consumed);
  }

  async claim(input: ClaimOAuthAuthorization): Promise<OAuthAuthorizationClaim | undefined> {
    const session = [...this.sessions.values()].find((candidate) => candidate.stateDigest === input.stateDigest);
    const accountKey = `${input.scope.ownerUserId}:${input.scope.workspaceId}:${input.providerAccountId}:${input.platform}`;
    const account = this.accounts.get(accountKey);
    const nowMs = Date.parse(input.now);
    const leaseExpiresMs = Date.parse(input.leaseExpiresAt);
    if (!session || !account || !Number.isFinite(nowMs) || !Number.isFinite(leaseExpiresMs)
      || !UUID.test(input.leaseToken) || !SHA256.test(input.codeDigest) || !input.leaseOwner.trim()
      || input.leaseOwner.length > 255 || leaseExpiresMs <= nowMs || leaseExpiresMs > nowMs + 5 * 60_000
      || leaseExpiresMs > Date.parse(session.expiresAt) || Date.parse(session.expiresAt) <= nowMs) return undefined;
    if (session.scope.ownerUserId !== input.scope.ownerUserId || session.scope.workspaceId !== input.scope.workspaceId
      || session.actorUserId !== input.actorUserId || session.providerAccountId !== input.providerAccountId
      || session.platform !== input.platform || session.status === "consumed") return undefined;
    if (session.status === "processing") {
      if (!session.leaseExpiresAt || Date.parse(session.leaseExpiresAt) > Date.parse(input.now)) return undefined;
      if (session.authorizationCodeDigest !== input.codeDigest || session.exchangeStatus === "indeterminate"
        || session.exchangeStatus === "succeeded" || session.exchangeStatus === "failed") return undefined;
      if (account.credentialVersion !== session.expectedCredentialVersion) return undefined;
    } else if (session.authorizationCodeDigest !== null || session.exchangeStatus !== "not_started") return undefined;

    const expectedCredentialVersion = session.expectedCredentialVersion ?? account.credentialVersion;
    const tokenBindingId = session.tokenBindingId ?? randomUUID();
    const claimed: OAuthSession = {
      ...session,
      status: "processing",
      leaseToken: input.leaseToken,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      leaseFencing: session.leaseFencing + 1,
      authorizationCodeDigest: input.codeDigest,
      expectedCredentialVersion,
      targetCredentialVersion: expectedCredentialVersion + 1,
      tokenBindingId,
      updatedAt: input.now,
    };
    const codeReference=`vault://ai-media-studio/oauth-code/v1/${claimed.id}`;
    const tokenReference=`vault://ai-media-studio/oauth-token/v1/${tokenBindingId}`;
    const existingCode=this.vaultOperations.get(`authorization_code:${codeReference}`);const existingToken=this.vaultOperations.get(`token_credential:${tokenReference}`);
    if((existingCode&&existingCode.sessionId!==claimed.id)||(existingToken&&existingToken.sessionId!==claimed.id))return undefined;
    if(!existingCode)this.vaultOperations.set(`authorization_code:${codeReference}`,{id:randomUUID(),kind:"authorization_code",reference:codeReference,sessionId:claimed.id,state:"scheduled",
      availableAt:claimed.expiresAt,quiescentUntil:new Date(Date.parse(claimed.expiresAt)+60_000).toISOString(),tokenBindingId,authorizationCodeDigest:input.codeDigest});
    if(!existingToken)this.vaultOperations.set(`token_credential:${tokenReference}`,{id:randomUUID(),kind:"token_credential",reference:tokenReference,sessionId:claimed.id,state:"retained",
      availableAt:"9999-12-31T23:59:59.999Z",quiescentUntil:"9999-12-31T23:59:59.999Z",tokenBindingId,authorizationCodeDigest:null});
    this.sessions.set(claimed.id, claimed);
    return this.asClaim(claimed);
  }

  async attachAuthorizationCode(input: OAuthLeaseCommand & { authorizationCodeRef: string }): Promise<OAuthAuthorizationClaim | undefined> {
    const current = this.exactLease(input);
    if (!current || current.exchangeStatus !== "not_started") return undefined;
    const next = { ...current, authorizationCodeRef: input.authorizationCodeRef, exchangeStatus: "ready" as const, updatedAt: input.now };
    this.sessions.set(next.id, next);
    return this.asClaim(next);
  }

  async markExchangeStarted(input: OAuthLeaseCommand): Promise<OAuthAuthorizationClaim | undefined> {
    const current = this.exactLease(input);
    if (!current || current.exchangeStatus !== "ready" || !current.authorizationCodeRef) return undefined;
    const next = { ...current, exchangeStatus: "in_progress" as const, updatedAt: input.now };
    this.sessions.set(next.id, next);
    return this.asClaim(next);
  }

  async finalizeAuthorized(input: OAuthFinalizeAuthorization): Promise<OAuthSession | undefined> {
    const current = this.exactLease(input);
    if (!current || current.exchangeStatus !== "in_progress" || current.tokenBindingId !== input.descriptor.tokenBindingId
      || current.platform !== input.descriptor.platform || current.targetCredentialVersion == null
      || current.expectedCredentialVersion == null) return undefined;
    const key = `${current.scope.ownerUserId}:${current.scope.workspaceId}:${current.providerAccountId}:${current.platform}`;
    const account = this.accounts.get(key);
    if (!account || account.credentialVersion !== current.expectedCredentialVersion
      || (account.externalAccountId !== null && account.externalAccountId !== input.descriptor.externalAccountId)) return undefined;
    this.accounts.set(key, {
      ...account,
      credentialVersion: current.targetCredentialVersion,
      externalAccountId: input.descriptor.externalAccountId,
      secretRef: input.tokenReference,
      credentialActorUserId: current.actorUserId,
      credentialSourceSessionId: current.id,
      tokenBindingId: current.tokenBindingId,
      capabilities: [...input.descriptor.capabilities],
      grantedScopes: [...input.descriptor.scopes],
      credentialExpiresAt: input.descriptor.accessTokenExpiresAt,
    });
    const done: OAuthSession = {
      ...current, status: "consumed", exchangeStatus: "succeeded", outcome: "authorized",
      consumedAt: input.consumedAt, leaseToken: null, leaseOwner: null, leaseExpiresAt: null,
      failureCode: null, updatedAt: input.consumedAt,
    };
    this.sessions.set(done.id, done);
    this.accelerateNonToken(done.id,input.consumedAt);
    return clone(done);
  }

  async markIndeterminate(input: OAuthLeaseCommand & { failureCode: OAuthSession["failureCode"] }): Promise<OAuthSession | undefined> {
    const current = this.exactLease(input);
    if (!current || input.failureCode == null) return undefined;
    const next: OAuthSession = {
      ...current, exchangeStatus: "indeterminate", failureCode: input.failureCode,
      leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now,
    };
    this.sessions.set(next.id, next);
    for(const [key,item]of this.vaultOperations)if(item.sessionId===next.id)this.vaultOperations.set(key,{...item,state:"scheduled",availableAt:input.now,quiescentUntil:new Date(Date.parse(input.now)+60_000).toISOString()});
    return clone(next);
  }

  private exactLease(input: OAuthLeaseCommand): OAuthSession | undefined {
    const current = this.sessions.get(input.sessionId);
    if (!current || current.status !== "processing" || current.scope.ownerUserId !== input.scope.ownerUserId
      || current.scope.workspaceId !== input.scope.workspaceId || current.actorUserId !== input.actorUserId
      || current.providerAccountId !== input.providerAccountId || current.platform !== input.platform
      || current.leaseToken !== input.leaseToken || current.leaseFencing !== input.leaseFencing
      || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= Date.parse(input.now)) return undefined;
    return current;
  }

  private accelerateNonToken(sessionId:string,now:string):void{for(const [key,item]of this.vaultOperations)if(item.sessionId===sessionId&&item.kind!=="token_credential")
    this.vaultOperations.set(key,{...item,availableAt:now,quiescentUntil:new Date(Date.parse(now)+60_000).toISOString()});}

  private asClaim(session: OAuthSession): OAuthAuthorizationClaim {
    if (!session.leaseToken || !session.leaseOwner || !session.leaseExpiresAt || session.expectedCredentialVersion == null
      || session.targetCredentialVersion == null || !session.tokenBindingId) throw new Error("Invalid authorization claim");
    return {
      session: clone(session), leaseToken: session.leaseToken, leaseOwner: session.leaseOwner,
      leaseExpiresAt: session.leaseExpiresAt, leaseFencing: session.leaseFencing,
      expectedCredentialVersion: session.expectedCredentialVersion,
      targetCredentialVersion: session.targetCredentialVersion, tokenBindingId: session.tokenBindingId,
      recovery: session.exchangeStatus === "in_progress" ? "post_exchange" : "pre_exchange",
    };
  }
}
