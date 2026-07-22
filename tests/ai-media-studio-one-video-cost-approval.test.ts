import assert from "node:assert/strict";
import test from "node:test";
import {
  oneVideoCostApprovalRequestSchema,
  oneVideoCostApprovalResponseSchema,
} from "../shared/ai-media-studio-one-video-cost-approval";
import { OneVideoCostApprovalCoordinator } from "../server/ai-media-studio/planning/one-video-cost-approval-coordinator";
import { OneVideoCostApprovalError } from "../server/ai-media-studio/planning/one-video-cost-approval-contracts";
import { DrizzleOneVideoCostApprovalContextLoader } from "../server/ai-media-studio/planning/drizzle-one-video-cost-approval-context-loader";

const key = (prefix: string, digit: number) => `${prefix}_${digit.toString(16).padStart(24, "0")}`;
const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" };
const context = {
  dailyPlanSlotId: "11111111-1111-4111-8111-111111111111",
  slotAttempt: 1,
  planId: key("plan", 1),
  batchId: key("batch", 1),
  slotId: key("slot", 1),
  quoteKey: key("quote", 1),
  renderSpecKey: key("render_spec", 1),
};

test("public cost-approval contract is exact, redacted, and correlates replay effects", () => {
  assert.equal(oneVideoCostApprovalRequestSchema.safeParse({
    expectedBatchId: context.batchId,
    expectedQuoteKey: context.quoteKey,
    decision: "approved",
    idempotencyKey: "approval_000000000000000000000001",
  }).success, true);
  for (const unsafe of [
    { amountMicroUsd: "1" }, { providerAccountId: "private" }, { evidenceDigest: `sha256:${"a".repeat(64)}` },
  ]) {
    assert.equal(oneVideoCostApprovalRequestSchema.safeParse({
      expectedBatchId: context.batchId, expectedQuoteKey: context.quoteKey,
      decision: "approved", idempotencyKey: "approval_000000000000000000000001", ...unsafe,
    }).success, false);
  }
  const response = {
    outcome: "recorded",
    approval: { planId: context.planId, batchId: context.batchId, slotId: context.slotId,
      decision: "approved", approvedQuoteKey: context.quoteKey, renderSpecKey: context.renderSpecKey },
    effects: { providerCalled: false, secretResolved: false, verificationPerformed: false,
      quoteRequested: false, approvalRecorded: true, reservationCreated: false, renderCreated: false,
      outboxCreated: false, spendCommitted: false, publishingCreated: false },
    canGenerate: false, spendAuthorized: false,
  } as const;
  assert.equal(oneVideoCostApprovalResponseSchema.safeParse(response).success, true);
  assert.equal(oneVideoCostApprovalResponseSchema.safeParse({
    ...response, outcome: "replayed", effects: { ...response.effects, approvalRecorded: true },
  }).success, false);
});

test("coordinator authorizes before lookup, binds exact batch and quote, and records no execution effects", async () => {
  const order: string[] = [];
  const commands: unknown[] = [];
  const coordinator = new OneVideoCostApprovalCoordinator({
    authorizer: { async authorize() { order.push("authorize"); return { launchAuthorityContext: { trusted: true } }; } },
    contextLoader: { async load() { order.push("load"); return context; } },
    launchAuthority: { async recordHumanLaunchApproval(_authorization, command) {
      order.push("write"); commands.push(command);
      return { id: "22222222-2222-4222-8222-222222222222", kind: "human_launch_approval",
        inputDigest: `sha256:${"a".repeat(64)}` as const, replayed: false };
    } },
  });
  const result = await coordinator.record({
    scope, publicPlanKey: context.planId, publicSlotKey: context.slotId,
    expectedBatchId: context.batchId, expectedQuoteKey: context.quoteKey,
    decision: "approved", idempotencyKey: "approval_000000000000000000000001", authorizationContext: { request: true },
  });
  assert.deepEqual(order, ["authorize", "load", "write"]);
  assert.deepEqual(commands, [{ scope, dailyPlanSlotId: context.dailyPlanSlotId, slotAttempt: 1,
    decision: "approved", expectedQuoteKey: context.quoteKey,
    idempotencyKey: "approval_000000000000000000000001" }]);
  assert.equal(result.outcome, "recorded");
  assert.equal(result.effects.approvalRecorded, true);
  assert.equal(Object.entries(result.effects).filter(([name, value]) => name !== "approvalRecorded" && value).length, 0);
  assert.equal(JSON.stringify(result).includes(context.dailyPlanSlotId), false);
});

test("coordinator fails closed before tenant lookup when authorization is absent and returns safe stale conflict", async () => {
  let loads = 0;
  const denied = new OneVideoCostApprovalCoordinator({
    authorizer: { async authorize() { return undefined; } },
    contextLoader: { async load() { loads += 1; return context; } },
    launchAuthority: { async recordHumanLaunchApproval() { throw new Error("must not write"); } },
  });
  const command = { scope, publicPlanKey: context.planId, publicSlotKey: context.slotId,
    expectedBatchId: context.batchId, expectedQuoteKey: context.quoteKey, decision: "approved" as const,
    idempotencyKey: "approval_000000000000000000000001", authorizationContext: {} };
  await assert.rejects(denied.record(command), (error: unknown) =>
    error instanceof OneVideoCostApprovalError && error.code === "FORBIDDEN");
  assert.equal(loads, 0);

  const stale = new OneVideoCostApprovalCoordinator({
    authorizer: { async authorize() { return { launchAuthorityContext: {} }; } },
    contextLoader: { async load() { return context; } },
    launchAuthority: { async recordHumanLaunchApproval() { throw new Error("must not write"); } },
  });
  await assert.rejects(stale.record({ ...command, expectedQuoteKey: key("quote", 2) }), (error: unknown) =>
    error instanceof OneVideoCostApprovalError && error.code === "STALE_OR_CONFLICT");
});

test("Drizzle context loader resolves only the internal slot after strict public read-model proof", async () => {
  const queries: string[] = [];
  const loader = new DrizzleOneVideoCostApprovalContextLoader({
    async execute(query) {
      queries.push(String(query));
      return { rows: [{ daily_plan_slot_id: context.dailyPlanSlotId }] };
    },
  }, {
    async observe(receivedScope, planId, slotId) {
      assert.deepEqual(receivedScope, scope); assert.equal(planId, context.planId); assert.equal(slotId, context.slotId);
      return {
        subject: { planId: context.planId, batchId: context.batchId, slotId: context.slotId, slotAttempt: 1 },
        maximumQuote: { state: "quoted", quoteKey: context.quoteKey, renderSpecKey: context.renderSpecKey },
      } as never;
    },
  });
  assert.deepEqual(await loader.load(scope, context.planId, context.slotId), context);
  assert.equal(queries.length, 1);
});
