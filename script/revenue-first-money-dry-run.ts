import "../server/env-loader";
import {
  buildRevenueFirstMoneyDryRun,
  formatRevenueFirstMoneyDryRunText,
  getRevenueFirstMoneyDryRunExitCode,
  parseRevenueFirstMoneyDryRunArgs,
  validateRevenueFirstMoneyDryRunOptions,
} from "../server/revenue-first-money-dry-run-cli";

async function main() {
  const options = parseRevenueFirstMoneyDryRunArgs(process.argv.slice(2));
  const validationErrors = validateRevenueFirstMoneyDryRunOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenueFirstMoneyDryRun(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueFirstMoneyDryRunText(result));
  process.exitCode = getRevenueFirstMoneyDryRunExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
