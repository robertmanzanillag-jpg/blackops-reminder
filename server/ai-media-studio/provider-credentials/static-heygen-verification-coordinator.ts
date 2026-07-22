import type { TenantScope } from "../core/resource-domain";
import {
  HeyGenV3StaticVerificationHttpProvider,
  type HeyGenV3StaticVerificationProviderOptions,
} from "../providers/heygen-v3-static-verification-provider";
import type {
  HeyGenV3StaticVerificationFailureCode,
  HeyGenV3StaticVerificationProvider,
  HeyGenV3StaticVerificationSelection,
} from "../providers/heygen-v3-static-verification-contracts";
import { STATIC_HEYGEN_SECRET_REF } from "./static-heygen-contracts";
import type { StaticHeyGenSecretResolver } from "./static-heygen-secret-resolver";
import {
  deterministicUuid,
  type Sha256Digest,
  type StaticHeyGenVerificationReceipt,
} from "./static-heygen-verification-contracts";
import { StaticHeyGenVerificationService } from "./static-heygen-verification-service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,254}$/u;
const SAFE_ROSTER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const MIN_LIFETIME_MS = 60_000;
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type StaticHeyGenLiveVerificationAuthorizationContext = unknown;

export interface StaticHeyGenLiveVerificationAuthorization {
  readonly decision: "authorized";
  readonly capability: "heygen_static_verification:execute";
  readonly actorUserId: string;
}

export interface StaticHeyGenLiveVerificationAuthorizer {
  authorize(input: Readonly<{
    operation: "verify_static_heygen";
    scope: TenantScope;
    authorizationContext: StaticHeyGenLiveVerificationAuthorizationContext;
  }>): Promise<StaticHeyGenLiveVerificationAuthorization | undefined>;
}

/** Exact server-owned context. No field in this shape may come from an HTTP body. */
export interface StaticHeyGenLiveVerificationContext {
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: "heygen";
  readonly providerCredentialVersion: number;
  readonly accountStatus: "disconnected";
  readonly credentialStatus: "unverified";
  readonly credentialSource: "static_api_key";
  readonly staticCredentialBindingId: string;
  readonly credentialBindingRequestDigest: Sha256Digest;
  readonly bindingLifecycleState: "pending";
  readonly bindingVerificationState: "unverified";
  readonly secretRef: string;
  readonly dailyPlanId: string;
  readonly sourceRosterKey: string;
  readonly sourceRosterDigest: Sha256Digest;
  readonly planDigest: Sha256Digest;
  readonly planStatus: "blocked";
  readonly plannedSlotCount: number;
  readonly selections: readonly HeyGenV3StaticVerificationSelection[];
}

export interface StaticHeyGenLiveVerificationContextLoader {
  loadCurrent(scope: TenantScope): Promise<StaticHeyGenLiveVerificationContext | undefined>;
}

export interface StaticHeyGenLiveVerificationReplayReader {
  find(scope: TenantScope, idempotencyKey: string): Promise<StaticHeyGenVerificationReceipt | undefined>;
}

export type StaticHeyGenVerificationProviderFactory = (
  options: HeyGenV3StaticVerificationProviderOptions,
) => HeyGenV3StaticVerificationProvider;

export type StaticHeyGenLiveVerificationResult =
  | Readonly<{
      outcome: "recorded";
      verification: StaticHeyGenVerificationReceipt["verification"];
      effects: Readonly<{
        providerNetworkCall: true;
        liveVerification: true;
        generation: false;
        admission: false;
        spend: false;
        deployment: false;
        migrationApply: false;
        publishing: false;
      }>;
    }>
  | Readonly<{
      outcome: "replayed";
      verification: StaticHeyGenVerificationReceipt["verification"];
      effects: Readonly<{
        providerNetworkCall: false;
        liveVerification: false;
        generation: false;
        admission: false;
        spend: false;
        deployment: false;
        migrationApply: false;
        publishing: false;
      }>;
    }>
  | Readonly<{
      outcome: "provider_failed";
      providerKey: "heygen";
      failureCode: HeyGenV3StaticVerificationFailureCode;
      observedAt: string;
      effects: Readonly<{
        providerNetworkCall: true;
        liveVerification: false;
        generation: false;
        admission: false;
        spend: false;
        deployment: false;
        migrationApply: false;
        publishing: false;
      }>;
    }>;

export type StaticHeyGenLiveVerificationErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "CONTEXT_UNAVAILABLE"
  | "SECRET_UNAVAILABLE"
  | "VERIFICATION_UNAVAILABLE";

export class StaticHeyGenLiveVerificationError extends Error {
  readonly statusCode: number;

  constructor(readonly code: StaticHeyGenLiveVerificationErrorCode) {
    super("Live HeyGen verification is unavailable");
    this.name = "StaticHeyGenLiveVerificationError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "UNAUTHORIZED" ? 403 : 503;
  }
}

export interface StaticHeyGenLiveVerificationCoordinatorOptions {
  readonly authorizer: StaticHeyGenLiveVerificationAuthorizer;
  readonly replayReader: StaticHeyGenLiveVerificationReplayReader;
  readonly contextLoader: StaticHeyGenLiveVerificationContextLoader;
  readonly secretResolver: StaticHeyGenSecretResolver;
  readonly evidenceService: StaticHeyGenVerificationService;
  readonly verificationLifetimeMs?: number;
  readonly providerFactory?: StaticHeyGenVerificationProviderFactory;
}

const SAFE_SUCCESS_EFFECTS = Object.freeze({
  providerNetworkCall: true,
  liveVerification: true,
  generation: false,
  admission: false,
  spend: false,
  deployment: false,
  migrationApply: false,
  publishing: false,
} as const);

const SAFE_FAILED_EFFECTS = Object.freeze({ ...SAFE_SUCCESS_EFFECTS, liveVerification: false } as const);
const SAFE_REPLAY_EFFECTS = Object.freeze({
  ...SAFE_SUCCESS_EFFECTS,
  providerNetworkCall: false,
  liveVerification: false,
} as const);

/**
 * Explicit, run-on-demand coordinator for the immutable static-key evidence path.
 * Authorization precedes every context, secret and provider operation. The only
 * default transport is the reviewed GET-only HeyGen V3 verification provider.
 */
export class StaticHeyGenLiveVerificationCoordinator {
  private readonly lifetimeMs: number;
  private readonly providerFactory: StaticHeyGenVerificationProviderFactory;

  constructor(private readonly options: StaticHeyGenLiveVerificationCoordinatorOptions) {
    if (!options?.authorizer || !options.replayReader || !options.contextLoader
      || !options.secretResolver || !options.evidenceService) {
      throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    }
    this.lifetimeMs = options.verificationLifetimeMs ?? 6 * 60 * 60 * 1_000;
    if (!Number.isSafeInteger(this.lifetimeMs)
      || this.lifetimeMs < MIN_LIFETIME_MS
      || this.lifetimeMs > MAX_LIFETIME_MS) {
      throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    }
    this.providerFactory = options.providerFactory
      ?? ((providerOptions) => new HeyGenV3StaticVerificationHttpProvider(providerOptions));
  }

  async run(input: Readonly<{
    scope: TenantScope;
    idempotencyKey: string;
    authorizationContext: StaticHeyGenLiveVerificationAuthorizationContext;
  }>): Promise<StaticHeyGenLiveVerificationResult> {
    const request = validateRequest(input);
    const authorization = await this.authorize(request);
    const replay = await this.findReplay(request.scope, request.idempotencyKey);
    if (replay) return Object.freeze({ outcome: "replayed" as const, verification: replay.verification, effects: SAFE_REPLAY_EFFECTS });
    const context = await this.loadContext(request.scope);
    const apiKey = await this.resolveSecret(context.secretRef);
    let providerOutcome;
    try {
      const provider = this.providerFactory({
        apiKey,
        providerAccountId: context.providerAccountId,
        providerCredentialVersion: context.providerCredentialVersion,
      });
      providerOutcome = await provider.verify({
        scope: context.scope,
        providerAccountId: context.providerAccountId,
        providerKey: "heygen",
        providerCredentialVersion: context.providerCredentialVersion,
        idempotencyKey: request.idempotencyKey,
        selections: context.selections,
      });
    } catch {
      throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    }
    if (providerOutcome.kind === "failed") {
      return Object.freeze({
        outcome: "provider_failed" as const,
        providerKey: "heygen" as const,
        failureCode: providerOutcome.failureCode,
        observedAt: providerOutcome.observedAt,
        effects: SAFE_FAILED_EFFECTS,
      });
    }

    const observedAtMs = Date.parse(providerOutcome.observedAt);
    if (!Number.isFinite(observedAtMs)) throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    let receipt: StaticHeyGenVerificationReceipt;
    try {
      receipt = await this.options.evidenceService.recordPassed({
        verificationId: deterministicUuid([
          "live-static-heygen-verification-v1",
          context.scope.ownerUserId,
          context.scope.workspaceId,
          context.providerAccountId,
          context.providerCredentialVersion,
          context.dailyPlanId,
          request.idempotencyKey,
        ].join("\0")),
        scope: context.scope,
        actorUserId: authorization.actorUserId,
        providerAccountId: context.providerAccountId,
        staticCredentialBindingId: context.staticCredentialBindingId,
        providerCredentialVersion: context.providerCredentialVersion,
        credentialBindingRequestDigest: context.credentialBindingRequestDigest,
        dailyPlanId: context.dailyPlanId,
        sourceRosterKey: context.sourceRosterKey,
        sourceRosterDigest: context.sourceRosterDigest,
        planDigest: context.planDigest,
        policyExpiresAt: new Date(observedAtMs + this.lifetimeMs).toISOString(),
        idempotencyKey: request.idempotencyKey,
        providerOutcome,
      });
    } catch {
      throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    }
    if (receipt.outcome !== "recorded") throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    return Object.freeze({ outcome: "recorded" as const, verification: receipt.verification, effects: SAFE_SUCCESS_EFFECTS });
  }

  private async authorize(input: Readonly<{
    scope: TenantScope;
    idempotencyKey: string;
    authorizationContext: StaticHeyGenLiveVerificationAuthorizationContext;
  }>): Promise<StaticHeyGenLiveVerificationAuthorization> {
    let authorization: StaticHeyGenLiveVerificationAuthorization | undefined;
    try {
      authorization = await this.options.authorizer.authorize({
        operation: "verify_static_heygen",
        scope: input.scope,
        authorizationContext: input.authorizationContext,
      });
    } catch {
      throw new StaticHeyGenLiveVerificationError("UNAUTHORIZED");
    }
    if (!authorization
      || authorization.decision !== "authorized"
      || authorization.capability !== "heygen_static_verification:execute"
      || !SAFE_ACTOR.test(authorization.actorUserId)) {
      throw new StaticHeyGenLiveVerificationError("UNAUTHORIZED");
    }
    return authorization;
  }

  private async loadContext(scope: TenantScope): Promise<StaticHeyGenLiveVerificationContext> {
    let context: StaticHeyGenLiveVerificationContext | undefined;
    try {
      context = await this.options.contextLoader.loadCurrent(scope);
    } catch {
      throw new StaticHeyGenLiveVerificationError("CONTEXT_UNAVAILABLE");
    }
    if (!context || !validContext(context, scope)) {
      throw new StaticHeyGenLiveVerificationError("CONTEXT_UNAVAILABLE");
    }
    return context;
  }

  private async findReplay(
    scope: TenantScope,
    idempotencyKey: string,
  ): Promise<StaticHeyGenVerificationReceipt | undefined> {
    try {
      const replay = await this.options.replayReader.find(scope, idempotencyKey);
      if (!replay) return undefined;
      if (replay.outcome !== "replayed"
        || replay.verification.providerKey !== "heygen"
        || !Number.isSafeInteger(replay.verification.providerCredentialVersion)
        || replay.verification.providerCredentialVersion < 1
        || !Number.isSafeInteger(replay.verification.avatarCount)
        || replay.verification.avatarCount < 5
        || replay.verification.avatarCount > 10
        || !Number.isSafeInteger(replay.verification.voiceCount)
        || replay.verification.voiceCount < 1
        || replay.verification.voiceCount > 10
        || !Number.isFinite(Date.parse(replay.verification.verifiedAt))
        || !Number.isFinite(Date.parse(replay.verification.expiresAt))
        || Date.parse(replay.verification.expiresAt) <= Date.parse(replay.verification.verifiedAt)) {
        throw new Error("invalid replay");
      }
      return replay;
    } catch {
      throw new StaticHeyGenLiveVerificationError("VERIFICATION_UNAVAILABLE");
    }
  }

  private async resolveSecret(secretRef: string) {
    try {
      const value = await this.options.secretResolver.resolve(secretRef);
      if (!value) throw new Error("missing");
      return value;
    } catch {
      throw new StaticHeyGenLiveVerificationError("SECRET_UNAVAILABLE");
    }
  }
}

function validateRequest(input: Readonly<{
  scope: TenantScope;
  idempotencyKey: string;
  authorizationContext: StaticHeyGenLiveVerificationAuthorizationContext;
}>) {
  if (!input || typeof input !== "object"
    || !validScope(input.scope)
    || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new StaticHeyGenLiveVerificationError("INVALID_REQUEST");
  }
  return Object.freeze({ scope: Object.freeze({ ...input.scope }), idempotencyKey: input.idempotencyKey,
    authorizationContext: input.authorizationContext });
}

function validContext(context: StaticHeyGenLiveVerificationContext, scope: TenantScope): boolean {
  return validScope(context.scope)
    && context.scope.ownerUserId === scope.ownerUserId
    && context.scope.workspaceId === scope.workspaceId
    && UUID.test(context.providerAccountId)
    && context.providerKey === "heygen"
    && Number.isSafeInteger(context.providerCredentialVersion)
    && context.providerCredentialVersion >= 1
    && context.accountStatus === "disconnected"
    && context.credentialStatus === "unverified"
    && context.credentialSource === "static_api_key"
    && UUID.test(context.staticCredentialBindingId)
    && SHA256.test(context.credentialBindingRequestDigest)
    && context.bindingLifecycleState === "pending"
    && context.bindingVerificationState === "unverified"
    && STATIC_HEYGEN_SECRET_REF.test(context.secretRef)
    && UUID.test(context.dailyPlanId)
    && SAFE_ROSTER.test(context.sourceRosterKey)
    && SHA256.test(context.sourceRosterDigest)
    && SHA256.test(context.planDigest)
    && context.planStatus === "blocked"
    && Number.isSafeInteger(context.plannedSlotCount)
    && context.plannedSlotCount === context.selections.length * 10
    && context.selections.length >= 5
    && context.selections.length <= 10
    && new Set(context.selections.map((selection) => selection.avatarLookId)).size === context.selections.length
    && context.selections.every((selection) => SAFE_PROVIDER_ID.test(selection.avatarLookId)
      && SAFE_PROVIDER_ID.test(selection.voiceId));
}

function validScope(scope: TenantScope): boolean {
  return Boolean(scope
    && typeof scope.ownerUserId === "string"
    && scope.ownerUserId === scope.ownerUserId.trim()
    && scope.ownerUserId.length >= 1
    && scope.ownerUserId.length <= 255
    && typeof scope.workspaceId === "string"
    && scope.workspaceId === scope.workspaceId.trim()
    && scope.workspaceId.length >= 1
    && scope.workspaceId.length <= 255);
}
