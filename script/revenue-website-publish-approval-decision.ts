import "../server/env-loader";
import {
  buildRevenueWebsitePublishApprovalDecisionFromCli,
  formatRevenueWebsitePublishApprovalDecisionText,
  getRevenueWebsitePublishApprovalDecisionExitCode,
  parseRevenueWebsitePublishApprovalDecisionArgs,
  validateRevenueWebsitePublishApprovalDecisionOptions,
} from "../server/revenue-website-publish-approval-decision-cli";

async function main() {
  const options = parseRevenueWebsitePublishApprovalDecisionArgs(process.argv.slice(2));
  const validationErrors = validateRevenueWebsitePublishApprovalDecisionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenueWebsitePublishApprovalDecisionFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueWebsitePublishApprovalDecisionText(result));
  process.exit(getRevenueWebsitePublishApprovalDecisionExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
