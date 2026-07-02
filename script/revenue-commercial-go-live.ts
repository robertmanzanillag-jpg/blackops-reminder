import "../server/env-loader";
import {
  buildRevenueCommercialGoLivePacket,
  formatRevenueCommercialGoLivePacketText,
  parseRevenueCommercialGoLiveArgs,
  validateRevenueCommercialGoLiveOptions,
} from "../server/revenue-commercial-go-live-cli";

async function main() {
  const options = parseRevenueCommercialGoLiveArgs(process.argv.slice(2));
  const validationErrors = validateRevenueCommercialGoLiveOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenueCommercialGoLivePacket(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueCommercialGoLivePacketText(packet));
  process.exit(packet.status === "ready_for_commercial_go_live" ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
