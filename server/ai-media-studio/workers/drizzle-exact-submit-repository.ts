import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedSendAuthorization,
  AdmittedSubmissionClaim,
} from "./admitted-render-contracts";
import type { ExactOneVideoStageContext } from "./one-video-run-once-executor";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export interface ExactSubmitDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}
export interface ExactSubmitTransactionalDatabase extends ExactSubmitDatabase {
  /** Resolves only after COMMIT; rejection includes deferred/commit-time failures. */
  transaction<T>(callback: (tx: ExactSubmitDatabase) => Promise<T>): Promise<T>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const CLAIM_GUARD: unique symbol = Symbol("ai-media-exact-submit-claim");
const AUTHORIZATION_GUARD: unique symbol = Symbol("ai-media-exact-submit-authorization");

interface ExactContextIdentity {
  executionId: string;
  runLeaseToken: string;
  runFencingToken: bigint;
  commandDigest: Sha256Digest;
  actorUserId: string;
  scope: Readonly<TenantScope>;
  budgetReservationId: string;
  renderJobId: string;
  dailyPlanSlotId: string;
  slotAttempt: number;
  workHandoffDigest: Sha256Digest;
}

type GuardedClaim = AdmittedSubmissionClaim & {
  readonly [CLAIM_GUARD]: object;
};
type GuardedAuthorization = AdmittedSendAuthorization & {
  readonly [AUTHORIZATION_GUARD]: object;
};

/**
 * Function-only adapter for the one authorized `activate_and_submit` lane.
 * It has no queue-wide claim, run-next, provider, direct-DML, or publishing API.
 */
export class DrizzleExactSubmitRepository {
  private readonly guard = Object.freeze({});
  private readonly claimContexts = new WeakMap<object, ExactContextIdentity>();
  private readonly authorizationContexts = new WeakMap<object, ExactContextIdentity>();

  constructor(
    private readonly db: ExactSubmitTransactionalDatabase,
    private readonly scope: TenantScope,
  ) {
    assertScope(scope);
  }

  async claim(
    context: ExactOneVideoStageContext,
    input: { workerId: string; leaseDurationMs: number },
  ): Promise<AdmittedSubmissionClaim | undefined> {
    const identity = exactContextIdentity(context, this.scope);
    assertWorkerLease(input);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.claim_exact_one_video_submit_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${input.workerId}::text,${input.leaseDurationMs}::integer
    )`, row => {
      if (!row) return undefined;
      assertReturnedContext(row, identity);
      const claim: GuardedClaim = brand({
        ...claimFrom(row),
      }, CLAIM_GUARD, this.guard);
      this.claimContexts.set(claim, identity);
      return claim;
    });
  }

  async authorize(
    context: ExactOneVideoStageContext,
    claim: AdmittedSubmissionClaim,
  ): Promise<AdmittedSendAuthorization | undefined> {
    const identity = exactContextIdentity(context, this.scope);
    if (!this.isIssuedClaim(claim, identity)) {
      throw new Error("Exact submit claim was not issued for this run");
    }
    assertClaimInput(claim);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.authorize_exact_one_video_submit_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.id}::uuid,${claim.fencingToken}::bigint,${claim.leaseToken}::uuid,
      ${claim.sealedRequestDigest}::text
    )`, row => {
      if (!row) return undefined;
      assertReturnedContext(row, identity);
      const authorization: GuardedAuthorization = brand({
        ...authorizationFrom(row),
      }, AUTHORIZATION_GUARD, this.guard);
      assertExactAuthorization(authorization, claim);
      this.authorizationContexts.set(authorization, identity);
      return authorization;
    });
  }

  async confirm(
    context: ExactOneVideoStageContext,
    authorization: AdmittedSendAuthorization,
    outcome: {
      providerJobId: string;
      providerRequestId?: string;
      evidenceDigest: Sha256Digest;
    },
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope);
    if (!this.isIssuedAuthorization(authorization, identity)) {
      throw new Error("Exact submit authorization was not issued for this run");
    }
    assertFinalization(authorization, outcome);
    if (!boundedProviderId(outcome.providerJobId)) throw new Error("Invalid provider job id");
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${authorization.id}::uuid,${authorization.fencingToken}::bigint,
      ${authorization.authorizationDigest}::text,${authorization.leaseToken}::uuid,
      ${outcome.providerJobId}::text,${outcome.providerRequestId ?? null}::text,
      ${outcome.evidenceDigest}::text
    )`, row => exactMutation(row, identity));
  }

  async markAmbiguous(
    context: ExactOneVideoStageContext,
    authorization: AdmittedSendAuthorization,
    outcome: {
      providerRequestId?: string;
      evidenceDigest: Sha256Digest;
    },
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope);
    if (!this.isIssuedAuthorization(authorization, identity)) {
      throw new Error("Exact submit authorization was not issued for this run");
    }
    assertFinalization(authorization, outcome);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${authorization.id}::uuid,${authorization.fencingToken}::bigint,
      ${authorization.authorizationDigest}::text,${authorization.leaseToken}::uuid,
      ${outcome.providerRequestId ?? null}::text,${outcome.evidenceDigest}::text
    )`, row => exactMutation(row, identity));
  }

  private isIssuedClaim(
    claim: AdmittedSubmissionClaim,
    identity: ExactContextIdentity,
  ): claim is GuardedClaim {
    return Boolean(claim && (claim as Partial<GuardedClaim>)[CLAIM_GUARD] === this.guard
      && sameContext(this.claimContexts.get(claim as object), identity));
  }

  private isIssuedAuthorization(
    authorization: AdmittedSendAuthorization,
    identity: ExactContextIdentity,
  ): authorization is GuardedAuthorization {
    return Boolean(authorization
      && (authorization as Partial<GuardedAuthorization>)[AUTHORIZATION_GUARD] === this.guard
      && sameContext(this.authorizationContexts.get(authorization as object), identity));
  }
}

async function committedCall<T>(
  db: ExactSubmitTransactionalDatabase,
  query: SQL,
  decode: (row: Record<string, unknown> | undefined) => T,
): Promise<T> {
  return db.transaction(async tx => decode(exactOptionalRow(await tx.execute(query))));
}

function exactContextIdentity(
  context: ExactOneVideoStageContext,
  scope: TenantScope,
): ExactContextIdentity {
  if (!context || context.action !== "activate_and_submit" || !context.target
    || context.target.scope.ownerUserId !== scope.ownerUserId
    || context.target.scope.workspaceId !== scope.workspaceId
    || !UUID.test(context.lease?.executionId) || !UUID.test(context.lease?.leaseToken)
    || typeof context.lease?.fencingToken !== "bigint" || context.lease.fencingToken < 1n
    || context.lease.commandId !== context.commandId
    || context.lease.commandDigest !== context.commandDigest
    || !DIGEST.test(context.commandDigest) || !safePart(context.commandId, 160)
    || !safePart(context.actorUserId, 160)
    || !UUID.test(context.target.budgetReservationId)
    || !UUID.test(context.target.renderJobId)
    || !UUID.test(context.target.dailyPlanSlotId)
    || !Number.isSafeInteger(context.target.slotAttempt) || context.target.slotAttempt < 1
    || !DIGEST.test(context.target.workHandoffDigest)) {
    throw new Error("Invalid activate-and-submit exact run context");
  }
  return Object.freeze({
    executionId: context.lease.executionId,
    runLeaseToken: context.lease.leaseToken,
    runFencingToken: context.lease.fencingToken,
    commandDigest: context.commandDigest,
    actorUserId: context.actorUserId,
    scope: Object.freeze({ ...scope }),
    budgetReservationId: context.target.budgetReservationId,
    renderJobId: context.target.renderJobId,
    dailyPlanSlotId: context.target.dailyPlanSlotId,
    slotAttempt: context.target.slotAttempt,
    workHandoffDigest: context.target.workHandoffDigest,
  });
}

function assertReturnedContext(row: Record<string, unknown>, expected: ExactContextIdentity): void {
  const actual: ExactContextIdentity = {
    executionId: dbUuid(row, "execution_id"),
    runLeaseToken: dbUuid(row, "run_lease_token"),
    runFencingToken: big(row.run_fencing_token),
    commandDigest: dbDigest(row, "command_digest"),
    actorUserId: text(row.actor_user_id),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    dailyPlanSlotId: dbUuid(row, "daily_plan_slot_id"),
    slotAttempt: positive(row.slot_attempt),
    workHandoffDigest: dbDigest(row, "work_handoff_digest"),
  };
  if (!sameContext(actual, expected)) {
    throw new Error("Exact submit function returned another run target");
  }
}

function sameContext(
  left: ExactContextIdentity | undefined,
  right: ExactContextIdentity,
): boolean {
  return Boolean(left
    && left.executionId === right.executionId
    && left.runLeaseToken === right.runLeaseToken
    && left.runFencingToken === right.runFencingToken
    && left.commandDigest === right.commandDigest
    && left.actorUserId === right.actorUserId
    && left.scope.ownerUserId === right.scope.ownerUserId
    && left.scope.workspaceId === right.scope.workspaceId
    && left.budgetReservationId === right.budgetReservationId
    && left.renderJobId === right.renderJobId
    && left.dailyPlanSlotId === right.dailyPlanSlotId
    && left.slotAttempt === right.slotAttempt
    && left.workHandoffDigest === right.workHandoffDigest);
}

function identityFrom(row: Record<string, unknown>) {
  return {
    id: dbUuid(row, "id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    providerAccountId: dbUuid(row, "provider_account_id"),
    providerKey: text(row.provider_key),
    providerCredentialVersion: positive(row.provider_credential_version),
    providerIdempotencyKey: text(row.provider_idempotency_key),
    avatarExternalResourceId: text(row.avatar_external_resource_id),
    voiceExternalResourceId: text(row.voice_external_resource_id),
    sealedRequest: deepFreezeJsonObject(plainJsonObject(row.request_json)),
    sealedRequestDigest: dbDigest(row, "sealed_request_digest"),
    fencingToken: big(row.fencing_token),
  };
}

function claimFrom(row: Record<string, unknown>): AdmittedSubmissionClaim {
  return {
    ...identityFrom(row),
    leaseToken: dbUuid(row, "lease_token"),
    leaseExpiresAt: iso(row.lease_expires_at),
  };
}

function authorizationFrom(row: Record<string, unknown>): AdmittedSendAuthorization {
  return {
    ...identityFrom(row),
    authorizationDigest: dbDigest(row, "send_authorization_digest"),
    commitEvidenceDigest: dbDigest(row, "commit_evidence_digest"),
    authorizedAt: iso(row.authorized_at),
    leaseToken: dbUuid(row, "lease_token"),
    leaseExpiresAt: iso(row.lease_expires_at),
  };
}

function assertExactAuthorization(
  actual: AdmittedSendAuthorization,
  claim: AdmittedSubmissionClaim,
): void {
  if (actual.id !== claim.id || !sameScope(actual.scope, claim.scope)
    || actual.budgetReservationId !== claim.budgetReservationId
    || actual.renderJobId !== claim.renderJobId
    || actual.providerAccountId !== claim.providerAccountId
    || actual.providerKey !== claim.providerKey
    || actual.providerCredentialVersion !== claim.providerCredentialVersion
    || actual.providerIdempotencyKey !== claim.providerIdempotencyKey
    || actual.avatarExternalResourceId !== claim.avatarExternalResourceId
    || actual.voiceExternalResourceId !== claim.voiceExternalResourceId
    || actual.sealedRequestDigest !== claim.sealedRequestDigest
    || actual.fencingToken !== claim.fencingToken
    || actual.leaseToken !== claim.leaseToken
    || actual.leaseExpiresAt !== claim.leaseExpiresAt
    || canonicalJson(actual.sealedRequest) !== canonicalJson(claim.sealedRequest)) {
    throw new Error("Exact authorization does not match the issued submission claim");
  }
}

function exactMutation(
  row: Record<string, unknown> | undefined,
  identity: ExactContextIdentity,
): boolean {
  if (!row) return false;
  assertReturnedContext(row, identity);
  if (typeof row.applied !== "boolean") throw new Error("Invalid exact submit mutation result");
  return row.applied;
}

function assertClaimInput(claim: AdmittedSubmissionClaim): void {
  assertScope(claim.scope);
  for (const [label, value] of [
    ["claim.id", claim.id],
    ["claim.budgetReservationId", claim.budgetReservationId],
    ["claim.renderJobId", claim.renderJobId],
    ["claim.providerAccountId", claim.providerAccountId],
    ["claim.leaseToken", claim.leaseToken],
  ] as const) assertUuid(value, label);
  if (!DIGEST.test(claim.sealedRequestDigest) || claim.fencingToken < 1n
    || Number.isNaN(Date.parse(claim.leaseExpiresAt))) {
    throw new Error("Invalid exact submission claim");
  }
  plainJsonObject(claim.sealedRequest);
}

function assertFinalization(
  input: AdmittedSendAuthorization,
  outcome: { providerRequestId?: string; evidenceDigest: Sha256Digest },
): void {
  assertClaimInput(input);
  if (!DIGEST.test(input.authorizationDigest) || !DIGEST.test(input.commitEvidenceDigest)
    || Number.isNaN(Date.parse(input.authorizedAt))
    || !optionalProviderId(outcome.providerRequestId) || !DIGEST.test(outcome.evidenceDigest)) {
    throw new Error("Invalid exact submission finalization");
  }
}

function exactOptionalRow(result: ExecuteResult): Record<string, unknown> | undefined {
  const value = Array.isArray(result)
    ? result
    : result && typeof result === "object" ? result.rows : undefined;
  if (!Array.isArray(value) || value.length > 1
    || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Invalid exact submit capability function result");
  }
  return value[0] as Record<string, unknown> | undefined;
}

function brand<T extends object, K extends symbol>(
  value: T,
  key: K,
  guard: object,
): T & { readonly [P in K]: object } {
  Object.defineProperty(value, key, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: guard,
  });
  return Object.freeze(value) as T & { readonly [P in K]: object };
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Invalid exact submit text");
  return value;
}
function dbUuid(row: Record<string, unknown>, key: string): string {
  const value = text(row[key]);
  assertUuid(value, key);
  return value;
}
function dbDigest(row: Record<string, unknown>, key: string): Sha256Digest {
  const value = text(row[key]);
  if (!DIGEST.test(value)) throw new Error(`Invalid ${key}`);
  return value as Sha256Digest;
}
function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`Invalid ${label}`);
}
function positive(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid positive integer");
  return result;
}
function big(value: unknown): bigint {
  try {
    const result = BigInt(String(value));
    if (result < 1n) throw new Error();
    return result;
  } catch {
    throw new Error("Invalid fencing token");
  }
}
function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid database time");
  return date.toISOString();
}
function returnedScope(row: Record<string, unknown>): TenantScope {
  const result = {
    ownerUserId: text(row.owner_user_id),
    workspaceId: text(row.workspace_id),
  };
  assertScope(result);
  return Object.freeze(result);
}
function assertScope(scope: TenantScope): void {
  if (!scope || !safePart(scope.ownerUserId, 160) || !safePart(scope.workspaceId, 160)) {
    throw new Error("Exact tenant scope is required");
  }
}
function sameScope(left: TenantScope, right: TenantScope): boolean {
  return left.ownerUserId === right.ownerUserId && left.workspaceId === right.workspaceId;
}
function assertWorkerLease(input: { workerId: string; leaseDurationMs: number }): void {
  if (!safePart(input.workerId, 120) || !Number.isInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1 || input.leaseDurationMs > 300_000) {
    throw new Error("Invalid exact submission claim lease");
  }
}
function boundedProviderId(value: unknown): value is string {
  return typeof value === "string" && value === value.trim()
    && value.length >= 1 && value.length <= 500;
}
function optionalProviderId(value: unknown): boolean {
  return value === undefined || boundedProviderId(value);
}
function safePart(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max
    && value === value.trim() && SAFE.test(value);
}
function plainJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || !isJsonValue(value)) {
    throw new Error("Invalid sealed request JSON");
  }
  return value as Readonly<Record<string, unknown>>;
}
function deepFreezeJsonObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      if (Array.isArray(item)) {
        for (const nested of item) {
          if (nested && typeof nested === "object") {
            deepFreezeJsonValue(nested);
          }
        }
        Object.freeze(item);
      } else {
        deepFreezeJsonValue(item);
      }
    }
  }
  return Object.freeze(value);
}
function deepFreezeJsonValue(value: object): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") deepFreezeJsonValue(item);
    }
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      if (item && typeof item === "object") deepFreezeJsonValue(item);
    }
  }
  Object.freeze(value);
}
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value as Record<string, unknown>).every(isJsonValue);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
