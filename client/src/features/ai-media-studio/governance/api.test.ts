import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { governanceApi } from "./api";
import { actionableApiError } from "./errors";
import { commaSeparated, isSha256Digest } from "./types";

test("governance helpers accept only bounded opaque SHA-256 references", () => {
  assert.equal(isSha256Digest(`sha256:${"a".repeat(64)}`), true);
  assert.equal(isSha256Digest("https://example.com/evidence"), false);
  assert.deepEqual(commaSeparated("US, CA, US"), ["US", "CA"]);
});

test("governance denials expose only allowlisted actionable reasons", () => {
  assert.equal(actionableApiError({
    code: "GOVERNANCE_GATE_DENIED",
    reasons: ["profile_expired", "quality_review_missing", "private-provider-detail"],
    error: "Governance policy denied request",
  }, "fallback"), "Renew the expired governance profile. Complete a quality review for this exact video.");
  assert.equal(actionableApiError({ code: "UNKNOWN", error: "Safe server error" }, "fallback"), "Safe server error");
  assert.equal(actionableApiError({ code: "GOVERNANCE_GATE_DENIED", reasons: ["private-provider-detail"] }, "fallback"), "fallback");
});

test("profile creation uses authenticated subject path without client identity claims", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ profile: { id: "profile-1" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const input = {
      consentBasis: "obtained" as const,
      rightsBasis: "owned" as const,
      allowedUses: ["internal_preview" as const],
      territories: ["US"],
      validFrom: "2026-07-20T12:00:00.000Z",
      expiresAt: "2027-07-20T12:00:00.000Z",
      policyVersion: "v1",
      proofDigest: `sha256:${"b".repeat(64)}`,
      brandPolicy: { requiredTerms: ["disclose AI"], prohibitedTerms: ["guaranteed"] },
      idempotencyKey: "governance-profile-test-1",
    };
    await governanceApi.createInfluencerProfile({ influencerId: "influencer-1", input });
    assert.equal(captured?.url, "/api/ai-media-studio/governance/influencers/influencer-1/profile");
    assert.equal(captured?.init?.credentials, "include");
    const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    assert.deepEqual(body, input);
    assert.equal("actorId" in body, false);
    assert.equal("tenantId" in body, false);
    assert.equal("influencerId" in body, false);
    assert.equal("avatarId" in body, false);
    assert.equal("voiceId" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quality review body contains scores, notes, and idempotency only", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ review: { id: "review-1" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await governanceApi.createAssetQualityReview({ assetId: "asset-1", input: {
      criteria: { naturalMovement: 5, eyeContact: 4, speechQuality: 5, lighting: 4, realism: 4, brandConsistency: 5, verticalQuality: 5 },
      notes: "Clean render",
      idempotencyKey: "quality-review-test-1",
    } });
    assert.deepEqual(Object.keys(body).sort(), ["criteria", "idempotencyKey", "notes"]);
    assert.equal("assetId" in body, false);
    assert.equal("assetChecksum" in body, false);
    assert.equal("evaluatorId" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("governance UI does not present future or expired evidence as approved", async () => {
  const component = await readFile(new URL("./influencer-governance.tsx", import.meta.url), "utf8");
  assert.match(component, /Scheduled governance profile/);
  assert.match(component, /Expired governance profile/);
  assert.match(component, /Rendering and publishing remain blocked/);
  assert.doesNotMatch(component, /Approved governance profile/);
  assert.match(component, /> Governance<\/Button>/);
  assert.match(component, /Create replacement/);
  assert.match(component, /Create new version/);
});
