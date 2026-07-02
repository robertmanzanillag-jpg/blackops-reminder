import "../server/env-loader";
import {
  buildRevenueLedgerApprovalDecisionFromCli,
  formatRevenueLedgerApprovalDecisionText,
  getRevenueLedgerApprovalDecisionExitCode,
  parseRevenueLedgerApprovalDecisionArgs,
  validateRevenueLedgerApprovalDecisionOptions,
} from "../server/revenue-ledger-approval-decision-cli";

async function main() {
  const options = parseRevenueLedgerApprovalDecisionArgs(process.argv.slice(2));
  const validationErrors = validateRevenueLedgerApprovalDecisionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const result = buildRevenueLedgerApprovalDecisionFromCli(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatRevenueLedgerApprovalDecisionText(result));
  process.exitCode = getRevenueLedgerApprovalDecisionExitCode(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
