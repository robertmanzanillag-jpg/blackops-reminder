import "../server/env-loader";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildRevenuePublicScoutExtract,
  formatRevenuePublicScoutExtractText,
  parseRevenuePublicScoutExtractArgs,
  validateRevenuePublicScoutExtractOptions,
} from "../server/revenue-public-scout-extract-cli";

async function main() {
  const options = parseRevenuePublicScoutExtractArgs(process.argv.slice(2));
  const validationErrors = validateRevenuePublicScoutExtractOptions(options, existsSync);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const rawNotes = readFileSync(options.inputPath, "utf8");
  const input = buildRevenuePublicScoutExtract(rawNotes, options);
  if (options.outputPath) {
    writeFileSync(options.outputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  }

  console.log(options.json ? JSON.stringify(input, null, 2) : formatRevenuePublicScoutExtractText(input, options.outputPath));
  process.exit(input.candidates.length > 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
