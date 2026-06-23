import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const queuePath = path.join(rootDir, "scheduled", "metricool-execution-queue.json");
const queueMarkdownPath = path.join(rootDir, "scheduled", "metricool-execution-queue.md");
const queueCsvPath = path.join(rootDir, "scheduled", "metricool-execution-queue.csv");

const sliceRequired = (content: string, startNeedle: string, endNeedle: string) => {
  const start = content.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing start marker: ${startNeedle}`);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing end marker after ${startNeedle}: ${endNeedle}`);
  return content.slice(start, end);
};

test("owned source rights dry-run feeds Metricool source readiness sync without fake readiness", async () => {
  const originalQueue = await readFile(queuePath, "utf8").catch(() => null);
  const originalMarkdown = await readFile(queueMarkdownPath, "utf8").catch(() => null);
  const originalCsv = await readFile(queueCsvPath, "utf8").catch(() => null);

  try {
    const dryRun = spawnSync(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const audit = JSON.parse(dryRun.stdout);
    assert.equal(audit.realPublishEnabled, false);
    assert.equal(audit.publishMode, "approval_required");
    assert.equal(audit.rightsReady, audit.byCategory.sports.rightsReady + audit.byCategory.memes.rightsReady + audit.byCategory.streamers.rightsReady);
    assert.equal(audit.evidenceProblems, 0);
    assert.equal(audit.registrationPending, 0);

    const sync = spawnSync(process.execPath, ["script/clippers-sync-metricool-source-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    const synced = JSON.parse(sync.stdout);
    assert.equal(synced.realPublishEnabled, false);
    assert.equal(synced.publishMode, "approval_required");
    assert.equal(synced.localOwnedSourceTotals.total, audit.rightsReady);

    const queue = JSON.parse(await readFile(queuePath, "utf8"));
    assert.equal(queue.realPublishEnabled, false);
    assert.equal(queue.publishMode, "approval_required");
    assert.equal(queue.totals.readyToSend, 0);
    assert.equal(queue.sourceReadiness.localOwnedSourceTotals.total, audit.rightsReady);
    assert.equal(
      queue.sourceReadiness.totals.rightsReadyAssets,
      queue.sourceReadiness.categories.reduce((sum, category) => sum + category.rightsReadyAssets, 0),
    );
    assert.ok(queue.items.every((item) =>
      item.approvalRequired === true && item.canSendNow === false && item.status !== "ready_to_send"
    ));
  } finally {
    if (originalQueue !== null) await writeFile(queuePath, originalQueue);
    else await unlink(queuePath).catch(() => undefined);
    if (originalMarkdown !== null) await writeFile(queueMarkdownPath, originalMarkdown);
    else await unlink(queueMarkdownPath).catch(() => undefined);
    if (originalCsv !== null) await writeFile(queueCsvPath, originalCsv);
    else await unlink(queueCsvPath).catch(() => undefined);
  }
});

test("account permission readiness reports Metricool MVP without claiming direct API approval", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "metricool_mvp_ready");
  assert.equal(output.verifiedAccounts, 2);
  assert.equal(output.accountProfiles, 9);
  assert.equal(output.metricoolReadyLanes, 2);
  assert.equal(output.directApiReadyLanes, 0);
  assert.equal(output.connectedMetricoolRightsReadyAssets, 77);
  assert.equal(output.localOwnedSourceAssets, 100);

  const readiness = JSON.parse(await readFile(path.join(rootDir, "account-permission-readiness.json"), "utf8"));
  assert.equal(readiness.totals.developerAppsApproved, 0);
  assert.equal(readiness.totals.permissionGroupsApproved, 0);
  assert.ok(readiness.accountRows.some((row) =>
    row.accountId === "sports-daily"
    && row.platform === "tiktok"
    && row.readyForMetricoolApproval === true
    && row.directApiReady === false
  ));
  assert.ok(readiness.accountRows.some((row) =>
    row.accountId === "streamer-pulse"
    && row.platform === "tiktok"
    && row.accountStatus !== "verified"
    && row.readyForMetricoolApproval === false
  ));
});

test("operational readiness keeps MVP separate from full external readiness", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.metricoolMvpReady, true);
  assert.equal(output.fullDirectApiReady, false);
  assert.equal(output.readyToSend, 0);
  assert.ok(output.blockers > 0);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-operational-readiness.json"), "utf8"));
  assert.equal(report.metricool.realPublishEnabled, false);
  assert.equal(report.metricool.publishMode, "approval_required");
  assert.equal(report.metricool.readyToSend, 0);
  assert.equal(report.accounts.directApiReadyLanes, 0);
  assert.ok(report.blockers.some((blocker) => blocker.includes("direct API publishing remains blocked")));
});

test("external closeout pack lists remaining account developer and permission actions", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_external_actions");
  assert.equal(output.accounts, 7);
  assert.equal(output.developerApps, 3);
  assert.equal(output.permissions, 6);
  assert.equal(output.tasks, 16);

  const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.json"), "utf8"));
  assert.equal(pack.metricool.readyToSend, 0);
  assert.equal(pack.metricool.publishMode, "approval_required");
  assert.ok(!pack.blockers.some((blocker) => blocker.includes("Local app is not listening")));
  assert.ok(pack.tasks.some((task) => task.id === "account:streamer-pulse:tiktok" && task.priority === "critical"));
  assert.ok(pack.tasks.some((task) => task.id === "developer_app:tiktok" && task.missingEnvVars.includes("TIKTOK_CLIENT_KEY")));
  assert.ok(pack.tasks.some((task) => task.id === "permission:tiktok:video.publish"));

  const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
  assert.match(evidenceCsv, /kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes/);
  assert.match(evidenceCsv, /permission.*video\.publish/);

  const source = await readFile(path.join(process.cwd(), "script/clippers-external-closeout-pack.mjs"), "utf8");
  assert.match(source, /const blocked = tasks\.length > 0 \|\| safeOperationalBlockers\.length > 0/);
  assert.match(source, /status: blocked \? "blocked_external_actions" : "ready_for_final_review"/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/preview-external-closeout-evidence-import/);
  assert.match(routes, /\/api\/clippers\/apply-external-closeout-evidence-import/);

  const ui = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(ui, /data-testid="clippers-external-closeout-evidence-import"/);
  assert.match(ui, /data-testid="preview-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="apply-clippers-external-closeout-evidence-import-button"/);
});

test("external closeout evidence importer rejects placeholders without applying", async () => {
  const packResult = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(packResult.status, 0, packResult.stderr || packResult.stdout);

  const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_invalid_evidence");
  assert.equal(output.applied, 0);
  assert.ok(output.rejected > 0);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
  assert.equal(report.mode, "preview");
  assert.ok(report.rejected.some((row) => row.reason.includes("Falta proof real") || row.reason.includes("Status ambiguo")));
});

test("external closeout evidence importer previews clean rows for strict apply", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const cleanCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,https://www.youtube.com/create_channel,,https://proof.example.com/meme-radar-youtube,YouTube channel verified with manager proof and 2FA evidence stored outside repo",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://proof.example.com/youtube-app-review,YouTube app review submitted with ticket YT-123 and no secrets stored",
    "permission,,tiktok,requested,video.publish,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://proof.example.com/tiktok-video-publish,TikTok video.publish scope requested with reviewer note for owned clips approval queue",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, cleanCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "ready_to_apply");
    assert.equal(output.accepted, 3);
    assert.equal(output.rejected, 0);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.equal(report.nextStep.includes("--apply"), true);
    assert.equal(JSON.stringify(report).includes("client_secret"), false);
    assert.equal(JSON.stringify(report).includes("access_token"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects secrets in persisted fields", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,youtube,submitted,," +
      "sk-secret-test-value,https://app.clipprreview.com?api_key=unsafe," +
      "https://app.clipprreview.com/api/clippers/oauth/youtube/callback," +
      "https://console.cloud.google.com/apis/library/youtube.googleapis.com,," +
      "https://proof.example.com/youtube-app-review," +
      "YouTube app review submitted with normal portal proof",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 1);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.equal(JSON.stringify(report).includes("sk-secret-test-value"), false);
    assert.equal(JSON.stringify(report).includes("api_key=unsafe"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("rights registration rejects unsafe Metricool queue state", async () => {
  const originalQueue = await readFile(queuePath, "utf8");
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = false;
    queue.totals = { ...(queue.totals || {}), readyToSend: 1 };
    queue.items = [{ id: "unsafe-test-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /publishMode is not explicitly approval_required|readyToSend items|can send now/);
  } finally {
    await writeFile(queuePath, originalQueue);
  }
});

test("account permission readiness rejects unsafe Metricool queue state", async () => {
  const originalQueue = await readFile(queuePath, "utf8");
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = false;
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 1 };
    queue.items = [{ id: "unsafe-test-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.metricoolReadyLanes, 0);

    const readiness = JSON.parse(await readFile(accountPath, "utf8"));
    assert.equal(readiness.sourceReadiness.guardSafe, false);
    assert.ok(readiness.sourceReadiness.blockers.some((blocker) => blocker.includes("publishMode") || blocker.includes("readyToSend") || blocker.includes("can send now")));
  } finally {
    await writeFile(queuePath, originalQueue);
    if (originalAccount !== null) await writeFile(accountPath, originalAccount);
  }
});

test("operational readiness rejects stale account readiness when source readiness is blocked", async () => {
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8");
  const originalQueue = await readFile(queuePath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.sourceReadiness = {
      ...(queue.sourceReadiness || {}),
      status: "blocked",
      totals: { ...(queue.sourceReadiness?.totals || {}), rightsReadyAssets: 0 },
      categories: [],
    };
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 0 };
    queue.status = "approval_required";
    queue.publishMode = "approval_required";
    queue.realPublishEnabled = false;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.metricoolMvpReady, false);
    assert.equal(output.fullDirectApiReady, false);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.sources.sourceReadinessReady, false);
    assert.ok(report.blockers.some((blocker) => blocker.includes("source readiness")));
  } finally {
    await writeFile(accountPath, originalAccount);
    await writeFile(queuePath, originalQueue);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("operational readiness refreshes stale account permission readiness before reporting", async () => {
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    await writeFile(accountPath, JSON.stringify({
      status: "metricool_mvp_ready",
      totals: {
        accountProfiles: 9,
        verifiedAccounts: 9,
        metricoolReadyLanes: 9,
        directApiReadyLanes: 9,
        developerApps: 3,
        developerAppsApproved: 3,
        permissionGroups: 3,
        permissionGroupsApproved: 3,
      },
      sourceReadiness: {
        localOwnedSourceAssets: 999,
        connectedMetricoolRightsReadyAssets: 999,
        realPublishEnabled: false,
        publishMode: "approval_required",
      },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.accounts.directApiReadyLanes, 0);
    assert.equal(report.fullDirectApiReady, false);
    assert.notEqual(report.accounts.verified, 9);
  } finally {
    await writeFile(accountPath, originalAccount);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("Clippers UI refreshes account permission readiness after evidence activation refresh", async () => {
  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.ok(page.includes("interface ClipperOperationalReadinessSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutPackSummary"));
  assert.ok(page.includes('queryKey: ["/api/clippers/operational-readiness"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-pack"]'));
  assert.ok(page.includes('fetch("/api/clippers/prepare-operational-readiness", { method: "POST" })'));
  assert.ok(page.includes('fetch("/api/clippers/prepare-external-closeout-pack", { method: "POST" })'));
  assert.ok(page.includes('data-testid="clippers-operational-readiness"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-pack"'));
  assert.ok(page.includes('data-testid="prepare-clippers-external-closeout-pack-button"'));
  assert.ok(page.includes("Operational Readiness"));
  assert.ok(page.includes("External Closeout Pack"));
  assert.ok(page.includes("more external actions in"));
  assert.ok(page.includes("Full Direct API"));
  assert.ok(page.includes("Auto-send"));
  assert.ok(page.includes("more blockers in"));
  const accountRowsBlock = sliceRequired(
    page,
    "accountPermissionReadiness.accountRows.map((row) =>",
    "Permission gates",
  );
  assert.ok(accountRowsBlock.includes("row.blockers.slice(0, 3)"));
  assert.ok(accountRowsBlock.includes("more account blockers in"));

  const readinessHelperBlock = sliceRequired(
    page,
    "const refreshAccountPermissionReadinessCache = async () =>",
    "const refreshPostConnectActivationState = async",
  );
  assert.ok(readinessHelperBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], readinessData.accountPermissionReadiness)'));

  const activationRefreshBlock = sliceRequired(
    page,
    "const refreshPostConnectActivationState = async",
    "const refreshSourceRunwayState = async",
  );
  assert.ok(activationRefreshBlock.includes("await refreshAccountPermissionReadinessCache()"));
  assert.ok(activationRefreshBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));
  assert.ok(activationRefreshBlock.includes("Readiness pendiente"));

  const credentialRefreshBlock = sliceRequired(
    page,
    "const refreshCredentialOauthRunwayState = async",
    "const runMutation = useMutation",
  );
  assert.ok(credentialRefreshBlock.includes("await refreshAccountPermissionReadinessCache()"));
  assert.ok(credentialRefreshBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));
  assert.ok(credentialRefreshBlock.includes("Readiness pendiente"));

  const postConnectMutationBlock = sliceRequired(
    page,
    "const postConnectActivationSweepMutation = useMutation",
    "const intakeRefreshSweepMutation = useMutation",
  );
  assert.ok(postConnectMutationBlock.includes("void refreshAccountPermissionReadinessCache().catch"));
  assert.ok(postConnectMutationBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.ok(routes.includes('runClipperJsonScript("script/clippers-operational-readiness.mjs", "Operational readiness")'));
  assert.ok(routes.includes('runClipperJsonScript("script/clippers-external-closeout-pack.mjs", "External closeout pack")'));
  assert.ok(routes.includes('app.get("/api/clippers/operational-readiness"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-operational-readiness"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-pack"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-external-closeout-pack"'));
  const activationRouteBlock = sliceRequired(
    routes,
    'app.post("/api/clippers/run-post-connect-activation-sweep"',
    'app.post("/api/clippers/run-intake-refresh-sweep"',
  );
  assert.ok(activationRouteBlock.includes("status: result.status"));
});
