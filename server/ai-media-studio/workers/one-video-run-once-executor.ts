import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";

declare const trustedOneVideoRunPrincipal: unique symbol;
declare const exactOneVideoRunLease: unique symbol;

export type OneVideoRunOnceAction =
  | "activate_and_submit"
  | "reconcile_submission"
  | "observe_terminal"
  | "ingest_asset"
  | "link_asset";

export interface ExactOneVideoRunTarget {
  readonly scope: Readonly<TenantScope>;
  readonly budgetReservationId: string;
  readonly renderJobId: string;
  readonly dailyPlanSlotId: string;
  readonly slotAttempt: number;
  readonly workHandoffDigest: Sha256Digest;
}

/**
 * Minted only by a trusted server/operator authorization boundary. Browser
 * input is never sufficient to construct or validate this capability.
 */
export interface TrustedOneVideoRunPrincipal {
  readonly capability: "run-exactly-one-video";
  readonly actorUserId: string;
  readonly [trustedOneVideoRunPrincipal]: true;
}

export interface ExactOneVideoRunAuthorization {
  assertAuthorized(input: {
    principal: TrustedOneVideoRunPrincipal;
    target: ExactOneVideoRunTarget;
    action: OneVideoRunOnceAction;
    commandId: string;
    commandDigest: Sha256Digest;
  }): void | Promise<void>;
}

export interface OneVideoRunOnceCommand {
  target: ExactOneVideoRunTarget;
  action: OneVideoRunOnceAction;
  commandId: string;
  principal: TrustedOneVideoRunPrincipal;
}

export type ExactOneVideoStageOutcome =
  | "confirmed"
  | "ambiguous"
  | "reconciled_no_submit"
  | "processing"
  | "completed"
  | "failed"
  | "asset_completed"
  | "asset_completed_unlinked"
  | "asset_linked"
  | "retry_scheduled"
  | "dead_letter"
  | "lease_lost"
  | "idle"
  | "authorization_lost";

export interface ExactOneVideoStageResult {
  target: ExactOneVideoRunTarget;
  action: OneVideoRunOnceAction;
  outcome: ExactOneVideoStageOutcome;
}

export interface ExactOneVideoStageContext {
  readonly target: ExactOneVideoRunTarget;
  readonly action: OneVideoRunOnceAction;
  readonly commandId: string;
  readonly commandDigest: Sha256Digest;
  readonly actorUserId: string;
  readonly lease: ExactOneVideoRunLease;
}

/**
 * Every method requires the complete authorized and durably fenced exact-run
 * context. Deliberately no `runNext()` or publishing method is accepted by
 * this boundary.
 */
export interface ExactOneVideoStageRunner {
  activateAndSubmitExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
  reconcileSubmissionExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
  observeTerminalExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
  ingestAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
  linkAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
}

export interface ExactOneVideoRunLease {
  readonly executionId: string;
  readonly commandId: string;
  readonly commandDigest: Sha256Digest;
  readonly fencingToken: bigint;
  readonly leaseToken: string;
  readonly [exactOneVideoRunLease]: true;
}

export type ExactOneVideoFenceAcquireResult =
  | { kind: "acquired"; lease: ExactOneVideoRunLease }
  | { kind: "replayed"; result: ExactOneVideoStageResult }
  | { kind: "busy" }
  | { kind: "conflict" };

/**
 * Production implementations must acquire and complete in durable storage.
 * The exact target, action and command digest are the idempotency identity.
 */
export interface ExactOneVideoRunFence {
  acquire(input: {
    target: ExactOneVideoRunTarget;
    action: OneVideoRunOnceAction;
    commandId: string;
    commandDigest: Sha256Digest;
    actorUserId: string;
  }): Promise<ExactOneVideoFenceAcquireResult>;
  complete(input: {
    lease: ExactOneVideoRunLease;
    result: ExactOneVideoStageResult;
  }): Promise<boolean>;
  sealUncertain(input: {
    lease: ExactOneVideoRunLease;
    errorDigest: Sha256Digest;
  }): Promise<boolean>;
}

export type OneVideoRunOnceErrorCode =
  | "BUSY"
  | "CONFLICT"
  | "INVALID_COMMAND"
  | "STAGE_MISMATCH"
  | "UNCERTAIN";

export class OneVideoRunOnceError extends Error {
  constructor(readonly code: OneVideoRunOnceErrorCode) {
    super(code);
    this.name = "OneVideoRunOnceError";
  }
}

/**
 * Unmounted provider-neutral one-video executor.
 *
 * Construction performs no database, secret, provider, DNS, storage, worker,
 * publishing, or timer I/O. Each explicit call performs at most one exact
 * pipeline action, is protected by both an in-process concurrency-one guard
 * and a required durable fence, and never exposes a global queue-drain method.
 */
export class OneVideoRunOnceExecutor {
  readonly configured = true;
  readonly autostart = false;
  readonly concurrency = 1;
  readonly publishingAvailable = false;
  private running = false;

  constructor(private readonly options: {
    authorization: ExactOneVideoRunAuthorization;
    fence: ExactOneVideoRunFence;
    stages: ExactOneVideoStageRunner;
  }) {
    if (!options.authorization || !options.fence || !options.stages) {
      throw new OneVideoRunOnceError("INVALID_COMMAND");
    }
  }

  async run(command: OneVideoRunOnceCommand): Promise<ExactOneVideoStageResult> {
    const validated = validateCommand(command);
    const commandDigest = oneVideoRunOnceCommandDigest(validated);
    if (this.running) throw new OneVideoRunOnceError("BUSY");
    this.running = true;
    try {
      await this.options.authorization.assertAuthorized({
        principal: validated.principal,
        target: validated.target,
        action: validated.action,
        commandId: validated.commandId,
        commandDigest,
      });
      const acquired = await this.options.fence.acquire({
        target: validated.target,
        action: validated.action,
        commandId: validated.commandId,
        commandDigest,
        actorUserId: validated.principal.actorUserId,
      });
      if (acquired.kind === "replayed") {
        assertExactResult(validated, acquired.result);
        return acquired.result;
      }
      if (acquired.kind === "busy") throw new OneVideoRunOnceError("BUSY");
      if (acquired.kind === "conflict") throw new OneVideoRunOnceError("CONFLICT");
      assertExactLease(validated, commandDigest, acquired.lease);
      const context = exactStageContext(validated, commandDigest, acquired.lease);
      try {
        const result = await runExactStage(this.options.stages, context);
        assertExactResult(validated, result);
        if (!await this.options.fence.complete({ lease: context.lease, result })) {
          throw new OneVideoRunOnceError("CONFLICT");
        }
        return result;
      } catch (error) {
        const sealed = await this.options.fence.sealUncertain({
          lease: context.lease,
          errorDigest: uncertainErrorDigest(error, validated, context.lease),
        });
        if (!sealed) throw new OneVideoRunOnceError("CONFLICT");
        throw new OneVideoRunOnceError("UNCERTAIN");
      }
    } finally {
      this.running = false;
    }
  }
}

export function oneVideoRunOnceCommandDigest(
  input: OneVideoRunOnceCommand,
): Sha256Digest {
  const command = validateCommand(input);
  return sha256(JSON.stringify(canonicalJson({
    version: 1,
    target: command.target,
    action: command.action,
    commandId: command.commandId,
    actorUserId: command.principal.actorUserId,
  })));
}

async function runExactStage(
  stages: ExactOneVideoStageRunner,
  context: ExactOneVideoStageContext,
): Promise<ExactOneVideoStageResult> {
  switch (context.action) {
    case "activate_and_submit": return stages.activateAndSubmitExact(context);
    case "reconcile_submission": return stages.reconcileSubmissionExact(context);
    case "observe_terminal": return stages.observeTerminalExact(context);
    case "ingest_asset": return stages.ingestAssetExact(context);
    case "link_asset": return stages.linkAssetExact(context);
  }
}

function exactStageContext(
  command: OneVideoRunOnceCommand,
  commandDigest: Sha256Digest,
  acquiredLease: ExactOneVideoRunLease,
): ExactOneVideoStageContext {
  const lease = Object.freeze({
    executionId: acquiredLease.executionId,
    commandId: acquiredLease.commandId,
    commandDigest: acquiredLease.commandDigest,
    fencingToken: acquiredLease.fencingToken,
    leaseToken: acquiredLease.leaseToken,
  }) as ExactOneVideoRunLease;
  return Object.freeze({
    target: command.target,
    action: command.action,
    commandId: command.commandId,
    commandDigest,
    actorUserId: command.principal.actorUserId,
    lease,
  });
}

function validateCommand(command: OneVideoRunOnceCommand): OneVideoRunOnceCommand {
  const target = command?.target;
  if (!target || !target.scope
    || !safePart(target.scope.ownerUserId, 160) || !safePart(target.scope.workspaceId, 160)
    || !UUID.test(target.budgetReservationId) || !UUID.test(target.renderJobId)
    || !UUID.test(target.dailyPlanSlotId)
    || !Number.isSafeInteger(target.slotAttempt) || target.slotAttempt < 1
    || !DIGEST.test(target.workHandoffDigest)
    || !ACTIONS.has(command.action)
    || !safePart(command.commandId, 160)
    || !command.principal || command.principal.capability !== "run-exactly-one-video"
    || !safePart(command.principal.actorUserId, 160)) {
    throw new OneVideoRunOnceError("INVALID_COMMAND");
  }
  return Object.freeze({
    target: Object.freeze({
      scope: Object.freeze({ ...target.scope }),
      budgetReservationId: target.budgetReservationId,
      renderJobId: target.renderJobId,
      dailyPlanSlotId: target.dailyPlanSlotId,
      slotAttempt: target.slotAttempt,
      workHandoffDigest: target.workHandoffDigest,
    }),
    action: command.action,
    commandId: command.commandId,
    principal: Object.freeze({
      capability: command.principal.capability,
      actorUserId: command.principal.actorUserId,
    }) as TrustedOneVideoRunPrincipal,
  });
}

function assertExactResult(command: OneVideoRunOnceCommand, result: ExactOneVideoStageResult): void {
  if (!result || result.action !== command.action || !sameTarget(result.target, command.target)
    || !ACTION_OUTCOMES[command.action].has(result.outcome)) {
    throw new OneVideoRunOnceError("STAGE_MISMATCH");
  }
}

function assertExactLease(
  command: OneVideoRunOnceCommand,
  commandDigest: Sha256Digest,
  lease: ExactOneVideoRunLease,
): void {
  if (!lease || !UUID.test(lease.executionId) || !UUID.test(lease.leaseToken)
    || lease.commandId !== command.commandId
    || lease.commandDigest !== commandDigest || !DIGEST.test(lease.commandDigest)
    || typeof lease.fencingToken !== "bigint" || lease.fencingToken < 1n) {
    throw new OneVideoRunOnceError("CONFLICT");
  }
}

function sameTarget(left: ExactOneVideoRunTarget, right: ExactOneVideoRunTarget): boolean {
  return left.scope.ownerUserId === right.scope.ownerUserId
    && left.scope.workspaceId === right.scope.workspaceId
    && left.budgetReservationId === right.budgetReservationId
    && left.renderJobId === right.renderJobId
    && left.dailyPlanSlotId === right.dailyPlanSlotId
    && left.slotAttempt === right.slotAttempt
    && left.workHandoffDigest === right.workHandoffDigest;
}

function uncertainErrorDigest(
  error: unknown,
  command: OneVideoRunOnceCommand,
  lease: ExactOneVideoRunLease,
): Sha256Digest {
  return sha256(JSON.stringify(canonicalJson({
    version: 1,
    classification: error instanceof Error ? error.name : "UnknownStageError",
    action: command.action,
    commandId: command.commandId,
    commandDigest: lease.commandDigest,
    executionId: lease.executionId,
    fencingToken: lease.fencingToken.toString(),
    target: command.target,
  })));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

function sha256(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safePart(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ACTIONS = new Set<OneVideoRunOnceAction>([
  "activate_and_submit", "reconcile_submission", "observe_terminal", "ingest_asset", "link_asset",
]);
const COMMON_STOP = ["idle", "authorization_lost"] as const;
const ACTION_OUTCOMES: Record<OneVideoRunOnceAction, ReadonlySet<ExactOneVideoStageOutcome>> = {
  activate_and_submit: new Set(["confirmed", "ambiguous", ...COMMON_STOP]),
  reconcile_submission: new Set(["confirmed", "ambiguous", "reconciled_no_submit", ...COMMON_STOP]),
  observe_terminal: new Set(["processing", "completed", "failed", ...COMMON_STOP]),
  ingest_asset: new Set([
    "asset_completed", "asset_completed_unlinked", "retry_scheduled", "dead_letter", "lease_lost", ...COMMON_STOP,
  ]),
  link_asset: new Set(["asset_linked", "asset_completed_unlinked", ...COMMON_STOP]),
};
