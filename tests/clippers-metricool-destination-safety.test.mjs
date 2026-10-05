import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runMetricoolAutopilot, validateAutopilotItem } from "../script/clippers-metricool-autopilot.mjs";

const env = {
  CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
  METRICOOL_USER_TOKEN: "test-token",
  METRICOOL_USER_ID: "test-user",
  CLIPPERS_METRICOOL_BLOG_ID: "6431687",
  CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa",
};
const item = {
  campaignId: "approved-campaign",
  draftFile: "drafts/approved-clip.mp4",
  account: "streamersclipusa",
  platform: "tiktok",
  blogId: 6431687,
  caption: "Approved caption",
  mediaUrl: "https://media.example.org/approved-clip.mp4",
  status: "ready_for_metricool_autopilot",
  publishAllowed: true,
};
const mediaReceipt = {
  campaignId: item.campaignId,
  draftFile: item.draftFile,
  fileId: "verified-media-file",
  mediaUrl: item.mediaUrl,
  sha256: "a".repeat(64),
};

async function withWorkspace(run) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-destination-safety-"));
  try {
    return await run((options = {}) => runMetricoolAutopilot({
      env,
      workspaceRoot,
      queue: { targetDailyClips: 5, items: [item] },
      ledger: [],
      mediaReceipts: [mediaReceipt],
      now: new Date("2026-07-28T05:00:00.000Z"),
      async fetch() { throw new Error("Unexpected network request"); },
      ...options,
    }));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("TikTok delivery rejects other platforms and normalizes account handles", async () => {
  assert.deepEqual(validateAutopilotItem({ ...item, account: " @STREAMERSCLIPUSA " }, "@streamersclipusa").blockers, []);
  for (const platform of ["instagram", "youtube", "facebook"]) {
    await withWorkspace(async (run) => {
      const result = await run({ queue: { targetDailyClips: 5, items: [{ ...item, platform }] } });
      assert.equal(result.scheduled, 0);
      assert.deepEqual(result.results[0].blockers, ["wrong_platform"]);
    });
  }
});

test("an invalid destination cannot consume the valid row's dedupe keys", async () => {
  await withWorkspace(async (run) => {
    const result = await run({
      dryRun: true,
      queue: { targetDailyClips: 5, items: [{ ...item, account: "other-account" }, item] },
    });
    assert.equal(result.wouldSchedule, 1);
    assert.equal(result.results[0].status, "blocked");
    assert.deepEqual(result.results[0].blockers, ["wrong_account"]);
    assert.equal(result.results[1].account, item.account);
  });
});

test("wrong-blog and expired rows cannot consume the valid row's dedupe keys", async () => {
  for (const invalid of [
    { ...item, blogId: 6431685 },
    { ...item, campaignExpiresAt: "2026-07-28T04:00:00.000Z" },
  ]) {
    await withWorkspace(async (run) => {
      const result = await run({ dryRun: true, queue: { targetDailyClips: 5, items: [invalid, item] } });
      assert.equal(result.wouldSchedule, 1);
      assert.equal(result.results[0].status, "blocked");
      assert.equal(result.results[1].status, "dry_run");
    });
  }
});

test("confirmed receipts from other destinations do not suppress this account", async () => {
  const confirmed = {
    ...item,
    metricoolBlogId: Number(env.CLIPPERS_METRICOOL_BLOG_ID),
    metricoolUserId: env.METRICOOL_USER_ID,
    status: "published",
  };
  for (const mismatch of [
    { account: "other-account" },
    { metricoolBlogId: 6431685 },
    { metricoolUserId: "other-user" },
    { platform: "instagram" },
  ]) {
    await withWorkspace(async (run) => {
      const result = await run({ dryRun: true, ledger: [{ ...confirmed, ...mismatch }] });
      assert.equal(result.wouldSchedule, 1);
      assert.equal(result.results[0].status, "dry_run");
    });
  }
  await withWorkspace(async (run) => {
    const result = await run({ dryRun: true, ledger: [confirmed] });
    assert.equal(result.scheduled, 0);
    assert.equal(result.results[0].status, "deduplicated");
  });
});

test("ambiguous legacy delivery suppresses retries without claiming this account delivered", async () => {
  await withWorkspace(async (run) => {
    const result = await run({ ledger: [{ caption: item.caption, status: "scheduled" }] });
    assert.equal(result.scheduled, 0);
    assert.equal(result.results[0].status, "blocked");
    assert.deepEqual(result.results[0].blockers, ["legacy_delivery_destination_unverified_retry_suppressed"]);
  });
});

test("matching caption and time on Instagram cannot verify a TikTok receipt", async () => {
  await withWorkspace(async (run) => {
    let submissions = 0;
    const result = await run({
      verifyAttempts: 1,
      async fetch(url) {
        if (url === "https://ai.metricool.com/mcp") {
          submissions += 1;
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: { content: [] } }));
        }
        const data = submissions ? [{
          id: "instagram-post",
          text: item.caption,
          publicationDate: { dateTime: "2026-07-28T10:00:00" },
          providers: [{ network: "instagram" }],
        }] : [];
        return new Response(JSON.stringify({ data }));
      },
    });
    assert.equal(submissions, 1);
    assert.equal(result.status, "attention_required");
    assert.equal(result.scheduled, 0);
    assert.equal(result.results[0].status, "verification_pending");
    assert.equal(result.results[0].metricoolId, undefined);
  });
});

test("pending receipts for other destinations remain unchanged and suppress retries", async () => {
  await withWorkspace(async (run) => {
    const preview = await run({ dryRun: true });
    const pending = {
      ...item,
      itemId: preview.results[0].itemId,
      metricoolBlogId: Number(env.CLIPPERS_METRICOOL_BLOG_ID),
      metricoolUserId: env.METRICOOL_USER_ID,
      scheduledFor: "2026-07-28T10:00:00",
      status: "verification_pending",
    };
    for (const mismatch of [
      { account: "other-account" },
      { metricoolBlogId: 6431685 },
      { metricoolUserId: "other-user" },
      { platform: "instagram" },
    ]) {
      const ledger = [{ ...pending, ...mismatch }];
      const original = structuredClone(ledger);
      const result = await run({ ledger });
      assert.equal(result.status, "attention_required");
      assert.equal(result.scheduled, 0);
      assert.equal(result.verificationPending, 1);
      assert.equal(result.results[0].reason, "pending_receipt_destination_mismatch_retry_suppressed");
      assert.deepEqual(ledger, original);
    }
  });
});
