import "../server/env-loader";
import { writeFileSync } from "node:fs";
import {
  buildRevenuePublicScoutScheduleCli,
  formatRevenuePublicScoutScheduleText,
  parseRevenuePublicScoutScheduleArgs,
  validateRevenuePublicScoutScheduleOptions,
} from "../server/revenue-public-scout-schedule-cli";

async function main() {
  const options = parseRevenuePublicScoutScheduleArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicScoutScheduleOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const schedule = buildRevenuePublicScoutScheduleCli(options);
  if (options.outputPath) {
    writeFileSync(options.outputPath, `${JSON.stringify(schedule, null, 2)}\n`, { encoding: "utf8", flag: options.overwrite ? "w" : "wx" });
  }

  console.log(options.json ? JSON.stringify(schedule, null, 2) : formatRevenuePublicScoutScheduleText(schedule, options.outputPath));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
