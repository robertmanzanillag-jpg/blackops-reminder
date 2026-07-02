import {
  buildRevenueContactPathReadinessPacketFromCli,
  formatRevenueContactPathReadinessPacketText,
  getRevenueContactPathReadinessPacketExitCode,
  parseRevenueContactPathReadinessPacketArgs,
  validateRevenueContactPathReadinessPacketOptions,
} from "../server/revenue-contact-path-readiness-packet-cli";

const options = parseRevenueContactPathReadinessPacketArgs(process.argv.slice(2));
const errors = validateRevenueContactPathReadinessPacketOptions(options);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const packet = buildRevenueContactPathReadinessPacketFromCli(options);

if (options.json) console.log(JSON.stringify(packet, null, 2));
else console.log(formatRevenueContactPathReadinessPacketText(packet));

process.exit(getRevenueContactPathReadinessPacketExitCode(packet));
