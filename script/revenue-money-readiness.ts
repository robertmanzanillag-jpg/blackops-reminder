import "../server/env-loader";
import { buildRevenueMoneyReadinessReport } from "../server/revenue-engine";
import {
  formatRevenueMoneyReadinessText,
  parseRevenueMoneyReadinessArgs,
  validateRevenueMoneyReadinessOptions,
} from "../server/revenue-money-readiness-cli";

async function main() {
  const options = parseRevenueMoneyReadinessArgs(process.argv.slice(2));
  const validationErrors = validateRevenueMoneyReadinessOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const report = buildRevenueMoneyReadinessReport({ mode: options.mode as "first-sprint" | "production-launch" });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatRevenueMoneyReadinessText(report));
  process.exit(report.ready ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
