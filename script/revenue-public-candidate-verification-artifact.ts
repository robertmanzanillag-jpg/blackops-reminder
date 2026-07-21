import "../server/env-loader";
import {
  buildRevenuePublicCandidateVerificationArtifactFromCli,
  formatRevenuePublicCandidateVerificationArtifactText,
  getRevenuePublicCandidateVerificationArtifactExitCode,
  parseRevenuePublicCandidateVerificationArtifactArgs,
  validateRevenuePublicCandidateVerificationArtifactOptions,
} from "../server/revenue-public-candidate-verification-artifact-cli";

async function main() {
  const options = parseRevenuePublicCandidateVerificationArtifactArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicCandidateVerificationArtifactOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenuePublicCandidateVerificationArtifactFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicCandidateVerificationArtifactText(result));
  process.exit(getRevenuePublicCandidateVerificationArtifactExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
