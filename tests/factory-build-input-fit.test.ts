import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOpenAiFactoryPatchGenerator, estimateFactoryInputTokens, factoryRequestAnchors, shrinkFactorySourceContext } from "../server/software-factory-openai-builder";
import { isInfrastructureStop, companyOrderRetryAttempt, FACTORY_ORDER_MAX_RETRIES } from "../server/software-factory-order-retry";
import { previousCompanyOrderSelection } from "../server/software-factory-company-auto";

const repo = "robertmanzanillag-jpg/blackops-reminder";
const big = (name: string, lines: number, marker?: number) => Array.from({ length: lines }, (_, i) => i === marker ? `export function ${name}Target() { return ${i}; }` : `const filler_${i} = "${"x".repeat(60)}";`).join("\n") + "\n";

async function workspace(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "fit-"));
  for (const [p, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, p)), { recursive: true }); await writeFile(path.join(root, p), text); }
  return root;
}
function generator(maxInputTokens: number | undefined, seen: { text: string; instructions: string }[]) {
  return createOpenAiFactoryPatchGenerator({ patchMode: "exactSourceEdits", requireTestEdit: true, maxOutputTokens: 8192, ...(maxInputTokens ? { maxInputTokens } : {}),
    sourcePaths: { [repo]: ["server/widget.ts", "server/other.ts", "tests/widget.test.ts"] },
    generateText: (async (input: any) => { seen.push({ text: input.text, instructions: input.instructions });
      return { status: "completed", costCents: 3, text: JSON.stringify({ edits: [
        { path: "server/widget.ts", before: "export function widgetTarget() { return 500; }", after: "export function widgetTarget() { return 501; }" },
        { path: "tests/widget.test.ts", before: "// end\n", after: "// end\n// regression\n" }] }) }; }) as any });
}
const files = { "server/widget.ts": big("widget", 1000, 500), "server/other.ts": big("other", 1000), "tests/widget.test.ts": "import { widgetTarget } from '../server/widget';\n// end\n" };
const input = { repository: repo, baseSha: "a".repeat(40), request: "Fix widgetTarget off-by-one", reservedCents: 100, testCommand: ["npm"], buildCommand: ["npm"] };

test("over-cap build input is shrunk to anchored line windows before the single paid call; edits still apply to the full original", async () => {
  const ws = await workspace(files), seen: any[] = [];
  const out = await generator(30000, seen)(input, { workspace: ws, maxCostCents: 100 });
  assert.equal(seen.length, 1);
  assert.ok(estimateFactoryInputTokens(seen[0].instructions, seen[0].text) <= 30000);
  const sent = JSON.parse(seen[0].text).files;
  assert.ok(sent.find((f: any) => f.path === "server/widget.ts").excerpts.some((e: any) => e.text.includes("widgetTarget")));
  assert.equal(sent.some((f: any) => f.path === "server/other.ts" && f.text), false);
  assert.match(seen[0].instructions, /excerpts/);
  assert.equal(out.costCents, 3); assert.equal(out.diagnostic, undefined); assert.match(out.patch, /return 501/);
});

test("input under the cap is sent unchanged (no excerpts, same instructions)", async () => {
  const ws = await workspace(files), a: any[] = [], b: any[] = [];
  await generator(10_000_000, a)(input, { workspace: ws, maxCostCents: 100 });
  await generator(undefined, b)(input, { workspace: ws, maxCostCents: 100 });
  assert.deepEqual(a, b); assert.doesNotMatch(a[0].instructions, /excerpts/);
});

test("fails closed at $0 without any provider call when even the minimal context does not fit", async () => {
  const ws = await workspace(files), seen: any[] = [];
  const out = await generator(500, seen)(input, { workspace: ws, maxCostCents: 100 });
  assert.equal(seen.length, 0);
  assert.deepEqual(out, { patch: "", costCents: 0, diagnostic: "PROVIDER_INPUT_TOO_LARGE" });
});

test("shrink is deterministic and anchors come from the request", () => {
  const list = Object.entries(files).map(([p, text]) => ({ path: p, text }));
  assert.deepEqual(shrinkFactorySourceContext(list, input.request, 2), shrinkFactorySourceContext(list, input.request, 2));
  assert.ok(factoryRequestAnchors(input.request).includes("widgetTarget"));
});

const ownerKey = "o", orderId = "ord", rev = "r".repeat(64);
const root = (retry: number, status: string, result: any) => ({ id: `root-${retry}`, ownerKey, kind: "discover", status, key: `k${retry}`, completedAt: "2026-11-26T01:30:00Z",
  payload: { companyOrder: { version: 1, company: "main", orderId, revision: rev, ...(retry ? { retry } : {}) } }, result }) as any;
const build = (r: any, reason: string, costCents = 0) => ({ id: `b-${r.id}`, ownerKey, kind: "build", status: "failed", key: `${r.id}.next`, payload: { previousJobId: r.id },
  result: { status: "failed", reason, costCents, evidence: { pipelineState: { rootJobId: r.id } } } }) as any;
const found = (paths: string[]) => ({ status: "completed", costCents: 4, evidence: { pipelineState: { finding: { kind: "bug", sourcePaths: paths } } } });

test("$0 build INPUT_TOO_LARGE / COUNT_INVALID stops are retryable within the max-2 bound; paid stops are not", () => {
  for (const reason of ["FACTORY_REMOTE_BUILD_FAILED:PROVIDER_INPUT_TOO_LARGE", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_COUNT_INVALID"]) {
    const r0 = root(0, "completed", found(["server/a.ts", "tests/a.test.ts"]));
    assert.equal(companyOrderRetryAttempt([r0, build(r0, reason)], ownerKey, orderId, rev), 1);
    assert.equal(companyOrderRetryAttempt([r0, build(r0, reason, 5)], ownerKey, orderId, rev), 0);
    const r2 = root(2, "completed", found(["tests/a.test.ts"]));
    assert.equal(companyOrderRetryAttempt([r2, build(r2, reason)], ownerKey, orderId, rev), FACTORY_ORDER_MAX_RETRIES);
  }
  // A paid discovery WITHOUT a persisted selection keeps the order settled.
  const r0 = root(0, "completed", { status: "completed", costCents: 4, evidence: { pipelineState: { finding: { kind: "bug" } } } });
  assert.equal(companyOrderRetryAttempt([r0, build(r0, "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_INPUT_TOO_LARGE")], ownerKey, orderId, rev), 0);
  assert.equal(isInfrastructureStop(root(1, "blocked", { status: "blocked", reason: "FACTORY_AUTO_SELECTION_ALREADY_EXECUTED", costCents: 0 })), true);
  assert.equal(isInfrastructureStop(build(r0, "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_OUTPUT_LIMIT")), false);
});

test("a retry reuses the persisted selection of the same order revision", () => {
  const r0 = root(0, "completed", found(["server/a.ts", "tests/a.test.ts"]));
  assert.deepEqual(previousCompanyOrderSelection([r0], ownerKey, orderId, rev), { kind: "bug", paths: ["server/a.ts", "tests/a.test.ts"] });
  assert.equal(previousCompanyOrderSelection([r0], ownerKey, orderId, "s".repeat(64)), undefined);
  assert.equal(previousCompanyOrderSelection([r0], "other", orderId, rev), undefined);
});
