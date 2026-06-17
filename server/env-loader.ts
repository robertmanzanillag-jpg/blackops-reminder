import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const LOCAL_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.replit",
  "CEO_ASSISTANT_ENV",
  "CEO_ASSISTANT_ENV.local",
];

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string): number {
  const raw = readFileSync(filePath, "utf8");
  let loaded = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const clean = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = clean.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = clean.slice(0, separatorIndex).trim();
    const value = stripOptionalQuotes(clean.slice(separatorIndex + 1));
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] !== undefined) continue;

    process.env[key] = value;
    loaded += 1;
  }

  return loaded;
}

export function loadLocalEnvFiles(cwd = process.cwd()): string[] {
  const loadedFiles: string[] = [];

  for (const fileName of LOCAL_ENV_FILES) {
    const filePath = path.join(cwd, fileName);
    if (!existsSync(filePath)) continue;
    const loaded = loadEnvFile(filePath);
    if (loaded > 0) loadedFiles.push(fileName);
  }

  return loadedFiles;
}

loadLocalEnvFiles();
