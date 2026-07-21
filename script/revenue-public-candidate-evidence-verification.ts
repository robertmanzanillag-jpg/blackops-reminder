import "../server/env-loader";
import {
  buildRevenuePublicCandidateEvidenceVerificationFromCli,
  formatRevenuePublicCandidateEvidenceVerificationText,
  getRevenuePublicCandidateEvidenceVerificationExitCode,
  parseRevenuePublicCandidateEvidenceVerificationArgs,
  validateRevenuePublicCandidateEvidenceVerificationOptions,
} from "../server/revenue-public-candidate-evidence-verification-cli";

async function main() {
  const options = parseRevenuePublicCandidateEvidenceVerificationArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicCandidateEvidenceVerificationOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenuePublicCandidateEvidenceVerificationFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicCandidateEvidenceVerificationText(result));
  process.exit(getRevenuePublicCandidateEvidenceVerificationExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
