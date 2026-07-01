import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildRevenuePublicScoutScheduleCli,
  buildRevenuePublicScoutScheduleInput,
  formatRevenuePublicScoutScheduleText,
  parseRevenuePublicScoutScheduleArgs,
  validateRevenuePublicScoutScheduleOptions,
} from "../server/revenue-public-scout-schedule-cli";

function fakeOutputPathChecks(options: { existing?: string[]; symlinks?: string[]; directories?: string[]; realpaths?: Record<string, string> } = {}) {
  const existing = new Set([
    "/tmp",
    "/tmp/.ssh",
    "/Users/robertmanzanilla/Desktop",
    "/Users/robertmanzanilla/Documents/asistente/revenue_workspace/public-scout",
    ...(options.existing || []),
  ]);
  const symlinks = new Set(options.symlinks || []);
  const directories = new Set([
    "/tmp",
    "/tmp/.ssh",
    "/Users/robertmanzanilla/Desktop",
    "/Users/robertmanzanilla/Documents/asistente/revenue_workspace/public-scout",
    ...(options.directories || []),
  ]);
  return {
    exists: (targetPath: string) => existing.has(targetPath),
    lstat: (targetPath: string) => ({
      isFile: () => existing.has(targetPath) && !directories.has(targetPath),
      isSymbolicLink: () => symlinks.has(targetPath),
    }),
    realpath: (targetPath: string) => options.realpaths?.[targetPath] || targetPath,
  };
}

test("parses revenue public scout schedule CLI options", () => {
  const parsed = parseRevenuePublicScoutScheduleArgs([
    "--schedule-name=Orlando roofers",
    "--area=Orlando",
    "--niche=roofers",
    "--offer-focus=websites",
    "--daily-research-target=20",
    "--daily-qualified-lead-limit=6",
    "--daily-mockup-limit=2",
    "--start-date=2026-07-02",
    "--run-days=3",
    "--runs-per-day=2",
    "--run-hour-local=8",
    "--browser-executor=manual_browser",
    "--max-candidates-per-run=5",
    "--timezone=America/New_York",
    "--output=/tmp/revenue-schedule.json",
    "--overwrite",
    "--json",
  ]);

  assert.deepEqual(parsed, {
    scheduleName: "Orlando roofers",
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 6,
    dailyMockupLimit: 2,
    startDate: "2026-07-02",
    runDays: 3,
    runsPerDay: 2,
    runHourLocal: 8,
    browserExecutor: "manual_browser",
    maxCandidatesPerRun: 5,
    timezone: "America/New_York",
    outputPath: "/tmp/revenue-schedule.json",
    overwrite: true,
    json: true,
    invalidNumericArgs: [],
  });
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(parsed), []);
});

test("validates schedule schema and output path safety", () => {
  const badRange = parseRevenuePublicScoutScheduleArgs([
    "--daily-research-target=0",
    "--output=/tmp/revenue-schedule.json",
  ]);
  const sensitive = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/.env.local",
  ]);
  const credentials = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/credentials.json",
  ]);
  const ssh = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/.ssh/config",
  ]);
  const outsideAllowed = parseRevenuePublicScoutScheduleArgs([
    "--output=/Users/robertmanzanilla/Desktop/revenue-schedule.json",
  ]);
  const existing = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/revenue-schedule.json",
  ]);
  const overwrite = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/revenue-schedule.json",
    "--overwrite",
  ]);

  assert.equal(validateRevenuePublicScoutScheduleOptions(badRange).some((error) => error.includes("dailyResearchTarget")), true);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(sensitive, fakeOutputPathChecks()), [
    "--output cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(credentials, fakeOutputPathChecks()), [
    "--output cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.",
  ]);
  assert.equal(validateRevenuePublicScoutScheduleOptions(ssh, fakeOutputPathChecks()).some((error) => error.includes(".ssh")), true);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(outsideAllowed, fakeOutputPathChecks()), [
    "--output must be inside revenue_workspace/public-scout or the system temp directory.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(existing, fakeOutputPathChecks({ existing: ["/tmp/revenue-schedule.json"] })), [
    "--output already exists; pass --overwrite to replace it.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(overwrite, fakeOutputPathChecks({ existing: ["/tmp/revenue-schedule.json"] })), []);
});

test("rejects symlink outputs and symlinked output parents", () => {
  const symlinkOutput = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/revenue-schedule.json",
    "--overwrite",
  ]);
  const symlinkParent = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/public-scout-link/revenue-schedule.json",
  ]);

  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(symlinkOutput, fakeOutputPathChecks({
    existing: ["/tmp/revenue-schedule.json"],
    symlinks: ["/tmp/revenue-schedule.json"],
  })), [
    "--output cannot be a symlink.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(symlinkParent, fakeOutputPathChecks({
    existing: ["/tmp/public-scout-link"],
    directories: ["/tmp/public-scout-link"],
    symlinks: ["/tmp/public-scout-link"],
  })), [
    "--output parent directory cannot be a symlink.",
  ]);
});

test("rejects output parent realpaths outside allowed roots", () => {
  const symlinkedAncestor = parseRevenuePublicScoutScheduleArgs([
    "--output=/tmp/public-scout-dir/revenue-schedule.json",
  ]);

  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(symlinkedAncestor, fakeOutputPathChecks({
    existing: ["/tmp/public-scout-dir"],
    directories: ["/tmp/public-scout-dir"],
    realpaths: {
      "/tmp/public-scout-dir": "/Users/robertmanzanilla/.ssh",
    },
  })), [
    "--output must be inside revenue_workspace/public-scout or the system temp directory.",
  ]);
});

test("rejects symlinked workspace output roots and ancestors", () => {
  const workspaceRoot = path.resolve(process.cwd(), "revenue_workspace/public-scout");
  const rootSymlink = parseRevenuePublicScoutScheduleArgs([
    `--output=${workspaceRoot}/nested/revenue-schedule.json`,
  ]);
  const ancestorSymlink = parseRevenuePublicScoutScheduleArgs([
    `--output=${workspaceRoot}/nested/deep/revenue-schedule.json`,
  ]);

  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(rootSymlink, fakeOutputPathChecks({
    existing: [workspaceRoot, `${workspaceRoot}/nested`],
    directories: [workspaceRoot, `${workspaceRoot}/nested`],
    symlinks: [workspaceRoot],
  })), [
    "--output workspace directory cannot be a symlink.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutScheduleOptions(ancestorSymlink, fakeOutputPathChecks({
    existing: [workspaceRoot, `${workspaceRoot}/nested`, `${workspaceRoot}/nested/deep`],
    directories: [workspaceRoot, `${workspaceRoot}/nested`, `${workspaceRoot}/nested/deep`],
    symlinks: [`${workspaceRoot}/nested`],
  })), [
    "--output workspace path cannot include symlink directories.",
  ]);
});

test("rejects invalid numeric args and impossible dates", () => {
  const invalidNumber = parseRevenuePublicScoutScheduleArgs(["--run-days=abc"]);
  const impossibleDate = parseRevenuePublicScoutScheduleArgs(["--start-date=2026-02-31"]);

  assert.equal(validateRevenuePublicScoutScheduleOptions(invalidNumber).some((error) => error.includes("--run-days must be a valid number")), true);
  assert.equal(validateRevenuePublicScoutScheduleOptions(impossibleDate).some((error) => error.includes("startDate must be a valid")), true);
});

test("builds schedule input without contact spend or write fields", () => {
  const input = buildRevenuePublicScoutScheduleInput(parseRevenuePublicScoutScheduleArgs([
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
  ]));

  assert.equal(input.area, "Miami");
  assert.equal(input.niche, "coffee shop");
  assert.equal("dailyContactLimit" in input, false);
  assert.equal("maxPaidDataSpendUsd" in input, false);
  assert.equal("writePreviewFiles" in input, false);
});

test("builds a guarded public scout schedule with structured commands", () => {
  const schedule = buildRevenuePublicScoutScheduleCli(parseRevenuePublicScoutScheduleArgs([
    "--schedule-name=Miami cafe scout",
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
    "--run-days=2",
    "--runs-per-day=2",
    "--max-candidates-per-run=4",
  ]));

  assert.equal(schedule.status, "ready_for_guarded_schedule");
  assert.equal(schedule.runCount, 4);
  assert.equal(schedule.runs[0].commands.prepareBrowserSession.command, "npm");
  assert.equal(schedule.runs[0].commands.prepareBrowserSession.args.includes("--daily-qualified-lead-limit=4"), true);
  assert.equal(schedule.runs[0].commands.extractCandidates.args.includes("--source=browser_subagent"), true);
  assert.equal(schedule.runs[0].commands.captureForReview.args.includes(`--scout-run-id=${schedule.runs[0].id}`), true);
  assert.equal(schedule.dispatch.importInstructions.some((item) => item.includes("Batch leads")), false);
  assert.equal(schedule.dispatch.importInstructions.some((item) => item.includes("Preview batch")), false);
  assert.equal(schedule.dispatch.importInstructions.some((item) => item.includes("Robert approves")), true);
  assert.equal(schedule.safety.runsBrowserAutomatically, false);
  assert.equal(schedule.safety.sendsOutreach, false);
  assert.equal(schedule.safety.paidDataSpendUsd, 0);
});

test("formats schedule text without shell command strings", () => {
  const schedule = buildRevenuePublicScoutScheduleCli(parseRevenuePublicScoutScheduleArgs([
    "--area=Miami$(touch /tmp/revenue-pwn)",
    "--niche=coffee shop",
    "--run-days=1",
    "--runs-per-day=1",
  ]));
  const output = formatRevenuePublicScoutScheduleText(schedule, "/tmp/revenue-schedule.json");

  assert.match(output, /Revenue public scout schedule: ready_for_guarded_schedule/);
  assert.match(output, /First run structured commands:/);
  assert.doesNotMatch(output, /npm run revenue:browser-scout-session/);
  assert.match(output, /Runs browser automatically: no/);
  assert.match(output, /Sends outreach: no/);
});
