import "../server/env-loader";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildRevenuePublicScoutExecute,
  formatRevenuePublicScoutExecuteText,
  getRevenuePublicScoutExecuteExitCode,
  parseRevenuePublicScoutExecuteArgs,
  validateRevenuePublicScoutExecuteOptions,
  validateRevenuePublicScoutExecuteResolvedPaths,
} from "../server/revenue-public-scout-execute-cli";

async function main() {
  const options = parseRevenuePublicScoutExecuteArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicScoutExecuteOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const rawSchedule = readFileSync(options.schedulePath, "utf8");
  const schedule = JSON.parse(rawSchedule) as { runs?: Array<{ id: string; captureNotesPath: string }> };
  const run = options.runId
    ? schedule.runs?.find((item) => item.id === options.runId)
    : schedule.runs?.[0];
  const notesPath = options.notesPath || run?.captureNotesPath || "";
  if (!notesPath) {
    console.error("--notes is required when the schedule run does not define captureNotesPath.");
    process.exit(1);
  }
  const resolvedPathErrors = validateRevenuePublicScoutExecuteResolvedPaths({
    notesPath,
    extractedJsonPath: run?.extractedJsonPath,
    writeExtracted: options.writeExtracted,
  });
  if (resolvedPathErrors.length) {
    console.error(resolvedPathErrors.join("\n"));
    process.exit(1);
  }
  const rawNotes = readFileSync(notesPath, "utf8");
  const result = buildRevenuePublicScoutExecute(rawSchedule, rawNotes, { ...options, notesPath }, (filePath, content) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, { encoding: "utf8", flag: "w" });
  });
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicScoutExecuteText(result));
  process.exitCode = getRevenuePublicScoutExecuteExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
