import "../server/env-loader";
import { updateRevenuePublicLeadCandidateVerification } from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateVerificationUpdateInput,
  formatRevenuePublicCandidateVerificationUpdateText,
  parseRevenuePublicCandidateVerificationUpdateArgs,
  validateRevenuePublicCandidateVerificationUpdateOptions,
} from "../server/revenue-public-candidate-verification-update-cli";

async function main() {
  const options = parseRevenuePublicCandidateVerificationUpdateArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicCandidateVerificationUpdateOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const input = buildRevenuePublicCandidateVerificationUpdateInput(options);
  const result = updateRevenuePublicLeadCandidateVerification(input);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicCandidateVerificationUpdateText(result));
  process.exit(result.updated ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
