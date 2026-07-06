import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("website build handoff requires Claude design skill and premium 3D QA", () => {
  const source = readFileSync("server/revenue-engine.ts", "utf8");
  const developerAutopilotSource = readFileSync("server/developer-autopilot.ts", "utf8");
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(source, /design\/creative guidance before coding/);
  assert.match(source, /\.claude\/skills\/design-creative\/SKILL\.md/);
  assert.match(source, /designSkillContext: internalDesignSkillContext\.join/);
  assert.match(source, /publicDesignDirection/);
  assert.match(source, /premium agency-quality website/);
  assert.match(source, /Optional premium 3D\/motion enhancement/);
  assert.match(source, /Three\.js or CSS depth/);
  assert.match(source, /reduced-motion fallback/);
  assert.match(source, /Verify 3D\/animation renders nonblank/);
  assert.match(source, /Design Skill \/ Premium Experience/);
  assert.match(developerAutopilotSource, /designSkillContext\?: string \| null/);
  assert.match(developerAutopilotSource, /request\.designSkillContext/);
  assert.match(developerAutopilotSource, /designSkillContext: null/);
  assert.match(routesSource, /designSkillContext: workspace\.codexBuildHandoff\.designSkillContext/);
  assert.match(source, /Keep prices, deposits, payment references, operator notes, credentials and private client details out of public GitHub text/);
});
