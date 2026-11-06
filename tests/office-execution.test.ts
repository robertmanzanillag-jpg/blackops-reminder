import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createOfficeExecution } from "../server/office-execution";
import { createAgentCouncil, CouncilStateConflict } from "../server/agent-council";
import { emptyCouncilState } from "../shared/agent-council";
import { advanceCompany } from "../shared/agent-company";
import type { OfficeCloudRun } from "../server/office-cloud-store";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const role = "claude-reviewer";
function fixture() {
  const initial = emptyCouncilState();
  initial.company = advanceCompany(initial.company, { now: NOW - 86400001, roles: { [role]: "Reviewer" }, statuses: { [role]: { state: "working", label: "Observed result" } } }).state;
  initial.company.careers[role].reviewGuidance = ["Verify account ownership"];
  let raw = JSON.stringify(initial), revision = 0;
  const make = () => createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async () => {},
    versioned: { read: async () => ({ raw, revision }), write: async (next, expected) => { if (expected !== revision) throw new CouncilStateConflict(); raw = next; return ++revision; } },
    collect: async () => ({}), submitProposal: async () => "", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {},
  });
  const task = (): OfficeCloudRun => ({ id: randomUUID(), key: randomUUID(), kind: "claude_review", prUrl: "https://github.com/a/b/pull/1", status: "running", createdAt: new Date(NOW).toISOString(), fence: randomUUID(), leaseExpiresAt: new Date(NOW + 180000).toISOString() });
  return { make, task };
}
const env = { OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MODEL: "test-model", OPENAI_API_KEY: "test-only", OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: "100000" };

test("durable admission binds active guidance, accounts usage and confirms actual review across restart", async () => {
  const f = fixture(); const council = f.make(); let request: any;
  const diff = "+const safe = true;";
  const execution = createOfficeExecution(council, env, () => NOW, {
    loadPr: async prUrl => ({ prUrl, headSha: "a".repeat(40), diff, diffSha256: createHash("sha256").update(diff).digest("hex") }),
    fetch: (async (_url, options) => { request = JSON.parse(String(options?.body)); return new Response(JSON.stringify({ id: "resp_test", model: "test-model", status: "completed", usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ verdict: "pass", summary: "Reviewed", findings: [] }) }] }] })); }) as typeof fetch,
  });
  const task = f.task(); assert.equal(await execution.admission.ready(), true);
  assert.equal(await execution.admission.begin(task), true);
  const restarted = createOfficeExecution(f.make(), env, () => NOW);
  assert.equal(await restarted.admission.ready(), false);
  const output = await execution.execute({ ...task, status: "running" });
  assert.match(request.input, /Verify account ownership/);
  assert.equal(output.provider, "openai");
  await execution.admission.finish(task, { ...output, status: "completed" });
  const loaded = await f.make().load();
  assert.equal(loaded.officeExecution!.tokens.reservations[0].result!.usage.totalTokens, 30);
  assert.equal(loaded.officeExecution!.roles.roles[role].leases[0].status, "completed");
  assert.equal(await restarted.admission.ready(), true);
  assert.equal("officeExecution" in await council.view(), false);
});

test("actual invalid reviews retire depleted holder; infrastructure failure never deducts life", async () => {
  const f = fixture(); const council = f.make();
  await council.updateOfficeExecution((state, company) => { company.careers[role].battery = 10; return state; });
  let execution = createOfficeExecution(council, env, () => NOW);
  const blocked = f.task(); assert.equal(await execution.admission.begin(blocked), true);
  await execution.admission.finish(blocked, { status: "blocked", error: { code: "quota_or_rate_limit", reason: "Provider unavailable" } });
  assert.equal((await council.load()).company.careers[role].battery, 10);
  execution = createOfficeExecution(f.make(), env, () => NOW);
  const failed = f.task(); assert.equal(await execution.admission.begin(failed), true);
  await execution.admission.finish(failed, { status: "failed", error: { code: "INVALID_REVIEW", reason: "Invalid output" } });
  const result = await council.load();
  assert.equal(result.company.careers[role].generation, 2);
  assert.equal(result.officeExecution!.roles.roles[role].status, "vacant");
  assert.equal(await createOfficeExecution(f.make(), env, () => NOW).admission.ready(), false);
});

test("simultaneous workers serialize role admission and missing explicit budget fails closed", async () => {
  const f = fixture();
  const a = createOfficeExecution(f.make(), env, () => NOW), b = createOfficeExecution(f.make(), env, () => NOW);
  assert.deepEqual((await Promise.all([a.admission.begin(f.task()), b.admission.begin(f.task())])).sort(), [false, true]);
  assert.throws(() => createOfficeExecution(f.make(), { ...env, OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: undefined }), /explicit_token_limit/);
});
