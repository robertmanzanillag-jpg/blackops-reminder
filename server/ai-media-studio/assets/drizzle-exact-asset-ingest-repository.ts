import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type {
  ExactOneVideoStageContext,
  OneVideoRunOnceAction,
} from "../workers/one-video-run-once-executor";
import type { AssetIngestErrorCode } from "./contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];

export interface ExactAssetIngestDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}

export interface ExactAssetIngestTransactionalDatabase
  extends ExactAssetIngestDatabase {
  /** Resolves only after COMMIT; rejection includes deferred/commit-time failures. */
  transaction<T>(
    callback: (tx: ExactAssetIngestDatabase) => Promise<T>,
  ): Promise<T>;
}

export interface ExactAssetIngestClaim {
  readonly ingestJobId: string;
  readonly scope: Readonly<TenantScope>;
  readonly budgetReservationId: string;
  readonly renderJobId: string;
  readonly providerKey: string;
  readonly remoteArtifactRef: string;
  readonly sourceUrl: string;
  readonly expectedMimeType: "video/mp4";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly fencingToken: bigint;
}

export type ExactAssetIngestClaimResult =
  | { readonly kind: "claimed"; readonly claim: ExactAssetIngestClaim }
  | {
    readonly kind: "idle" | "dead_letter";
    readonly ingestJobId: string;
  };

export interface ExactAssetLinkClaim {
  readonly ingestJobId: string;
  readonly scope: Readonly<TenantScope>;
  readonly budgetReservationId: string;
  readonly renderJobId: string;
  readonly linkState: "completed_unlinked" | "linked";
  readonly mediaAssetId?: string;
  readonly ownedObjectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly ingestFencingToken: bigint;
}

export interface ExactAssetIngestFailureResult {
  readonly applied: boolean;
  readonly state: "retry_wait" | "dead_letter";
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTENT_SHA256 = /^[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const ERROR_CODES = new Set<AssetIngestErrorCode>([
  "source_rejected",
  "source_unavailable",
  "mime_rejected",
  "size_exceeded",
  "chunk_exceeded",
  "invalid_mp4",
  "storage_failed",
  "ingest_failed",
]);
const INGEST_GUARD: unique symbol = Symbol("ai-media-exact-asset-ingest-claim");
const LINK_GUARD: unique symbol = Symbol("ai-media-exact-asset-link-claim");

interface ExactAssetContextIdentity {
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

type GuardedIngestClaim = ExactAssetIngestClaim & {
  readonly [INGEST_GUARD]: object;
};
type GuardedLinkClaim = ExactAssetLinkClaim & {
  readonly [LINK_GUARD]: object;
};

/**
 * Exact, function-only capability boundary for one explicitly identified
 * ingest job. It has no global queue drain, raw table DML, provider call,
 * publishing method, timer, or autostart surface.
 */
export class DrizzleExactAssetIngestRepository {
  private readonly guard = Object.freeze({});
  private readonly ingestContexts =
    new WeakMap<object, ExactAssetContextIdentity>();
  private readonly linkContexts =
    new WeakMap<object, ExactAssetContextIdentity>();

  constructor(
    private readonly db: ExactAssetIngestTransactionalDatabase,
    private readonly scope: TenantScope,
  ) {
    assertScope(scope);
  }

  async claimExactIngest(
    context: ExactOneVideoStageContext,
    input: {
      ingestJobId: string;
      workerId: string;
      leaseDurationMs: number;
    },
  ): Promise<ExactAssetIngestClaimResult> {
    const identity = exactContextIdentity(context, this.scope, "ingest_asset");
    assertUuid(input.ingestJobId, "ingestJobId");
    assertWorkerLease(input);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${input.ingestJobId}::uuid,${input.workerId}::text,
      ${input.leaseDurationMs}::integer
    )`, row => {
      assertReturnedContext(row, identity, "ingest");
      const returnedJobId = dbUuid(row, "ingest_job_id");
      if (returnedJobId !== input.ingestJobId) {
        throw new Error("Exact asset ingest function returned another ingest job");
      }
      if (row.claim_outcome === "idle" || row.claim_outcome === "dead_letter") {
        return Object.freeze({
          kind: row.claim_outcome,
          ingestJobId: returnedJobId,
        });
      }
      if (row.claim_outcome !== "claimed") {
        throw new Error("Invalid exact asset ingest claim outcome");
      }
      const claim = brand(ingestClaimFrom(row), INGEST_GUARD, this.guard);
      this.ingestContexts.set(claim, identity);
      return Object.freeze({ kind: "claimed" as const, claim });
    });
  }

  async completeExactIngest(
    context: ExactOneVideoStageContext,
    claim: ExactAssetIngestClaim,
    outcome: {
      ownedObjectKey: string;
      sha256: string;
      sizeBytes: number;
    },
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope, "ingest_asset");
    this.assertIssuedIngest(claim, identity);
    assertIngestClaim(claim);
    assertCompletedOutcome(outcome);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.ingestJobId}::uuid,${claim.leaseToken}::text,
      ${claim.fencingToken}::bigint,${outcome.ownedObjectKey}::text,
      ${outcome.sha256}::text,${outcome.sizeBytes}::bigint
    )`, row => exactApplied(row, identity, "ingest", claim.ingestJobId));
  }

  async failExactIngest(
    context: ExactOneVideoStageContext,
    claim: ExactAssetIngestClaim,
    outcome: {
      errorCode: AssetIngestErrorCode;
      retryable: boolean;
      retryAt: string;
    },
  ): Promise<ExactAssetIngestFailureResult> {
    const identity = exactContextIdentity(context, this.scope, "ingest_asset");
    this.assertIssuedIngest(claim, identity);
    assertIngestClaim(claim);
    assertFailedOutcome(outcome);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.ingestJobId}::uuid,${claim.leaseToken}::text,
      ${claim.fencingToken}::bigint,${outcome.errorCode}::text,
      ${outcome.retryable}::boolean,${new Date(outcome.retryAt)}::timestamptz
    )`, row => exactFailure(row, identity, claim.ingestJobId));
  }

  async loadExactLink(
    context: ExactOneVideoStageContext,
    input: { ingestJobId: string },
  ): Promise<ExactAssetLinkClaim | undefined> {
    const identity = exactContextIdentity(context, this.scope, "link_asset");
    assertUuid(input.ingestJobId, "ingestJobId");
    return committedOptionalCall(this.db, sql`SELECT * FROM ai_media_worker_api.load_exact_one_video_asset_link_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${input.ingestJobId}::uuid
    )`, row => {
      assertReturnedContext(row, identity, "link");
      const returnedJobId = dbUuid(row, "ingest_job_id");
      if (returnedJobId !== input.ingestJobId) {
        throw new Error("Exact asset link function returned another ingest job");
      }
      const claim = brand(linkClaimFrom(row), LINK_GUARD, this.guard);
      this.linkContexts.set(claim, identity);
      return claim;
    });
  }

  async recordExactLink(
    context: ExactOneVideoStageContext,
    claim: ExactAssetLinkClaim,
    input: { mediaAssetId: string },
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope, "link_asset");
    this.assertIssuedLink(claim, identity);
    assertLinkClaim(claim);
    assertUuid(input.mediaAssetId, "mediaAssetId");
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_asset_linked_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.ingestJobId}::uuid,${claim.ingestFencingToken}::bigint,
      ${claim.ownedObjectKey}::text,${claim.sha256}::text,
      ${input.mediaAssetId}::uuid
    )`, row => {
      const applied = exactApplied(row, identity, "link", claim.ingestJobId);
      if (!applied) return false;
      if (dbUuid(row, "media_asset_id") !== input.mediaAssetId) {
        throw new Error("Exact asset link function returned another media asset");
      }
      return applied;
    });
  }

  private assertIssuedIngest(
    claim: ExactAssetIngestClaim,
    identity: ExactAssetContextIdentity,
  ): asserts claim is GuardedIngestClaim {
    if (!claim
      || (claim as Partial<GuardedIngestClaim>)[INGEST_GUARD] !== this.guard
      || !sameContext(this.ingestContexts.get(claim as object), identity)) {
      throw new Error("Exact asset ingest claim was not issued for this run");
    }
  }

  private assertIssuedLink(
    claim: ExactAssetLinkClaim,
    identity: ExactAssetContextIdentity,
  ): asserts claim is GuardedLinkClaim {
    if (!claim
      || (claim as Partial<GuardedLinkClaim>)[LINK_GUARD] !== this.guard
      || !sameContext(this.linkContexts.get(claim as object), identity)) {
      throw new Error("Exact asset link claim was not issued for this run");
    }
  }
}

async function committedCall<T>(
  db: ExactAssetIngestTransactionalDatabase,
  query: SQL,
  decode: (row: Record<string, unknown>) => T,
): Promise<T> {
  return db.transaction(async tx => decode(exactOneRow(await tx.execute(query))));
}

async function committedOptionalCall<T>(
  db: ExactAssetIngestTransactionalDatabase,
  query: SQL,
  decode: (row: Record<string, unknown>) => T,
): Promise<T | undefined> {
  return db.transaction(async tx => {
    const row = optionalOneRow(await tx.execute(query));
    return row ? decode(row) : undefined;
  });
}

function exactContextIdentity(
  context: ExactOneVideoStageContext,
  scope: TenantScope,
  action: Extract<OneVideoRunOnceAction, "ingest_asset" | "link_asset">,
): ExactAssetContextIdentity {
  if (!context || context.action !== action || !context.target
    || context.target.scope.ownerUserId !== scope.ownerUserId
    || context.target.scope.workspaceId !== scope.workspaceId
    || !UUID.test(context.lease?.executionId) || !UUID.test(context.lease?.leaseToken)
    || typeof context.lease?.fencingToken !== "bigint"
    || context.lease.fencingToken < 1n
    || context.lease.commandId !== context.commandId
    || context.lease.commandDigest !== context.commandDigest
    || !DIGEST.test(context.commandDigest) || !safePart(context.commandId, 160)
    || !safePart(context.actorUserId, 160)
    || !UUID.test(context.target.budgetReservationId)
    || !UUID.test(context.target.renderJobId)
    || !UUID.test(context.target.dailyPlanSlotId)
    || !Number.isSafeInteger(context.target.slotAttempt)
    || context.target.slotAttempt < 1
    || !DIGEST.test(context.target.workHandoffDigest)) {
    throw new Error(`Invalid ${action} exact run context`);
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

function assertReturnedContext(
  row: Record<string, unknown>,
  expected: ExactAssetContextIdentity,
  lane: "ingest" | "link",
): void {
  const actual: ExactAssetContextIdentity = {
    executionId: dbUuid(row, "execution_id"),
    runLeaseToken: dbUuid(row, "run_lease_token"),
    runFencingToken: positiveBigInt(row.run_fencing_token, "run_fencing_token"),
    commandDigest: dbDigest(row, "command_digest"),
    actorUserId: boundedText(row.actor_user_id, 160, "actor_user_id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    dailyPlanSlotId: dbUuid(row, "daily_plan_slot_id"),
    slotAttempt: positiveInteger(row.slot_attempt, "slot_attempt"),
    workHandoffDigest: dbDigest(row, "work_handoff_digest"),
  };
  if (!sameContext(actual, expected)) {
    throw new Error(`Exact asset ${lane} function returned another run target`);
  }
}

function sameContext(
  left: ExactAssetContextIdentity | undefined,
  right: ExactAssetContextIdentity,
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

function ingestClaimFrom(row: Record<string, unknown>): ExactAssetIngestClaim {
  const expectedMimeType = boundedText(
    row.expected_mime_type,
    40,
    "expected_mime_type",
  );
  if (expectedMimeType !== "video/mp4") {
    throw new Error("Exact asset ingest claim has unsupported MIME type");
  }
  const claim: ExactAssetIngestClaim = {
    ingestJobId: dbUuid(row, "ingest_job_id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    providerKey: safeText(row.provider_key, 80, "provider_key"),
    remoteArtifactRef: boundedText(
      row.remote_artifact_ref,
      1_000,
      "remote_artifact_ref",
    ),
    sourceUrl: exactHttpsUrl(row.source_url),
    expectedMimeType,
    attempt: positiveInteger(row.attempt, "attempt"),
    maxAttempts: positiveInteger(row.max_attempts, "max_attempts"),
    leaseOwner: safeText(row.lease_owner, 120, "lease_owner"),
    leaseToken: dbUuid(row, "lease_token"),
    leaseExpiresAt: iso(row.lease_expires_at, "lease_expires_at"),
    fencingToken: positiveBigInt(row.fencing_token, "fencing_token"),
  };
  if (claim.attempt > claim.maxAttempts) {
    throw new Error("Exact asset ingest claim exceeds max attempts");
  }
  return claim;
}

function linkClaimFrom(row: Record<string, unknown>): ExactAssetLinkClaim {
  if (row.link_state !== "completed_unlinked" && row.link_state !== "linked") {
    throw new Error("Invalid exact asset link state");
  }
  const mediaAssetId = row.media_asset_id === null
    || row.media_asset_id === undefined
    ? undefined
    : dbUuid(row, "media_asset_id");
  if ((row.link_state === "linked") !== Boolean(mediaAssetId)) {
    throw new Error("Exact asset link state does not match media asset identity");
  }
  const expectedMimeType = boundedText(
    row.expected_mime_type,
    40,
    "expected_mime_type",
  );
  if (expectedMimeType !== "video/mp4") {
    throw new Error("Exact asset link has unsupported MIME type");
  }
  const claim: ExactAssetLinkClaim = {
    ingestJobId: dbUuid(row, "ingest_job_id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    linkState: row.link_state,
    ...(mediaAssetId ? { mediaAssetId } : {}),
    ownedObjectKey: objectKey(row.owned_object_key),
    sha256: contentSha256(row.sha256),
    sizeBytes: positiveInteger(row.size_bytes, "size_bytes"),
    ingestFencingToken: positiveBigInt(
      row.ingest_fencing_token,
      "ingest_fencing_token",
    ),
  };
  return claim;
}

function exactApplied(
  row: Record<string, unknown>,
  identity: ExactAssetContextIdentity,
  lane: "ingest" | "link",
  expectedIngestJobId: string,
): boolean {
  assertReturnedContext(row, identity, lane);
  if (dbUuid(row, "ingest_job_id") !== expectedIngestJobId) {
    throw new Error(`Exact asset ${lane} function returned another ingest job`);
  }
  if (typeof row.applied !== "boolean") {
    throw new Error(`Invalid exact asset ${lane} mutation result`);
  }
  return row.applied;
}

function exactFailure(
  row: Record<string, unknown>,
  identity: ExactAssetContextIdentity,
  expectedIngestJobId: string,
): ExactAssetIngestFailureResult {
  assertReturnedContext(row, identity, "ingest");
  if (dbUuid(row, "ingest_job_id") !== expectedIngestJobId) {
    throw new Error("Exact asset ingest function returned another ingest job");
  }
  if (typeof row.applied !== "boolean"
    || (row.state !== "retry_wait" && row.state !== "dead_letter")) {
    throw new Error("Invalid exact asset ingest failure result");
  }
  return Object.freeze({ applied: row.applied, state: row.state });
}

function exactOneRow(result: ExecuteResult): Record<string, unknown> {
  const row = optionalOneRow(result);
  if (!row) {
    throw new Error("Invalid exact asset capability function result");
  }
  return row;
}

function optionalOneRow(
  result: ExecuteResult,
): Record<string, unknown> | undefined {
  const value = Array.isArray(result)
    ? result
    : result && typeof result === "object" ? result.rows : undefined;
  if (!Array.isArray(value) || value.length > 1
    || (value.length === 1
      && (!value[0] || typeof value[0] !== "object" || Array.isArray(value[0])))) {
    throw new Error("Invalid exact asset capability function result");
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

function assertIngestClaim(claim: ExactAssetIngestClaim): void {
  assertUuid(claim.ingestJobId, "claim.ingestJobId");
  assertUuid(claim.budgetReservationId, "claim.budgetReservationId");
  assertUuid(claim.renderJobId, "claim.renderJobId");
  assertScope(claim.scope);
  safeText(claim.providerKey, 80, "claim.providerKey");
  boundedText(claim.remoteArtifactRef, 1_000, "claim.remoteArtifactRef");
  exactHttpsUrl(claim.sourceUrl);
  if (claim.expectedMimeType !== "video/mp4"
    || positiveInteger(claim.attempt, "claim.attempt") > positiveInteger(
      claim.maxAttempts,
      "claim.maxAttempts",
    )
    || safeText(claim.leaseOwner, 120, "claim.leaseOwner") !== claim.leaseOwner) {
    throw new Error("Invalid exact asset ingest claim");
  }
  assertUuid(claim.leaseToken, "claim.leaseToken");
  iso(claim.leaseExpiresAt, "claim.leaseExpiresAt");
  if (claim.fencingToken < 1n) throw new Error("Invalid claim.fencingToken");
}

function assertLinkClaim(claim: ExactAssetLinkClaim): void {
  assertUuid(claim.ingestJobId, "claim.ingestJobId");
  assertUuid(claim.budgetReservationId, "claim.budgetReservationId");
  assertUuid(claim.renderJobId, "claim.renderJobId");
  assertScope(claim.scope);
  if ((claim.linkState !== "completed_unlinked" && claim.linkState !== "linked")
    || (claim.linkState === "linked") !== Boolean(claim.mediaAssetId)) {
    throw new Error("Invalid exact asset link claim");
  }
  if (claim.mediaAssetId) assertUuid(claim.mediaAssetId, "claim.mediaAssetId");
  objectKey(claim.ownedObjectKey);
  contentSha256(claim.sha256);
  positiveInteger(claim.sizeBytes, "claim.sizeBytes");
  if (claim.ingestFencingToken < 1n) {
    throw new Error("Invalid claim.ingestFencingToken");
  }
}

function assertCompletedOutcome(input: {
  ownedObjectKey: string;
  sha256: string;
  sizeBytes: number;
}): void {
  objectKey(input.ownedObjectKey);
  contentSha256(input.sha256);
  positiveInteger(input.sizeBytes, "sizeBytes");
}

function assertFailedOutcome(input: {
  errorCode: AssetIngestErrorCode;
  retryable: boolean;
  retryAt: string;
}): void {
  if (!ERROR_CODES.has(input.errorCode)
    || typeof input.retryable !== "boolean") {
    throw new Error("Invalid exact asset ingest failure");
  }
  iso(input.retryAt, "retryAt");
}

function assertWorkerLease(input: {
  workerId: string;
  leaseDurationMs: number;
}): void {
  if (!safePart(input.workerId, 120)
    || !Number.isInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 300_000) {
    throw new Error("Invalid exact asset ingest lease");
  }
}

function returnedScope(row: Record<string, unknown>): TenantScope {
  const scope = {
    ownerUserId: safeText(row.owner_user_id, 160, "owner_user_id"),
    workspaceId: safeText(row.workspace_id, 160, "workspace_id"),
  };
  assertScope(scope);
  return scope;
}

function assertScope(scope: TenantScope): void {
  if (!safePart(scope.ownerUserId, 160)
    || !safePart(scope.workspaceId, 160)) {
    throw new Error("Exact tenant scope is required");
  }
}

function dbUuid(row: Record<string, unknown>, key: string): string {
  const value = boundedText(row[key], 36, key);
  assertUuid(value, key);
  return value;
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function dbDigest(row: Record<string, unknown>, key: string): Sha256Digest {
  const value = boundedText(row[key], 71, key);
  if (!DIGEST.test(value)) throw new Error(`Invalid ${key}`);
  return value as Sha256Digest;
}

function positiveBigInt(value: unknown, label: string): bigint {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 1n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1
    || (label.includes("size") && parsed > 10_737_418_240)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function safePart(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= max
    && value === value.trim()
    && SAFE.test(value);
}

function safeText(value: unknown, max: number, label: string): string {
  if (!safePart(value, max)) throw new Error(`Invalid ${label}`);
  return value;
}

function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max
    || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function exactHttpsUrl(value: unknown): string {
  const raw = boundedText(value, 4_096, "source_url");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid source_url");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname
    || parsed.username || parsed.password || parsed.href !== raw) {
    throw new Error("Invalid source_url");
  }
  return raw;
}

function objectKey(value: unknown): string {
  const key = boundedText(value, 1_024, "owned_object_key");
  if (key.startsWith("/") || key.endsWith("/") || key.includes("//")
    || key.split("/").some(part => part === "." || part === "..")
    || !SAFE.test(key)) {
    throw new Error("Invalid owned_object_key");
  }
  return key;
}

function contentSha256(value: unknown): string {
  const digest = boundedText(value, 64, "sha256");
  if (!CONTENT_SHA256.test(digest)) throw new Error("Invalid sha256");
  return digest;
}

function iso(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label}`);
  return parsed.toISOString();
}
