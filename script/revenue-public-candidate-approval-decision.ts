import "../server/env-loader";
import {
  buildRevenuePublicCandidateApprovalDecisionFromCli,
  formatRevenuePublicCandidateApprovalDecisionText,
  getRevenuePublicCandidateApprovalDecisionExitCode,
  parseRevenuePublicCandidateApprovalDecisionArgs,
  validateRevenuePublicCandidateApprovalDecisionOptions,
} from "../server/revenue-public-candidate-approval-decision-cli";

async function main() {
  const options = parseRevenuePublicCandidateApprovalDecisionArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicCandidateApprovalDecisionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenuePublicCandidateApprovalDecisionFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicCandidateApprovalDecisionText(result));
  process.exitCode = getRevenuePublicCandidateApprovalDecisionExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
