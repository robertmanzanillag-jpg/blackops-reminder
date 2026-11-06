import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGitHubFactoryChecks, type FactoryActionsClient } from "../server/software-factory-actions";

function fixture() {
  const repository = "owner/repo", baseSha = "a".repeat(40), headSha = "b".repeat(40), patchSha256 = "c".repeat(64);
  const branch = `factory/${baseSha}-${patchSha256}`, workflow = Buffer.from("trusted workflow");
  const path = ".github/workflows/factory-candidate-checks.yml";
  const candidate = { repository, baseSha, headSha, patchSha256, branch };
  const project = { id: "test-project", repo: repository };
  const run = { id: 10, head_sha: headSha, head_branch: branch, event: "push", path, workflow_id: 3,
    run_attempt: 1, status: "completed", conclusion: "success" as string | null,
    html_url: `https://github.com/${repository}/actions/runs/10`,
    repository: { full_name: repository, private: false }, head_repository: { full_name: repository } };
  const job = { run_id: 10, head_sha: headSha, name: "isolated-checks", status: "completed", conclusion: "success",
    completed_at: "2026-11-06T10:00:00Z", labels: ["ubuntu-24.04"],
    steps: ["Isolated tests", "Isolated build", "Isolated browser recovery tests"].map(name => ({ name, status: "completed", conclusion: "success" })) };
  let privateRepo = false, changedWorkflow = false, calls = 0, waits = 0;
  const client: FactoryActionsClient = {
    repos: {
      get: async () => ({ data: { full_name: repository, private: privateRepo, archived: false, disabled: false } }),
      getContent: async () => ({ data: { type: "file", path, encoding: "base64", size: workflow.length,
        content: changedWorkflow ? Buffer.from("changed workflow").toString("base64") : workflow.toString("base64") } }),
    },
    actions: {
      listWorkflowRuns: async () => { calls++; return { data: { total_count: 1, workflow_runs: [run] } }; },
      listJobsForWorkflowRunAttempt: async input => { assert.equal(input.attempt_number, 1); return { data: { total_count: 1, jobs: [job] } }; },
    },
  };
  const checks = createGitHubFactoryChecks({ client, repositories: { [repository]: { workflowId: 3, workflowPath: path,
    workflowSha256: createHash("sha256").update(workflow).digest("hex"), jobName: job.name,
    testStep: "Isolated tests", buildStep: "Isolated build", browserStep: "Isolated browser recovery tests" } }, maxPolls: 2,
    now: () => new Date("2026-11-06T10:01:00Z"), wait: async () => { waits++; } });
  const verify = () => checks.verifyCandidate(project, candidate, { signal: new AbortController().signal, maxCostCents: 5 });
  return { checks, verify, run, job, client, candidate, project,
    private: () => { privateRepo = true; }, change: () => { changedWorkflow = true; }, counts: () => ({ calls, waits }) };
}
test("accepts only exact trusted completed tests and build, without requiring undocumented job attempt", async () => {
  const f = fixture(), result = await f.verify();
  assert.equal(result.status, "passed");
  if (result.status === "passed") {
    assert.equal(result.headSha, f.candidate.headSha);
    assert.deepEqual(result.artifactIds, [f.run.html_url]);
    assert.equal(result.createdAt, f.job.completed_at);
    assert.equal(result.costCents, 0);
  }
});
test("preflight blocks private repositories and altered workflow before polling", async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.private(), (f: ReturnType<typeof fixture>) => f.change()]) {
    const f = fixture(); mutate(f);
    assert.equal(await f.checks.preflight(f.project.repo, f.candidate.baseSha, new AbortController().signal), false);
    assert.equal((await f.verify()).status, "unknown"); assert.equal(f.counts().calls, 0);
  }
});
test("wrong revision, branch, repository, workflow and reruns cannot satisfy gate", async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.run.head_sha = "d".repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.run.head_branch = "main"; },
    (f: ReturnType<typeof fixture>) => { f.run.repository.full_name = "other/repo"; },
    (f: ReturnType<typeof fixture>) => { f.run.workflow_id++; },
    (f: ReturnType<typeof fixture>) => { f.run.run_attempt++; },
    (f: ReturnType<typeof fixture>) => { f.run.event = "pull_request"; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal((await f.verify()).status, "unknown"); }
});
test("skipped tests, missing build, wrong runner and stale evidence never pass", async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.job.steps[0].conclusion = "skipped"; },
    (f: ReturnType<typeof fixture>) => { f.job.steps.pop(); },
    (f: ReturnType<typeof fixture>) => { f.job.labels = ["self-hosted"]; },
    (f: ReturnType<typeof fixture>) => { f.job.completed_at = "2025-01-01T00:00:00Z"; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.equal((await f.verify()).status, "unknown"); }
});
test("only a confirmed terminal failure settles; cancellation and incomplete failure remain unknown", async () => {
  const known = fixture(); known.run.conclusion = known.job.conclusion = "failure";
  assert.equal((await known.verify()).status, "failed");
  for (const conclusion of [null, "cancelled", "timed_out"]) {
    const f = fixture(); f.run.conclusion = conclusion;
    assert.equal((await f.verify()).status, "unknown");
  }
  const incomplete = fixture(); incomplete.run.conclusion = "failure";
  assert.equal((await incomplete.verify()).status, "unknown");
});
test("pending run is bounded and cannot fabricate successful evidence", async () => {
  const f = fixture(); f.run.status = "in_progress"; f.run.conclusion = null;
  assert.equal((await f.verify()).status, "unknown");
  assert.deepEqual(f.counts(), { calls: 2, waits: 1 });
});


test("missing, skipped or duplicate browser recovery step blocks even a successful job", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.job.steps.pop(); },
    (f: ReturnType<typeof fixture>) => { f.job.steps[2].conclusion = "skipped"; },
    (f: ReturnType<typeof fixture>) => { f.job.steps.push({ ...f.job.steps[2] }); },
  ]) {
    const f = fixture(); change(f);
    assert.equal((await f.verify()).status, "unknown");
  }
});
