import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOpenAiFactoryPatchGenerator } from "../server/software-factory-openai-builder";

const input = { repository: "owner/app", baseSha: "a".repeat(40), request: "Fix the synthetic bug", reservedCents: 10, testCommand: ["test"], buildCommand: ["build"] };
test("sends only operator-selected source and preserves exact patch and usage", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "export const value=1;");
    await writeFile(path.join(workspace, "unselected.txt"), "DO_NOT_SEND");
    const sourcePaths = { "owner/app": ["app.ts"] };
    const patch = "diff --git a/app.ts b/app.ts\n";
    const generate = createOpenAiFactoryPatchGenerator({ sourcePaths, maxOutputTokens: 100, generateText: async request => {
      const context = JSON.parse(request.text);
      assert.deepEqual(context.files, [{ path: "app.ts", text: "export const value=1;" }]);
      assert.equal(context.baseSha, input.baseSha);
      assert.equal(request.maxCostCents, 10);
      return { status: "completed", text: patch, costCents: 2, inputTokens: 50, outputTokens: 20 };
    } });
    sourcePaths["owner/app"].push("unselected.txt");
    assert.deepEqual(await generate(input, { workspace, maxCostCents: 10 }), { patch, costCents: 2 });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("protected, traversal and oversized source cannot reach the model", async () => {
  let calls = 0;
  const generateText = async () => { calls++; return { status: "blocked" as const, reason: "fixture", costCents: 0 }; };
  for (const file of ["../escape", "/absolute", "C:/absolute", "x/.env.local", "secrets/key", "x\\escape", "./app.ts", ".aws/config", ".ssh/config", "keys/private.pem", "id_ed25519", "x/.env ", "x/aux.ts", "x/control\u0001.ts"]) {
    assert.throws(() => createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": [file] }, maxOutputTokens: 100, generateText }), /ALLOWLIST/);
  }
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "x".repeat(192001));
    const generate = createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100, generateText });
    await assert.rejects(generate(input, { workspace, maxCostCents: 10 }), /CONTEXT_TOO_LARGE/);
    await assert.rejects(generate({ ...input, repository: "other/app" }, { workspace, maxCostCents: 10 }), /NOT_ALLOWED/);
    assert.equal(calls, 0);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("ambiguous model execution throws; terminal failure retains its cost", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "fixture");
    const common = { sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100 };
    const unknown = createOpenAiFactoryPatchGenerator({ ...common, generateText: async () => ({ status: "unknown", reason: "timeout", costCents: 0 }) });
    await assert.rejects(unknown(input, { workspace, maxCostCents: 10 }), /UNCONFIRMED/);
    const failed = createOpenAiFactoryPatchGenerator({ ...common, generateText: async () => ({ status: "failed", reason: "refusal", costCents: 3 }) });
    assert.deepEqual(await failed(input, { workspace, maxCostCents: 10 }), { patch: "", costCents: 3 });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
