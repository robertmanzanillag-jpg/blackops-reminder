import "../server/env-loader";
import {
  buildRevenuePaymentPathReadinessPacketFromCli,
  formatRevenuePaymentPathReadinessPacketText,
  getRevenuePaymentPathReadinessPacketExitCode,
  parseRevenuePaymentPathReadinessPacketArgs,
  validateRevenuePaymentPathReadinessPacketOptions,
} from "../server/revenue-payment-path-readiness-packet-cli";

async function main() {
  const options = parseRevenuePaymentPathReadinessPacketArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePaymentPathReadinessPacketOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const packet = buildRevenuePaymentPathReadinessPacketFromCli(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenuePaymentPathReadinessPacketText(packet));
  process.exit(getRevenuePaymentPathReadinessPacketExitCode(packet));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
