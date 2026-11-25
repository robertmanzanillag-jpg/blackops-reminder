import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOpenAiFactoryPatchGenerator } from "../server/software-factory-openai-builder";
import { factoryPatchDiagnostics } from "../server/software-factory-builder";

async function run(result: any) {
  const workspace = await mkdtemp(path.join(tmpdir(), "fpp-"));
  await mkdir(path.join(workspace, "tests"));
  await writeFile(path.join(workspace, "tests/a.test.ts"), "export {};\n");
  const generate = createOpenAiFactoryPatchGenerator({ generateText: (async () => result) as any, sourcePaths: { "o/r": ["tests/a.test.ts"] }, maxOutputTokens: 1024, patchMode: "exactSourceEdits" });
  return generate({ repository: "o/r", baseSha: "a".repeat(40), request: "fix" } as any, { workspace, maxCostCents: 10, signal: new AbortController().signal });
}

test("pre-dispatch pricing holds surface PROVIDER_PRICING_UNVERIFIED instead of generic PROVIDER_BLOCKED", async () => {
  assert.ok((factoryPatchDiagnostics as readonly string[]).includes("PROVIDER_PRICING_UNVERIFIED"));
  for (const reason of ["FACTORY_OPENAI_CACHE_PRICING_REQUIRED", "FACTORY_OPENAI_PRICING_EXPIRED", "FACTORY_ANTHROPIC_PRICING_EXPIRED"])
    assert.deepEqual(await run({ status: "blocked", reason, costCents: 0 }), { patch: "", costCents: 0, diagnostic: "PROVIDER_PRICING_UNVERIFIED" });
  assert.deepEqual(await run({ status: "blocked", reason: "FACTORY_OPENAI_INPUT_TIER_UNVERIFIED", costCents: 0 }), { patch: "", costCents: 0, diagnostic: "PROVIDER_INPUT_TIER_UNVERIFIED" });
  assert.deepEqual(await run({ status: "failed", reason: "FACTORY_OPENAI_PRICING_EXPIRED", costCents: 0 }), { patch: "", costCents: 0, diagnostic: "PROVIDER_FAILED" });
});
