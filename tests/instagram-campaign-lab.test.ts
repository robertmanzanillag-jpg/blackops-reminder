import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createInstagramCampaignStudy,
  getInstagramCampaignLabSnapshot,
  resetInstagramCampaignLabForTests,
  setInstagramCampaignLabPathForTests,
} from "../server/instagram-campaign-lab";

const testDir = path.join(os.tmpdir(), "instagram-campaign-lab-tests");

test.beforeEach(() => {
  const studiesPath = path.join(testDir, "studies.json");
  rmSync(studiesPath, { force: true });
  setInstagramCampaignLabPathForTests(studiesPath);
  resetInstagramCampaignLabForTests();
});

test.after(() => {
  setInstagramCampaignLabPathForTests(null);
  resetInstagramCampaignLabForTests();
});

test("creates a brand-safe multi-platform social study from three or more reference accounts", () => {
  const result = createInstagramCampaignStudy({
    brandName: "Black Room",
    businessType: "nightlife events",
    targetAudience: "Miami nightlife guests",
    goal: "Use references to improve our social accounts without copying them.",
    accounts: [
      { handle: "@referenceone", notes: "premium reels, promo campaigns, elegant photo style" },
      { platform: "tiktok", handle: "@referencetwo", notes: "strong hooks, trend adaptations, retention, event recaps" },
      { handle: "https://youtube.com/@referencethree", notes: "Shorts series and educational hooks" },
      { handle: "@referencefour", notes: "weekly offer rhythm" },
    ],
  });

  assert.equal(result.status, "created");
  assert.equal(result.study.accounts.length, 4);
  assert.equal(result.study.accounts[0].handle, "referenceone");
  assert.deepEqual(result.study.accounts.map((account) => account.platform), ["instagram", "tiktok", "youtube", "instagram"]);
  assert.equal(result.study.platformPlans.some((plan) => plan.platform === "tiktok" && plan.dataToCapture.includes("watch time si esta disponible")), true);
  assert.equal(result.study.platformPlans.some((plan) => plan.platform === "youtube" && plan.formats.includes("Shorts")), true);
  assert.equal(result.study.ownableStrategy.approvalRules.includes("No usar fotos, logos, videos, canciones o textos de cuentas referencia como asset final."), true);
  assert.equal(result.study.photoDirections.length >= 3, true);
  assert.equal(result.study.campaignBlueprints.length >= 2, true);
  assert.equal(result.study.promptPack.some((prompt) => prompt.id === "platform-adapter"), true);
  assert.equal(result.study.promptPack.some((prompt) => prompt.id === "originality-check"), true);

  const snapshot = getInstagramCampaignLabSnapshot();
  assert.equal(snapshot.minimumAccounts, 3);
  assert.equal(snapshot.supportedPlatforms.includes("tiktok"), true);
  assert.equal(snapshot.latestStudy?.brandName, "Black Room");
  assert.equal(snapshot.studies.length, 1);
  assert.equal(snapshot.installedStack.some((tool) => tool.name === "Claude CLI/skills" && tool.status === "not_detected_in_this_session"), true);
});

test("requires at least three reference accounts", () => {
  assert.throws(
    () =>
      createInstagramCampaignStudy({
        brandName: "Test Brand",
        accounts: [{ handle: "@one" }, { handle: "@two" }],
      }),
    /Array must contain at least 3 element/
  );
});
