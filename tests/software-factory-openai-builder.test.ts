import test from "node:test";
import { validateFactoryPublicationPatch } from "../server/software-factory-github-publisher";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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


test("missing model line delimiter is normalized without repairing invalid diff contents", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "old\n");
    const valid = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new  ";
    for (const text of [valid, valid + "\n", valid.replace("@@ -1 +1 @@", "@@ -2 +2 @@")]) {
      const generate = createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100,
        generateText: async () => ({ status: "completed", text, costCents: 2, inputTokens: 10, outputTokens: 10 }) });
      const result = await generate(input, { workspace, maxCostCents: 10 });
      assert.equal(result.patch, text.endsWith("\n") ? text : text + "\n");
      assert.equal(result.costCents, 2);
      assert.deepEqual(validateFactoryPublicationPatch(result.patch), ["app.ts"]);
    }
    for (const text of [valid.replace("@@ -1 +1 @@", "@@ -1,2 +1,2 @@"), "```diff\n" + valid + "\n```", valid.replaceAll("app.ts", "../escape"), valid + "\r", ""]) {
      const generate = createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100,
        generateText: async () => ({ status: "completed", text, costCents: 2, inputTokens: 10, outputTokens: 10 }) });
      const result = await generate(input, { workspace, maxCostCents: 10 });
      assert.equal(result.costCents, 2);
      assert.throws(() => validateFactoryPublicationPatch(result.patch));
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});


test("plain text edits construct exact complete hunks and reject ambiguous or structural edits with settled cost", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-text-test-"));
  const source = '<!doctype html>\n<html><body><h1>Old wording.</h1><a href="health.json">Health</a></body></html>\n';
  try {
    await mkdir(path.join(workspace, "site"));
    await writeFile(path.join(workspace, "site/index.html"), source);
    const run = async (text: string) => createOpenAiFactoryPatchGenerator({
      sourcePaths: { "owner/app": ["site/index.html"] }, patchMode: "plainTextEdits", maxOutputTokens: 100,
      generateText: async request => {
        assert.match(request.instructions, /JSON object/);
        return { status: "completed", text, costCents: 1, inputTokens: 10, outputTokens: 10 };
      },
    })(input, { workspace, maxCostCents: 10 });
    const result = await run(JSON.stringify({ before: "Old wording.", after: "Verified wording." }));
    assert.equal(result.costCents, 1);
    assert.deepEqual(validateFactoryPublicationPatch(result.patch), ["site/index.html"]);
    assert.equal(result.patch, 'diff --git a/site/index.html b/site/index.html\n--- a/site/index.html\n+++ b/site/index.html\n@@ -1,2 +1,2 @@\n-<!doctype html>\n-<html><body><h1>Old wording.</h1><a href="health.json">Health</a></body></html>\n+<!doctype html>\n+<html><body><h1>Verified wording.</h1><a href="health.json">Health</a></body></html>\n');
    for (const response of ['not json', '{}', JSON.stringify({ before: 'Old wording.', after: 'New', extra: true }), ...[
      ['health.json', 'other.json'], ['missing', 'New'], ['Old wording.', '<script>'], ['Old wording.', 'https://example.com'],
      ['Old wording.', '&lt;script&gt;'], ['Old wording.', 'New\nline'], ['Old wording.', ''], ['Old wording.', 'x'.repeat(5001)],
    ].map(([before, after]) => JSON.stringify({ before, after }))]) {
      assert.deepEqual(await run(response), { patch: "", costCents: 1 });
    }
    for (const unsafe of [source.replace('Health</a>', 'Old wording.</a>'), source.replace('<h1>', '<script>'), source.replace('<h1>', '<!--'), source.slice(0, -1), '\uFEFF' + source]) {
      await writeFile(path.join(workspace, "site/index.html"), unsafe);
      assert.deepEqual(await run(JSON.stringify({ before: 'Old wording.', after: 'New wording.' })), { patch: "", costCents: 1 });
    }
    assert.throws(() => createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, patchMode: "plainTextEdits", maxOutputTokens: 100, generateText: async () => { throw Error("must not call"); } }), /PLAIN_TEXT_SOURCE_REQUIRED/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
