import "../server/env-loader";
import {
  buildRevenuePaymentPathApprovalDecisionFromCli,
  formatRevenuePaymentPathApprovalDecisionText,
  getRevenuePaymentPathApprovalDecisionExitCode,
  parseRevenuePaymentPathApprovalDecisionArgs,
  validateRevenuePaymentPathApprovalDecisionOptions,
} from "../server/revenue-payment-path-approval-decision-cli";

async function main() {
  const options = parseRevenuePaymentPathApprovalDecisionArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePaymentPathApprovalDecisionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenuePaymentPathApprovalDecisionFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePaymentPathApprovalDecisionText(result));
  process.exit(getRevenuePaymentPathApprovalDecisionExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
