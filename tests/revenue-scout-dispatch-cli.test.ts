import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRevenueScoutDispatchCliPacket,
  formatRevenueScoutDispatchText,
  parseRevenueScoutDispatchArgs,
  validateRevenueScoutDispatchOptions,
} from "../server/revenue-scout-dispatch-cli";

function isolatedRevenueEnv(prefix: string) {
  return {
    ...process.env,
    REVENUE_ENGINE_SCOUTING_MISSIONS_PATH: `/tmp/${prefix}-scouting-missions.json`,
    REVENUE_ENGINE_DAILY_SCOUT_SPRINTS_PATH: `/tmp/${prefix}-daily-scout-sprints.json`,
    REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: `/tmp/${prefix}-public-lead-candidates.json`,
    REVENUE_ENGINE_LEADS_PATH: `/tmp/${prefix}-leads.json`,
    REVENUE_ENGINE_OUTREACH_PATH: `/tmp/${prefix}-outreach.json`,
    REVENUE_ENGINE_LEDGER_PATH: `/tmp/${prefix}-ledger.json`,
    REVENUE_ENGINE_DELIVERY_WORKSPACES_PATH: `/tmp/${prefix}-delivery-workspaces.json`,
    REVENUE_ENGINE_WEBSITE_OPPORTUNITIES_PATH: `/tmp/${prefix}-website-opportunities.json`,
  };
}

test("parses Revenue scout dispatch CLI options", () => {
  assert.deepEqual(parseRevenueScoutDispatchArgs([]), {
    json: false,
    prepareOnly: false,
    area: "Miami",
    niche: "restaurants",
    offerFocus: "both",
    targetLeadCount: 10,
    maxTasks: 3,
    resultSlotsPerTask: 2,
  });
  assert.deepEqual(parseRevenueScoutDispatchArgs([
    "--json",
    "--prepare-only",
    "--area",
    "Orlando",
    "--niche",
    "roofers",
    "--offer-focus",
    "websites",
    "--target",
    "12",
    "--max-tasks",
    "4",
    "--slots-per-task",
    "3",
  ]), {
    json: true,
    prepareOnly: true,
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    targetLeadCount: 12,
    maxTasks: 4,
    resultSlotsPerTask: 3,
  });
});

test("validates Revenue scout dispatch CLI options", () => {
  assert.deepEqual(validateRevenueScoutDispatchOptions(parseRevenueScoutDispatchArgs(["--area=Miami"])), []);
  assert.deepEqual(validateRevenueScoutDispatchOptions(parseRevenueScoutDispatchArgs(["--area", "--niche=dentists"])), [
    "--area must be at least 2 characters.",
  ]);
  assert.deepEqual(validateRevenueScoutDispatchOptions(parseRevenueScoutDispatchArgs(["--area=", "--niche=dentists"])), [
    "--area must be at least 2 characters.",
  ]);
  assert.deepEqual(validateRevenueScoutDispatchOptions(parseRevenueScoutDispatchArgs(["--target", "--area=Tampa"])), [
    "--target must be an integer between 5 and 50.",
  ]);
  assert.deepEqual(validateRevenueScoutDispatchOptions(parseRevenueScoutDispatchArgs(["--target=", "--area=Tampa"])), [
    "--target must be an integer between 5 and 50.",
  ]);
  assert.deepEqual(validateRevenueScoutDispatchOptions(parseRevenueScoutDispatchArgs([
    "--area=M",
    "--niche=x",
    "--offer-focus=fast-money",
    "--target=4",
    "--max-tasks=2",
    "--slots-per-task=0",
  ])), [
    "--area must be at least 2 characters.",
    "--niche must be at least 2 characters.",
    "--offer-focus must be one of: websites, automations, both.",
    "--target must be an integer between 5 and 50.",
    "--max-tasks must be an integer between 3 and 30.",
    "--slots-per-task must be an integer between 1 and 5.",
  ]);
});

test("formats Revenue scout dispatch for operator assignment", () => {
  const packet = {
    status: "dispatch_ready",
    reason: "Scout dispatch listo.",
    sprint: {
      id: "daily-scout-test",
      area: "Miami",
      niche: "restaurants",
      offerFocus: "both",
      targetRows: 2,
      taskCount: 1,
    },
    dispatch: {
      mode: "manual_subagent_dispatch",
      executionMode: "manual_evidence_required",
      blockedUntil: "public evidence is pasted and verified",
      requiredExecutionBridge: "bounded public-search/browser scout",
      readyToAssign: true,
      agentCount: 1,
      taskCount: 1,
      slotCount: 2,
      agentAssignments: [
        { ownerAgent: "scout-a", taskIds: ["task-1"], taskCount: 1, slotCount: 2, searchUrls: ["https://example.com"], copyableBrief: "Do not contact businesses." },
      ],
      connectorIntake: {
        endpoint: "/api/revenue-engine/public-scout-connector-intake",
        executionMode: "verified_connector_review_only",
        approvalLocked: true,
        maxResults: 20,
        workOrderCount: 1,
      },
      copyableDispatchBrief: "Do not contact businesses.",
    },
    safety: {
      researchesPublicSources: true,
      persistsScoutRun: true,
      persistsCandidates: false,
      persistsLeads: false,
      sendsOutreach: false,
      spendsMoney: false,
      deploys: false,
      requiresRobertApprovalToContact: true,
      downstreamCandidatePersistence: "Connector intake can persist review-only public candidates later; this dispatch command does not create candidates, leads, outreach, charges or deployments.",
    },
    nextAction: "Assign briefs to subagents.",
    dispatchStatus: "dispatch_ready",
    prepareOnly: true,
  } as ReturnType<typeof buildRevenueScoutDispatchCliPacket>;
  const text = formatRevenueScoutDispatchText(packet);

  assert.match(text, /Revenue Engine Scout Dispatch/);
  assert.match(text, /Prepare only: yes/);
  assert.match(text, /scout-a: 1 tasks \/ 2 slots/);
  assert.match(text, /Endpoint: \/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(text, /review-only public candidates later/);
  assert.match(text, /Sends outreach: no/);
  assert.match(text, /Do not contact businesses/);
});

test("Revenue scout dispatch executable blocks success until evidence runner is explicit", () => {
  const env = isolatedRevenueEnv(`revenue-scout-dispatch-cli-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-scout-dispatch.ts",
    "--area=Tampa",
    "--niche=dentists",
    "--offer-focus=websites",
    "--target=8",
    "--max-tasks=3",
    "--slots-per-task=2",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024 * 10,
  });

  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /Revenue Engine Scout Dispatch/);
  assert.match(run.stdout, /Status: needs_evidence_runner/);
  assert.match(run.stdout, /Dispatch status: dispatch_ready/);
  assert.match(run.stdout, /Prepare only: no/);
  assert.match(run.stdout, /Blocked until: public evidence is pasted and verified/);
  assert.match(run.stdout, /Endpoint: \/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(run.stdout, /Persists scout run: yes/);
  assert.match(run.stdout, /Persists candidates: no/);
  assert.match(run.stdout, /Persists leads: no/);
  assert.match(run.stdout, /Sends outreach: no/);
  assert.match(run.stdout, /Spends money: no/);
  assert.match(run.stdout, /Deploys: no/);
  assert.match(run.stdout, /review-only public candidates later/);
  assert.equal(existsSync(env.REVENUE_ENGINE_DAILY_SCOUT_SPRINTS_PATH), true);
  assert.equal(existsSync(env.REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH), false);
  assert.equal(existsSync(env.REVENUE_ENGINE_LEADS_PATH), false);
  assert.equal(existsSync(env.REVENUE_ENGINE_OUTREACH_PATH), false);
});

test("Revenue scout dispatch prepare-only executable creates safe dispatch packet", () => {
  const env = isolatedRevenueEnv(`revenue-scout-dispatch-prepare-cli-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-scout-dispatch.ts",
    "--prepare-only",
    "--area=Tampa",
    "--niche=dentists",
    "--offer-focus=websites",
    "--target=8",
    "--max-tasks=3",
    "--slots-per-task=2",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024 * 10,
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Status: dispatch_ready/);
  assert.match(run.stdout, /Prepare only: yes/);
  assert.match(run.stdout, /Persists candidates: no/);
  assert.equal(existsSync(env.REVENUE_ENGINE_DAILY_SCOUT_SPRINTS_PATH), true);
  assert.equal(existsSync(env.REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH), false);
});

test("Revenue scout dispatch JSON output is sanitized for subagent handoff", () => {
  const env = isolatedRevenueEnv(`revenue-scout-dispatch-json-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-scout-dispatch.ts",
    "--json",
    "--prepare-only",
    "--area",
    "Tampa",
    "--niche",
    "dentists",
    "--offer-focus",
    "websites",
    "--target",
    "8",
    "--max-tasks",
    "3",
    "--slots-per-task",
    "2",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024 * 10,
  });

  assert.equal(run.status, 0, run.stderr);
  const packet = JSON.parse(run.stdout);
  assert.equal(packet.status, "dispatch_ready");
  assert.equal(packet.dispatchStatus, "dispatch_ready");
  assert.equal(packet.prepareOnly, true);
  assert.equal(packet.sprint.area, "Tampa");
  assert.equal(packet.sprint.niche, "dentists");
  assert.equal(packet.dispatch.mode, "manual_subagent_dispatch");
  assert.equal(packet.dispatch.connectorIntake.workOrderCount, 3);
  assert.equal("workOrders" in packet.dispatch.connectorIntake, false);
  assert.equal(packet.safety.persistsCandidates, false);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.spendsMoney, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal("snapshot" in packet, false);
  assert.equal(JSON.stringify(packet).includes("recentLeads"), false);
  assert.match(packet.safety.downstreamCandidatePersistence, /review-only public candidates/);
});

test("Revenue scout dispatch JSON default reports evidence runner requirement", () => {
  const env = isolatedRevenueEnv(`revenue-scout-dispatch-json-blocked-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-scout-dispatch.ts",
    "--json",
    "--area=Tampa",
    "--niche=dentists",
    "--offer-focus=websites",
    "--target=8",
    "--max-tasks=3",
    "--slots-per-task=2",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024 * 10,
  });

  assert.equal(run.status, 1, run.stderr);
  const packet = JSON.parse(run.stdout);
  assert.equal(packet.status, "needs_evidence_runner");
  assert.equal(packet.dispatchStatus, "dispatch_ready");
  assert.equal(packet.prepareOnly, false);
  assert.match(packet.nextAction, /no businesses were discovered yet/);
  assert.equal(packet.safety.persistsCandidates, false);
  assert.equal(packet.safety.persistsLeads, false);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.spendsMoney, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(existsSync(env.REVENUE_ENGINE_DAILY_SCOUT_SPRINTS_PATH), true);
  assert.equal(existsSync(env.REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH), false);
  assert.equal(existsSync(env.REVENUE_ENGINE_LEADS_PATH), false);
  assert.equal(existsSync(env.REVENUE_ENGINE_OUTREACH_PATH), false);
});

test("package exposes Revenue scout dispatch CLI", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(
    packageJson.scripts["revenue:scout-dispatch"],
    "node --import tsx script/revenue-scout-dispatch.ts",
  );
  assert.equal(
    packageJson.scripts["test:revenue-scout-dispatch-cli"],
    "node --import tsx --test tests/revenue-scout-dispatch-cli.test.ts",
  );
});
