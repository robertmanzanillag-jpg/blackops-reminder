import type { Sha256Digest } from "../planning/contracts";
import {
  hasTrustedOneVideoRunPrincipalIdentity,
  OneVideoRunOnceError,
  oneVideoRunOnceCommandDigest,
  type ExactOneVideoRunAuthorization,
  type ExactOneVideoRunTarget,
  type OneVideoRunOnceAction,
  type OneVideoRunOnceCommand,
  type TrustedOneVideoRunPrincipal,
} from "./one-video-run-once-executor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface ServerOwnedOneVideoRunAuthorizationInput {
  capabilityId: string;
  actorUserId: string;
  target: ExactOneVideoRunTarget;
  action: OneVideoRunOnceAction;
  commandId: string;
}
export interface ServerOwnedOneVideoRunAuthorization {
  readonly capabilityId: string;
  readonly principal: TrustedOneVideoRunPrincipal;
  readonly command: OneVideoRunOnceCommand;
  readonly commandDigest: Sha256Digest;
  readonly authorization: ExactOneVideoRunAuthorization;
}

/** Mints one frozen server authority for one exact PR32 command. */
export function createServerOwnedOneVideoRunAuthorization(
  input: ServerOwnedOneVideoRunAuthorizationInput,
): ServerOwnedOneVideoRunAuthorization {
  if (!UUID.test(input?.capabilityId)) throw new OneVideoRunOnceError("INVALID_COMMAND");
  const principal = Object.freeze({
    capability: "run-exactly-one-video" as const,
    actorUserId: input.actorUserId,
  }) as TrustedOneVideoRunPrincipal;
  const command = Object.freeze({
    target: frozenTarget(input.target),
    action: input.action,
    commandId: input.commandId,
    principal,
  });
  const commandDigest = oneVideoRunOnceCommandDigest(command);
  const authorization: ExactOneVideoRunAuthorization = Object.freeze({
    assertAuthorized(
      candidate: Parameters<ExactOneVideoRunAuthorization["assertAuthorized"]>[0],
    ) {
      if (!candidate?.principal
        || !hasTrustedOneVideoRunPrincipalIdentity(candidate.principal, principal)
        || candidate.principal.actorUserId !== command.principal.actorUserId
        || candidate.action !== command.action
        || candidate.commandId !== command.commandId
        || candidate.commandDigest !== commandDigest
        || !sameTarget(candidate.target, command.target)) {
        throw new OneVideoRunOnceError("INVALID_COMMAND");
      }
    },
  });
  return Object.freeze({
    capabilityId: input.capabilityId,
    principal,
    command,
    commandDigest,
    authorization,
  });
}

function frozenTarget(target: ExactOneVideoRunTarget): ExactOneVideoRunTarget {
  return Object.freeze({
    scope: Object.freeze({
      ownerUserId: target?.scope?.ownerUserId,
      workspaceId: target?.scope?.workspaceId,
    }),
    budgetReservationId: target?.budgetReservationId,
    renderJobId: target?.renderJobId,
    dailyPlanSlotId: target?.dailyPlanSlotId,
    slotAttempt: target?.slotAttempt,
    workHandoffDigest: target?.workHandoffDigest,
  }) as ExactOneVideoRunTarget;
}
function sameTarget(left: ExactOneVideoRunTarget, right: ExactOneVideoRunTarget): boolean {
  return Boolean(left && left.scope
    && left.scope.ownerUserId === right.scope.ownerUserId
    && left.scope.workspaceId === right.scope.workspaceId
    && left.budgetReservationId === right.budgetReservationId
    && left.renderJobId === right.renderJobId
    && left.dailyPlanSlotId === right.dailyPlanSlotId
    && left.slotAttempt === right.slotAttempt
    && left.workHandoffDigest === right.workHandoffDigest);
}
