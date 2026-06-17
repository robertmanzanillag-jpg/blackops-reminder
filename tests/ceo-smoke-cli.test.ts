import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCeoSmokeReport,
  formatCeoSmokeJson,
  formatCeoSmokeText,
  parseCeoSmokeArgs,
  validateCeoSmokeOptions,
} from "../server/ceo-smoke-cli";
import {
  buildCeoBackupCheckReport,
} from "../server/ceo-backup-check-cli";
import {
  REQUIRED_CEO_DB_TABLES,
  buildCeoDbCheckReport,
} from "../server/ceo-db-check-cli";
import type { CeoReadinessReport } from "../server/ceo-readiness";

const readyReadiness: CeoReadinessReport = {
  ready: true,
  status: "ready",
  checks: [
    { id: "auth", label: "Auth", status: "ready", detail: "Resolved user context." },
  ],
};

const readyDb = buildCeoDbCheckReport({
  databaseUrlConfigured: true,
  existingTables: Array.from(REQUIRED_CEO_DB_TABLES),
});

const readyBackup = buildCeoBackupCheckReport({
  databaseUrlConfigured: true,
  backupDir: "backups/ceo-assistant",
  backupDirWritable: true,
  encryptedSecretBackupConfigured: true,
  availableTools: {
    pg_dump: true,
    pg_restore: true,
    psql: true,
    tar: true,
  },
  existingArtifactPaths: [],
});

test("parses CEO smoke CLI options", () => {
  assert.deepEqual(
    parseCeoSmokeArgs(["--user-id=user-1", "--chat-id=123", "--send-brief", "--execute", "--json"]),
    { userId: "user-1", chatId: "123", sendBrief: true, execute: true, json: true },
  );
});

test("requires execute and user id before sending a real smoke brief", () => {
  assert.deepEqual(validateCeoSmokeOptions(parseCeoSmokeArgs([])), []);
  assert.deepEqual(validateCeoSmokeOptions(parseCeoSmokeArgs(["--send-brief"])), [
    "--user-id is required when --send-brief is used.",
    "--execute is required with --send-brief to send a real Telegram CEO brief.",
  ]);
  assert.deepEqual(validateCeoSmokeOptions(parseCeoSmokeArgs(["--send-brief", "--user-id=user-1", "--execute"])), []);
});

test("builds CEO smoke readiness from doctor readiness and optional brief", () => {
  const report = buildCeoSmokeReport({
    checks: [{ id: "database", label: "Database", ok: true, detail: "DATABASE_URL configured." }],
    db: readyDb,
    backup: readyBackup,
    readiness: readyReadiness,
    commands: ["npm run ceo:readiness -- --user-id=user-1"],
    brief: { attempted: false, success: true, message: "skipped" },
  });

  assert.equal(report.ready, true);
  assert.equal(report.doctorReady, true);
  assert.equal(report.dbReady, true);
  assert.equal(report.backupReady, true);
  assert.equal(report.readinessReady, true);
  assert.match(formatCeoSmokeText(report), /CEO Assistant Smoke/);
  assert.match(formatCeoSmokeText(report), /Database schema: ready/);
  assert.match(formatCeoSmokeText(report), /Backup\/restore: ready/);
  assert.match(formatCeoSmokeText(report), /Brief: skipped/);
  assert.equal(JSON.parse(formatCeoSmokeJson(report)).ready, true);
});

test("CEO smoke fails if a requested brief fails", () => {
  const report = buildCeoSmokeReport({
    checks: [{ id: "database", label: "Database", ok: true, detail: "DATABASE_URL configured." }],
    db: readyDb,
    backup: readyBackup,
    readiness: readyReadiness,
    commands: [],
    brief: { attempted: true, success: false, message: "Telegram not configured." },
  });

  assert.equal(report.ready, false);
  assert.equal(report.brief.attempted, true);
});

test("CEO smoke fails when schema or backup preflight is not ready", () => {
  const missingDb = buildCeoDbCheckReport({
    databaseUrlConfigured: true,
    existingTables: ["users"],
  });
  const missingBackup = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: false,
    availableTools: {
      pg_dump: true,
      pg_restore: false,
      psql: true,
      tar: true,
    },
    existingArtifactPaths: ["secrets"],
  });
  const report = buildCeoSmokeReport({
    checks: [{ id: "database", label: "Database", ok: true, detail: "DATABASE_URL configured." }],
    db: missingDb,
    backup: missingBackup,
    readiness: readyReadiness,
    commands: [],
    brief: { attempted: false, success: true, message: "skipped" },
  });

  assert.equal(report.ready, false);
  assert.equal(report.dbReady, false);
  assert.equal(report.backupReady, false);
  assert.match(formatCeoSmokeText(report), /telegram_processed_updates missing/);
  assert.match(formatCeoSmokeText(report), /pg_restore missing/);
});
