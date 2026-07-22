import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BITMAP_FONT = Object.freeze({
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
});

export const CAMPAIGN = Object.freeze({
  campaignId: "whop-mac-energy-ryan-clavicular-conor-2026-07-22",
  experienceId: "exp_4f31WKOCZ8uxii",
  campaignName: "Ryan Garcia, Clavicular, Conor McGregor",
  marketplace: "Whop Content Rewards",
  destinationAccount: "@streamersclipusa",
  brandAccount: "@drinkmacenergy",
  contentBankUrl: "https://drive.google.com/drive/folders/1qLyqqNI6zej74KVy8hN03xPVAzZuXxYW",
  campaignEvidence: "evidence-drop/whop/mac-energy-campaign-2026-07-22.md",
  sourceDrop: "source-drop/streamers/whop-mac-energy-2026-07-22",
  outputDrop: "drafts/whop/mac-energy-2026-07-22",
});

export const CLIP_SPECS = Object.freeze([
  {
    id: "mac-energy-01-ryan-garcia",
    sourceName: "ryan-garcia-fanatics-fest-presser.mp4",
    startSeconds: 530,
    durationSeconds: 12,
    hook: "RYAN KEEPS MAC ON THE TABLE",
    featuredTalent: "Ryan Garcia",
    talentTag: "@kingryan",
  },
  {
    id: "mac-energy-02-product-moment",
    sourceName: "MAC energy.mp4",
    startSeconds: 4,
    durationSeconds: 12,
    hook: "CONOR CALLS MAC SENSATIONAL",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
  {
    id: "mac-energy-03-flavor-test",
    sourceName: "Mac Energy Drink_ The BEST Flavor & Energy!.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "THE MAC FLAVOR TEST",
    featuredTalent: "Ryan Garcia",
    talentTag: "@kingryan",
  },
  {
    id: "mac-energy-04-conor-prime",
    sourceName: "VN20260712_234016.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "CONOR SAYS HE IS IN HIS PRIME",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
  {
    id: "mac-energy-05-clavicular-setup",
    sourceName: "clavicular-mac-energy-source.mov",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "CLAVICULAR SHOWS THE MAC SETUP",
    featuredTalent: "Clavicular",
    talentTag: "@clavicular",
  },
  {
    id: "mac-energy-06-officially-back",
    sourceName: "fullsend_mma_1783551884_3937040527681003529_53903826786.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "MAC IS OFFICIALLY BACK",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
  {
    id: "mac-energy-07-all-the-marbles",
    sourceName: "mmajunkie_1783653297_3937890821851367590_1249064182.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "CONOR SAYS ITS FOR ALL THE MARBLES",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
  {
    id: "mac-energy-08-destruction",
    sourceName: "mmajunkie_1783653664_3937894387152381122_1249064182.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "CONOR PROMISES DESTRUCTION",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
  {
    id: "mac-energy-09-boxing-critique",
    sourceName: "mmajunkie_1783654217_3937898989839153868_1249064182.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "CONOR CALLS HIS BOXING ABYSMAL",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
  {
    id: "mac-energy-10-crowd-troll",
    sourceName: "sportscenter_1783650464_3937867809743551946_505182045.mp4",
    startSeconds: 0,
    durationSeconds: 12,
    hook: "CONOR STARTS TROLLING THE CROWD",
    featuredTalent: "Conor McGregor",
    talentTag: "@thenotoriousmma",
  },
]);

function isContained(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertRegularContainedFile(workspaceRoot, filePath) {
  const absoluteRoot = path.resolve(workspaceRoot);
  const absoluteFile = path.resolve(filePath);
  if (!isContained(absoluteRoot, absoluteFile)) throw new Error(`Input path escapes Clippers workspace: ${filePath}`);

  const relative = path.relative(absoluteRoot, absoluteFile);
  let cursor = absoluteRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch(() => null);
    if (!info) throw new Error(`Required campaign source is missing: ${absoluteFile}`);
    if (info.isSymbolicLink()) throw new Error(`Campaign inputs must not use symlinks: ${absoluteFile}`);
  }

  const info = await lstat(absoluteFile);
  if (!info.isFile()) throw new Error(`Campaign input is not a regular file: ${absoluteFile}`);
  const [realRoot, realFile] = await Promise.all([realpath(absoluteRoot), realpath(absoluteFile)]);
  if (!isContained(realRoot, realFile)) throw new Error(`Resolved input path escapes Clippers workspace: ${absoluteFile}`);
  return absoluteFile;
}

async function assertSafeOutputPath(workspaceRoot, outputPath) {
  const absoluteRoot = path.resolve(workspaceRoot);
  const absoluteOutput = path.resolve(outputPath);
  if (!isContained(absoluteRoot, absoluteOutput)) throw new Error(`Output path escapes Clippers workspace: ${outputPath}`);
  const relative = path.relative(absoluteRoot, absoluteOutput);
  let cursor = absoluteRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error(`Campaign outputs must not use symlinks: ${absoluteOutput}`);
  }
  return absoluteOutput;
}

async function verifyCampaignEvidence(workspaceRoot) {
  const evidencePath = await assertRegularContainedFile(workspaceRoot, path.join(workspaceRoot, CAMPAIGN.campaignEvidence));
  const evidence = await readFile(evidencePath, "utf8");
  const required = [CAMPAIGN.campaignId, CAMPAIGN.experienceId, CAMPAIGN.marketplace, CAMPAIGN.contentBankUrl];
  if (evidence.length < 160 || !required.every((value) => evidence.includes(value)) || /<[^>]+>|placeholder|paste here/i.test(evidence)) {
    throw new Error("Campaign rights evidence is missing, incomplete, or contains placeholders.");
  }
  return evidencePath;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function probe(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt:format=duration",
    "-of", "json",
    filePath,
  ]);
  return JSON.parse(stdout);
}

function validateSourceProbe(spec, result) {
  const duration = Number(result.format?.duration);
  const hasVideo = result.streams?.some((stream) => stream.codec_type === "video");
  const hasAudio = result.streams?.some((stream) => stream.codec_type === "audio");
  if (!hasVideo || !hasAudio) throw new Error(`Source must contain video and audio: ${spec.sourceName}`);
  if (!Number.isFinite(duration) || duration < spec.startSeconds + spec.durationSeconds) {
    throw new Error(`Source is too short for approved segment: ${spec.sourceName}`);
  }
  if (spec.durationSeconds < 5) throw new Error(`Draft segment is shorter than five seconds: ${spec.id}`);
}

function validateDraftProbe(spec, result) {
  const video = result.streams?.find((stream) => stream.codec_type === "video");
  const audio = result.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(result.format?.duration);
  const valid = video?.codec_name === "h264"
    && video.width === 1080
    && video.height === 1920
    && video.pix_fmt === "yuv420p"
    && audio?.codec_name === "aac"
    && duration >= 5;
  if (!valid) throw new Error(`Rendered draft failed H264/AAC 9:16 validation: ${spec.id}`);
  return duration;
}

function wrapHook(text, maximumCharacters = 21) {
  const lines = [];
  for (const word of text.split(" ")) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maximumCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length > 2) throw new Error(`Hook is too long for deterministic title plate: ${text}`);
  return lines;
}

async function writeHookPlate(filePath, hook) {
  const width = 960;
  const height = 190;
  const scale = 7;
  const glyphAdvance = 6 * scale;
  const pixels = Buffer.alloc(width * height * 3);
  const lines = wrapHook(hook);
  const lineHeight = 8 * scale;
  const firstY = Math.floor((height - lines.length * lineHeight + scale) / 2);

  for (const [lineIndex, line] of lines.entries()) {
    const xStart = Math.floor((width - line.length * glyphAdvance + scale) / 2);
    for (const [characterIndex, character] of [...line].entries()) {
      const glyph = BITMAP_FONT[character];
      if (!glyph) throw new Error(`Unsupported hook character: ${character}`);
      for (const [row, bits] of glyph.entries()) {
        for (const [column, bit] of [...bits].entries()) {
          if (bit !== "1") continue;
          const left = xStart + characterIndex * glyphAdvance + column * scale;
          const top = firstY + lineIndex * lineHeight + row * scale;
          for (let y = top; y < top + scale; y += 1) {
            for (let x = left; x < left + scale; x += 1) {
              const offset = (y * width + x) * 3;
              pixels[offset] = 255;
              pixels[offset + 1] = 255;
              pixels[offset + 2] = 255;
            }
          }
        }
      }
    }
  }
  await writeFile(filePath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]), { flag: "wx" });
}

function captionFor(spec) {
  return `${spec.hook}. ${CAMPAIGN.brandAccount} ${spec.talentTag} #MACenergy #paidpartner`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function approvalCsv(clips) {
  const headers = ["campaign_id", "draft_file", "source_file", "source_sha256", "draft_sha256", "featured_talent", "caption", "metricool_status", "publish_allowed"];
  const rows = clips.map((clip) => [
    CAMPAIGN.campaignId, clip.outputFilename, clip.sourceName, clip.sourceSha256, clip.draftSha256,
    clip.featuredTalent, clip.caption, clip.metricoolStatus, clip.publishAllowed,
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function approvalHtml(clips) {
  const rows = clips.map((clip) => `<tr><td>${html(clip.outputFilename)}</td><td>${html(clip.featuredTalent)}</td><td>${html(clip.sourceName)}</td><td>${html(clip.caption)}</td><td>approval_required</td></tr>`).join("\n");
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>MAC Energy Metricool approval queue</title></head>\n<body><h1>MAC Energy Metricool approval queue</h1><p>Publishing is disabled. Human visual/audio QA and Metricool approval are required.</p><table border="1"><thead><tr><th>Draft</th><th>Talent</th><th>Source</th><th>Caption</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`;
}

async function renderDraft(workspaceRoot, spec, sourcePath, targetPath) {
  const hookPath = await assertSafeOutputPath(workspaceRoot, `${targetPath}.hook.ppm`);
  await writeHookPlate(hookPath, spec.hook);
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(spec.startSeconds), "-t", String(spec.durationSeconds), "-i", sourcePath,
      "-loop", "1", "-i", hookPath,
      "-filter_complex", "[0:v]scale=1080:1920:force_original_aspect_ratio=increase:out_range=tv,crop=1080:1920,format=yuv420p[base];[base][1:v]overlay=60:90:eof_action=repeat,format=yuv420p[v]",
      "-map", "[v]", "-map", "0:a:0",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-color_range", "tv",
      "-c:a", "aac", "-b:a", "192k",
      "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
      "-map_metadata", "-1", "-metadata", "creation_time=1970-01-01T00:00:00Z",
      "-metadata", "comment=Whop MAC Energy campaign draft; approval required",
      "-shortest", "-movflags", "+faststart",
      targetPath,
    ]);
  } finally {
    await unlink(hookPath).catch(() => {});
  }
}

export async function prepareWhopMacEnergyDrafts(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const sourceDir = path.join(workspaceRoot, CAMPAIGN.sourceDrop);
  const outputDir = path.join(workspaceRoot, CAMPAIGN.outputDrop);
  const uniqueSources = new Set(CLIP_SPECS.map((spec) => spec.sourceName));
  if (uniqueSources.size !== 10 || CLIP_SPECS.length !== 10) throw new Error("Campaign requires ten distinct approved source files.");

  const campaignEvidencePath = await verifyCampaignEvidence(workspaceRoot);

  const approved = [];
  for (const spec of CLIP_SPECS) {
    const sourcePath = await assertRegularContainedFile(workspaceRoot, path.join(sourceDir, spec.sourceName));
    const sourceProbe = await probe(sourcePath);
    validateSourceProbe(spec, sourceProbe);
    approved.push({ spec, sourcePath, sourceSha256: await sha256(sourcePath) });
  }

  await assertSafeOutputPath(workspaceRoot, outputDir);
  await mkdir(outputDir, { recursive: true });
  await assertSafeOutputPath(workspaceRoot, outputDir);
  const clips = [];
  for (const { spec, sourcePath, sourceSha256 } of approved) {
    const outputFilename = `${spec.id}.mp4`;
    const targetPath = await assertSafeOutputPath(workspaceRoot, path.join(outputDir, outputFilename));
    await renderDraft(workspaceRoot, spec, sourcePath, targetPath);
    const renderedDurationSeconds = validateDraftProbe(spec, await probe(targetPath));
    clips.push({
      ...spec,
      sourcePath,
      sourceSha256,
      outputFilename,
      targetPath,
      draftSha256: await sha256(targetPath),
      renderedDurationSeconds,
      audioSource: "source",
      caption: captionFor(spec),
      publishAllowed: false,
      metricoolStatus: "approval_required",
    });
  }

  const manifest = {
    status: "drafts_ready_for_qa",
    ...CAMPAIGN,
    campaignEvidencePath,
    sourcePolicy: "fixed_allowlist_local_content_bank_only",
    productionMethod: "deterministic_local_ffmpeg_no_network_no_generated_footage",
    requiredFormat: { orientation: "9:16", width: 1080, height: 1920, minimumDurationSeconds: 5, videoCodec: "h264", audioCodec: "aac", pixelFormat: "yuv420p", faststart: true, preserveSourceAudio: true },
    publishAllowed: false,
    realPublishEnabled: false,
    metricoolStatus: "approval_required",
    metricoolApprovalRequired: true,
    campaignRules: ["MAC can visible in every clip", "hook or MAC moment in first three seconds", "Content Bank footage only", "tag @drinkmacenergy and featured talent", "human visual and audio QA required"],
    cleanupPolicy: {
      mode: "retain_sources_until_verified_public_tiktok_and_whop_submission",
      deleteSourcesBeforeEvidence: false,
      requiredProof: ["verified public TikTok post URL", "verified public TikTok publication timestamp", "verified Whop submission receipt", "matching source and draft SHA-256 ledger"],
    },
    clips,
    blockers: ["Human visual/audio QA must confirm MAC can visibility and context for every draft.", "Metricool approval is required before scheduling or publishing.", "Public TikTok URL must be submitted to Whop after verified publication."],
  };

  const [manifestPath, csvPath, htmlPath] = await Promise.all([
    assertSafeOutputPath(workspaceRoot, path.join(outputDir, "draft-manifest.json")),
    assertSafeOutputPath(workspaceRoot, path.join(outputDir, "metricool-approval-queue.csv")),
    assertSafeOutputPath(workspaceRoot, path.join(outputDir, "metricool-approval-queue.html")),
  ]);
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(csvPath, approvalCsv(clips)),
    writeFile(htmlPath, approvalHtml(clips)),
  ]);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareWhopMacEnergyDrafts()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
