export type CeoBackupCheckOptions = {
  json: boolean;
};

export type CeoBackupToolCheck = {
  tool: "pg_dump" | "pg_restore" | "psql" | "tar";
  ok: boolean;
  detail: string;
};

export type CeoBackupArtifactCheck = {
  path: string;
  exists: boolean;
  sensitive: boolean;
  policy: "include_if_exists" | "encrypted_only";
  detail: string;
};

export type CeoBackupCheckReport = {
  ready: boolean;
  databaseUrlConfigured: boolean;
  backupDir: string;
  backupDirWritable: boolean;
  encryptedSecretBackupConfigured: boolean;
  tools: CeoBackupToolCheck[];
  artifacts: CeoBackupArtifactCheck[];
  commands: string[];
};

export const DEFAULT_CEO_BACKUP_DIR = "backups/ceo-assistant";

export const CEO_BACKUP_ARTIFACT_PATHS = [
  { path: "revenue_engine_data", sensitive: false, policy: "include_if_exists" },
  { path: "revenue_mockups", sensitive: false, policy: "include_if_exists" },
  { path: "radio_video_edits", sensitive: false, policy: "include_if_exists" },
  { path: "promo_video_edits", sensitive: false, policy: "include_if_exists" },
  { path: "credentials", sensitive: true, policy: "encrypted_only" },
  { path: "secrets", sensitive: true, policy: "encrypted_only" },
] as const;

export function parseCeoBackupCheckArgs(argv: string[]): CeoBackupCheckOptions {
  return {
    json: argv.includes("--json"),
  };
}

export function buildCeoBackupCheckReport(input: {
  databaseUrlConfigured: boolean;
  backupDir: string;
  backupDirWritable: boolean;
  encryptedSecretBackupConfigured: boolean;
  availableTools: Partial<Record<CeoBackupToolCheck["tool"], boolean>>;
  existingArtifactPaths: string[];
}): CeoBackupCheckReport {
  const existingArtifacts = new Set(input.existingArtifactPaths);
  const tools: CeoBackupToolCheck[] = (["pg_dump", "pg_restore", "psql", "tar"] as const).map((tool) => ({
    tool,
    ok: Boolean(input.availableTools[tool]),
    detail: input.availableTools[tool]
      ? `${tool} available.`
      : `${tool} missing. Install PostgreSQL client tools and system tar before relying on backup/restore.`,
  }));
  const artifacts: CeoBackupArtifactCheck[] = CEO_BACKUP_ARTIFACT_PATHS.map((artifact) => {
    const exists = existingArtifacts.has(artifact.path);
    const encrypted = !artifact.sensitive || input.encryptedSecretBackupConfigured;
    return {
      ...artifact,
      exists,
      detail: !exists
        ? `${artifact.path} not present; nothing to include right now.`
        : artifact.sensitive && !encrypted
          ? `${artifact.path} exists and must only be backed up with encrypted off-machine storage. Set CEO_BACKUP_SECRETS_ENCRYPTED=true after configuring that process.`
          : `${artifact.path} exists and is covered by the ${artifact.policy} policy.`,
    };
  });
  const sensitiveArtifactsReady = artifacts.every((artifact) => !artifact.exists || !artifact.sensitive || input.encryptedSecretBackupConfigured);
  const ready = input.databaseUrlConfigured
    && input.backupDirWritable
    && tools.every((tool) => tool.ok)
    && sensitiveArtifactsReady;

  return {
    ready,
    databaseUrlConfigured: input.databaseUrlConfigured,
    backupDir: input.backupDir,
    backupDirWritable: input.backupDirWritable,
    encryptedSecretBackupConfigured: input.encryptedSecretBackupConfigured,
    tools,
    artifacts,
    commands: buildCeoBackupCommands(input.backupDir),
  };
}

export function buildCeoBackupCommands(backupDir: string): string[] {
  const dir = backupDir || DEFAULT_CEO_BACKUP_DIR;
  return [
    `mkdir -p ${dir}`,
    `pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="${dir}/postgres.dump"`,
    `tar -czf "${dir}/local-artifacts.tgz" revenue_engine_data revenue_mockups radio_video_edits promo_video_edits 2>/dev/null || true`,
    `psql "$DATABASE_URL" -c "select 1"`,
    `pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DATABASE_URL" "${dir}/postgres.dump"`,
  ];
}

export function formatCeoBackupCheckText(report: CeoBackupCheckReport): string {
  const lines = [
    "CEO Assistant Backup Check",
    `Ready: ${report.ready ? "yes" : "no"}`,
    `DATABASE_URL: ${report.databaseUrlConfigured ? "configured" : "missing"}`,
    `Backup dir: ${report.backupDir} (${report.backupDirWritable ? "writable" : "not writable"})`,
    `Sensitive artifacts: ${report.encryptedSecretBackupConfigured ? "encrypted backup configured" : "encrypted backup not confirmed"}`,
    "",
    "Tools:",
    ...report.tools.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.tool}: ${check.detail}`),
    "",
    "Artifacts:",
    ...report.artifacts.map((check) => `- [${check.exists ? "found" : "absent"}] ${check.path}: ${check.detail}`),
    "",
    "Backup/restore commands:",
    ...report.commands.map((command) => `- ${command}`),
  ];
  return lines.join("\n");
}

export function formatCeoBackupCheckJson(report: CeoBackupCheckReport): string {
  return JSON.stringify(report, null, 2);
}
