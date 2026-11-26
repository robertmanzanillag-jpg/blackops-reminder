import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFactorySelectedPaths } from "../server/software-factory-company-auto";
import { validateFactoryOrderPaths } from "../server/software-factory-write-scope";

const listed = ["server/app.ts", "tests/app.test.ts", "client/src/App.tsx"];
const roots = ["server/", "client/", "shared/", "tests/"];

test("harmless spellings of listed paths normalize to the listed path", () => {
  assert.deepEqual(normalizeFactorySelectedPaths(["./server/app.ts", "/tests/app.test.ts", " client/src/app.tsx ", "server/app.ts"], listed),
    ["server/app.ts", "tests/app.test.ts", "client/src/App.tsx"]);
});

test("paths outside write roots or traversal stay rejected after normalization", () => {
  for (const bad of ["../server/app.ts", "./.github/workflows/x.yml", "/etc/passwd", "script/x.mjs", "server/../secrets/a.ts"]) {
    const n = normalizeFactorySelectedPaths([bad, "tests/app.test.ts"], listed);
    assert.throws(() => validateFactoryOrderPaths(n, { roots, maxFiles: 6 }));
  }
});

test("ambiguous case-insensitive match is not guessed", () => {
  assert.deepEqual(normalizeFactorySelectedPaths(["server/x.ts"], ["server/X.ts", "server/x.TS"]), ["server/x.ts"]);
});
