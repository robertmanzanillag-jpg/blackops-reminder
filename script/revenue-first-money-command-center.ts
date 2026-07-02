import "../server/env-loader";
import {
  buildRevenueFirstMoneyCommandCenter,
  formatRevenueFirstMoneyCommandCenterText,
  getRevenueFirstMoneyCommandCenterExitCode,
  parseRevenueFirstMoneyCommandCenterArgs,
  validateRevenueFirstMoneyCommandCenterOptions,
} from "../server/revenue-first-money-command-center-cli";

async function main() {
  const options = parseRevenueFirstMoneyCommandCenterArgs(process.argv.slice(2));
  const validationErrors = validateRevenueFirstMoneyCommandCenterOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueFirstMoneyCommandCenter(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueFirstMoneyCommandCenterText(packet));
  process.exit(getRevenueFirstMoneyCommandCenterExitCode(packet));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
