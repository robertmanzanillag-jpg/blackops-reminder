import assert from "node:assert/strict";
import test from "node:test";
import { sandboxReadinessSchema } from "../shared/ai-media-studio-sandbox-readiness";
import { batchId, planId, sandboxPacket, slotId } from "./helpers/ai-media-studio-sandbox-readiness-fixture";

test("strict packet exposes one exact vertical slot and permanently denies effects, spend, and execution", () => {
  const packet = sandboxPacket();
  assert.deepEqual(packet.subject, { planId, batchId, slotId });
  assert.deepEqual(packet.format, { aspectRatio: "9:16", orientation: "vertical" });
  assert.equal(packet.canGenerate, false); assert.equal(packet.sandboxExecutionAllowed, false);
  assert.equal(packet.spendAuthorized, false); assert.equal(packet.authoritativeForAdmission, false);
  assert.ok(Object.values(packet.effects).every((effect) => effect === false));
});

test("packet rejects native/provider/private fields and inconsistent gate summaries", () => {
  for (const privateField of ["providerAccountId", "avatarId", "voiceId", "secretRef", "externalResourceId"]) {
    assert.equal(sandboxReadinessSchema.safeParse({ ...sandboxPacket(), [privateField]: "private" }).success, false);
  }
  const corrupt = structuredClone(sandboxPacket()) as any;
  corrupt.summary.passedGates = 4;
  assert.equal(sandboxReadinessSchema.safeParse(corrupt).success, false);
});
