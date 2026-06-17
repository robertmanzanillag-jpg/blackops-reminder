import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCeoBackupCheckReport,
  formatCeoBackupCheckJson,
  formatCeoBackupCheckText,
  parseCeoBackupCheckArgs,
} from "../server/ceo-backup-check-cli";

const allTools = {
  pg_dump: true,
  pg_restore: true,
  psql: true,
  tar: true,
};

test("parses CEO backup check CLI options", () => {
  assert.deepEqual(parseCeoBackupCheckArgs(["--json"]), { json: true });
  assert.deepEqual(parseCeoBackupCheckArgs([]), { json: false });
});

test("reports backup readiness when database tools and policies are configured", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: true,
    availableTools: allTools,
    existingArtifactPaths: ["revenue_engine_data", "credentials"],
  });

  assert.equal(report.ready, true);
  assert.equal(report.tools.every((tool) => tool.ok), true);
  assert.equal(report.artifacts.find((artifact) => artifact.path === "credentials")?.policy, "encrypted_only");
});

test("blocks backup readiness when PostgreSQL tools are missing", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: true,
    availableTools: { ...allTools, pg_dump: false },
    existingArtifactPaths: [],
  });

  assert.equal(report.ready, false);
  assert.equal(report.tools.find((tool) => tool.tool === "pg_dump")?.ok, false);
});

test("blocks backup readiness when sensitive local artifacts are not covered by encrypted backups", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: false,
    availableTools: allTools,
    existingArtifactPaths: ["secrets"],
  });

  assert.equal(report.ready, false);
  assert.match(report.artifacts.find((artifact) => artifact.path === "secrets")?.detail || "", /encrypted off-machine storage/);
});

test("formats CEO backup check text and JSON", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: false,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: false,
    encryptedSecretBackupConfigured: false,
    availableTools: {},
    existingArtifactPaths: [],
  });

  assert.match(formatCeoBackupCheckText(report), /CEO Assistant Backup Check/);
  assert.equal(JSON.parse(formatCeoBackupCheckJson(report)).ready, false);
  assert.ok(report.commands.some((command) => command.includes("pg_restore")));
});
