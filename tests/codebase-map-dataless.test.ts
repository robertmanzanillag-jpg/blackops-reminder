import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

type GeneratedCodebaseMap = {
  files: Array<{ path: string }>;
  skippedDatalessFiles: string[];
  guardrails: string[];
};

test("generated codebase map excludes macOS dataless placeholders", async () => {
  const map = JSON.parse(
    await readFile(path.resolve(process.cwd(), "docs/codebase-map.json"), "utf8"),
  ) as GeneratedCodebaseMap;

  assert.ok(Array.isArray(map.skippedDatalessFiles));
  assert.ok(map.guardrails.some((guardrail) => guardrail.includes("dataless")));

  const indexedFiles = new Set(map.files.map((file) => file.path));
  for (const skippedFile of map.skippedDatalessFiles) {
    assert.equal(indexedFiles.has(skippedFile), false, `${skippedFile} must not be indexed`);
  }
});
