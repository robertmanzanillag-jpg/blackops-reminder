import assert from "node:assert/strict";
import test from "node:test";
import {
  ONE_VIDEO_HELD_ADMISSION_OPERATION,
  type OneVideoHeldAdmissionPublicCas,
} from "../server/ai-media-studio/planning/one-video-held-admission-contracts";
import { createServerOwnedOneVideoHeldAdmissionAuthorization } from "../server/ai-media-studio/planning/server-owned-one-video-held-admission-authorization";

const key = (prefix: string, digit: string): string => `${prefix}_${digit.repeat(24)}`;
const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const cas: OneVideoHeldAdmissionPublicCas = {
  publicPlanKey: key("plan", "1"),
  publicSlotKey: key("slot", "2"),
  expectedBatchId: key("batch", "3"),
  expectedQuoteKey: key("quote", "4"),
  expectedRenderSpecKey: key("render_spec", "5"),
  expectedSlotAttempt: 1,
  idempotencyKey: "held-admission-0001",
};

function authenticationPair() {
  const authenticatedSessions = new WeakMap<object, string>();
  const pair = createServerOwnedOneVideoHeldAdmissionAuthorization((context) => {
    const subjectId = authenticatedSessions.get(context);
    if (!subjectId) throw new Error("no authenticated session");
    return subjectId;
  });
  return { pair, authenticatedSessions };
}

test("server-owned held-admission authorization mints one frozen exact personal-tenant principal", async () => {
  const { pair, authenticatedSessions } = authenticationPair();
  const request = {};
  authenticatedSessions.set(request, scope.ownerUserId);
  const authorization = await pair.authorizer.authorize({
    authorizationContext: request,
    operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope,
    cas,
  });
  assert.ok(authorization);
  assert.notEqual(authorization.heldAdmissionAuthenticationContext, request);

  const principal = await pair.authenticator.authenticate({
    context: authorization.heldAdmissionAuthenticationContext,
    operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope,
    cas,
  });
  assert.ok(principal);
  assert.equal(principal.subjectId, scope.ownerUserId);
  assert.equal(principal.operation, ONE_VIDEO_HELD_ADMISSION_OPERATION);
  assert.deepEqual(principal.scope, scope);
  assert.deepEqual(principal.cas, cas);
  assert.equal(Object.isFrozen(principal), true);
  assert.equal(Object.isFrozen(principal.scope), true);
  assert.equal(Object.isFrozen(principal.cas), true);
});

test("held-admission authorization rejects headers/body lookalikes, wrong users and non-personal tenants", async () => {
  const { pair, authenticatedSessions } = authenticationPair();
  for (const authorizationContext of [
    null,
    "owner-a",
    { body: { principal: "owner-a" } },
    { headers: { "x-user-id": "owner-a" } },
    { authenticatedUserId: "owner-a" },
  ]) {
    assert.equal(await pair.authorizer.authorize({
      authorizationContext,
      operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
      scope,
      cas,
    }), undefined);
  }

  const wrongUserRequest = {};
  authenticatedSessions.set(wrongUserRequest, "owner-b");
  assert.equal(await pair.authorizer.authorize({
    authorizationContext: wrongUserRequest,
    operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope,
    cas,
  }), undefined);

  const validRequest = {};
  authenticatedSessions.set(validRequest, scope.ownerUserId);
  assert.equal(await pair.authorizer.authorize({
    authorizationContext: validRequest,
    operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope: { ...scope, workspaceId: "workspace-a" },
    cas,
  }), undefined);
});

test("sealed admission context is bound to operation, scope, every CAS field and idempotency", async () => {
  const { pair, authenticatedSessions } = authenticationPair();
  const request = {};
  authenticatedSessions.set(request, scope.ownerUserId);
  const authorization = await pair.authorizer.authorize({
    authorizationContext: request,
    operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope,
    cas,
  });
  assert.ok(authorization);

  const changedCases: OneVideoHeldAdmissionPublicCas[] = [
    { ...cas, publicPlanKey: key("plan", "6") },
    { ...cas, publicSlotKey: key("slot", "6") },
    { ...cas, expectedBatchId: key("batch", "6") },
    { ...cas, expectedQuoteKey: key("quote", "6") },
    { ...cas, expectedRenderSpecKey: key("render_spec", "6") },
    { ...cas, expectedSlotAttempt: 2 },
    { ...cas, idempotencyKey: "held-admission-0002" },
  ];
  for (const changed of changedCases) {
    assert.equal(await pair.authenticator.authenticate({
      context: authorization.heldAdmissionAuthenticationContext,
      operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
      scope,
      cas: changed,
    }), undefined);
  }
  assert.equal(await pair.authenticator.authenticate({
    context: authorization.heldAdmissionAuthenticationContext,
    operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope: { ownerUserId: "owner-b", workspaceId: "personal" },
    cas,
  }), undefined);
  assert.equal(await pair.authenticator.authenticate({
    context: authorization.heldAdmissionAuthenticationContext,
    operation: "wrong-operation" as typeof ONE_VIDEO_HELD_ADMISSION_OPERATION,
    scope,
    cas,
  }), undefined);
  assert.equal(await pair.authenticator.authenticate({
    context: {}, operation: ONE_VIDEO_HELD_ADMISSION_OPERATION, scope, cas,
  }), undefined);
});

test("authorizer refuses malformed CAS values before sealing", async () => {
  const { pair, authenticatedSessions } = authenticationPair();
  const request = {};
  authenticatedSessions.set(request, scope.ownerUserId);
  for (const changed of [
    { ...cas, publicPlanKey: "native-plan" },
    { ...cas, expectedQuoteKey: "quote_native" },
    { ...cas, expectedSlotAttempt: 0 },
    { ...cas, idempotencyKey: "short" },
  ]) {
    assert.equal(await pair.authorizer.authorize({
      authorizationContext: request,
      operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
      scope,
      cas: changed,
    }), undefined);
  }
});
