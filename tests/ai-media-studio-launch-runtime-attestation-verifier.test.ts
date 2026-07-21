import assert from "node:assert/strict";
import test from "node:test";
import type {
  TrustedLaunchAuthorityPrincipal,
  TrustedLaunchSubject,
} from "../server/ai-media-studio/planning/launch-authority-contracts";
import { createProcessLocalLaunchRuntimeAttestationFacets } from
  "../server/ai-media-studio/planning/launch-runtime-attestation-verifier";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = Object.freeze({ ownerUserId: "owner-1", workspaceId: "workspace-1" });
const principal = Object.freeze({
  subjectId: "workload:sandbox",
  kind: "workload",
  capabilities: Object.freeze(["sandbox:attest"]),
  authenticationEvidenceDigest: digest("a"),
}) as unknown as TrustedLaunchAuthorityPrincipal;
const subject = Object.freeze({
  scope,
  dailyPlanId: "11111111-1111-4111-8111-111111111111",
  dailyPlanSlotId: "22222222-2222-4222-8222-222222222222",
  slotAttempt: 1,
  planDigest: digest("b"),
  slotDigest: digest("c"),
  sourceRosterKey: "heygen-roster",
  sourceRosterDigest: digest("d"),
  sourceMemberKey: "member-1",
  providerAccountId: "33333333-3333-4333-8333-333333333333",
  providerKey: "heygen",
  providerCredentialVersion: 2,
  scriptVariantId: "44444444-4444-4444-8444-444444444444",
  scriptVariantChecksum: "checksum-v1",
  scriptId: "55555555-5555-4555-8555-555555555555",
  sourceType: "owned_upload",
  sourceItemId: "source-1",
  sourceContentHash: "sha256-content-hash",
  governanceProfileId: "66666666-6666-4666-8666-666666666666",
  governanceEvidenceDigest: digest("e"),
  governanceUse: "commercial_social_video",
  governanceTerritory: "US",
  contentCountry: "US",
  launchIntentId: "77777777-7777-4777-8777-777777777777",
  launchIntentDigest: digest("f"),
  launchSubjectDigest: digest("1"),
}) as unknown as TrustedLaunchSubject;

const validFrom = new Date("2026-07-21T12:00:00.000Z");
const expiresAt = new Date("2026-07-21T12:05:00.000Z");

test("process-local verifier recovers one frozen sandbox decision from an opaque unguessable handle", async () => {
  const { sandboxIssuer, verifier } = createProcessLocalLaunchRuntimeAttestationFacets();
  const handle = sandboxIssuer.mint({
    scope, principal, subject, idempotencyKey: "sandbox-attestation-0001", validFrom, expiresAt,
    attestationId: "sandbox-run-0001", decision: "passed", sourceEvidenceDigest: digest("2"),
  });
  assert.match(handle, /^lar_[A-Za-z0-9_-]{43}$/u);
  const result = await verifier.verify({
    kind: "sandbox_proof", attestationHandle: handle, scope, principal, subject,
    databaseNow: new Date("2026-07-21T12:01:00.000Z"), idempotencyKey: "sandbox-attestation-0001",
  });
  assert.deepEqual(result, {
    kind: "sandbox_proof", attestationId: "sandbox-run-0001", decision: "passed",
    sourceEvidenceDigest: digest("2"),
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(await verifier.verify({
    kind: "sandbox_proof", attestationHandle: `${handle.slice(0, -1)}x`, scope, principal, subject,
    databaseNow: new Date("2026-07-21T12:01:00.000Z"), idempotencyKey: "sandbox-attestation-0001",
  }), undefined);
});

test("verifier rejects wrong kind, scope, exact principal, durable subject, idempotency, and DB-time window", async () => {
  const { quoteIssuer, verifier } = createProcessLocalLaunchRuntimeAttestationFacets();
  const handle = quoteIssuer.mint({
    scope, principal, subject, idempotencyKey: "quote-attestation-0001", validFrom, expiresAt,
    attestationId: "quote-0001", decision: "quoted", maximumQuoteMicroUsd: "1250000",
    sourceEvidenceDigest: digest("3"),
  });
  const base = {
    kind: "maximum_quote" as const, attestationHandle: handle, scope, principal, subject,
    databaseNow: new Date("2026-07-21T12:02:00.000Z"), idempotencyKey: "quote-attestation-0001",
  };
  const exact = await verifier.verify(base);
  assert.deepEqual(exact, {
    kind: "maximum_quote", attestationId: "quote-0001", decision: "quoted",
    maximumQuoteMicroUsd: "1250000", currency: "USD", sourceEvidenceDigest: digest("3"),
  });
  assert.ok(Object.isFrozen(exact));

  const alteredPrincipal = { ...principal, capabilities: ["quote:attest"] } as unknown as TrustedLaunchAuthorityPrincipal;
  const alteredSubject = { ...subject, launchIntentDigest: digest("9") } as unknown as TrustedLaunchSubject;
  for (const candidate of [
    { ...base, kind: "sandbox_proof" as const },
    { ...base, scope: { ...scope, workspaceId: "other" } },
    { ...base, principal: alteredPrincipal },
    { ...base, subject: alteredSubject },
    { ...base, idempotencyKey: "quote-attestation-0002" },
    { ...base, databaseNow: new Date(validFrom.getTime() - 1) },
    { ...base, databaseNow: new Date(expiresAt) },
  ]) assert.equal(await verifier.verify(candidate), undefined);
});

test("minting validates a bounded lifetime, exact input shape, digest, and positive canonical quote", () => {
  const { quoteIssuer } = createProcessLocalLaunchRuntimeAttestationFacets();
  const base = {
    scope, principal, subject, idempotencyKey: "quote-attestation-0001", validFrom, expiresAt,
    attestationId: "quote-0001", decision: "quoted" as const, maximumQuoteMicroUsd: "1",
    sourceEvidenceDigest: digest("4"),
  };
  for (const invalid of ["0", "01", "-1", "9000000000000001"]) {
    assert.throws(() => quoteIssuer.mint({ ...base, maximumQuoteMicroUsd: invalid }), TypeError);
  }
  assert.throws(() => quoteIssuer.mint({ ...base, attestationId: "short" }), TypeError);
  assert.throws(() => quoteIssuer.mint({ ...base, forged: true } as any), TypeError);
  assert.throws(() => quoteIssuer.mint({
    ...base, expiresAt: new Date(validFrom.getTime() + 86_400_001),
  }), TypeError);
});

test("factory exposes frozen least-privilege facets and binds nullable manual-source provenance", async () => {
  const facets = createProcessLocalLaunchRuntimeAttestationFacets();
  assert.ok(Object.isFrozen(facets));
  assert.deepEqual(Object.keys(facets.verifier), ["verify"]);
  assert.deepEqual(Object.keys(facets.sandboxIssuer), ["mint"]);
  assert.deepEqual(Object.keys(facets.quoteIssuer), ["mint"]);
  assert.equal("mint" in facets.verifier, false);
  assert.equal("verify" in facets.sandboxIssuer, false);
  assert.equal("verify" in facets.quoteIssuer, false);
  assert.equal("mintMaximumQuoteAttestation" in facets.sandboxIssuer, false);
  assert.equal("mintSandboxAttestation" in facets.quoteIssuer, false);

  const manualSubject = Object.freeze({
    ...subject,
    sourceType: "manual",
    sourceItemId: null,
    sourceContentHash: null,
  }) as unknown as TrustedLaunchSubject;
  const handle = facets.sandboxIssuer.mint({
    scope, principal, subject: manualSubject, idempotencyKey: "manual-sandbox-0001", validFrom, expiresAt,
    attestationId: "manual-sandbox-run-0001", decision: "passed", sourceEvidenceDigest: digest("5"),
  });
  assert.equal((await facets.verifier.verify({
    kind: "sandbox_proof", attestationHandle: handle, scope, principal, subject: manualSubject,
    databaseNow: new Date("2026-07-21T12:01:00.000Z"), idempotencyKey: "manual-sandbox-0001",
  }))?.decision, "passed");
  assert.equal(await facets.verifier.verify({
    kind: "sandbox_proof", attestationHandle: handle, scope, principal,
    subject: { ...manualSubject, sourceItemId: "forged" } as unknown as TrustedLaunchSubject,
    databaseNow: new Date("2026-07-21T12:01:00.000Z"), idempotencyKey: "manual-sandbox-0001",
  }), undefined);
});
