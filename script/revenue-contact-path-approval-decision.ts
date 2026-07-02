import {
  buildRevenueContactPathApprovalDecisionFromCli,
  formatRevenueContactPathApprovalDecisionText,
  getRevenueContactPathApprovalDecisionExitCode,
  parseRevenueContactPathApprovalDecisionArgs,
  validateRevenueContactPathApprovalDecisionOptions,
} from "../server/revenue-contact-path-approval-decision-cli";

const options = parseRevenueContactPathApprovalDecisionArgs(process.argv.slice(2));
const errors = validateRevenueContactPathApprovalDecisionOptions(options);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const result = buildRevenueContactPathApprovalDecisionFromCli(options);

if (options.json) console.log(JSON.stringify(result, null, 2));
else console.log(formatRevenueContactPathApprovalDecisionText(result));

process.exit(getRevenueContactPathApprovalDecisionExitCode(result));
