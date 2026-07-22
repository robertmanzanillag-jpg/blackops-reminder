import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

test("held-admission UI is server-adjudicated, accessible, and activation-free", async () => {
  const [workbench, dialog, api] = await Promise.all([
    read("client/src/features/ai-media-studio/core/production-batch-workbench.tsx"),
    read("client/src/features/ai-media-studio/core/one-video-held-admission-dialog.tsx"),
    read("client/src/features/ai-media-studio/core/api.ts"),
  ]);

  assert.match(workbench, /Held sandbox admission/);
  assert.match(workbench, /Review held admission/);
  assert.match(workbench, /heldAdmissionReadiness\?\.postAvailable === true/);
  assert.doesNotMatch(workbench, /heldAdmissionEnabled\s*=\s*quoteIsExact/);
  assert.match(workbench, /expectedBatchId: heldAdmissionCas\.expectedBatchId/);
  assert.match(workbench, /expectedQuoteKey: heldAdmissionCas\.expectedQuoteKey/);
  assert.match(workbench, /expectedRenderSpecKey: heldAdmissionCas\.expectedRenderSpecKey/);
  assert.match(workbench, /expectedSlotAttempt: heldAdmissionCas\.expectedSlotAttempt/);
  assert.match(workbench, /idempotencyKey: heldAdmissionOperationRef\.current\.idempotencyKey/);
  assert.match(workbench, /Provider not contacted · External spend \$0 · Video not generated/);
  assert.match(workbench, /Activation remains disabled/);
  assert.doesNotMatch(workbench, /setQueryData\([^\n]*held-admission/);

  assert.match(dialog, /<DialogTitle>Create a held one-video admission\?<\/DialogTitle>/);
  assert.match(dialog, /I understand this reserves internal budget for held work only/);
  assert.match(dialog, /Create held admission — no provider call/);
  assert.match(dialog, /disabled=\{!acknowledged \|\| isPending\}/);
  assert.match(dialog, /aria-describedby/);
  assert.match(dialog, /role="alert"/);

  assert.match(api, /oneVideoHeldAdmissionRequestSchema\.parse\(input\)/);
  assert.match(api, /oneVideoHeldAdmissionResponseSchema\.parse/);
  assert.match(api, /one-video-held-admission-readiness/);
  assert.match(api, /one-video-held-admission\/\$\{encodeURIComponent\(slotId\)\}/);
  const mutation = api.slice(api.indexOf("createOneVideoHeldAdmission: async"), api.indexOf("prepareProductionBatchScripts: async"));
  const serializedRequest = mutation.match(/body: JSON\.stringify\(([^)]+)\)/)?.[1];
  assert.equal(serializedRequest, "request");
  assert.doesNotMatch(mutation, /input\.(providerAccountId|nativeId|secret|credential|maximumQuoteMicroUsd)/);
});
