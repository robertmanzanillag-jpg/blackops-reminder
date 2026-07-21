import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("PR22 authority and runtime attestation boundaries are absent from HTTP and public barrels", () => {
  const routes = read("server/ai-media-studio/routes.ts");
  const planningBarrel = read("server/ai-media-studio/planning/index.ts");
  const studioBarrel = read("server/ai-media-studio/index.ts");
  const publicPaths = read("server/user-context.ts");

  for (const source of [routes, planningBarrel, studioBarrel, publicPaths]) {
    assert.doesNotMatch(source, /launch-authority-service|drizzle-launch-authority-repository|launch-runtime-attestation-verifier/iu);
    assert.doesNotMatch(source, /LaunchAuthorityService|LaunchAuthorityRepository|LaunchRuntimeAttestationVerifier/iu);
  }
  assert.doesNotMatch(routes, /\/api\/ai-media-studio\/(?:internal\/)?(?:launch-authorit|authority|admission-policy|kill-switch|launch-evidence)/iu);
  assert.doesNotMatch(publicPaths, /launch-authorit|admission-policy|kill-switch|launch-evidence/iu);
  assert.doesNotMatch(planningBarrel, /launch-authority|drizzle-daily-admission-repository/iu);
});

test("authority contracts and service stay server-only and have no side-effect dependencies", () => {
  const contracts = read("server/ai-media-studio/planning/launch-authority-contracts.ts");
  const service = read("server/ai-media-studio/planning/launch-authority-service.ts");
  const verifier = read("server/ai-media-studio/planning/launch-runtime-attestation-verifier.ts");
  const combined = `${contracts}\n${service}\n${verifier}`;

  assert.doesNotMatch(combined, /from ["']express["']|import type .*\b(?:Request|Response|Router)\b/iu);
  assert.doesNotMatch(combined, /VideoProvider|MediaJobQueue|outbox|fetch\s*\(|HEYGEN_API_KEY|DATABASE_URL/iu);
  assert.doesNotMatch(combined, /issueEvidence|issueAuthority\s*\(/iu);
  assert.doesNotMatch(contracts, /LaunchSubjectResolver/);
  assert.match(contracts, /LaunchAuthorityValidityPolicy/);
  assert.match(contracts, /LaunchRuntimeAttestationVerifier/);
  assert.doesNotMatch(service, /maximumQuoteMicroUsd|sourceEvidenceDigest|attestationId/iu);
  assert.doesNotMatch(verifier, /process\.env|fetch\s*\(|DATABASE_URL|HEYGEN_API_KEY/iu);
});
