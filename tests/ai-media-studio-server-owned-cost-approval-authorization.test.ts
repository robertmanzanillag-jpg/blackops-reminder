import assert from "node:assert/strict";
import test from "node:test";
import { createServerOwnedOneVideoCostApprovalAuthorization } from "../server/ai-media-studio/planning/server-owned-one-video-cost-approval-authorization";

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" };

test("server-owned cost approval authorization seals exact user and tenant scope", async () => {
  const request = { authenticatedUserId: "owner-a" };
  const pair = createServerOwnedOneVideoCostApprovalAuthorization((value) =>
    (value as typeof request).authenticatedUserId);
  const authorized = await pair.authorizer.authorize({ authorizationContext: request, scope });
  assert.ok(authorized);

  const principal = await pair.authenticator.authenticate({
    context: authorized.launchAuthorityContext,
    scope,
    requiredCapability: "human_launch:decide",
  });
  assert.equal(principal?.subjectId, "owner-a");
  assert.equal(principal?.kind, "user");
  assert.deepEqual(principal?.capabilities, ["human_launch:decide"]);

  assert.equal(await pair.authenticator.authenticate({
    context: authorized.launchAuthorityContext,
    scope: { ...scope, workspaceId: "workspace-b" },
    requiredCapability: "human_launch:decide",
  }), undefined);
  assert.equal(await pair.authenticator.authenticate({
    context: authorized.launchAuthorityContext,
    scope,
    requiredCapability: "quote:attest",
  }), undefined);
  assert.equal(await pair.authenticator.authenticate({
    context: {}, scope, requiredCapability: "human_launch:decide",
  }), undefined);
});

test("authorization fails closed for unauthenticated and cross-owner requests", async () => {
  const pair = createServerOwnedOneVideoCostApprovalAuthorization((value) => {
    const id = (value as { authenticatedUserId?: string }).authenticatedUserId;
    if (!id) throw new Error("unauthenticated");
    return id;
  });
  assert.equal(await pair.authorizer.authorize({ authorizationContext: {}, scope }), undefined);
  assert.equal(await pair.authorizer.authorize({
    authorizationContext: { authenticatedUserId: "owner-b" }, scope,
  }), undefined);
  assert.equal(await pair.authorizer.authorize({ authorizationContext: "owner-a", scope }), undefined);
});
