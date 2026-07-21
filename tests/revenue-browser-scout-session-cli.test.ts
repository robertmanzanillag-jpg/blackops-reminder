import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRevenueBrowserScoutDispatchInput,
  buildRevenueBrowserScoutSession,
  formatRevenueBrowserScoutSessionText,
  parseRevenueBrowserScoutSessionArgs,
  validateRevenueBrowserScoutSessionOptions,
} from "../server/revenue-browser-scout-session-cli";

function fakeDispatch(input: ReturnType<typeof buildRevenueBrowserScoutDispatchInput>) {
  return {
    status: "ready_for_scout_dispatch",
    mission: { name: `${input.area} ${input.niche} scout` },
    publicScoutRunEndpoint: "/api/revenue-engine/public-scout-run",
    previewEndpoint: "/api/revenue-engine/money-sprint-preview",
    workOrders: [
      {
        id: "public-directory-search",
        sourceTaskId: "task-directory",
        ownerAgent: "browser-scout",
        source: "public_directory",
        query: `${input.area} ${input.niche} no website`,
        url: "https://www.google.com/search?q=public+business+directory",
        targetRows: input.dailyQualifiedLeadLimit,
        browserInstructions: [
          "Use public pages only.",
          "Do not contact businesses.",
        ],
        candidatePayloadTemplate: {
          businessName: "Replace With Real Business",
          area: input.area,
          niche: input.niche,
          websiteStatus: "unknown",
          contactChannel: "unknown",
          contactValue: "unknown",
          sourceUrl: "",
          recipientEmail: "",
          evidence: "Replace with public evidence.",
          painPoint: "Needs review before any offer is drafted.",
          estimatedOfferUsd: 3500,
          status: "research",
          contactName: "Owner",
          businessSummary: "Captured from public browser notes.",
          notes: "No outreach sent.",
        },
      },
    ],
  };
}

test("parses revenue browser scout session CLI options", () => {
  const parsed = parseRevenueBrowserScoutSessionArgs([
    "--area=Orlando",
    "--niche=roofers",
    "--offer-focus=websites",
    "--daily-research-target=12",
    "--daily-qualified-lead-limit=6",
    "--daily-mockup-limit=2",
    "--daily-contact-limit=1",
    "--capture=/tmp/revenue-capture.json",
    "--notes=/tmp/public-notes.txt",
    "--extracted-output=/tmp/extracted-candidates.json",
    "--output=/tmp/revenue-session.json",
    "--overwrite",
    "--json",
    "--open",
  ]);

  assert.deepEqual(parsed, {
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 12,
    dailyQualifiedLeadLimit: 6,
    dailyMockupLimit: 2,
    dailyContactLimit: 1,
    json: true,
    open: true,
    outputPath: "/tmp/revenue-session.json",
    capturePath: "/tmp/revenue-capture.json",
    notesInputPath: "/tmp/public-notes.txt",
    extractedOutputPath: "/tmp/extracted-candidates.json",
    overwrite: true,
  });
  assert.deepEqual(validateRevenueBrowserScoutSessionOptions(parsed), []);

  const defaults = parseRevenueBrowserScoutSessionArgs([]);
  assert.equal(defaults.capturePath, "");
  assert.equal(defaults.outputPath, "");
  assert.equal(defaults.notesInputPath, "public-notes.txt");
  assert.equal(defaults.extractedOutputPath, "");
});

test("validates browser scout session safety limits", () => {
  const badOffer = parseRevenueBrowserScoutSessionArgs(["--offer-focus=banana"]);
  assert.deepEqual(validateRevenueBrowserScoutSessionOptions(badOffer), [
    "--offer-focus must be websites, automations or both.",
  ]);

  const tooLarge = parseRevenueBrowserScoutSessionArgs(["--daily-research-target=100"]);
  assert.deepEqual(validateRevenueBrowserScoutSessionOptions(tooLarge), [
    "--daily-research-target must be between 10 and 30 for a safe browser scout session.",
  ]);

  const sensitive = parseRevenueBrowserScoutSessionArgs(["--capture=credentials/revenue.json"]);
  assert.deepEqual(validateRevenueBrowserScoutSessionOptions(sensitive), [
    "--capture cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.",
    "--extracted-output cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.",
  ]);

  const existing = parseRevenueBrowserScoutSessionArgs(["--output=/tmp/revenue-session.json"]);
  assert.deepEqual(validateRevenueBrowserScoutSessionOptions(existing, {
    exists: (path) => path === "/tmp" || path === "/tmp/revenue-session.json",
    lstat: () => ({ isFile: () => true, isSymbolicLink: () => false }),
    realpath: (path) => path,
  }), [
    "--output already exists; pass --overwrite to replace it.",
  ]);

  const samePath = parseRevenueBrowserScoutSessionArgs([
    "--capture=/tmp/candidates.json",
    "--extracted-output=/tmp/candidates.json",
  ]);
  assert.equal(
    validateRevenueBrowserScoutSessionOptions(samePath).includes("--capture and --extracted-output must be different files."),
    true,
  );
});

test("builds dispatch input with no spend contacts or preview writes", () => {
  const input = buildRevenueBrowserScoutDispatchInput(parseRevenueBrowserScoutSessionArgs([
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
    "--daily-contact-limit=3",
  ]));

  assert.equal(input.area, "Miami");
  assert.equal(input.niche, "coffee shop");
  assert.equal(input.maxPaidDataSpendUsd, 0);
  assert.equal(input.requireRobertApprovalToContact, true);
  assert.equal(input.writePreviewFiles, false);
  assert.deepEqual(input.seedLeads, []);
  assert.equal(input.seedLeadBatchText, "");
});

test("builds browser scout session manifest with capture template locked for review", () => {
  const options = parseRevenueBrowserScoutSessionArgs([
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
    "--daily-research-target=10",
    "--daily-qualified-lead-limit=6",
    "--capture=/tmp/candidates.json",
  ]);
  const dispatch = fakeDispatch(buildRevenueBrowserScoutDispatchInput(options));
  const session = buildRevenueBrowserScoutSession(dispatch, options);

  assert.equal(session.status, "ready_for_browser_scout_session");
  assert.equal(session.openMode, "dry_run_manifest");
  assert.equal(session.urlCount, dispatch.workOrders.length);
  assert.equal(session.capturePath, "/tmp/candidates.json");
  assert.equal(session.captureTemplate.maxPaidDataSpendUsd, 0);
  assert.equal(session.captureTemplate.source, "browser_subagent");
  assert.equal(session.captureTemplate.writePreviewFiles, false);
  assert.equal(session.captureTemplate.autoApproveVerified, false);
  assert.equal(session.captureTemplate.candidates[0].verificationStatus, "needs_review");
  assert.equal(session.captureTemplate.candidates[0].publicEvidenceVerified, false);
  assert.equal(session.captureTemplate.candidates[0].approvalToImport, false);
  assert.equal(session.captureTemplate.candidates[0].recipientEmail, "");
  assert.equal(session.captureTemplate.candidates[0].sourceUrl, "");
  assert.equal(session.trustedExecutorHandoff.status, "ready_for_trusted_browser_executor_handoff");
  assert.equal(session.trustedExecutorHandoff.scoutRunId, session.missionName);
  assert.match(session.trustedExecutorHandoff.prompt, /Do not contact businesses/);
  assert.match(session.trustedExecutorHandoff.publicNotesTemplate, /Business:/);
  assert.match(session.trustedExecutorHandoff.publicNotesTemplate, /Source URL:/);
  assert.match(session.trustedExecutorHandoff.publicNotesTemplate, /Evidence:/);
  assert.match(session.trustedExecutorHandoff.publicNotesTemplate, /Offer:/);
  assert.doesNotMatch(session.trustedExecutorHandoff.publicNotesTemplate, /Estimated Offer USD:/);
  assert.equal(session.trustedExecutorHandoff.source, "browser_subagent");
  assert.equal(session.trustedExecutorHandoff.area, "Miami");
  assert.equal(session.trustedExecutorHandoff.niche, "coffee shop");
  assert.equal(session.trustedExecutorHandoff.offerFocus, "websites");
  assert.equal(session.trustedExecutorHandoff.notesInputPath, "public-notes.txt");
  assert.equal(session.trustedExecutorHandoff.extractedJsonPath, "/tmp/candidates.extracted.json");
  assert.equal(session.trustedExecutorHandoff.evidenceRequirements.some((item) => item.includes("public source URL")), true);
  assert.equal(session.trustedExecutorHandoff.acceptanceCriteria.some((item) => item.includes("approvalToImport stays false")), true);
  assert.equal(session.trustedExecutorHandoff.nextCommands.extractCandidates.command, "npm");
  assert.equal(session.trustedExecutorHandoff.nextCommands.extractCandidates.args.includes("revenue:public-scout-extract"), true);
  assert.equal(session.trustedExecutorHandoff.nextCommands.extractCandidates.args.includes("--source=browser_subagent"), true);
  assert.equal(session.trustedExecutorHandoff.nextCommands.extractCandidates.args.includes(`--scout-run-id=${session.missionName}`), true);
  assert.equal(session.trustedExecutorHandoff.nextCommands.captureForReview.command, "npm");
  assert.equal(session.trustedExecutorHandoff.nextCommands.captureForReview.args.includes("revenue:public-scout-run"), true);
  assert.equal(session.nextCommand.command, "npm");
  assert.equal(session.nextCommand.args.includes("revenue:public-scout-extract"), true);
  assert.equal(session.safety.opensBrowserTabs, false);
  assert.equal(session.safety.persistsLeads, false);
  assert.equal(session.safety.sendsOutreach, false);
  assert.equal(session.safety.writesPreviewFiles, false);
});

test("formats browser scout session with safety claims visible", () => {
  const options = parseRevenueBrowserScoutSessionArgs(["--area=Miami", "--niche=salon"]);
  const dispatch = fakeDispatch(buildRevenueBrowserScoutDispatchInput(options));
  const output = formatRevenueBrowserScoutSessionText(buildRevenueBrowserScoutSession(dispatch, options));

  assert.match(output, /Revenue browser scout session: ready_for_browser_scout_session/);
  assert.match(output, /Trusted executor handoff:/);
  assert.match(output, /Extract command: npm \["run","revenue:public-scout-extract"/);
  assert.match(output, /Capture command: npm \["run","revenue:public-scout-run"/);
  assert.match(output, /Opens browser tabs: no/);
  assert.match(output, /Paid data spend: \$0/);
  assert.match(output, /Persists final leads: no/);
  assert.match(output, /Sends outreach: no/);
});

test("browser scout session emits structured commands for hostile input", () => {
  const options = parseRevenueBrowserScoutSessionArgs([
    "--area=Miami$(touch /tmp/revenue-pwn)",
    "--niche=coffee shop",
    "--capture=/tmp/candidates.json",
  ]);
  const dispatch = fakeDispatch(buildRevenueBrowserScoutDispatchInput(options));
  const session = buildRevenueBrowserScoutSession(dispatch, options);
  const output = formatRevenueBrowserScoutSessionText(session);

  assert.equal(session.nextCommand.command, "npm");
  assert.equal(session.nextCommand.args.some((arg) => arg.includes("Miami$(touch /tmp/revenue-pwn)")), true);
  assert.doesNotMatch(output, /npm run revenue:public-scout-extract -- --area=Miami/);
});
