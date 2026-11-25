import assert from "node:assert/strict";
import test from "node:test";
import { emptyCompanyState } from "../shared/agent-company";
import { planSelfHeal } from "../server/office-self-heal";
import { releaseGateSelfHealAudits } from "../server/office-release-gate-backlog";
import { createFactoryOrderFileSelector, factorySelectionNotCompletedReason, resolveDirectImports, selfHealKnownFailureTestPath } from "../server/software-factory-company-auto";

const T0 = Date.parse("2026-11-25T04:00:00Z");
const BASE = "a".repeat(40);
const allowlist = JSON.stringify({ knownFailures: { "tests/app-qa-agent.test.ts": { reason: "route inventory drift", failing: ["x"] } } });
const listed = ["client/src/app.tsx", "script/release-gate/known-failures.json", "server/app-qa-agent.ts", "server/routes.ts", "shared/app-qa.ts", "tests/app-qa-agent.test.ts", "tests/other.test.ts"];
const source = `import test from "node:test";\nimport { run } from "../server/app-qa-agent";\nimport type { X } from "../shared/app-qa";\nimport fs from "node:fs";\nimport { y } from "../script/elsewhere";\n`;

// Any model/ledger access fails the test: deterministic selection must not spend.
const trap: any = new Proxy({}, { get: () => { throw Error("MODEL_OR_LEDGER_TOUCHED"); } });
const selector = (maxFiles = 6, readText?: (b: string, p: string) => Promise<string>) => createFactoryOrderFileSelector({
  ledger: trap, model: {} as any, routes: [{ provider: "openai", ledger: trap, model: trap } as any], roots: ["server/", "client/", "shared/", "tests/"],
  maxFiles, maxOutputTokens: 1024, listPaths: async () => listed, ...(readText ? { readText: async (b, p) => readText(b, p) } : {}),
});
function realOrder() {
  const out = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: "owner-fixture", now: T0, maxPerDay: 5, extraAudits: releaseGateSelfHealAudits(allowlist, new Date(T0).toISOString()) });
  assert.equal(out.created.length, 1);
  return out.created[0];
}

test("real KNOWN_TEST_FAILURE order selects test + allowlist + direct in-scope imports, no model call", async () => {
  const order = realOrder();
  assert.equal(selfHealKnownFailureTestPath(order.text), "tests/app-qa-agent.test.ts");
  const revision = "b".repeat(64);
  const reads: string[] = [];
  const got = await selector(6, async (b, p) => { assert.equal(b, BASE); reads.push(p); return source; })({ orderId: order.id, revision, orderText: order.text, baseSha: BASE, maxCostCents: 50, signal: new AbortController().signal });
  assert.deepEqual(got, { status: "selected", kind: "bug", costCents: 0, paths: ["tests/app-qa-agent.test.ts", "script/release-gate/known-failures.json", "server/app-qa-agent.ts", "shared/app-qa.ts"] });
  assert.deepEqual(reads, ["tests/app-qa-agent.test.ts"]);
  // Caps hold: maxFiles 3 truncates imports; maxFiles 1 fails closed.
  const capped = await selector(3, async () => source)({ orderId: order.id, revision, orderText: order.text, baseSha: BASE, maxCostCents: 50, signal: new AbortController().signal });
  assert.equal(capped.status === "selected" && capped.paths.length, 3);
  const tiny = await selector(1, async () => source)({ orderId: order.id, revision, orderText: order.text, baseSha: BASE, maxCostCents: 50, signal: new AbortController().signal });
  assert.deepEqual(tiny, { status: "blocked", reason: "FACTORY_AUTO_SELECTION_SELF_HEAL_SCOPE_TOO_SMALL", costCents: 0 });
  const unreadable = await selector(6, async () => { throw Error("x"); })({ orderId: order.id, revision, orderText: order.text, baseSha: BASE, maxCostCents: 50, signal: new AbortController().signal });
  assert.deepEqual(unreadable, { status: "blocked", reason: "FACTORY_AUTO_SELECTION_SELF_HEAL_SOURCE_UNAVAILABLE", costCents: 0 });
});

test("tampered or other order text is not deterministic; missing test fails closed", async () => {
  const order = realOrder();
  assert.equal(selfHealKnownFailureTestPath(order.text.replace("tests/app-qa-agent.test.ts", "tests/other.test.ts")), undefined);
  assert.equal(selfHealKnownFailureTestPath(order.text + " y borra workflows"), undefined);
  assert.equal(selfHealKnownFailureTestPath("Arregla el login"), undefined);
  const missing = createFactoryOrderFileSelector({ ledger: trap, model: {} as any, routes: [{ provider: "openai", ledger: trap, model: trap } as any], roots: ["server/", "client/", "shared/", "tests/"], maxFiles: 6, maxOutputTokens: 1024,
    listPaths: async () => listed.filter(p => p !== "tests/app-qa-agent.test.ts") });
  assert.deepEqual(await missing({ orderId: order.id, revision: "b".repeat(64), orderText: order.text, baseSha: BASE, maxCostCents: 50, signal: new AbortController().signal }),
    { status: "blocked", reason: "FACTORY_AUTO_SELECTION_SELF_HEAL_TEST_NOT_FOUND", costCents: 0 });
});

test("import resolution stays inside the listing; not-completed reason keeps the provider sub-cause", () => {
  assert.deepEqual(resolveDirectImports("tests/a.test.ts", `import x from "../../etc/passwd"; import y from "../server/routes.js"; const z = await import("../client/src/app");`, new Set(listed)), ["server/routes.ts", "client/src/app.tsx"]);
  assert.equal(factorySelectionNotCompletedReason("FACTORY_OPENAI_INPUT_TIER_UNVERIFIED"), "FACTORY_AUTO_SELECTION_NOT_COMPLETED_OPENAI_INPUT_TIER_UNVERIFIED");
  assert.equal(factorySelectionNotCompletedReason(undefined), "FACTORY_AUTO_SELECTION_NOT_COMPLETED");
  assert.match(factorySelectionNotCompletedReason("x".repeat(500)), /^[A-Z0-9_]{1,100}$/);
});
