import assert from "node:assert/strict";
import test from "node:test";
import type { AppErrorEvent, AppHealthCheck, AppIncident, AppProject } from "@shared/schema";
import { __appQaAgentInternals, analyzeAppTelemetry, analyzeImprovementIdeas } from "../server/app-qa-agent";

function appProject(overrides: Partial<AppProject> = {}): AppProject {
  return {
    id: "app-1",
    userId: "user-1",
    name: "Kong Nightlife",
    slug: "kong-nightlife",
    description: "Nightlife production app",
    environment: "production",
    publicUrl: "https://kong.example",
    healthUrl: "https://kong.example/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "kong-nightlife",
    githubRepo: "robertmanzanillag-jpg/kong-nightlife",
    deploymentProvider: "replit",
    deploymentId: null,
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    status: "healthy",
    priority: "high",
    ownerLabel: "Robert",
    tags: null,
    lastSeenAt: null,
    createdAt: new Date("2026-06-18T12:00:00.000Z"),
    updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    ...overrides,
  };
}

test("route scout keeps a map of pages and expected clicks", () => {
  const report = __appQaAgentInternals.analyzeRoutes();

  assert.equal(report.status, "pass");
  assert.ok(report.checked >= 10);
  assert.equal(
    __appQaAgentInternals.LOCAL_ROUTE_MAP.some((route) => route.path === "/agents-office" && route.expectedClicks.length > 0),
    true,
  );
});

test("improvement scout flags important production apps without health endpoints", () => {
  const report = analyzeImprovementIdeas([appProject({ healthUrl: null })]);

  assert.equal(report.findings.some((finding) => finding.title === "Agregar health endpoint"), true);
  assert.equal(report.findings.some((finding) => finding.sourceAgent === "improvement-scout"), true);
});

test("error scout turns failed checks and incidents into actionable findings", () => {
  const app = appProject();
  const now = new Date("2026-06-18T12:00:00.000Z");
  const healthCheck = {
    id: "check-1",
    appProjectId: app.id,
    checkType: "health_endpoint",
    status: "failed",
    responseTimeMs: 900,
    statusCode: 500,
    checkedUrl: app.healthUrl,
    errorMessage: "Internal error",
    metadata: null,
    checkedAt: now,
  } satisfies AppHealthCheck;
  const incident = {
    id: "incident-1",
    appProjectId: app.id,
    source: "api",
    severity: "critical",
    status: "open",
    title: "Checkout broken",
    summary: "Users cannot complete checkout.",
    fingerprint: "checkout-broken",
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    durationSeconds: null,
    relatedErrorEventId: null,
    relatedPendingActionId: null,
    relatedPrUrl: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  } satisfies AppIncident;
  const errorEvent = {
    id: "error-1",
    appProjectId: app.id,
    incidentId: incident.id,
    source: "failed_api",
    level: "fatal",
    eventKey: "checkout-500",
    fingerprint: "checkout-500",
    title: "Checkout API 500",
    message: "POST /api/checkout failed",
    stacktrace: null,
    requestMethod: "POST",
    requestPath: "/api/checkout",
    statusCode: 500,
    userImpact: "Checkout blocked",
    count: 2,
    firstSeenAt: now,
    lastSeenAt: now,
    metadata: null,
    createdAt: now,
  } satisfies AppErrorEvent;

  const report = analyzeAppTelemetry([{ app, healthChecks: [healthCheck], incidents: [incident], errors: [errorEvent] }]);

  assert.equal(report.status, "fail");
  assert.equal(report.findings.some((finding) => finding.title === "Health check fallando"), true);
  assert.equal(report.findings.some((finding) => finding.severity === "critical"), true);
});

test("telegram report summarizes high priority QA failures first", () => {
  const app = appProject();
  const report = analyzeAppTelemetry([{
    app,
    healthChecks: [{
      id: "check-1",
      appProjectId: app.id,
      checkType: "health_endpoint",
      status: "failed",
      responseTimeMs: 500,
      statusCode: 500,
      checkedUrl: app.healthUrl,
      errorMessage: "Internal error",
      metadata: null,
      checkedAt: new Date("2026-06-18T12:00:00.000Z"),
    }],
    incidents: [],
    errors: [],
  }]);
  const scan = {
    scannedAt: "2026-06-18T12:00:00.000Z",
    totalApps: 1,
    totalGithubRepos: 1,
    totalGithubAppRepos: 1,
    githubConnected: true,
    githubError: null,
    totalRoutes: 17,
    totalChecks: 1,
    failCount: 1,
    warnCount: 0,
    telegramSent: false,
    dailyDigestSent: false,
    summary: "QA Agent encontro 1 bloqueos altos y 0 avisos.",
    council: __appQaAgentInternals.buildQaCouncil({
      subAgents: [report],
      findings: report.findings,
      githubConnected: true,
      githubApps: [],
      failCount: 1,
      warnCount: 0,
    }),
    subAgents: [report],
    routeMap: [],
    visualScans: [],
    githubApps: [],
    findings: report.findings,
    improvementIdeas: [],
  };

  const message = __appQaAgentInternals.formatTelegramReport(scan);

  assert.match(message, /App QA Agent/);
  assert.match(message, /Fallos principales/);
  assert.match(message, /Health check fallando/);
  assert.match(message, /Repos GitHub: 1/);
  assert.match(message, /Fallos altos\/criticos: 1/);
});

test("daily digest summarizes council status and new GitHub app repos", () => {
  const report = __appQaAgentInternals.analyzeRoutes();
  const githubApp = {
    id: 42,
    name: "new-customer-app",
    fullName: "robert/new-customer-app",
    htmlUrl: "https://github.com/robert/new-customer-app",
    homepage: null,
    language: "TypeScript",
    private: true,
    archived: false,
    disabled: false,
    fork: false,
    updatedAt: "2026-06-18T12:00:00.000Z",
    pushedAt: "2026-06-18T12:00:00.000Z",
    openIssuesCount: 0,
    connectedToInventory: false,
    checkedUrl: null,
    status: "warn" as const,
    notes: ["Nuevo/fuera de Developer Health"],
  };
  const council = __appQaAgentInternals.buildQaCouncil({
    subAgents: [report],
    findings: [],
    githubConnected: true,
    githubApps: [githubApp],
    failCount: 0,
    warnCount: 1,
  });
  const scan = {
    scannedAt: "2026-06-18T12:00:00.000Z",
    totalApps: 1,
    totalGithubRepos: 4,
    totalGithubAppRepos: 1,
    githubConnected: true,
    githubError: null,
    totalRoutes: 17,
    totalChecks: 17,
    failCount: 0,
    warnCount: 1,
    telegramSent: false,
    dailyDigestSent: false,
    summary: "QA Agent no vio bloqueos altos, pero dejo 1 mejoras/avisos.",
    council,
    subAgents: [report],
    routeMap: [],
    visualScans: [],
    githubApps: [githubApp],
    findings: [],
    improvementIdeas: [],
  };

  const digest = __appQaAgentInternals.formatDailyDigest(scan);

  assert.match(digest, /App QA Daily Digest/);
  assert.match(digest, /Repos nuevos\/fuera inventario: 1/);
  assert.match(digest, /QA Council/);
});

test("github scout finds new app repos that are not yet in Developer Health", async () => {
  const repo = {
    id: 42,
    name: "new-customer-app",
    full_name: "robert/new-customer-app",
    description: "Customer dashboard app",
    private: true,
    archived: false,
    disabled: false,
    fork: false,
    html_url: "https://github.com/robert/new-customer-app",
    homepage: null,
    default_branch: "main",
    updated_at: "2026-06-18T12:00:00.000Z",
    pushed_at: "2026-06-18T12:00:00.000Z",
    open_issues_count: 0,
    language: "TypeScript",
  } as any;

  assert.equal(__appQaAgentInternals.isLikelyGithubAppRepo(repo), true);

  const report = await __appQaAgentInternals.analyzeGithubAppRepos([], [repo]);

  assert.equal(report.githubApps.length, 1);
  assert.equal(report.githubApps[0].connectedToInventory, false);
  assert.equal(report.findings.some((finding) => finding.title === "Repo app fuera del inventario"), true);
  assert.equal(report.findings.some((finding) => finding.title === "Repo app sin URL publica en GitHub"), true);
});

test("visual click scout reports setup guidance when base URL is missing", async () => {
  const previousBaseUrl = process.env.APP_QA_BASE_URL;
  const previousPublicUrl = process.env.PUBLIC_APP_URL;
  delete process.env.APP_QA_BASE_URL;
  delete process.env.PUBLIC_APP_URL;

  try {
    const report = await __appQaAgentInternals.runVisualClickScout();

    assert.equal(report.status, "fail");
    assert.equal(report.findings.some((finding) => finding.title === "APP_QA_BASE_URL no configurado"), true);
  } finally {
    if (previousBaseUrl) process.env.APP_QA_BASE_URL = previousBaseUrl;
    if (previousPublicUrl) process.env.PUBLIC_APP_URL = previousPublicUrl;
  }
});

test("visual click scout stays in low-cost daily mode during lightweight scans", () => {
  const previousMode = process.env.APP_QA_VISUAL_MODE;
  const previousHours = process.env.APP_QA_VISUAL_HOURS;
  process.env.APP_QA_VISUAL_MODE = "daily";
  process.env.APP_QA_VISUAL_HOURS = "8,20";

  try {
    const runNow = __appQaAgentInternals.shouldRunVisualScout({
      userId: "user-visual-low-cost",
      notify: false,
      allowDailyDigest: false,
      now: new Date("2026-06-18T12:00:00.000Z"),
    });
    const runManual = __appQaAgentInternals.shouldRunVisualScout({
      userId: "user-visual-low-cost",
      notify: true,
      allowDailyDigest: false,
      now: new Date("2026-06-18T12:00:00.000Z"),
    });
    const runMorningDeep = __appQaAgentInternals.shouldRunVisualScout({
      userId: "user-visual-low-cost-morning",
      notify: false,
      allowDailyDigest: true,
      now: new Date("2026-06-18T12:00:00.000Z"),
    });
    const skipMorningRepeat = __appQaAgentInternals.shouldRunVisualScout({
      userId: "user-visual-low-cost-morning",
      notify: false,
      allowDailyDigest: true,
      now: new Date("2026-06-18T12:30:00.000Z"),
    });
    const runEveningDeep = __appQaAgentInternals.shouldRunVisualScout({
      userId: "user-visual-low-cost-morning",
      notify: false,
      allowDailyDigest: true,
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    assert.equal(runNow, false);
    assert.equal(runManual, true);
    assert.equal(runMorningDeep, true);
    assert.equal(skipMorningRepeat, false);
    assert.equal(runEveningDeep, true);
  } finally {
    if (previousMode) {
      process.env.APP_QA_VISUAL_MODE = previousMode;
    } else {
      delete process.env.APP_QA_VISUAL_MODE;
    }
    if (previousHours) {
      process.env.APP_QA_VISUAL_HOURS = previousHours;
    } else {
      delete process.env.APP_QA_VISUAL_HOURS;
    }
  }
});

test("storage unavailable result blocks release without throwing", () => {
  const result = __appQaAgentInternals.buildAppQaStorageUnavailableResult(
    new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    new Date("2026-06-19T07:30:00.000Z"),
  );

  assert.equal(result.council.status, "fail");
  assert.equal(result.githubConnected, false);
  assert.equal(result.githubError, "App QA storage unavailable");
  assert.ok(result.failCount >= 1);
  assert.equal(result.subAgents.some((agent) => agent.id === "api-scout" && agent.status === "fail"), true);
  assert.match(result.summary, /bloqueo release/);
});

test("storage unavailable result keeps useful AggregateError details", () => {
  const result = __appQaAgentInternals.buildAppQaStorageUnavailableResult(
    new AggregateError([new Error("connect ECONNREFUSED ::1:5432"), new Error("connect ECONNREFUSED 127.0.0.1:5432")]),
    new Date("2026-06-19T07:31:00.000Z"),
  );

  assert.match(result.summary, /ECONNREFUSED/);
  assert.match(result.findings[0].detail, /127\.0\.0\.1:5432/);
});
