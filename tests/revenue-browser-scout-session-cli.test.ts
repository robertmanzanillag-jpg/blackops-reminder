import assert from "node:assert/strict";
import test from "node:test";
import { buildRevenueScoutDispatch } from "../server/revenue-engine";
import {
  buildRevenueBrowserScoutDispatchInput,
  buildRevenueBrowserScoutSession,
  formatRevenueBrowserScoutSessionText,
  parseRevenueBrowserScoutSessionArgs,
  validateRevenueBrowserScoutSessionOptions,
} from "../server/revenue-browser-scout-session-cli";

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
    "--output=/tmp/revenue-session.json",
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
  });
  assert.deepEqual(validateRevenueBrowserScoutSessionOptions(parsed), []);

  const defaults = parseRevenueBrowserScoutSessionArgs([]);
  assert.equal(defaults.capturePath, "");
  assert.equal(defaults.outputPath, "");
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
  const dispatch = buildRevenueScoutDispatch(buildRevenueBrowserScoutDispatchInput(options));
  const session = buildRevenueBrowserScoutSession(dispatch, options);

  assert.equal(session.status, "ready_for_browser_scout_session");
  assert.equal(session.openMode, "dry_run_manifest");
  assert.equal(session.urlCount, dispatch.workOrders.length);
  assert.equal(session.capturePath, "/tmp/candidates.json");
  assert.equal(session.captureTemplate.maxPaidDataSpendUsd, 0);
  assert.equal(session.captureTemplate.writePreviewFiles, false);
  assert.equal(session.captureTemplate.autoApproveVerified, false);
  assert.equal(session.captureTemplate.candidates[0].verificationStatus, "needs_review");
  assert.equal(session.captureTemplate.candidates[0].publicEvidenceVerified, false);
  assert.equal(session.captureTemplate.candidates[0].approvalToImport, false);
  assert.match(session.nextCommand, /revenue:public-scout-run/);
  assert.equal(session.safety.opensBrowserTabs, false);
  assert.equal(session.safety.persistsLeads, false);
  assert.equal(session.safety.sendsOutreach, false);
  assert.equal(session.safety.writesPreviewFiles, false);
});

test("formats browser scout session with safety claims visible", () => {
  const options = parseRevenueBrowserScoutSessionArgs(["--area=Miami", "--niche=salon"]);
  const dispatch = buildRevenueScoutDispatch(buildRevenueBrowserScoutDispatchInput(options));
  const output = formatRevenueBrowserScoutSessionText(buildRevenueBrowserScoutSession(dispatch, options));

  assert.match(output, /Revenue browser scout session: ready_for_browser_scout_session/);
  assert.match(output, /Next command: npm run revenue:public-scout-run/);
  assert.match(output, /Opens browser tabs: no/);
  assert.match(output, /Paid data spend: \$0/);
  assert.match(output, /Persists final leads: no/);
  assert.match(output, /Sends outreach: no/);
});
