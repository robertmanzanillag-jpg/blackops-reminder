import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import test from "node:test";
import { registerRoutes } from "../server/routes";

const scriptPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-operating-refresh.ts");
const queuePaths = [
  path.join(process.cwd(), "clippers_workspace/scheduled/metricool-execution-queue.json"),
  path.join(process.cwd(), "clippers_workspace/scheduled/metricool-execution-queue.md"),
  path.join(process.cwd(), "clippers_workspace/scheduled/metricool-execution-queue.csv"),
];

async function readQueueSnapshot() {
  return Object.fromEntries(await Promise.all(queuePaths.map(async (filePath) => [
    filePath,
    await readFile(filePath, "utf8").catch(() => null),
  ])));
}

test("TikTok MVP operating refresh is wired to regenerate pipeline without external actions", async () => {
  const syntax = spawnSync(process.execPath, ["--import", "tsx", "--check", scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /prepareClipperSourceScout/);
  assert.match(source, /prepareClipperSourceScoutPermissionPack/);
  assert.match(source, /prepareClipperSourceScoutSourceFileKit/);
  assert.match(source, /prepareClipperWeeklyProductionFunnel/);
  assert.match(source, /prepareClipperSourceScoutDailySprint/);
  assert.match(source, /clippers-tiktok-mvp-autopilot-boundary\.mjs/);
  assert.match(source, /preservedQueuePaths/);
  assert.match(source, /snapshotFiles/);
  assert.match(source, /restoreFiles\(queueSnapshot\)/);
  assert.match(source, /statusFromBlockers\(blockers\)/);
  assert.match(source, /blocked_external_account_proof/);
  assert.match(source, /blocked_before_metricool/);
  assert.match(source, /targetWeeklyClips \|\| 100/);
  assert.match(source, /Operating refresh does not create external TikTok or Metricool accounts/);
  assert.match(source, /Operating refresh does not invent account ownership/);
  assert.match(source, /Operating refresh does not apply evidence, schedule posts, publish/);
  assert.match(source, /Operating refresh preserves the existing Metricool execution queue/);
  assert.match(source, /realPublishEnabled:\s*false/);
  assert.match(source, /directSocialApisRequired:\s*false/);
  assert.match(source, /codexCanCreateExternalAccounts:\s*false/);
  assert.match(source, /codexCanInventPermissions:\s*false/);
  assert.doesNotMatch(source, /--apply|video\.publish|ready_to_send|realPublishEnabled:\s*true|access_token=|refresh_token=|client_secret=/i);
});

test("TikTok MVP operating refresh blocks every non-ready boundary status", async () => {
  const { collectBoundaryBlockers, statusFromBlockers } = await import(pathToFileURL(scriptPath).href);
  const blockers = collectBoundaryBlockers(
    { ok: true },
    {
      status: "needs_internal_followup",
      launchDecision: "blocked_internal_followup",
      totals: { minimumProofUrlsNeeded: 0 },
    },
  );
  assert.ok(blockers.some((item) => item.includes("needs_internal_followup")));
  assert.ok(blockers.some((item) => item.includes("blocked_internal_followup")));
  assert.equal(statusFromBlockers(blockers), "blocked_external_account_proof");

  const missingBoundaryBlockers = collectBoundaryBlockers({ ok: true }, {});
  assert.ok(missingBoundaryBlockers.some((item) => item.includes("status is missing")));
  assert.ok(missingBoundaryBlockers.some((item) => item.includes("launch decision is missing")));
  assert.equal(statusFromBlockers(missingBoundaryBlockers), "blocked_external_account_proof");

  const readyBlockers = collectBoundaryBlockers(
    { ok: true },
    {
      status: "ready_for_operator_apply_review",
      launchDecision: "ready_for_metricool_approval_review",
      totals: { minimumProofUrlsNeeded: 0 },
    },
  );
  assert.deepEqual(readyBlockers, []);
  assert.equal(statusFromBlockers(readyBlockers), "ready_for_metricool_approval_review");
});

test("TikTok MVP operating refresh preserves Metricool queue artifacts byte for byte", async () => {
  const before = await readQueueSnapshot();
  const run = spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const after = await readQueueSnapshot();

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(after, before);

  const output = JSON.parse(run.stdout);
  assert.equal(output.status, "blocked_external_account_proof");
  assert.equal(output.launchDecision, "blocked_before_metricool");
});

test("TikTok MVP operating refresh POST route refreshes status without changing Metricool queue", async () => {
  const before = await readQueueSnapshot();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const httpServer = createServer(app);
  let listening = false;
  try {
    await registerRoutes(httpServer, app);
    await new Promise((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    listening = true;
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/clippers/prepare-tiktok-mvp-operating-refresh`, {
      method: "POST",
    });
    const body = await response.json();
    const after = await readQueueSnapshot();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.tiktokMvpOperatingRefresh.status, "blocked_external_account_proof");
    assert.equal(body.tiktokMvpOperatingRefresh.launchDecision, "blocked_before_metricool");
    assert.equal(body.tiktokMvpOperatingRefresh.realPublishEnabled, false);
    assert.equal(body.tiktokMvpOperatingRefresh.directSocialApisRequired, false);
    assert.equal(body.tiktokMvpOperatingRefresh.codexCanCreateExternalAccounts, false);
    assert.equal(body.tiktokMvpOperatingRefresh.codexCanInventPermissions, false);
    assert.equal(body.tiktokMvpAutopilotBoundary.status, "blocked_external_account_proof");
    assert.equal(body.tiktokNextAction?.realPublishEnabled ?? false, false);
    assert.deepEqual(after, before);
  } finally {
    if (listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
      });
    }
  }
});
