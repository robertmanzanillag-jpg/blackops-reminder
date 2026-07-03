import "../server/env-loader";
import {
  buildRevenueFirstMoneyCommandCenter,
  formatRevenueFirstMoneyCommandCenterText,
  isRevenueFirstMoneyCommandCenterReadyForMode,
  parseRevenueFirstMoneyCommandCenterArgs,
  validateRevenueFirstMoneyCommandCenterOptions,
} from "../server/revenue-first-money-command-center-cli";

function main() {
  const options = parseRevenueFirstMoneyCommandCenterArgs(process.argv.slice(2));
  const errors = validateRevenueFirstMoneyCommandCenterOptions(options);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueFirstMoneyCommandCenter(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueFirstMoneyCommandCenterText(packet));
  process.exit(isRevenueFirstMoneyCommandCenterReadyForMode(packet) ? 0 : 1);
}

main();
