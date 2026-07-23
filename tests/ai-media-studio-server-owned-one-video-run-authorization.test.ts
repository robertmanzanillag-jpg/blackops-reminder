import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import {
  OneVideoRunOnceError,
  OneVideoRunOnceExecutor,
  type ExactOneVideoRunLease,
  type ExactOneVideoStageRunner,
  type TrustedOneVideoRunPrincipal,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";
import { createServerOwnedOneVideoRunAuthorization } from "../server/ai-media-studio/workers/server-owned-one-video-run-authorization";

const digest = (c: string) => `sha256:${c.repeat(64)}` as Sha256Digest;
const input = Object.freeze({
  capabilityId: "10000000-0000-4000-8000-000000000001", actorUserId: "robert",
  target: Object.freeze({
    scope: Object.freeze({ ownerUserId: "robert", workspaceId: "personal" }),
    budgetReservationId: "20000000-0000-4000-8000-000000000002",
    renderJobId: "30000000-0000-4000-8000-000000000003",
    dailyPlanSlotId: "40000000-0000-4000-8000-000000000004",
    slotAttempt: 1, workHandoffDigest: digest("a"),
  }),
  action: "activate_and_submit" as const, commandId: "one-video-command-1",
});

test("server authority is frozen, exact, and rejects browser lookalikes", async () => {
  const authority = createServerOwnedOneVideoRunAuthorization(input);
  assert.equal(Object.isFrozen(authority.principal), true);
  const exact = {
    principal: authority.principal, target: authority.command.target,
    action: authority.command.action, commandId: authority.command.commandId,
    commandDigest: authority.commandDigest,
  };
  await authority.authorization.assertAuthorized(exact);
  await assert.rejects(async () => authority.authorization.assertAuthorized({
    ...exact,
    principal: { capability: "run-exactly-one-video", actorUserId: "robert" } as TrustedOneVideoRunPrincipal,
  }), (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "INVALID_COMMAND");
  await assert.rejects(async () => authority.authorization.assertAuthorized({
    ...exact, commandDigest: digest("b"),
  }), (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "INVALID_COMMAND");
});

test("executor preserves sealed principal identity through its immutable snapshot", async () => {
  const authority = createServerOwnedOneVideoRunAuthorization(input);
  let calls = 0;
  const stages: ExactOneVideoStageRunner = {
    async activateAndSubmitExact(context) {
      calls += 1;
      return { target: context.target, action: context.action, outcome: "confirmed" };
    },
    async reconcileSubmissionExact() { throw new Error("unexpected"); },
    async observeTerminalExact() { throw new Error("unexpected"); },
    async ingestAssetExact() { throw new Error("unexpected"); },
    async linkAssetExact() { throw new Error("unexpected"); },
  };
  const executor = new OneVideoRunOnceExecutor({
    authorization: authority.authorization, stages,
    fence: {
      async acquire(candidate) {
        return { kind: "acquired", lease: {
          executionId: "50000000-0000-4000-8000-000000000005",
          commandId: candidate.commandId, commandDigest: candidate.commandDigest,
          fencingToken: 1n, leaseToken: "60000000-0000-4000-8000-000000000006",
        } as ExactOneVideoRunLease };
      },
      async complete() { return true; },
      async sealUncertain() { return true; },
    },
  });
  assert.equal((await executor.run(authority.command)).outcome, "confirmed");
  assert.equal(calls, 1);
});

test("invalid durable capability fails before authority is minted", () => {
  assert.throws(() => createServerOwnedOneVideoRunAuthorization({
    ...input, capabilityId: "browser-value",
  }), /INVALID_COMMAND/u);
});
