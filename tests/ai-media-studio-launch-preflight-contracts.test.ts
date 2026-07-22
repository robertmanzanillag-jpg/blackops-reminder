import assert from "node:assert/strict";
import test from "node:test";
import { launchPreflightGateCodes, launchPreflightSchema } from "../shared/ai-media-studio-launch-preflight";

function blockedReport(avatars: 5 | 10) {
  const required = avatars * 10;
  return {
    version: 1, source: "derived_read_only", subject: { planId: `plan_${"a".repeat(24)}`,
      batchId: `batch_${"b".repeat(24)}`, avatarCount: avatars, videosPerAvatar: 10, plannedVideoCount: required },
    observedAt: "2026-07-22T00:00:00.000Z",
    quoteReadiness: { state: "unavailable", reasonCode: "provider_not_configured", actionCode: "configure_provider" },
    status: "blocked",
    canGenerate: false, sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true,
    authoritativeForAdmission: false,
    effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false, reservationCreated: false,
      renderCreated: false, outboxCreated: false, providerCalled: false },
    summary: { totalGates: 14, passedGates: 0, blockedGates: 14, pendingExternalGates: 0,
      pendingHumanGates: 0, unavailableGates: 0, readySlots: 0, requiredSlots: required },
    gates: launchPreflightGateCodes.map((code) => ({ code, state: "blocked", readySlots: 0, requiredSlots: required,
      reasonCode: "observation_unavailable", nextActionCode: "retry_observation" })),
  } as const;
}

test("strict public preflight accepts exact 5x10 and 10x10 no-spend observations", () => {
  for (const avatars of [5, 10] as const) {
    const parsed = launchPreflightSchema.parse(blockedReport(avatars));
    assert.equal(parsed.subject.plannedVideoCount, avatars * 10);
    assert.deepEqual(parsed.gates.map((gate) => gate.code), launchPreflightGateCodes);
  }
});

test("public contract rejects internal identifiers, secrets, native handles, and inconsistent derived summaries", () => {
  const unsafe = { ...blockedReport(5), providerAccountId: "internal", secretRef: "vault", nativeAvatarId: "native" };
  assert.equal(launchPreflightSchema.safeParse(unsafe).success, false);
  const badSummary = structuredClone(blockedReport(5)) as any;
  badSummary.summary.blockedGates = 13;
  assert.equal(launchPreflightSchema.safeParse(badSummary).success, false);
  const badPassed = structuredClone(blockedReport(5)) as any;
  badPassed.gates[0] = { ...badPassed.gates[0], state: "passed", reasonCode: "ready", nextActionCode: "none", readySlots: 49 };
  badPassed.summary.passedGates = 1; badPassed.summary.blockedGates = 13;
  assert.equal(launchPreflightSchema.safeParse(badPassed).success, false);
  const forgedQuoteReadiness = structuredClone(blockedReport(5)) as any;
  forgedQuoteReadiness.quoteReadiness = { state: "evidence_present",
    reasonCode: "exact_quote_evidence_present", actionCode: "review_exact_quote" };
  assert.equal(launchPreflightSchema.safeParse(forgedQuoteReadiness).success, false);
});
