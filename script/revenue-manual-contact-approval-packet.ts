import "../server/env-loader";
import {
  buildRevenueManualContactApprovalPacketFromCli,
  formatRevenueManualContactApprovalPacketText,
  getRevenueManualContactApprovalPacketExitCode,
  parseRevenueManualContactApprovalPacketArgs,
  validateRevenueManualContactApprovalPacketOptions,
} from "../server/revenue-manual-contact-approval-packet-cli";

async function main() {
  const options = parseRevenueManualContactApprovalPacketArgs(process.argv.slice(2));
  const validationErrors = validateRevenueManualContactApprovalPacketOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueManualContactApprovalPacketFromCli(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueManualContactApprovalPacketText(packet));
  process.exitCode = getRevenueManualContactApprovalPacketExitCode(packet);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
