import "../server/env-loader";
import {
  formatRevenueOutreachSendText,
  getRevenueOutreachSendExitCode,
  parseRevenueOutreachSendArgs,
  sendRevenueOutreachDraftFromCli,
  validateRevenueOutreachSendOptions,
} from "../server/revenue-outreach-send-cli";

async function main() {
  const options = parseRevenueOutreachSendArgs(process.argv.slice(2));
  const validationErrors = validateRevenueOutreachSendOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = await sendRevenueOutreachDraftFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueOutreachSendText(result));
  process.exitCode = getRevenueOutreachSendExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
