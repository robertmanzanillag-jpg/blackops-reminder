import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatRevenueFirstMoneyCommandCenterText,
  isRevenueFirstMoneyCommandCenterReadyForMode,
  parseRevenueFirstMoneyCommandCenterArgs,
  validateRevenueFirstMoneyCommandCenterOptions,
} from "../server/revenue-first-money-command-center-cli";

test("parses Revenue first-money command center CLI options", () => {
  assert.deepEqual(parseRevenueFirstMoneyCommandCenterArgs([]), { json: false, mode: "first-sprint" });
  assert.deepEqual(parseRevenueFirstMoneyCommandCenterArgs(["--json", "--mode=production-launch"]), {
    json: true,
    mode: "production-launch",
  });
});

test("validates Revenue first-money command center mode", () => {
  assert.deepEqual(validateRevenueFirstMoneyCommandCenterOptions(parseRevenueFirstMoneyCommandCenterArgs(["--mode=first-sprint"])), []);
  assert.deepEqual(validateRevenueFirstMoneyCommandCenterOptions(parseRevenueFirstMoneyCommandCenterArgs(["--mode=fast-money"])), [
    "--mode must be one of: first-sprint, production-launch.",
  ]);
});

test("formats Revenue first-money command center packet for operators", () => {
  const text = formatRevenueFirstMoneyCommandCenterText({
    status: "ready_for_first_money_work",
    mode: "first-sprint",
    nextCommand: {
      id: "public-scout",
      label: "Find businesses",
      command: "Use guarded public scout evidence capture in Revenue Engine.",
      status: "ready",
      reason: "Start guarded public scouting before contact, spend, or website work.",
    },
    queue: [
      {
        id: "public-scout",
        label: "Find businesses",
        command: "Use guarded public scout evidence capture in Revenue Engine.",
        status: "ready",
        reason: "Start guarded public scouting before contact, spend, or website work.",
      },
    ],
    counts: {
      publicCandidates: 0,
      reviewablePublicCandidates: 0,
      importReadyCandidates: 0,
      leads: 0,
      websiteSalesPackets: 0,
      outreachDrafts: 0,
      reviewableOutreachDrafts: 0,
      websiteClosures: 0,
      websiteHandoffs: 0,
      approvedOutreachDrafts: 0,
    },
    readiness: {
      canSearchBusinesses: true,
      canContactBusinesses: false,
      canCollectMoney: false,
      canBuildWebsites: false,
      remainingGaps: ["client charge/deposit confirmation"],
    },
    safety: {
      writesFiles: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      printsSecrets: false,
    },
  });

  assert.match(text, /Revenue Engine First-Money Command Center/);
  assert.match(text, /Next command:/);
  assert.match(text, /Find businesses/);
  assert.match(text, /Website sales packets: 0/);
  assert.match(text, /Charges clients: no/);
  assert.match(text, /client charge\/deposit confirmation/);
});

test("production launch mode is not ready while launch gaps remain", () => {
  const packet = {
    status: "ready_for_first_money_work" as const,
    mode: "production-launch" as const,
    nextCommand: {
      id: "public-scout",
      label: "Find businesses",
      command: "Use guarded public scout evidence capture in Revenue Engine.",
      status: "ready" as const,
      reason: "Start guarded public scouting before contact, spend, or website work.",
    },
    queue: [],
    counts: {
      publicCandidates: 0,
      reviewablePublicCandidates: 0,
      importReadyCandidates: 0,
      leads: 0,
      websiteSalesPackets: 0,
      outreachDrafts: 0,
      reviewableOutreachDrafts: 0,
      websiteClosures: 0,
      websiteHandoffs: 0,
      approvedOutreachDrafts: 0,
    },
    readiness: {
      canSearchBusinesses: true,
      canContactBusinesses: false,
      canCollectMoney: false,
      canBuildWebsites: false,
      remainingGaps: ["deploy without Robert approval"],
    },
    safety: {
      writesFiles: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      printsSecrets: false,
    },
  };

  assert.equal(isRevenueFirstMoneyCommandCenterReadyForMode(packet), false);
});

test("first-money command center executable fails unsafe modes", () => {
  const invalidMode = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-first-money-command-center.ts",
    "--mode=fast-money",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(invalidMode.status, 0);
  assert.match(invalidMode.stderr, /--mode must be one of/);

  const productionLaunch = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-first-money-command-center.ts",
    "--mode=production-launch",
    "--json",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(productionLaunch.status, 0);
  assert.match(productionLaunch.stdout, /"mode": "production-launch"/);
  assert.match(productionLaunch.stdout, /remainingGaps/);
});

test("package exposes first-money command center CLI", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(
    packageJson.scripts["revenue:first-money-command-center"],
    "node --import tsx script/revenue-first-money-command-center.ts",
  );
  assert.equal(
    packageJson.scripts["test:revenue-first-money-command-center-cli"],
    "node --import tsx --test tests/revenue-first-money-command-center-cli.test.ts",
  );
});
