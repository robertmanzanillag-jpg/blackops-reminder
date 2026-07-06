import "../server/env-loader";
import {
  buildRevenueScoutDispatchCliPacket,
  formatRevenueScoutDispatchText,
  parseRevenueScoutDispatchArgs,
  runRevenueScoutDispatchFromCliOptions,
  validateRevenueScoutDispatchOptions,
} from "../server/revenue-scout-dispatch-cli";

function main() {
  const options = parseRevenueScoutDispatchArgs(process.argv.slice(2));
  const errors = validateRevenueScoutDispatchOptions(options);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  const result = runRevenueScoutDispatchFromCliOptions(options);
  const packet = buildRevenueScoutDispatchCliPacket(result);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatRevenueScoutDispatchText(packet));
  process.exit(packet.status === "dispatch_ready" && packet.safety.sendsOutreach === false && packet.safety.spendsMoney === false && packet.safety.deploys === false ? 0 : 1);
}

main();
