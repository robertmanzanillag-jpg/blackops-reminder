import "../server/env-loader";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildRevenueScoutDispatch } from "../server/revenue-engine";
import {
  buildRevenueBrowserScoutDispatchInput,
  buildRevenueBrowserScoutSession,
  formatRevenueBrowserScoutSessionText,
  parseRevenueBrowserScoutSessionArgs,
  validateRevenueBrowserScoutSessionOptions,
} from "../server/revenue-browser-scout-session-cli";

function openUrl(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawnSync(command, args, { stdio: "ignore" });
}

async function main() {
  const options = parseRevenueBrowserScoutSessionArgs(process.argv.slice(2));
  const validationErrors = validateRevenueBrowserScoutSessionOptions(options);
  if (validationErrors.length) {
    console.error(validationErrors.join("\n"));
    process.exit(1);
  }

  const dispatch = buildRevenueScoutDispatch(buildRevenueBrowserScoutDispatchInput(options));
  const session = buildRevenueBrowserScoutSession(dispatch, options);

  if (options.outputPath) {
    writeFileSync(options.outputPath, JSON.stringify(session, null, 2));
  }
  if (options.capturePath) {
    writeFileSync(options.capturePath, JSON.stringify(session.captureTemplate, null, 2));
  }
  if (options.open) {
    for (const item of session.urlsToOpen) openUrl(item.url);
  }

  console.log(options.json ? JSON.stringify(session, null, 2) : formatRevenueBrowserScoutSessionText(session));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
