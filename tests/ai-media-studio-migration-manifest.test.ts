import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

type MigrationFile = { path: string; sha256: string };
type MigrationEntry = {
  order: number;
  pullRequest: string;
  provenanceCommit: string;
  forward: MigrationFile;
  rollback: MigrationFile;
};
type Manifest = {
  formatVersion: number;
  status: string;
  historicalBaseline: {
    sourceCommit: string;
    sourcePath: string;
    sourceBlob: string;
    sourceSha256: string;
    reason: string;
  };
  migrations: MigrationEntry[];
  schemaNeutralPullRequests: Array<{ pullRequest: string; reason: string; provenanceCommit: string }>;
  pr26: {
    stopBeforeForward: boolean;
    requiredRoles: Array<{ name: string; login: boolean; inherit: boolean }>;
    forbiddenAttributes: string[];
    separateLoginPrincipalsRequired: boolean;
  };
  stops: Array<{ after?: string; before?: string; reason: string }>;
};

const migrationDirectory = new URL("../migrations/ai-media-studio/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", migrationDirectory), "utf8")) as Manifest;
const digest = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

test("migration manifest is the exact, hashed 22-pair inventory", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.status, "preparation-only-no-go");
  assert.deepEqual(manifest.historicalBaseline, {
    sourceCommit: "8b30f1849523ba255b6fcbbedc676c3aaba35ae4",
    sourcePath: "shared/models/ai-media-studio-db.ts",
    sourceBlob: "4678f3b60595fe272ce11999806a4634317edb03",
    sourceSha256: "560ac47625eb1a14297a5a5d127be7cc267d5de3c1943d51ea7e19640be1972d",
    reason: "PR1 reconstructs the exact historical foundation needed before PR2; it refuses any pre-existing ai_media_* baseline instead of adopting inferred state.",
  });
  assert.equal(manifest.migrations.length, 22);
  assert.deepEqual(manifest.migrations.map((entry) => entry.order), Array.from({ length: 22 }, (_, index) => index + 1));
  assert.equal(new Set(manifest.migrations.map((entry) => entry.pullRequest)).size, 22);

  const files = readdirSync(migrationDirectory)
    .filter((name) => /_(?:forward|rollback)\.sql$/u.test(name))
    .sort();
  const inventoried = manifest.migrations
    .flatMap((entry) => [entry.forward.path, entry.rollback.path])
    .map((path) => path.replace("migrations/ai-media-studio/", ""))
    .sort();
  assert.deepEqual(inventoried, files, "every SQL migration file must appear exactly once");

  for (const entry of manifest.migrations) {
    assert.match(entry.provenanceCommit, /^[0-9a-f]{8,40}$/u);
    for (const file of [entry.forward, entry.rollback]) {
      assert.match(file.path, /^migrations\/ai-media-studio\/[a-z0-9_]+\.sql$/u);
      assert.match(file.sha256, /^[0-9a-f]{64}$/u);
      const bytes = readFileSync(new URL(file.path.replace("migrations/ai-media-studio/", ""), migrationDirectory));
      assert.equal(digest(bytes), file.sha256, `${file.path} hash drifted`);
    }
  }
});

test("historical schema-neutral gaps are explicit and cannot become inferred SQL", () => {
  assert.deepEqual(manifest.schemaNeutralPullRequests.map((entry) => entry.pullRequest), [
    "PR7", "PR10", "PR13", "PR17", "PR18", "PR21",
  ]);
  for (const entry of manifest.schemaNeutralPullRequests) {
    assert.ok(entry.reason.length >= 30, `${entry.pullRequest} needs a reviewed reason`);
    assert.match(entry.provenanceCommit, /^[0-9a-f]{8,40}$/u);
  }
  const migrationPullRequests = new Set(manifest.migrations.map((entry) => entry.pullRequest));
  for (const entry of manifest.schemaNeutralPullRequests) assert.equal(migrationPullRequests.has(entry.pullRequest), false);
});

test("PR26 role prerequisites and mandatory stops remain fail-closed", () => {
  assert.equal(manifest.pr26.stopBeforeForward, true);
  assert.equal(manifest.pr26.separateLoginPrincipalsRequired, true);
  assert.deepEqual(manifest.pr26.requiredRoles, [
    { name: "ai_media_admitted_fn_owner", login: false, inherit: false },
    { name: "ai_media_admitted_submit_executor", login: false, inherit: false },
    { name: "ai_media_admitted_reconcile_executor", login: false, inherit: false },
  ]);
  assert.deepEqual(manifest.pr26.forbiddenAttributes, [
    "SUPERUSER", "CREATEROLE", "CREATEDB", "REPLICATION", "BYPASSRLS",
  ]);
  assert.ok(manifest.stops.some((gate) => gate.after === "PR16B" && gate.before === "PR19"));
  assert.ok(manifest.stops.some((gate) => gate.before === "PR26"));
  assert.ok(manifest.stops.every((gate) => gate.reason.length >= 30));
});

test("checked-in migration SQL cannot perform provider or network I/O", () => {
  for (const entry of manifest.migrations) {
    for (const file of [entry.forward, entry.rollback]) {
      const sql = readFileSync(new URL(file.path.replace("migrations/ai-media-studio/", ""), migrationDirectory), "utf8");
      assert.doesNotMatch(sql, /\b(?:dblink|http_get|http_post|curl|wget|COPY\s+PROGRAM|lo_import)\b|\bnet\.http_/iu,
        `${file.path} contains an external-I/O primitive`);
      const ownsTransaction = /BEGIN;/u.test(sql) && /COMMIT;/u.test(sql);
      const evidencePreservingNoOp = /rollback is application-only and data preserving/iu.test(sql)
        && /intentionally contains no executable destructive SQL/iu.test(sql);
      assert.ok(ownsTransaction || evidencePreservingNoOp,
        `${file.path} must own a transaction or be an explicit evidence-preserving no-op rollback`);
    }
  }
});
