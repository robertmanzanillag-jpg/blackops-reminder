import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const renderedDir = path.join(rootDir, "rendered", "owned-active-tiktok-mvp-frames");
const forceRender = process.argv.includes("--force-render");
const commandTimeoutMs = 5 * 60_000;

const specs = [
  ...[
    ["sports-owned-43.mp4", "Possession audit", "one good closeout", "changed the shot"],
    ["sports-owned-44.mp4", "Two-way value", "defense starts it", "offense cashes in"],
    ["sports-owned-45.mp4", "Late clock read", "no rush", "find the corner"],
    ["sports-owned-46.mp4", "Screen angle lesson", "half a step", "full open lane"],
    ["sports-owned-47.mp4", "Bench unit spark", "energy play first", "points came after"],
    ["sports-owned-48.mp4", "Help defense map", "rotate early", "steal the pass"],
    ["sports-owned-49.mp4", "Game swing tracker", "turnovers stopped", "run started"],
    ["sports-owned-50.mp4", "Clutch timeout test", "draw it simple", "execute cleaner"],
    ["sports-owned-51.mp4", "Spacing checkpoint", "corner occupied", "paint opens"],
    ["sports-owned-52.mp4", "Shot quality truth", "open look", "better rhythm"],
    ["sports-owned-53.mp4", "Momentum reset", "slow the pace", "win the next trip"],
    ["sports-owned-54.mp4", "Underrated screen", "no box score", "all impact"],
    ["sports-owned-55.mp4", "Fast break math", "two defenders", "one easy pass"],
    ["sports-owned-56.mp4", "Pressure free throws", "routine matters", "noise fades"],
    ["sports-owned-57.mp4", "Adjustment watch", "same matchup", "different coverage"],
    ["sports-owned-58.mp4", "Possession winner", "one rebound", "one extra chance"],
    ["sports-owned-59.mp4", "Fourth quarter lens", "who controls pace?", "that decides it"],
    ["sports-owned-60.mp4", "Final play board", "simple option", "clean finish"],
  ].map(([fileName, title, line1, line2], index) => ({
    category: "sports",
    fileName,
    title,
    line1,
    line2,
    index,
    label: "Sports Daily active TikTok MVP original",
  })),
  ...[
    ["memes-owned-36.mp4", "When TikTok MVP says 100", "and source folder says 77", "top up time"],
    ["memes-owned-37.mp4", "POV: only Metricool", "no direct API chaos", "peaceful"],
    ["memes-owned-38.mp4", "The clip is ready-ish", "until proof asks receipts", "fair"],
    ["memes-owned-39.mp4", "When approval queue behaves", "and nobody auto-posts", "chef kiss"],
    ["memes-owned-40.mp4", "Robert connects accounts", "the system already prepared", "finally"],
  ].map(([fileName, title, line1, line2], index) => ({
    category: "memes",
    fileName,
    title,
    line1,
    line2,
    index,
    label: "Meme Radar active TikTok MVP original",
  })),
];

const palettes = {
  sports: [["#10231f", "#34d399"], ["#171f33", "#60a5fa"], ["#241b12", "#fbbf24"], ["#13251d", "#a3e635"]],
  memes: [["#1f2937", "#f472b6"], ["#12262b", "#67e8f9"], ["#2a2117", "#facc15"], ["#172033", "#93c5fd"]],
};

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function killCommandProcess(child) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing only the direct child when process groups are unavailable.
    }
  }
  child.kill("SIGKILL");
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killCommandProcess(child);
      reject(new Error(`${command} timed out after ${commandTimeoutMs}ms`));
    }, commandTimeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`${command} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
      });
    });
  });
}

async function fileExists(filePath) {
  return stat(filePath).then((file) => file.isFile()).catch(() => false);
}

async function renderSource(spec) {
  const categoryDir = path.join(sourceDropDir, spec.category);
  const frameDir = path.join(renderedDir, spec.category);
  await mkdir(categoryDir, { recursive: true });
  await mkdir(frameDir, { recursive: true });
  const outputPath = path.join(categoryDir, spec.fileName);
  const framePath = path.join(frameDir, `${path.basename(spec.fileName, ".mp4")}.png`);
  if (!forceRender && await fileExists(outputPath) && await fileExists(framePath)) return false;
  const [bg, accent] = palettes[spec.category][spec.index % palettes[spec.category].length];
  await runCommand("convert", [
    "-size", "1080x1920",
    `xc:${bg}`,
    "-fill", accent,
    "-draw", "rectangle 72,100 1008,1820",
    "-fill", "rgba(0,0,0,0.46)",
    "-draw", "rectangle 124,430 956,1140",
    "-fill", "rgba(255,255,255,0.12)",
    "-draw", "rectangle 168,1210 912,1360",
    "-gravity", "center",
    "-fill", "white",
    "-pointsize", "66",
    "-annotate", "+0-285", spec.line1,
    "-fill", accent,
    "-pointsize", "62",
    "-annotate", "+0-92", spec.line2,
    "-fill", "rgba(255,255,255,0.82)",
    "-pointsize", "36",
    "-annotate", "+0+265", spec.title,
    "-fill", "rgba(255,255,255,0.70)",
    "-pointsize", "31",
    "-annotate", "+0+655", "ORIGINAL OWNED SOURCE",
    "-fill", "rgba(255,255,255,0.58)",
    "-pointsize", "28",
    "-annotate", "+0+710", spec.label,
    framePath,
  ]);
  await runCommand("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", framePath,
    "-t", spec.category === "sports" && spec.index % 2 === 0 ? "7" : "6",
    "-r", "30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
  return true;
}

async function writeEvidence(category, categorySpecs) {
  const categoryDir = path.join(sourceDropDir, category);
  await mkdir(categoryDir, { recursive: true });
  const evidencePath = path.join(categoryDir, "owned-active-tiktok-mvp-production-notes.md");
  const label = category === "sports" ? "Sports Daily" : "Meme Radar";
  const restriction = category === "sports"
    ? "No third-party footage, no raw footage, no league footage, no broadcast footage, no team footage, no athlete likenesses, no copyrighted music, no scraped highlights, and no platform-private material are included."
    : "No third-party footage, no raw footage, no creator clips, no sports broadcasts, no streamer clips, no licensed music, no watermarked reposts, no cookies, no tokens, no passwords, no private screenshots, and no platform-private material are included.";
  await writeFile(evidencePath, [
    `# Owned Active TikTok MVP Production Notes - ${label}`,
    "",
    "status: owned_source",
    `category: ${category}`,
    "created_by: local Clippers active TikTok MVP generation script",
    `created_at: ${new Date().toISOString()}`,
    "",
    `These ${categorySpecs.length} source videos are original generated vertical assets for the TikTok-only Metricool MVP.`,
    restriction,
    "They are approved only as owned source inputs for draft creation and Metricool approval_required queue review.",
    "They do not verify any external account connection, Metricool brand, social login, or publishing permission.",
    "",
    "Covered files:",
    ...categorySpecs.map((spec) => `- ${spec.fileName}`),
    "",
    "Guardrails:",
    "- Keep Metricool in approval_required mode.",
    "- Do not enable realPublishEnabled.",
    "- Review captions before posting.",
    "- Do not imply official league, team, creator, platform, or streamer endorsement.",
    "- Replace any asset if a future platform policy or brand review rejects the format.",
    "",
  ].join("\n"));
  return evidencePath;
}

async function appendManifest(category, categorySpecs, evidencePath) {
  const manifestPath = path.join(sourceDropDir, category, "source-drop-manifest.csv");
  const header = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes";
  const current = await readFile(manifestPath, "utf8").catch(() => `${header}\n`);
  const rows = categorySpecs
    .filter((spec) => !current.includes(spec.fileName))
    .map((spec) => [
      category,
      spec.title,
      `owned-source://active-tiktok-mvp/${category}/${spec.fileName}`,
      `${category === "sports" ? "Sports Daily" : "Meme Radar"} original generated active TikTok MVP asset`,
      "tiktok",
      spec.fileName,
      "owned_or_permissioned",
      `owner note path: ${evidencePath}`,
      "high",
      category === "sports"
        ? "Original generated sports analysis graphic. No third-party footage, broadcast clips, likeness use, or copyrighted music. Use Metricool approval_required queue."
        : "Original generated vertical meme source. No third-party footage, creator clips, watermarked reposts, or copyrighted music. Use Metricool approval_required queue.",
    ].map(csvCell).join(","));
  if (!rows.length) return 0;
  await writeFile(manifestPath, `${current.trimEnd() || header}\n${rows.join("\n")}\n`);
  return rows.length;
}

async function main() {
  let rendered = 0;
  for (const spec of specs) {
    if (await renderSource(spec)) rendered += 1;
  }
  let appendedManifestRows = 0;
  for (const category of ["sports", "memes"]) {
    const categorySpecs = specs.filter((spec) => spec.category === category);
    const evidencePath = await writeEvidence(category, categorySpecs);
    appendedManifestRows += await appendManifest(category, categorySpecs, evidencePath);
  }
  console.log(JSON.stringify({
    generated: specs.length,
    rendered,
    appendedManifestRows,
    forceRender,
    activeTikTokMvpTargets: {
      sports: 60,
      memes: 40,
      streamers: 0,
    },
    generatedByCategory: {
      sports: specs.filter((spec) => spec.category === "sports").length,
      memes: specs.filter((spec) => spec.category === "memes").length,
    },
    realPublishEnabled: false,
    publishMode: "approval_required",
    nextStep: "Register owned source rights, then keep SPORT/memes TikTok blocked until real Metricool account proof is imported.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
