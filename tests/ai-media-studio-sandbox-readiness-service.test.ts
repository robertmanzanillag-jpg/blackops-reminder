import assert from "node:assert/strict";
import test from "node:test";
import { SandboxReadinessError } from "../server/ai-media-studio/planning/sandbox-readiness-contracts";
import { SandboxReadinessService } from "../server/ai-media-studio/planning/sandbox-readiness-service";
import { planId, sandboxPacket, slotId } from "./helpers/ai-media-studio-sandbox-readiness-fixture";

test("service scopes exact public plan and slot keys and validates the repository packet", async () => {
  const calls: unknown[] = [];
  const service = new SandboxReadinessService({ observe: async (...args) => { calls.push(args); return sandboxPacket(); } });
  assert.deepEqual(await service.observe({ ownerUserId: " owner ", workspaceId: " workspace " }, planId, slotId), sandboxPacket());
  assert.deepEqual(calls, [[{ ownerUserId: "owner", workspaceId: "workspace" }, planId, slotId]]);
});

test("service makes cross-tenant absence indistinguishable and fails spoofed or malformed output closed", async () => {
  const missing = new SandboxReadinessService({ observe: async () => undefined });
  await assert.rejects(() => missing.observe({ ownerUserId: "owner", workspaceId: "workspace" }, planId, slotId),
    (error: unknown) => error instanceof SandboxReadinessError && error.code === "NOT_FOUND");
  const corrupt = new SandboxReadinessService({ observe: async () => ({ ...sandboxPacket(), spendAuthorized: true }) as any });
  await assert.rejects(() => corrupt.observe({ ownerUserId: "owner", workspaceId: "workspace" }, planId, slotId),
    (error: unknown) => error instanceof SandboxReadinessError && error.code === "UNAVAILABLE");
  await assert.rejects(() => missing.observe({ ownerUserId: "owner", workspaceId: "workspace" }, "bad", slotId),
    (error: unknown) => error instanceof SandboxReadinessError && error.code === "INVALID_REQUEST");
});
