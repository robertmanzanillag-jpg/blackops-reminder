import "../server/env-loader";
import {
  buildRevenueMoneySprintRunPacketExecution,
  formatRevenueMoneySprintRunPacketExecutionText,
  getRevenueMoneySprintRunPacketExitCode,
  parseRevenueMoneySprintRunPacketArgs,
  readRevenueMoneySprintRunPacketInput,
  validateRevenueMoneySprintRunPacketOptions,
} from "../server/revenue-money-sprint-run-packet-cli";

async function main() {
  const options = parseRevenueMoneySprintRunPacketArgs(process.argv.slice(2));
  const validationErrors = validateRevenueMoneySprintRunPacketOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const review = readRevenueMoneySprintRunPacketInput(options.inputPath);
  const result = buildRevenueMoneySprintRunPacketExecution(review, options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueMoneySprintRunPacketExecutionText(result));
  process.exit(getRevenueMoneySprintRunPacketExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
