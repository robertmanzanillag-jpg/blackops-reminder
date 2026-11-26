import test from "node:test";
import assert from "node:assert/strict";
import { officeUiCandidatePathAllowed, officeUiCandidateScopeValid, parseRawDiff } from "../script/software-factory-office-ui-acceptance";
import { OFFICE_UI_HARNESS_FILES } from "../script/software-factory-ui-static.mjs";
const m = (path: string, oldMode = "100644", newMode = "100644") => ({ path, oldMode, newMode });

test("office UI candidate scope admits office screen, backend leaf and tests (run 45890535176 shape)", () => {
  for (const p of ["client/src/components/agents-world-office/agents-office-world.tsx", "client/src/components/agents-world-office/sub/x.ts", "client/src/pages/agents-office.tsx", "client/src/pages/agents-office-world.tsx", "server/office-role-work.ts", "tests/app-qa-agent.test.ts", "tests/office-role-work.test.ts", "tests/sub/a.test.ts"])
    assert.equal(officeUiCandidatePathAllowed(p), true, p);
  assert.equal(officeUiCandidateScopeValid([m("client/src/components/agents-world-office/agents-office-world.tsx"), m("tests/app-qa-agent.test.ts")]), true);
});

test("office UI candidate scope denies harness, workflows, scripts, packages, secrets and traversal", () => {
  for (const p of [...OFFICE_UI_HARNESS_FILES, ".github/workflows/factory-candidate-checks.yml", "script/build.ts", "package.json", "package-lock.json", ".env", "secrets/key.pem", "credentials/a.json", "server/office-role-snapshots.ts", "server/routes.ts", "client/src/pages/home.tsx", "client/src/pages/agents-office.ts", "client/src/components/agents-world-office/../../App.tsx", "client/src/components/agents-world-office/.env", "tests/helper.ts", "tests/a.test.mjs", "vite.config.ts", "tests/../package.json.test.ts", ""])
    assert.equal(officeUiCandidatePathAllowed(p), false, p);
  assert.equal(officeUiCandidateScopeValid([]), false);
  assert.equal(officeUiCandidateScopeValid([m("server/office-role-work.ts"), m("script/software-factory-office-ui-oracle.mjs")]), false);
});

test("office UI candidate scope rejects symlinks, executables and submodules; accepts add/delete", () => {
  const f = "client/src/components/agents-world-office/office-scene.ts";
  assert.equal(officeUiCandidateScopeValid([m(f, "000000", "120000")]), false);
  assert.equal(officeUiCandidateScopeValid([m(f, "100644", "100755")]), false);
  assert.equal(officeUiCandidateScopeValid([m(f, "000000", "160000")]), false);
  assert.equal(officeUiCandidateScopeValid([m(f, "000000", "100644"), m("tests/x.test.ts", "100644", "000000")]), true);
});

test("raw diff parser reads NUL-separated git output and fails closed on garbage", () => {
  const raw = `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M\0server/office-role-work.ts\0:000000 120000 ${"0".repeat(40)} ${"c".repeat(40)} A\0tests/x.test.ts\0`;
  assert.deepEqual(parseRawDiff(raw), [m("server/office-role-work.ts"), m("tests/x.test.ts", "000000", "120000")]);
  assert.throws(() => parseRawDiff(`:100644 100644 a b R100\0x\0y\0`), /UI_CANDIDATE_SCOPE_INVALID/);
  assert.throws(() => parseRawDiff("garbage\0"), /UI_CANDIDATE_SCOPE_INVALID/);
});
