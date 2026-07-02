import "../server/env-loader";
import {
  buildRevenueWebsiteCreationPacketFromCli,
  formatRevenueWebsiteCreationPacketText,
  getRevenueWebsiteCreationPacketExitCode,
  parseRevenueWebsiteCreationPacketArgs,
  validateRevenueWebsiteCreationPacketOptions,
} from "../server/revenue-website-creation-packet-cli";

async function main() {
  const options = parseRevenueWebsiteCreationPacketArgs(process.argv.slice(2));
  const validationErrors = validateRevenueWebsiteCreationPacketOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueWebsiteCreationPacketFromCli(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueWebsiteCreationPacketText(packet));
  process.exit(getRevenueWebsiteCreationPacketExitCode(packet));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
