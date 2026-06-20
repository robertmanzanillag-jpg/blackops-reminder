import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPER_AUTOPILOT_POLICY,
  buildCodexGitHubIssueTitle,
  buildCodexPrFirstBrief,
  buildCodexGitHubIssueBody,
  buildReadyForApprovalMessage,
  createDeveloperAutopilotHandoff,
  evaluateDeveloperReleaseGate,
  parseDeveloperAutopilotRequest,
} from "../server/developer-autopilot";

test("developer autopilot policy is PR-first and subscription-based", () => {
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.codexBillingMode, "chatgpt_subscription");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.claudeBillingMode, "signed_in_claude_subscription_or_claude_code");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.repoScope, "all_registered_github_projects");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.changeStrategy, "pull_request_first");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.secondReview, "claude_independent_review_before_app_qa");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.replitDeployment, "explicit_human_approval_required");
});

test("Codex brief blocks direct main commits, API spend, and Replit deploy while requiring Claude review", () => {
  const brief = buildCodexPrFirstBrief({
    source: "telegram",
    repoFullName: "robert/asistente",
    appName: "ASITENTE",
    kind: "security",
    severity: "critical",
    title: "Token leak report",
    description: "A user reported a possible token leak in logs.",
    evidence: ["screenshot provided privately"],
    productionUrl: "https://example.replit.app",
  });

  assert.match(brief, /ChatGPT\/Codex subscription/);
  assert.match(brief, /Claude as an independent signed-in reviewer/);
  assert.match(brief, /pull request first/);
  assert.match(brief, /do not commit directly to main/);
  assert.match(brief, /Codex PR -> Claude independent review -> App QA release gate/);
  assert.match(brief, /Do not deploy to Replit/);
  assert.match(brief, /Keep exploit details private or sanitized/);
  assert.match(brief, /Do not edit \.env, secrets, credentials/);
});

test("release gate requires all App QA subagents to pass and still blocks Replit deploy", () => {
  const gate = evaluateDeveloperReleaseGate(
    {
      failCount: 0,
      warnCount: 0,
      summary: "QA Agent no encontro bloqueos.",
      subAgents: [
        { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
        { id: "api-scout", name: "API Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
      ],
    },
    { prUrl: "https://github.com/robert/asistente/pull/12" },
  );

  assert.equal(gate.status, "pass");
  assert.equal(gate.canSendForApproval, true);
  assert.equal(gate.canDeployToReplit, false);
  assert.equal(gate.requiresHumanReplitApproval, true);
  assert.equal(gate.secondReviewRequired, true);
  assert.deepEqual(gate.requiredReviewers, ["codex", "claude", "app_qa"]);
  assert.equal(gate.prUrl, "https://github.com/robert/asistente/pull/12");
});

test("release gate blocks send approval until a PR URL exists", () => {
  const gate = evaluateDeveloperReleaseGate({
    failCount: 0,
    warnCount: 0,
    summary: "QA Agent no encontro bloqueos.",
    subAgents: [
      { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
    ],
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.canSendForApproval, false);
  assert.match(gate.reasons.join(" "), /pull request URL is required/);
});

test("release gate blocks warnings before Replit deployment", () => {
  const gate = evaluateDeveloperReleaseGate({
    failCount: 0,
    warnCount: 1,
    summary: "QA Agent dejo 1 aviso.",
    subAgents: [
      { id: "improvement-scout", name: "Improvement Scout", status: "warn", summary: "warning", checked: 1, findings: [] },
    ],
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.canSendForApproval, false);
  assert.match(gate.reasons.join(" "), /warning/);
  assert.match(gate.reasons.join(" "), /Improvement Scout=warn/);
});

test("ready message asks for explicit Replit approval", () => {
  const message = buildReadyForApprovalMessage({
    repoFullName: "robert/asistente",
    prUrl: "https://github.com/robert/asistente/pull/12",
    qaGate: {
      status: "pass",
      canSendForApproval: true,
      canDeployToReplit: false,
      requiresHumanReplitApproval: true,
      secondReviewRequired: true,
      requiredReviewers: ["codex", "claude", "app_qa"],
      reasons: ["ready"],
      qaSummary: "All App QA subagents passed.",
    },
    testsRun: ["npm run check", "npm run test:telegram"],
  });

  assert.match(message, /PR:/);
  assert.match(message, /No voy a montar en Replit/);
  assert.match(message, /apruebe explicitamente/);
});

test("developer autopilot detects developer bugs but ignores generic work requests", () => {
  assert.equal(parseDeveloperAutopilotRequest("revisa radio y dime slots vacios", "telegram"), null);
  const request = parseDeveloperAutopilotRequest("arregla este bug en robert/asistente y abre PR", "telegram");

  assert.equal(request?.kind, "bug");
  assert.equal(request?.repoFullName, "robert/asistente");
  assert.equal(request?.replitRequested, false);
});

test("developer autopilot does not treat affected URLs as explicit GitHub repos", async () => {
  const request = parseDeveloperAutopilotRequest("arregla bug en https://kong.example.com/api/login para Kong app", "telegram");
  assert.equal(request?.repoFullName, null);

  const created = await createDeveloperAutopilotHandoff(
    "user-1",
    "arregla bug en https://kong.example.com/api/login para Kong app",
    "telegram",
    {
      getAppProjects: async () => [{
        name: "Kong App",
        description: "Nightlife production app",
        githubRepo: "robert/kong-app",
        publicUrl: "https://kong.example.com",
        healthUrl: "https://kong.example.com/health",
      }],
      listRepositories: async () => [{
        full_name: "robert/kong-app",
        name: "kong-app",
        private: true,
      }],
      createIssue: async (owner, repo) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "kong-app");
        return { number: 8, html_url: "https://github.com/robert/kong-app/issues/8" };
      },
    },
  );

  assert.equal(created.status, "created");
  assert.equal(created.repoFullName, "robert/kong-app");
});

test("developer autopilot creates a GitHub handoff issue for the selected repo", async () => {
  const created = await createDeveloperAutopilotHandoff(
    "user-1",
    "arregla este error en robert/asistente, el login falla",
    "web_chat",
    {
      getAppProjects: async () => [{
        name: "ASITENTE",
        description: "CEO assistant",
        githubRepo: "robert/asistente",
        publicUrl: "https://example.com",
        healthUrl: "https://example.com/health",
      }],
      listRepositories: async () => [{
        full_name: "robert/asistente",
        name: "asistente",
        private: true,
        html_url: "https://github.com/robert/asistente",
      }],
      createIssue: async (owner, repo, title, body) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "asistente");
        assert.match(title, /\[Codex PR-first\]/);
        assert.match(body, /Do not deploy to Replit/);
        assert.match(body, /@codex review/);
        assert.match(body, /Claude independent review/);
        return { number: 7, html_url: "https://github.com/robert/asistente/issues/7" };
      },
    },
  );

  assert.equal(created.status, "created");
  assert.equal(created.repoFullName, "robert/asistente");
  assert.equal(created.issueNumber, 7);
  assert.match(created.message, /PR-first/);
  assert.match(created.message, /No voy a montar en Replit/);
});

test("public security handoff redacts sensitive issue details", () => {
  const title = buildCodexGitHubIssueTitle({
    source: "telegram",
    repoFullName: "robert/public-app",
    kind: "security",
    title: "security bypass at /private-admin-reset",
    description: "private route",
    severity: "high",
  }, {
    full_name: "robert/public-app",
    name: "public-app",
    private: false,
  });
  assert.match(title, /Security-sensitive fix request/);
  assert.doesNotMatch(title, /private-admin-reset/);

  const body = buildCodexGitHubIssueBody({
    source: "telegram",
    repoFullName: "robert/public-app",
    kind: "security",
    title: "leaked token",
    description: "token=sk-secret1234567890 email admin@example.com",
    severity: "high",
    evidence: ["password=hunter2"],
  }, {
    full_name: "robert/public-app",
    name: "public-app",
    private: false,
  });

  assert.match(body, /Security details withheld/);
  assert.doesNotMatch(body, /sk-secret/);
  assert.doesNotMatch(body, /hunter2/);
  assert.doesNotMatch(body, /admin@example.com/);
});
