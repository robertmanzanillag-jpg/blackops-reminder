import "../server/env-loader";
import {
  buildRevenueOutreachApprovalDecisionFromCli,
  formatRevenueOutreachApprovalDecisionText,
  getRevenueOutreachApprovalDecisionExitCode,
  parseRevenueOutreachApprovalDecisionArgs,
  validateRevenueOutreachApprovalDecisionOptions,
} from "../server/revenue-outreach-approval-decision-cli";

async function main() {
  const options = parseRevenueOutreachApprovalDecisionArgs(process.argv.slice(2));
  const validationErrors = validateRevenueOutreachApprovalDecisionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenueOutreachApprovalDecisionFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueOutreachApprovalDecisionText(result));
  process.exitCode = getRevenueOutreachApprovalDecisionExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
