import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("PR21 authority issuers are absent from HTTP and public barrels", () => {
  const routes = read("server/ai-media-studio/routes.ts");
  const planningBarrel = read("server/ai-media-studio/planning/index.ts");
  const studioBarrel = read("server/ai-media-studio/index.ts");
  const publicPaths = read("server/user-context.ts");

  for (const source of [routes, planningBarrel, studioBarrel, publicPaths]) {
    assert.doesNotMatch(source, /launch-authority-service|drizzle-launch-authority-repository/iu);
    assert.doesNotMatch(source, /LaunchAuthorityService|LaunchAuthorityRepository/iu);
  }
  assert.doesNotMatch(routes, /\/api\/ai-media-studio\/(?:internal\/)?(?:launch-authorit|authority|admission-policy|kill-switch|launch-evidence)/iu);
  assert.doesNotMatch(publicPaths, /launch-authorit|admission-policy|kill-switch|launch-evidence/iu);
  assert.doesNotMatch(planningBarrel, /launch-authority|drizzle-daily-admission-repository/iu);
});

test("authority contracts and service stay server-only and have no side-effect dependencies", () => {
  const contracts = read("server/ai-media-studio/planning/launch-authority-contracts.ts");
  const service = read("server/ai-media-studio/planning/launch-authority-service.ts");
  const combined = `${contracts}\n${service}`;

  assert.doesNotMatch(combined, /from ["']express["']|import type .*\b(?:Request|Response|Router)\b/iu);
  assert.doesNotMatch(combined, /VideoProvider|MediaJobQueue|outbox|fetch\s*\(|HEYGEN_API_KEY|DATABASE_URL/iu);
  assert.doesNotMatch(combined, /issueEvidence|issueAuthority\s*\(/iu);
  assert.match(contracts, /LaunchSubjectResolver/);
  assert.match(contracts, /LaunchAuthorityValidityPolicy/);
});
