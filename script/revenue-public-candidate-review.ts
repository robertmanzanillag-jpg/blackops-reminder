import "../server/env-loader";
import { reviewRevenuePublicLeadCandidates } from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateReviewInput,
  formatRevenuePublicCandidateReviewText,
  getRevenuePublicCandidateReviewExitCode,
  parseRevenuePublicCandidateReviewArgs,
  validateRevenuePublicCandidateReviewOptions,
} from "../server/revenue-public-candidate-review-cli";

async function main() {
  const options = parseRevenuePublicCandidateReviewArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicCandidateReviewOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const input = buildRevenuePublicCandidateReviewInput(options);
  const result = reviewRevenuePublicLeadCandidates(input);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicCandidateReviewText(result));
  process.exit(getRevenuePublicCandidateReviewExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
