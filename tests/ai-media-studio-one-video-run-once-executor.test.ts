import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import {
  OneVideoRunOnceError,
  OneVideoRunOnceExecutor,
  oneVideoRunOnceCommandDigest,
  type ExactOneVideoFenceAcquireResult,
  type ExactOneVideoRunFence,
  type ExactOneVideoRunLease,
  type ExactOneVideoRunTarget,
  type ExactOneVideoStageContext,
  type ExactOneVideoStageResult,
  type ExactOneVideoStageRunner,
  type OneVideoRunOnceAction,
  type OneVideoRunOnceCommand,
  type TrustedOneVideoRunPrincipal,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const digest = (char: string) => `sha256:${char.repeat(64)}` as Sha256Digest;
const target: ExactOneVideoRunTarget = Object.freeze({
  scope: Object.freeze({ ownerUserId: "owner-1", workspaceId: "workspace-1" }),
  budgetReservationId: "10000000-0000-4000-8000-000000000001",
  renderJobId: "20000000-0000-4000-8000-000000000002",
  dailyPlanSlotId: "30000000-0000-4000-8000-000000000003",
  slotAttempt: 1,
  workHandoffDigest: digest("a"),
});
const principal = {
  capability: "run-exactly-one-video",
  actorUserId: "robert",
} as TrustedOneVideoRunPrincipal;
const lease = {
  executionId: "40000000-0000-4000-8000-000000000004",
  commandId: "one-video-command-1",
  commandDigest: oneVideoRunOnceCommandDigest({
    target,
    action: "activate_and_submit",
    commandId: "one-video-command-1",
    principal,
  }),
  fencingToken: 1n,
  leaseToken: "50000000-0000-4000-8000-000000000005",
} as ExactOneVideoRunLease;

function command(
  action: OneVideoRunOnceAction = "activate_and_submit",
  changes: Partial<OneVideoRunOnceCommand> = {},
): OneVideoRunOnceCommand {
  return { target, action, commandId: "one-video-command-1", principal, ...changes };
}

function result(action: OneVideoRunOnceAction, changes: Partial<ExactOneVideoStageResult> = {}): ExactOneVideoStageResult {
  return { target, action, outcome: action === "activate_and_submit" ? "confirmed" : "idle", ...changes };
}

function stages(call: (context: ExactOneVideoStageContext) => Promise<ExactOneVideoStageResult>): ExactOneVideoStageRunner {
  const invoke = (action: OneVideoRunOnceAction, context: ExactOneVideoStageContext) => {
    assert.equal(context.action, action);
    return call(context);
  };
  return {
    activateAndSubmitExact: (context) => invoke("activate_and_submit", context),
    reconcileSubmissionExact: (context) => invoke("reconcile_submission", context),
    observeTerminalExact: (context) => invoke("observe_terminal", context),
    ingestAssetExact: (context) => invoke("ingest_asset", context),
    linkAssetExact: (context) => invoke("link_asset", context),
  };
}

function fence(overrides: Partial<ExactOneVideoRunFence> = {}): ExactOneVideoRunFence {
  return {
    acquire: async (input) => ({ kind: "acquired", lease: {
      ...lease,
      commandId: input.commandId,
      commandDigest: input.commandDigest,
    } as ExactOneVideoRunLease }),
    complete: async () => true,
    sealUncertain: async () => true,
    ...overrides,
  };
}

test("construction is inert and one invocation calls only the selected exact stage", async () => {
  const calls: OneVideoRunOnceAction[] = [];
  let authorizations = 0;
  let acquisitions = 0;
  let completions = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { async assertAuthorized(input) {
      authorizations += 1;
      assert.equal(input.principal.actorUserId, "robert");
      assert.deepEqual(input.target, target);
    } },
    fence: fence({
      async acquire(input) {
        acquisitions += 1;
        assert.equal(input.actorUserId, "robert");
        return { kind: "acquired", lease: {
          ...lease, commandId: input.commandId, commandDigest: input.commandDigest,
        } as ExactOneVideoRunLease };
      },
      async complete() { completions += 1; return true; },
    }),
    stages: stages(async (context) => {
      calls.push(context.action);
      assert.deepEqual(context.target, target);
      return result(context.action);
    }),
  });

  assert.equal(executor.autostart, false);
  assert.equal(executor.concurrency, 1);
  assert.equal(executor.publishingAvailable, false);
  assert.deepEqual({ authorizations, acquisitions, completions, calls }, {
    authorizations: 0, acquisitions: 0, completions: 0, calls: [],
  });
  assert.deepEqual(await executor.run(command()), result("activate_and_submit"));
  assert.deepEqual(calls, ["activate_and_submit"]);
  assert.deepEqual({ authorizations, acquisitions, completions }, {
    authorizations: 1, acquisitions: 1, completions: 1,
  });
});

test("all five actions receive their immutable authorized lease context with no global drain or publishing surface", async () => {
  const calls: OneVideoRunOnceAction[] = [];
  const contexts: ExactOneVideoStageContext[] = [];
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence(),
    stages: stages(async (context) => {
      calls.push(context.action);
      contexts.push(context);
      return result(context.action);
    }),
  });
  for (const action of [
    "activate_and_submit", "reconcile_submission", "observe_terminal", "ingest_asset", "link_asset",
  ] as const) {
    await executor.run(command(action, { commandId: `command-${action}` }));
  }
  assert.deepEqual(calls, [
    "activate_and_submit", "reconcile_submission", "observe_terminal", "ingest_asset", "link_asset",
  ]);
  for (const context of contexts) {
    assert.deepEqual(context.target, target);
    assert.equal(context.commandId, `command-${context.action}`);
    assert.equal(context.commandDigest, oneVideoRunOnceCommandDigest(command(context.action, {
      commandId: context.commandId,
    })));
    assert.equal(context.actorUserId, principal.actorUserId);
    assert.equal(context.lease.executionId, lease.executionId);
    assert.equal(context.lease.commandId, context.commandId);
    assert.equal(context.lease.commandDigest, context.commandDigest);
    assert.equal(context.lease.fencingToken, lease.fencingToken);
    assert.equal(context.lease.leaseToken, lease.leaseToken);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.target), true);
    assert.equal(Object.isFrozen(context.target.scope), true);
    assert.equal(Object.isFrozen(context.lease), true);
  }
  assert.equal("runNext" in executor, false);
  assert.equal("publish" in executor, false);
});

test("stage context and its lease cannot be substituted or mutated", async () => {
  const acquiredLeaseBacking = {
    ...lease,
    commandDigest: oneVideoRunOnceCommandDigest(command()),
  };
  const acquiredLease = acquiredLeaseBacking as ExactOneVideoRunLease;
  let completedLease: ExactOneVideoRunLease | undefined;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({
      acquire: async () => ({ kind: "acquired", lease: acquiredLease }),
      complete: async (input) => {
        completedLease = input.lease;
        return true;
      },
    }),
    stages: stages(async (context) => {
      assert.notEqual(context.lease, acquiredLease);
      assert.throws(() => {
        (context as { lease: ExactOneVideoRunLease }).lease = {
          ...context.lease,
          fencingToken: 99n,
        } as ExactOneVideoRunLease;
      }, TypeError);
      assert.throws(() => {
        (context.lease as { fencingToken: bigint }).fencingToken = 99n;
      }, TypeError);
      assert.throws(() => {
        (context.target as { slotAttempt: number }).slotAttempt = 99;
      }, TypeError);
      acquiredLeaseBacking.fencingToken = 88n;
      acquiredLeaseBacking.leaseToken = "60000000-0000-4000-8000-000000000006";
      assert.equal(context.lease.fencingToken, 1n);
      assert.equal(context.lease.leaseToken, lease.leaseToken);
      return result(context.action);
    }),
  });

  await executor.run(command());
  assert.equal(completedLease?.fencingToken, 1n);
  assert.equal(completedLease?.leaseToken, lease.leaseToken);
  assert.equal(Object.isFrozen(completedLease), true);
});

test("principal is snapshotted before authorization awaits and cannot change the fenced stage identity", async () => {
  const principalBacking = {
    capability: "run-exactly-one-video" as const,
    actorUserId: "original-operator",
  };
  const mutablePrincipal = principalBacking as TrustedOneVideoRunPrincipal;
  const exactCommand = command("activate_and_submit", { principal: mutablePrincipal });
  const expectedDigest = oneVideoRunOnceCommandDigest(exactCommand);
  let releaseAuthorization!: () => void;
  const authorizationPending = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
  let authorizationEntered!: () => void;
  const authorizationStarted = new Promise<void>((resolve) => { authorizationEntered = resolve; });
  let fencedActor: string | undefined;
  let fencedDigest: Sha256Digest | undefined;
  let stageContext: ExactOneVideoStageContext | undefined;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { async assertAuthorized(input) {
      assert.equal(input.principal.actorUserId, "original-operator");
      assert.equal(Object.isFrozen(input.principal), true);
      authorizationEntered();
      await authorizationPending;
      assert.equal(input.principal.actorUserId, "original-operator");
    } },
    fence: fence({
      async acquire(input) {
        fencedActor = input.actorUserId;
        fencedDigest = input.commandDigest;
        return { kind: "acquired", lease: {
          ...lease,
          commandId: input.commandId,
          commandDigest: input.commandDigest,
        } as ExactOneVideoRunLease };
      },
    }),
    stages: stages(async (context) => {
      stageContext = context;
      return result(context.action);
    }),
  });

  const running = executor.run(exactCommand);
  await authorizationStarted;
  principalBacking.actorUserId = "substituted-operator";
  releaseAuthorization();
  await running;

  assert.equal(fencedActor, "original-operator");
  assert.equal(fencedDigest, expectedDigest);
  assert.equal(stageContext?.actorUserId, "original-operator");
  assert.equal(stageContext?.commandDigest, expectedDigest);
});

test("authorization and durable fence fail closed before any stage I/O", async () => {
  for (const [name, authorization, acquire, code] of [
    ["denied", { assertAuthorized() { throw new Error("denied"); } }, async () => ({ kind: "conflict" } as const), "denied"],
    ["busy", { assertAuthorized() {} }, async () => ({ kind: "busy" } as const), "BUSY"],
    ["conflict", { assertAuthorized() {} }, async () => ({ kind: "conflict" } as const), "CONFLICT"],
  ] as const) {
    let stagesCalled = 0;
    const executor = new OneVideoRunOnceExecutor({
      authorization,
      fence: fence({ acquire }),
      stages: stages(async () => { stagesCalled += 1; return result("activate_and_submit"); }),
    });
    if (name === "denied") await assert.rejects(executor.run(command()), /denied/u);
    else await assert.rejects(executor.run(command()), (error: unknown) =>
      error instanceof OneVideoRunOnceError && error.code === code);
    assert.equal(stagesCalled, 0);
  }
});

test("same command replay returns the durable result without invoking a stage", async () => {
  let stagesCalled = 0;
  const durable = result("activate_and_submit", { outcome: "ambiguous" });
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({ acquire: async () => ({ kind: "replayed", result: durable }) }),
    stages: stages(async () => { stagesCalled += 1; return result("activate_and_submit"); }),
  });
  assert.deepEqual(await executor.run(command()), durable);
  assert.equal(stagesCalled, 0);
});

test("concurrent invocation is rejected in-process while the first exact stage is active", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence(),
    stages: stages(async (context) => {
      entered();
      await pending;
      return result(context.action);
    }),
  });
  const first = executor.run(command());
  await started;
  await assert.rejects(executor.run(command("observe_terminal", { commandId: "another-command" })),
    (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "BUSY");
  release();
  await first;
});

test("wrong-target results are sealed uncertain and are never reported as success", async () => {
  let sealed = 0;
  let completed = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({
      async complete() { completed += 1; return true; },
      async sealUncertain() { sealed += 1; return true; },
    }),
    stages: stages(async (context) => result(context.action, {
      target: { ...target, renderJobId: "50000000-0000-4000-8000-000000000005" },
    })),
  });
  await assert.rejects(executor.run(command()),
    (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "UNCERTAIN");
  assert.equal(completed, 0);
  assert.equal(sealed, 1);
});

test("stage failure is durably sealed and replay cannot silently resubmit", async () => {
  let sealed = 0;
  let stagesCalled = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({ async sealUncertain(input) {
      sealed += 1;
      assert.match(input.errorDigest, /^sha256:[0-9a-f]{64}$/u);
      return true;
    } }),
    stages: stages(async () => {
      stagesCalled += 1;
      throw new Error("transport uncertainty");
    }),
  });
  await assert.rejects(executor.run(command()),
    (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "UNCERTAIN");
  assert.equal(stagesCalled, 1);
  assert.equal(sealed, 1);
});

test("lost durable completion after stage I/O is sealed uncertain", async () => {
  let sealed = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({
      complete: async () => false,
      sealUncertain: async () => { sealed += 1; return true; },
    }),
    stages: stages(async (context) => result(context.action)),
  });
  await assert.rejects(executor.run(command()),
    (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "UNCERTAIN");
  assert.equal(sealed, 1);
});

test("an outcome belonging to another stage is rejected and sealed uncertain", async () => {
  let sealed = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({ sealUncertain: async () => { sealed += 1; return true; } }),
    stages: stages(async (context) => result(context.action, { outcome: "asset_linked" })),
  });
  await assert.rejects(executor.run(command()),
    (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "UNCERTAIN");
  assert.equal(sealed, 1);
});

test("digest binds the exact target, action, command id and authorized actor", () => {
  const first = oneVideoRunOnceCommandDigest(command());
  const same = oneVideoRunOnceCommandDigest(command());
  const otherActor = oneVideoRunOnceCommandDigest(command("activate_and_submit", {
    principal: { ...principal, actorUserId: "another-authorized-operator" } as TrustedOneVideoRunPrincipal,
  }));
  const different = oneVideoRunOnceCommandDigest(command("observe_terminal"));
  assert.equal(first, same);
  assert.notEqual(first, otherActor);
  assert.notEqual(first, different);
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
});

test("a mismatched durable lease is rejected before stage I/O", async () => {
  let stagesCalled = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() {} },
    fence: fence({ acquire: async () => ({ kind: "acquired", lease: {
      ...lease, commandDigest: digest("f"),
    } as ExactOneVideoRunLease }) }),
    stages: stages(async () => { stagesCalled += 1; return result("activate_and_submit"); }),
  });
  await assert.rejects(executor.run(command()),
    (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "CONFLICT");
  assert.equal(stagesCalled, 0);
});

test("invalid exact identity is rejected before authorization, fence or stage work", async () => {
  let effects = 0;
  const executor = new OneVideoRunOnceExecutor({
    authorization: { assertAuthorized() { effects += 1; } },
    fence: fence({ async acquire(): Promise<ExactOneVideoFenceAcquireResult> {
      effects += 1;
      return { kind: "acquired", lease };
    } }),
    stages: stages(async () => { effects += 1; return result("activate_and_submit"); }),
  });
  await assert.rejects(executor.run(command("activate_and_submit", {
    target: { ...target, slotAttempt: 0 },
  })), (error: unknown) => error instanceof OneVideoRunOnceError && error.code === "INVALID_COMMAND");
  assert.equal(effects, 0);
});
