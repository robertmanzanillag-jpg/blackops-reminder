import "../server/env-loader";
import {
  formatRevenueLedgerRecordText,
  getRevenueLedgerRecordExitCode,
  parseRevenueLedgerRecordArgs,
  recordRevenueLedgerEntryFromCli,
  validateRevenueLedgerRecordOptions,
} from "../server/revenue-ledger-record-cli";

async function main() {
  const options = parseRevenueLedgerRecordArgs(process.argv.slice(2));
  const validationErrors = validateRevenueLedgerRecordOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = recordRevenueLedgerEntryFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueLedgerRecordText(result));
  process.exitCode = getRevenueLedgerRecordExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
