import "../server/env-loader";
import { getRevenueEngineSnapshot } from "../server/revenue-engine";
import {
  buildRevenueMoneyReadinessReport,
  formatRevenueMoneyReadinessText,
  parseRevenueMoneyReadinessArgs,
  validateRevenueMoneyReadinessOptions,
} from "../server/revenue-engine-money-readiness-cli";

function main() {
  const options = parseRevenueMoneyReadinessArgs(process.argv.slice(2));
  const errors = validateRevenueMoneyReadinessOptions(options);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  const report = buildRevenueMoneyReadinessReport(getRevenueEngineSnapshot(), options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatRevenueMoneyReadinessText(report));
  process.exit(report.ready ? 0 : 1);
}

main();
