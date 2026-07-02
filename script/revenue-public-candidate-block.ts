import "../server/env-loader";
import {
  buildRevenuePublicCandidateBlockFromCli,
  formatRevenuePublicCandidateBlockText,
  getRevenuePublicCandidateBlockExitCode,
  parseRevenuePublicCandidateBlockArgs,
  validateRevenuePublicCandidateBlockOptions,
} from "../server/revenue-public-candidate-block-cli";

async function main() {
  const options = parseRevenuePublicCandidateBlockArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicCandidateBlockOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenuePublicCandidateBlockFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenuePublicCandidateBlockText(result));
  process.exitCode = getRevenuePublicCandidateBlockExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
