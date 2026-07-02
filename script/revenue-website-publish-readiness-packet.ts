import "../server/env-loader";
import {
  buildRevenueWebsitePublishReadinessPacketFromCli,
  formatRevenueWebsitePublishReadinessPacketText,
  getRevenueWebsitePublishReadinessPacketExitCode,
  parseRevenueWebsitePublishReadinessPacketArgs,
  validateRevenueWebsitePublishReadinessPacketOptions,
} from "../server/revenue-website-publish-readiness-packet-cli";

async function main() {
  const options = parseRevenueWebsitePublishReadinessPacketArgs(process.argv.slice(2));
  const validationErrors = validateRevenueWebsitePublishReadinessPacketOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueWebsitePublishReadinessPacketFromCli(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueWebsitePublishReadinessPacketText(packet));
  process.exit(getRevenueWebsitePublishReadinessPacketExitCode(packet));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
