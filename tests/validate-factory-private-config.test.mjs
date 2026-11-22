import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateFactoryPrivateConfig } from "../script/validate-factory-private-config.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "factory-config-test-"));
  const paths = [join(root, "credit.json"), join(root, "operator.json")];
  paths.forEach(p => writeFileSync(p, "{}"));
  try { run(paths); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("valid objects pass syntax preflight without changing files or reporting contents", () => fixture(paths => {
  const lines = [];
  assert.equal(validateFactoryPrivateConfig(paths, x => lines.push(x)), true);
  assert.deepEqual(lines, []);
}));

for (const [index, label] of ["SHARED_CREDIT", "OPERATOR"].entries()) {
  test(`invalid ${label} JSON returns only its static diagnostic`, () => fixture(paths => {
    writeFileSync(paths[index], '{"private":"DO_NOT_PRINT_THIS"} invalid');
    const result = spawnSync(process.execPath, ["script/validate-factory-private-config.mjs", ...paths], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `FACTORY_${label}_CONFIG_INVALID\n`);
  }));
}

test("missing files, scalar JSON, arrays and wrong arguments fail closed", () => fixture(paths => {
  for (const value of ["null", "[]", "42", '\"string\"']) {
    writeFileSync(paths[1], value);
    assert.equal(validateFactoryPrivateConfig(paths, () => {}), false);
  }
  assert.equal(validateFactoryPrivateConfig([paths[0], paths[1] + "absent"], () => {}), false);
  const lines = [];
  assert.equal(validateFactoryPrivateConfig([], x => lines.push(x)), false);
  assert.deepEqual(lines, ["FACTORY_PRIVATE_CONFIG_ARGUMENTS_INVALID"]);
}));
