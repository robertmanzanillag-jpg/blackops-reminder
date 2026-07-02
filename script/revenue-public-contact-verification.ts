import "../server/env-loader";
import { listRevenuePublicLeadCandidates } from "../server/revenue-engine";
import {
  buildRevenuePublicContactVerificationPacket,
  formatRevenuePublicContactVerificationText,
  parseRevenuePublicContactVerificationArgs,
  validateRevenuePublicContactVerificationOptions,
} from "../server/revenue-public-contact-verification-cli";

async function main() {
  const options = parseRevenuePublicContactVerificationArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicContactVerificationOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenuePublicContactVerificationPacket(
    listRevenuePublicLeadCandidates(),
    options,
  );
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenuePublicContactVerificationText(packet));
  process.exit(packet.taskCount > 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
