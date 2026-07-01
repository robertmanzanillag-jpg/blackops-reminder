import "../server/env-loader";
import {
  buildRevenueOutreachApprovalPacketFromCli,
  formatRevenueOutreachApprovalPacketText,
  getRevenueOutreachApprovalPacketExitCode,
  parseRevenueOutreachApprovalPacketArgs,
  validateRevenueOutreachApprovalPacketOptions,
} from "../server/revenue-outreach-approval-packet-cli";

async function main() {
  const options = parseRevenueOutreachApprovalPacketArgs(process.argv.slice(2));
  const validationErrors = validateRevenueOutreachApprovalPacketOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueOutreachApprovalPacketFromCli(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueOutreachApprovalPacketText(packet));
  process.exit(getRevenueOutreachApprovalPacketExitCode(packet));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
