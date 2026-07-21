import { spawn } from "node:child_process";

const steps = [
  ["TikTok real readiness", process.execPath, ["script/clippers-real-tiktok-readiness-audit.mjs"]],
  ["Owned TikTok Metricool pack", process.execPath, ["script/clippers-owned-tiktok-metricool-approval-pack.mjs"]],
  ["Owned TikTok weekly batches", process.execPath, ["script/clippers-owned-tiktok-weekly-batches.mjs"]],
  ["Owned TikTok upload checklist", process.execPath, ["script/clippers-owned-tiktok-metricool-upload-checklist.mjs"]],
  ["Owned TikTok Metricool proof templates", process.execPath, ["script/clippers-owned-tiktok-metricool-proof-templates.mjs"]],
  ["Owned TikTok Metricool proof audit", process.execPath, ["script/clippers-owned-tiktok-metricool-proof-audit.mjs"]],
  ["Owned TikTok metrics templates", process.execPath, ["script/clippers-owned-tiktok-metrics-templates.mjs"]],
  ["Owned TikTok metrics audit", process.execPath, ["script/clippers-owned-tiktok-metrics-audit.mjs"]],
  ["TikTok go-live handoff", process.execPath, ["script/clippers-tiktok-go-live-handoff.mjs"]],
  ["TikTok account launch summary", process.execPath, ["script/clippers-tiktok-account-launch-summary.mjs"]],
  ["TikTok report index", process.execPath, ["script/clippers-tiktok-report-index.mjs"]],
];

function runStep([label, command, args]) {
  return new Promise((resolve, reject) => {
    console.log(`\n== ${label} ==`);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

for (const step of steps) {
  await runStep(step);
}

console.log("\nClippers TikTok reports refreshed.");
