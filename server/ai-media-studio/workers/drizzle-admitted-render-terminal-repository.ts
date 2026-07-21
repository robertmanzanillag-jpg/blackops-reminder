import { sql, type SQL } from "drizzle-orm";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedCompletedTerminalFinality,
  AdmittedFailedTerminalFinality,
  AdmittedTerminalClaim,
  AdmittedTerminalFinalizeResult,
  AdmittedTerminalRepository,
  AdmittedTerminalRetryReason,
} from "./admitted-render-terminal-worker";
import type {
  AdmittedRenderTransactionalDatabase,
  AdmittedWorkerDatabaseCapabilities,
  AdmittedWorkerDatabaseLanes,
} from "./drizzle-admitted-render-repository";

type ExecuteResult = { rows?: unknown[] } | unknown[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TERMINAL_CLAIM_GUARD: unique symbol = Symbol("ai-media-terminal-claim-guard");
type GuardedTerminalClaim = AdmittedTerminalClaim & { readonly [TERMINAL_CLAIM_GUARD]: object };

/** Function-only adapter for PR27's reconcile-lane terminal capability API. */
export class DrizzleAdmittedRenderTerminalRepository implements AdmittedTerminalRepository {
  private readonly claimGuard = Object.freeze({});

  constructor(
    private readonly db: Pick<AdmittedWorkerDatabaseLanes, "reconcile">,
    private readonly options: Pick<AdmittedWorkerDatabaseCapabilities, "scope" | "reconcileCapabilityId">,
  ) {
    if (!options.scope.ownerUserId.trim() || !options.scope.workspaceId.trim()) {
      throw new Error("Exact terminal tenant scope is required");
    }
    assertUuid(options.reconcileCapabilityId, "reconcileCapabilityId");
  }

  async claimTerminal(input: { workerId: string; leaseDurationMs: number }): Promise<AdmittedTerminalClaim | undefined> {
    if (!input.workerId.trim() || input.workerId !== input.workerId.trim() || input.workerId.length > 120
      || !Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1 || input.leaseDurationMs > 300_000) {
      throw new Error("Invalid terminal claim lease");
    }
    return committedCall(this.db.reconcile, sql`SELECT * FROM ai_media_worker_api.claim_terminal_check_v1(
      ${this.options.reconcileCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.workerId}::text,${input.leaseDurationMs}::integer)`, (row) => {
      if (!row) return undefined;
      const claim: GuardedTerminalClaim = {
        terminalCheckId: dbUuid(row, "id"),
        id: dbUuid(row, "submission_attempt_id"),
        scope: { ...this.options.scope },
        budgetReservationId: dbUuid(row, "budget_reservation_id"),
        renderJobId: dbUuid(row, "render_job_id"),
        providerAccountId: dbUuid(row, "provider_account_id"),
        providerKey: boundedText(row.provider_key, 80, "provider_key"),
        providerCredentialVersion: positive(row.provider_credential_version),
        authorizationDigest: dbDigest(row, "send_authorization_digest"),
        fencingToken: positiveBigInt(row.submission_fencing_token),
        providerJobId: boundedText(row.provider_job_id, 500, "provider_job_id"),
        terminalLeaseToken: dbUuid(row, "lease_token"),
        terminalLeaseExpiresAt: iso(row.lease_expires_at),
        terminalFencingToken: positiveBigInt(row.fencing_token),
        [TERMINAL_CLAIM_GUARD]: this.claimGuard,
      };
      return claim;
    });
  }

  async finalizeCompleted(input: AdmittedTerminalClaim & { finality: AdmittedCompletedTerminalFinality }): Promise<AdmittedTerminalFinalizeResult> {
    return this.finalize(input, input.finality);
  }

  async finalizeFailed(input: AdmittedTerminalClaim & { finality: AdmittedFailedTerminalFinality }): Promise<AdmittedTerminalFinalizeResult> {
    return this.finalize(input, input.finality);
  }

  async rescheduleTerminal(input: AdmittedTerminalClaim & {
    reason: AdmittedTerminalRetryReason;
    observedAt: string;
    evidenceDigest: Sha256Digest;
    capacityHeld: true;
  }): Promise<boolean> {
    if (!this.isIssuedClaim(input) || !DIGEST.test(input.evidenceDigest) || Number.isNaN(Date.parse(input.observedAt))) return false;
    return committedCall(this.db.reconcile, sql`SELECT * FROM ai_media_worker_api.release_terminal_check_unknown_v1(
      ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${terminalCheckId(input)}::uuid,${input.terminalLeaseToken}::uuid,
      ${input.terminalFencingToken}::bigint)`, mutationResult);
  }

  private async finalize(
    input: AdmittedTerminalClaim,
    finality: AdmittedCompletedTerminalFinality | AdmittedFailedTerminalFinality,
  ): Promise<AdmittedTerminalFinalizeResult> {
    if (!this.isIssuedClaim(input) || !DIGEST.test(finality.evidenceDigest)
      || Number.isNaN(Date.parse(finality.observedAt))) return "conflict";
    const completed = finality.kind === "completed";
    const remoteRef = completed ? finality.remoteArtifactRef : null;
    const remoteUrl = completed ? finality.ephemeralSourceUrl : null;
    if (completed && (!boundedString(remoteRef, 1_000) || !safeHttpsUrl(remoteUrl))) return "conflict";
    return committedCall(this.db.reconcile, sql`SELECT * FROM ai_media_worker_api.record_provider_terminal_v1(
      ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${terminalCheckId(input)}::uuid,${input.id}::uuid,${input.fencingToken}::bigint,
      ${input.terminalLeaseToken}::uuid,${input.terminalFencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.providerAccountId}::uuid,${input.providerKey}::text,
      ${input.providerCredentialVersion}::integer,${input.providerJobId}::text,${finality.kind}::text,
      ${remoteRef}::text,${remoteUrl}::text,${new Date(finality.observedAt)}::timestamptz,
      ${finality.evidenceDigest}::text)`, terminalMutationResult);
  }

  private isIssuedClaim(input: AdmittedTerminalClaim): input is GuardedTerminalClaim {
    return (input as Partial<GuardedTerminalClaim>)[TERMINAL_CLAIM_GUARD] === this.claimGuard
      && input.scope.ownerUserId === this.options.scope.ownerUserId
      && input.scope.workspaceId === this.options.scope.workspaceId;
  }
}

async function committedCall<T>(db: AdmittedRenderTransactionalDatabase, query: SQL,
  decode: (row: Record<string, unknown> | undefined) => T): Promise<T> {
  return db.transaction(async (tx) => decode(exactOptionalRow(await tx.execute(query))));
}

function exactOptionalRow(result: ExecuteResult): Record<string, unknown> | undefined {
  const value = Array.isArray(result) ? result : result && typeof result === "object" ? result.rows : undefined;
  if (!Array.isArray(value) || value.length > 1
    || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Invalid terminal capability function result");
  }
  return value[0] as Record<string, unknown> | undefined;
}

function terminalCheckId(input: AdmittedTerminalClaim): string {
  const value = input.terminalCheckId;
  if (typeof value !== "string") throw new Error("Terminal claim has no guarded check identity");
  assertUuid(value, "terminalCheckId");
  return value;
}

function mutationResult(row: Record<string, unknown> | undefined): boolean {
  if (!row) return false;
  if (typeof row.applied !== "boolean") throw new Error("Invalid terminal release result");
  return row.applied;
}

function terminalMutationResult(row: Record<string, unknown> | undefined): AdmittedTerminalFinalizeResult {
  if (!row || typeof row.outcome !== "string") throw new Error("Invalid terminal mutation result");
  if (row.outcome === "applied") return "applied";
  if (row.outcome === "replayed") return "duplicate";
  if (row.outcome === "conflict" || row.outcome === "rejected") return "conflict";
  throw new Error("Unknown terminal mutation outcome");
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`Invalid ${label}`);
}
function dbUuid(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== "string") throw new Error(`Invalid ${key}`);
  assertUuid(row[key], key);
  return row[key];
}
function dbDigest(row: Record<string, unknown>, key: string): Sha256Digest {
  if (typeof row[key] !== "string" || !DIGEST.test(row[key])) throw new Error(`Invalid ${key}`);
  return row[key] as Sha256Digest;
}
function positive(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Invalid positive integer");
  return parsed;
}
function positiveBigInt(value: unknown): bigint {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 1n) throw new Error();
    return parsed;
  } catch {
    throw new Error("Invalid terminal fencing token");
  }
}
function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid terminal lease time");
  return date.toISOString();
}
function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value !== value.trim() || !boundedString(value, max)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}
function safeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8_000 || /\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
