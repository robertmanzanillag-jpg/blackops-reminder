import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRevenuePublicScoutSchedule,
  listRevenuePublicLeadCandidates,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePublicScoutExecute,
  formatRevenuePublicScoutExecuteText,
  getRevenuePublicScoutExecuteExitCode,
  parseRevenuePublicScoutExecuteArgs,
  validateRevenuePublicScoutExecuteOptions,
  validateRevenuePublicScoutExecuteResolvedPaths,
} from "../server/revenue-public-scout-execute-cli";

const testCandidatesPath = "/tmp/revenue-public-scout-execute-candidates-test.json";
setRevenuePublicLeadCandidatesPathForTests(testCandidatesPath);

test.afterEach(() => {
  resetRevenuePublicLeadCandidatesForTests();
});

const publicNotes = [
  [
    "Business: Execute Scout Cafe",
    "Source: https://example.com/execute-scout-cafe",
    "Contact: owner@executescout.example",
    "Evidence: Public directory listing shows no website link, recent menu photos and a public email.",
    "Website: no website",
    "Pain: Needs online menu capture and catering inquiry follow-up.",
    "Offer: $3600",
  ].join("\n"),
  [
    "Business: Execute Scout Salon",
    "Source: https://example.com/execute-scout-salon",
    "Contact: Instagram @executescoutsalon",
    "Evidence: Public profile has service photos and asks clients to DM because no website booking page is visible.",
    "Website: weak website",
    "Pain: Needs booking page and intake automation.",
    "Offer: $4200",
  ].join("\n"),
].join("\n\n");

function scheduleJson(targetCandidates = 2) {
  const schedule = buildRevenuePublicScoutSchedule({
    scheduleName: "Execute scout",
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 10,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    startDate: "2026-07-02",
    runDays: 1,
    runsPerDay: 1,
    runHourLocal: 9,
    browserExecutor: "manual_browser",
    maxCandidatesPerRun: targetCandidates,
    timezone: "America/New_York",
  });
  return JSON.stringify(schedule);
}

test("parses and validates public scout execute options", () => {
  const parsed = parseRevenuePublicScoutExecuteArgs([
    "--schedule=/tmp/schedule.json",
    "--run-id=execute-scout-2026-07-02-01",
    "--notes=/tmp/notes.txt",
    "--write-extracted",
    "--json",
  ]);

  assert.deepEqual(parsed, {
    schedulePath: "/tmp/schedule.json",
    runId: "execute-scout-2026-07-02-01",
    notesPath: "/tmp/notes.txt",
    writeExtracted: true,
    json: true,
  });
  assert.deepEqual(validateRevenuePublicScoutExecuteOptions(parsed, () => true), []);
  assert.deepEqual(validateRevenuePublicScoutExecuteOptions(parseRevenuePublicScoutExecuteArgs([])), [
    "--schedule is required.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutExecuteOptions(parseRevenuePublicScoutExecuteArgs([
    "--schedule=/tmp/.env",
    "--notes=/tmp/secrets/notes.txt",
  ]), () => true), [
    "--schedule cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.",
    "--notes cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.",
  ]);
});

test("executes a guarded schedule run into Robert-review public candidates", () => {
  const result = buildRevenuePublicScoutExecute(scheduleJson(), publicNotes, {
    schedulePath: "/tmp/schedule.json",
    runId: "execute-scout-2026-07-02-01",
    notesPath: "/tmp/notes.txt",
    writeExtracted: false,
    json: false,
  });
  const text = formatRevenuePublicScoutExecuteText(result);
  const candidates = listRevenuePublicLeadCandidates();

  assert.equal(result.status, "recorded_for_robert_review");
  assert.equal(result.scoutRunResult?.recordedCandidates.length, 2);
  assert.equal(result.safety.persistsPublicCandidates, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.requiresRobertReview, true);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].businessName, "Execute Scout Cafe");
  assert.equal(candidates[0].verificationStatus, "needs_review");
  assert.equal(candidates[0].publicEvidenceVerified, false);
  assert.equal(candidates[0].approvalToImport, false);
  assert.match(text, /Recorded candidates: 2/);
  assert.match(text, /Requires Robert review: yes/);
  assert.equal(getRevenuePublicScoutExecuteExitCode(result), 0);
});

test("caps extracted notes to the scheduled run candidate limit", () => {
  const result = buildRevenuePublicScoutExecute(scheduleJson(1), publicNotes, {
    schedulePath: "/tmp/schedule.json",
    runId: "execute-scout-2026-07-02-01",
    notesPath: "/tmp/notes.txt",
    writeExtracted: false,
    json: false,
  });

  assert.equal(result.status, "recorded_for_robert_review");
  assert.equal(result.scoutRunResult?.recordedCandidates.length, 1);
  assert.equal(listRevenuePublicLeadCandidates().length, 1);
});

test("blocks unsafe or missing schedule runs without persisting candidates", () => {
  const unsafeSchedule = JSON.stringify({
    status: "ready_for_guarded_schedule",
    scheduleName: "Unsafe scout",
    runs: [],
    safety: {
      sendsOutreach: true,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
    },
  });

  const result = buildRevenuePublicScoutExecute(unsafeSchedule, publicNotes, {
    schedulePath: "/tmp/schedule.json",
    runId: "missing-run",
    notesPath: "/tmp/notes.txt",
    writeExtracted: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.safety.persistsPublicCandidates, false);
  assert.match(result.blockers.join("; "), /schedule must not send outreach/);
  assert.match(result.blockers.join("; "), /requested run was not found/);
  assert.equal(listRevenuePublicLeadCandidates().length, 0);
  assert.equal(getRevenuePublicScoutExecuteExitCode(result), 1);
});

test("blocks schedule-controlled extracted JSON paths outside safe scout roots", () => {
  const schedule = JSON.parse(scheduleJson());
  schedule.runs[0].extractedJsonPath = "/tmp/.ssh/extracted.json";

  const result = buildRevenuePublicScoutExecute(JSON.stringify(schedule), publicNotes, {
    schedulePath: "/tmp/schedule.json",
    runId: schedule.runs[0].id,
    notesPath: "/tmp/notes.txt",
    writeExtracted: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.safety.persistsPublicCandidates, false);
  assert.match(result.blockers.join("; "), /extracted JSON path cannot point/);
  assert.equal(listRevenuePublicLeadCandidates().length, 0);
});

test("script rejects schedule-derived sensitive notes paths before reading", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "revenue-public-scout-execute-sensitive-"));
  const schedulePath = path.join(dir, "schedule.json");
  const sensitiveNotesPath = path.join(os.tmpdir(), ".env.revenue-public-scout-notes");
  const schedule = JSON.parse(scheduleJson());
  schedule.runs[0].captureNotesPath = sensitiveNotesPath;
  writeFileSync(schedulePath, `${JSON.stringify(schedule, null, 2)}\n`);
  writeFileSync(sensitiveNotesPath, publicNotes);

  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-scout-execute.ts",
    `--schedule=${schedulePath}`,
    `--run-id=${schedule.runs[0].id}`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Resolved notes path cannot point/);
  assert.equal(listRevenuePublicLeadCandidates().length, 0);
});

test("resolved path validation rejects symlink notes and extracted outputs", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "revenue-public-scout-execute-symlink-"));
  const noteSymlink = path.join(dir, "notes.txt");
  const outputSymlink = path.join(dir, "extracted.json");
  symlinkSync(path.join(process.cwd(), "package.json"), noteSymlink);
  symlinkSync(path.join(process.cwd(), "package.json"), outputSymlink);

  const errors = validateRevenuePublicScoutExecuteResolvedPaths({
    notesPath: noteSymlink,
    extractedJsonPath: outputSymlink,
    writeExtracted: true,
  });

  assert.equal(errors.some((error) => error.includes("notes path cannot be a symlink")), true);
  assert.equal(errors.some((error) => error.includes("extracted JSON path cannot be a symlink")), true);
});

test("script rejects schedule-controlled extracted JSON symlink before writing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "revenue-public-scout-execute-output-symlink-"));
  const schedulePath = path.join(dir, "schedule.json");
  const notesPath = path.join(dir, "notes.txt");
  const outputSymlink = path.join(dir, "extracted.json");
  symlinkSync(path.join(process.cwd(), "package.json"), outputSymlink);
  const schedule = JSON.parse(scheduleJson());
  schedule.runs[0].captureNotesPath = notesPath;
  schedule.runs[0].extractedJsonPath = outputSymlink;
  writeFileSync(schedulePath, `${JSON.stringify(schedule, null, 2)}\n`);
  writeFileSync(notesPath, publicNotes);

  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-scout-execute.ts",
    `--schedule=${schedulePath}`,
    `--run-id=${schedule.runs[0].id}`,
    "--write-extracted",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Resolved extracted JSON path cannot be a symlink/);
  assert.equal(listRevenuePublicLeadCandidates().length, 0);
});

test("builder rejects schedule-controlled extracted JSON symlink before persisting candidates", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "revenue-public-scout-execute-builder-symlink-"));
  const outputSymlink = path.join(dir, "extracted.json");
  symlinkSync(path.join(process.cwd(), "package.json"), outputSymlink);
  const schedule = JSON.parse(scheduleJson());
  schedule.runs[0].extractedJsonPath = outputSymlink;
  let wroteOutput = false;

  const result = buildRevenuePublicScoutExecute(JSON.stringify(schedule), publicNotes, {
    schedulePath: "/tmp/schedule.json",
    runId: schedule.runs[0].id,
    notesPath: path.join(dir, "notes.txt"),
    writeExtracted: true,
    json: false,
  }, () => {
    wroteOutput = true;
  });

  assert.equal(result.status, "blocked");
  assert.equal(wroteOutput, false);
  assert.equal(result.safety.persistsPublicCandidates, false);
  assert.match(result.blockers.join("; "), /extracted JSON path cannot be a symlink/);
  assert.equal(listRevenuePublicLeadCandidates().length, 0);
});

test("builder rejects dangling extracted JSON symlink before persisting candidates", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "revenue-public-scout-execute-dangling-symlink-"));
  const outputSymlink = path.join(dir, "extracted.json");
  symlinkSync(path.join(dir, "missing-target.json"), outputSymlink);
  const schedule = JSON.parse(scheduleJson());
  schedule.runs[0].extractedJsonPath = outputSymlink;
  let wroteOutput = false;

  const result = buildRevenuePublicScoutExecute(JSON.stringify(schedule), publicNotes, {
    schedulePath: "/tmp/schedule.json",
    runId: schedule.runs[0].id,
    notesPath: path.join(dir, "notes.txt"),
    writeExtracted: true,
    json: false,
  }, () => {
    wroteOutput = true;
  });

  assert.equal(result.status, "blocked");
  assert.equal(wroteOutput, false);
  assert.match(result.blockers.join("; "), /extracted JSON path cannot be a symlink/);
  assert.equal(listRevenuePublicLeadCandidates().length, 0);
});

test("public scout execute script persists candidates and optional extracted JSON", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "revenue-public-scout-execute-"));
  const schedulePath = path.join(dir, "schedule.json");
  const notesPath = path.join(dir, "notes.txt");
  const extractedPath = path.join(dir, "execute-scout-2026-07-02-01.candidates.json");
  const schedule = JSON.parse(scheduleJson());
  schedule.runs[0].captureNotesPath = notesPath;
  schedule.runs[0].extractedJsonPath = extractedPath;
  writeFileSync(schedulePath, `${JSON.stringify(schedule, null, 2)}\n`);
  writeFileSync(notesPath, publicNotes);

  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-scout-execute.ts",
    `--schedule=${schedulePath}`,
    `--run-id=${schedule.runs[0].id}`,
    "--write-extracted",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue public scout execute: recorded_for_robert_review/);
  assert.match(result.stdout, /Sends outreach: no/);
  const extracted = JSON.parse(readFileSync(extractedPath, "utf8"));
  assert.equal(extracted.candidates.length, 2);
  assert.equal(extracted.autoApproveVerified, false);
  assert.equal(extracted.writePreviewFiles, false);
  assert.equal(extracted.maxPaidDataSpendUsd, 0);
});
