import "../server/env-loader";
import {
  buildRevenueWebsiteCreationApprovalDecisionFromCli,
  formatRevenueWebsiteCreationApprovalDecisionText,
  getRevenueWebsiteCreationApprovalDecisionExitCode,
  parseRevenueWebsiteCreationApprovalDecisionArgs,
  validateRevenueWebsiteCreationApprovalDecisionOptions,
} from "../server/revenue-website-creation-approval-decision-cli";

async function main() {
  const options = parseRevenueWebsiteCreationApprovalDecisionArgs(process.argv.slice(2));
  const validationErrors = validateRevenueWebsiteCreationApprovalDecisionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenueWebsiteCreationApprovalDecisionFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueWebsiteCreationApprovalDecisionText(result));
  process.exitCode = getRevenueWebsiteCreationApprovalDecisionExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
