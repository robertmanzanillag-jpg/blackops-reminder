import "../server/env-loader";
import { readFileSync } from "node:fs";
import { recordRevenuePublicScoutRun } from "../server/revenue-engine";
import {
  buildRevenuePublicScoutInput,
  buildRevenuePublicScoutSample,
  formatRevenuePublicScoutRunText,
  getRevenuePublicScoutRunExitCode,
  parseRevenuePublicScoutArgs,
  validateRevenuePublicScoutOptions,
} from "../server/revenue-public-scout-run-cli";

async function main() {
  const options = parseRevenuePublicScoutArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicScoutOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  if (options.sample) {
    console.log(JSON.stringify(buildRevenuePublicScoutSample(options), null, 2));
    process.exit(0);
  }

  const rawJson = readFileSync(options.inputPath, "utf8");
  const input = buildRevenuePublicScoutInput(rawJson, options);
  const result = recordRevenuePublicScoutRun(input);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicScoutRunText(result));
  process.exit(getRevenuePublicScoutRunExitCode(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
