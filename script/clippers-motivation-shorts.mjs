import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const MIN_SECONDS = 20;
const MAX_SECONDS = 40;
const SHA256 = /^[a-f0-9]{64}$/i;
const CHANNEL_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const RIGHTS_STATUSES = new Set(["owned", "explicitly_authorized"]);
const SUPPORTED_LANGUAGES = new Set(["es", "en"]);
const DAILY_LIMIT_PER_CHANNEL = 5;
const AUDIO_MODES = new Set(["local_voice", "procedural_original"]);
const PROCEDURAL_GENERATOR = "ffmpeg_lavfi_anoisesrc_v1";

const clean = (value) => String(value ?? "").trim();
const safeName = (value) => clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const hashText = (value) => createHash("sha256").update(String(value)).digest("hex");

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function jsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function pathExists(filePath) {
  return Boolean(await lstat(filePath).catch(() => null));
}

async function containedRegularFile(root, candidate) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(rootPath, clean(candidate));
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, info] = await Promise.all([
    realpath(rootPath).catch(() => null),
    realpath(candidatePath).catch(() => null),
    lstat(candidatePath).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !info?.isFile() || info.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? candidatePath : null;
}

async function runBinary(binary, args) {
  return execFileAsync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}

async function probe(filePath, run = runBinary) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height:format=duration",
    "-of", "json",
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  return {
    durationSeconds: Number(parsed.format?.duration),
    video: parsed.streams?.find((row) => row.codec_type === "video") || null,
    audio: parsed.streams?.find((row) => row.codec_type === "audio") || null,
  };
}

export function canonicalScript(manifest) {
  const hook = clean(manifest?.script?.hook);
  const beats = Array.isArray(manifest?.script?.beats) ? manifest.script.beats.map(clean).filter(Boolean) : [];
  const close = clean(manifest?.script?.close);
  return [hook, ...beats, close].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function manifestAudioMode(manifest) {
  const declared = clean(manifest?.audio?.mode);
  if (declared) return declared;
  return manifest?.voice ? "local_voice" : "";
}

function proceduralAudioBlockers(audio) {
  const blockers = [];
  const allowedAudioKeys = new Set(["mode", "durationSeconds", "seed", "parameters", "provenance"]);
  const allowedParameterKeys = new Set(["noiseColor", "amplitude", "highpassHz", "lowpassHz", "volumeDb", "fadeSeconds"]);
  const allowedProvenanceKeys = new Set(["status", "generator", "thirdPartyAssets", "networkUsed", "paidCostUsd"]);
  if (Object.keys(audio || {}).some((key) => !allowedAudioKeys.has(key))) blockers.push("procedural_audio_unsafe_or_mixed_fields");
  if (Object.keys(audio?.parameters || {}).some((key) => !allowedParameterKeys.has(key))) blockers.push("procedural_audio_parameters_invalid");
  if (Object.keys(audio?.provenance || {}).some((key) => !allowedProvenanceKeys.has(key))) blockers.push("procedural_audio_provenance_invalid");
  const durationSeconds = Number(audio?.durationSeconds);
  const seed = Number(audio?.seed);
  const parameters = audio?.parameters;
  if (typeof audio?.durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < MIN_SECONDS || durationSeconds > MAX_SECONDS) blockers.push("procedural_audio_duration_must_be_20_to_40_seconds");
  if (typeof audio?.seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) blockers.push("procedural_audio_seed_invalid");
  if (parameters?.noiseColor !== "pink"
    || typeof parameters?.amplitude !== "number" || !Number.isFinite(parameters.amplitude) || parameters.amplitude < 0.02 || parameters.amplitude > 0.3
    || typeof parameters?.highpassHz !== "number" || !Number.isFinite(parameters.highpassHz) || parameters.highpassHz < 20 || parameters.highpassHz > 250
    || typeof parameters?.lowpassHz !== "number" || !Number.isFinite(parameters.lowpassHz) || parameters.lowpassHz < 800 || parameters.lowpassHz > 8_000
    || Number(parameters?.lowpassHz) <= Number(parameters?.highpassHz)
    || typeof parameters?.volumeDb !== "number" || !Number.isFinite(parameters.volumeDb) || parameters.volumeDb < -36 || parameters.volumeDb > -6
    || typeof parameters?.fadeSeconds !== "number" || !Number.isFinite(parameters.fadeSeconds) || parameters.fadeSeconds < 0.25 || parameters.fadeSeconds > 3
    || Number(parameters?.fadeSeconds) * 2 >= durationSeconds) blockers.push("procedural_audio_parameters_invalid");
  const provenance = audio?.provenance;
  if (provenance?.status !== "owned_original"
    || provenance?.generator !== PROCEDURAL_GENERATOR
    || provenance?.thirdPartyAssets !== false
    || provenance?.networkUsed !== false
    || provenance?.paidCostUsd !== 0) blockers.push("procedural_audio_provenance_invalid");
  return [...new Set(blockers)];
}

export function buildProceduralAudioPlan(audio) {
  const blockers = proceduralAudioBlockers(audio);
  if (blockers.length) throw new Error(blockers.join(","));
  const durationSeconds = Number(audio.durationSeconds);
  const parameters = audio.parameters;
  const fadeSeconds = Number(parameters.fadeSeconds);
  const filter = [
    `anoisesrc=color=pink:amplitude=${Number(parameters.amplitude)}:sample_rate=48000:duration=${durationSeconds}:seed=${Number(audio.seed)}`,
    `highpass=f=${Number(parameters.highpassHz)}`,
    `lowpass=f=${Number(parameters.lowpassHz)}`,
    `afade=t=in:st=0:d=${fadeSeconds}`,
    `afade=t=out:st=${Number((durationSeconds - fadeSeconds).toFixed(3))}:d=${fadeSeconds}`,
    `volume=${Number(parameters.volumeDb)}dB`,
  ].join(",");
  return {
    mode: "procedural_original",
    generator: PROCEDURAL_GENERATOR,
    durationSeconds,
    seed: Number(audio.seed),
    parameters: {
      noiseColor: "pink",
      amplitude: Number(parameters.amplitude),
      highpassHz: Number(parameters.highpassHz),
      lowpassHz: Number(parameters.lowpassHz),
      volumeDb: Number(parameters.volumeDb),
      fadeSeconds,
    },
    filter,
  };
}

export function validateManifestShape(manifest) {
  const blockers = [];
  if (Number(manifest?.schemaVersion) !== 1) blockers.push("schema_version_invalid");
  if (!safeName(manifest?.shortId)) blockers.push("short_id_invalid");
  if (!CHANNEL_ID.test(clean(manifest?.channelId))) blockers.push("channel_id_invalid");
  if (!SUPPORTED_LANGUAGES.has(clean(manifest?.language).toLowerCase())) blockers.push("language_must_be_es_or_en");
  if (clean(manifest?.format) !== "youtube_short_9x16") blockers.push("format_invalid");
  const script = canonicalScript(manifest);
  if (script.length < 80 || script.length > 650) blockers.push("script_length_invalid");
  const originality = manifest?.script?.originality;
  if (originality?.status !== "owned_original") blockers.push("script_not_declared_owned_original");
  if (!clean(originality?.author)) blockers.push("script_author_missing");
  if (originality?.thirdPartyQuotes !== false) blockers.push("third_party_quotes_not_excluded");
  if (originality?.thirdPartySpeeches !== false) blockers.push("third_party_speeches_not_excluded");
  if (!Array.isArray(originality?.sources) || originality.sources.length !== 0) blockers.push("external_script_sources_present");
  if (manifest?.script?.structure?.conflict !== "hook"
    || manifest?.script?.structure?.idea !== "beats"
    || manifest?.script?.structure?.action !== "close") blockers.push("motivation_structure_invalid");
  const safety = manifest?.contentSafety;
  if (["celebrities", "podcasts", "clonedVoices", "thirdPartyQuotes", "wealthPromises", "healthPromises"]
    .every((key) => safety?.[key] === false)) {
    // All six exclusions are present and explicit.
  } else {
    blockers.push("content_safety_exclusions_missing");
  }
  const quality = manifest?.qualityGate;
  if (quality?.approved !== true
    || quality?.hookFirstSecond !== true
    || quality?.actionable !== true
    || quality?.noQuotaFiller !== true
    || !clean(quality?.reviewedBy)
    || !Number.isFinite(Date.parse(clean(quality?.reviewedAt)))) blockers.push("quality_gate_not_approved");
  const audioMode = manifestAudioMode(manifest);
  if (!AUDIO_MODES.has(audioMode)) blockers.push("audio_mode_invalid");
  if (audioMode === "local_voice") {
    if (manifest?.audio && clean(manifest.audio.mode) !== "local_voice") blockers.push("audio_modes_must_not_be_mixed");
    if (manifest?.audio && Object.keys(manifest.audio).some((key) => key !== "mode")) blockers.push("audio_modes_must_not_be_mixed");
    if (clean(manifest?.voice?.sourceType) !== "local_recording") blockers.push("voice_not_local_recording");
    if (!clean(manifest?.voice?.file)) blockers.push("voice_file_missing");
    if (!clean(manifest?.voice?.rightsEvidenceFile)) blockers.push("voice_rights_evidence_missing");
    if (!SHA256.test(clean(manifest?.voice?.sha256))) blockers.push("voice_hash_missing_or_invalid");
  } else if (audioMode === "procedural_original") {
    if (manifest?.voice) blockers.push("audio_modes_must_not_be_mixed");
    blockers.push(...proceduralAudioBlockers(manifest.audio));
  }
  return [...new Set(blockers)];
}

function validateVoiceEvidence(evidence, manifest, voiceSha256) {
  const shortId = clean(manifest.shortId);
  return Number(evidence?.schemaVersion) === 1
    && clean(evidence?.assetType) === "voice_recording"
    && clean(evidence?.shortId) === shortId
    && clean(evidence?.file) === clean(manifest.voice.file)
    && clean(evidence?.sha256).toLowerCase() === voiceSha256
    && RIGHTS_STATUSES.has(clean(evidence?.rightsStatus))
    && evidence?.speakerConsent === true
    && evidence?.commercialUseAuthorized === true
    && clean(evidence?.provenance) === "local_recording"
    && Boolean(clean(evidence?.verifiedBy))
    && Number.isFinite(Date.parse(clean(evidence?.verifiedAt)));
}

function srtTime(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function captionChunks(script, maxChars = 34) {
  const words = script.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    if (current.length && [...current, word].join(" ").length > maxChars) {
      chunks.push(current.join(" "));
      current = [];
    }
    current.push(word);
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

export function buildSrt(script, durationSeconds) {
  const cues = captionCues(script, durationSeconds);
  return `${cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.caption}`).join("\n\n")}\n`;
}

function captionCues(script, durationSeconds) {
  const chunks = captionChunks(script);
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const end = index === chunks.length - 1 ? durationSeconds : cursor + durationSeconds * weights[index] / totalWeight;
    const cue = { start: cursor, end, caption: chunk };
    cursor = end;
    return cue;
  });
}

async function prepareCaptionOverlay(script, durationSeconds, outputPath, run) {
  const tempDir = `${outputPath}.${process.pid}.${Date.now()}.captions`;
  await mkdir(tempDir, { recursive: true });
  const concat = ["ffconcat version 1.0"];
  for (const [index, cue] of captionCues(script, durationSeconds).entries()) {
    const imagePath = path.join(tempDir, `caption-${String(index).padStart(3, "0")}.png`);
    const safeCaption = cue.caption.replace(/[\u0000-\u001f@%\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    await run("magick", [
      "-background", "none", "-fill", "white", "-stroke", "black", "-strokewidth", "3",
      "-font", "Arial-Bold", "-pointsize", "64", "-gravity", "center", "-size", "900x350",
      `caption:${safeCaption}`, imagePath,
    ]);
    concat.push(`file '${imagePath}'`, `duration ${(cue.end - cue.start).toFixed(6)}`);
  }
  const lastImage = path.join(tempDir, `caption-${String(captionCues(script, durationSeconds).length - 1).padStart(3, "0")}.png`);
  concat.push(`file '${lastImage}'`);
  const concatPath = path.join(tempDir, "captions.ffconcat");
  await writeFile(concatPath, `${concat.join("\n")}\n`, "utf8");
  return { tempDir, concatPath };
}

async function evidenceFrames(outputPath, targetDir, durationSeconds, run) {
  const temporary = `${targetDir}.${process.pid}.${Date.now()}.tmp`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const frames = [];
  try {
    for (const [label, seconds] of [["start", 0.5], ["middle", durationSeconds / 2], ["end", durationSeconds - 0.5]]) {
      const filePath = path.join(temporary, `${label}.jpg`);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", Number(seconds).toFixed(3), "-i", outputPath, "-frames:v", "1", "-q:v", "2", filePath]);
      if ((await stat(filePath)).size < 100) throw new Error(`evidence frame empty: ${label}`);
      frames.push({ label, seconds: Number(Number(seconds).toFixed(3)), file: path.basename(filePath), sha256: await sha256File(filePath) });
    }
    await rm(targetDir, { recursive: true, force: true });
    await rename(temporary, targetDir);
    return frames;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function ledgerRows(ledger) {
  return Array.isArray(ledger?.items) ? ledger.items : [];
}

function dayInNewYork(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function volumeBlocker(rows, now, channelId) {
  const today = dayInNewYork(now);
  const validRows = rows.filter((row) => clean(row?.channelId) === clean(channelId)
    && Number.isFinite(Date.parse(clean(row?.renderedAt))));
  if (validRows.filter((row) => dayInNewYork(row.renderedAt) === today).length >= DAILY_LIMIT_PER_CHANNEL) return "daily_channel_render_limit_reached";
  return null;
}

export async function renderMotivationShort({ workspaceRoot, manifestFile, run = runBinary, now = new Date() }) {
  const root = path.resolve(workspaceRoot);
  const manifestPath = await containedRegularFile(root, manifestFile);
  if (!manifestPath) throw new Error("manifest_missing_or_unsafe");
  const manifest = await jsonFile(manifestPath);
  const blockers = validateManifestShape(manifest);
  if (blockers.length) return { status: "blocked", shortId: clean(manifest?.shortId) || null, blockers, apiCostUsd: 0, publishEnabled: false };

  const audioMode = manifestAudioMode(manifest);
  let voicePath = null;
  let rightsPath = null;
  let voiceSha256 = null;
  let evidence = null;
  let proceduralAudioPlan = null;
  let durationSeconds;
  if (audioMode === "local_voice") {
    voicePath = await containedRegularFile(root, manifest.voice.file);
    rightsPath = await containedRegularFile(root, manifest.voice.rightsEvidenceFile);
    if (!voicePath || !rightsPath) {
      return { status: "blocked", shortId: manifest.shortId, blockers: [!voicePath ? "voice_missing_or_unsafe" : "voice_rights_missing_or_unsafe"], apiCostUsd: 0, publishEnabled: false };
    }
    voiceSha256 = await sha256File(voicePath);
    if (voiceSha256 !== clean(manifest.voice.sha256).toLowerCase()) {
      return { status: "blocked", shortId: manifest.shortId, blockers: ["voice_hash_mismatch"], apiCostUsd: 0, publishEnabled: false };
    }
    evidence = await jsonFile(rightsPath);
    if (!validateVoiceEvidence(evidence, manifest, voiceSha256)) {
      return { status: "blocked", shortId: manifest.shortId, blockers: ["voice_rights_evidence_invalid"], apiCostUsd: 0, publishEnabled: false };
    }

    let voiceProbe;
    try {
      voiceProbe = await probe(voicePath, run);
    } catch {
      return { status: "blocked", shortId: manifest.shortId, blockers: ["voice_ffprobe_failed"], apiCostUsd: 0, publishEnabled: false };
    }
    durationSeconds = voiceProbe.durationSeconds;
    if (!voiceProbe.audio || voiceProbe.video || !Number.isFinite(durationSeconds) || durationSeconds < MIN_SECONDS || durationSeconds > MAX_SECONDS) {
      return { status: "blocked", shortId: manifest.shortId, blockers: ["voice_media_must_be_audio_only_20_to_40_seconds"], apiCostUsd: 0, publishEnabled: false };
    }
  } else {
    proceduralAudioPlan = buildProceduralAudioPlan(manifest.audio);
    durationSeconds = proceduralAudioPlan.durationSeconds;
  }

  const script = canonicalScript(manifest);
  const scriptSha256 = hashText(script);
  const manifestSha256 = await sha256File(manifestPath);
  const ledgerPath = path.join(root, "reports", "clippers-motivation-ledger.json");
  const ledger = await jsonFile(ledgerPath, { schemaVersion: 1, items: [] });
  const rows = ledgerRows(ledger);
  const audioPlanSha256 = proceduralAudioPlan ? hashText(JSON.stringify(proceduralAudioPlan)) : null;
  const duplicate = rows.find((row) => row.manifestSha256 === manifestSha256
    || row.scriptSha256 === scriptSha256
    || (voiceSha256 && row.voiceSha256 === voiceSha256)
    || (audioPlanSha256 && row.audioPlanSha256 === audioPlanSha256));
  if (duplicate) return { status: "duplicate", shortId: manifest.shortId, duplicateOf: duplicate.shortId, blockers: ["already_rendered"], apiCostUsd: 0, publishEnabled: false };
  const language = clean(manifest.language).toLowerCase();
  const channelId = clean(manifest.channelId);
  const channelLanguageMismatch = rows.some((row) => clean(row?.channelId) === channelId
    && clean(row?.language) && clean(row.language).toLowerCase() !== language);
  if (channelLanguageMismatch) return { status: "blocked", shortId: manifest.shortId, blockers: ["channel_language_mismatch"], apiCostUsd: 0, publishEnabled: false };
  const limitBlocker = volumeBlocker(rows, now, channelId);
  if (limitBlocker) return { status: "blocked", shortId: manifest.shortId, blockers: [limitBlocker], apiCostUsd: 0, publishEnabled: false };

  const shortId = safeName(manifest.shortId);
  const channelSlug = safeName(channelId);
  const outputDir = path.join(root, "motivation", "rendered", channelSlug, shortId);
  const evidenceDir = path.join(root, "evidence-drop", "motivation", channelSlug, shortId);
  const outputPath = path.join(outputDir, `${shortId}.mp4`);
  const tempOutput = `${outputPath}.${process.pid}.${Date.now()}.tmp.mp4`;
  const subtitlePath = path.join(outputDir, `${shortId}.srt`);
  if (await pathExists(outputPath) || await pathExists(subtitlePath) || await pathExists(evidenceDir)) {
    return { status: "blocked", shortId: manifest.shortId, blockers: ["existing_artifact_without_ledger"], apiCostUsd: 0, publishEnabled: false };
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(subtitlePath, buildSrt(script, durationSeconds), "utf8");
  const background = clean(manifest?.style?.backgroundColor || "#111827");
  if (!/^#[0-9a-f]{6}$/i.test(background)) {
    await rm(subtitlePath, { force: true });
    return { status: "blocked", shortId: manifest.shortId, blockers: ["background_color_invalid"], apiCostUsd: 0, publishEnabled: false };
  }
  let captionOverlay;
  try {
    captionOverlay = await prepareCaptionOverlay(script, durationSeconds, outputPath, run);
    const audioInput = audioMode === "local_voice" ? ["-i", voicePath] : ["-f", "lavfi", "-i", proceduralAudioPlan.filter];
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=${background}:s=1080x1920:r=30:d=${durationSeconds.toFixed(3)}`,
      ...audioInput,
      "-f", "concat", "-safe", "0", "-i", captionOverlay.concatPath,
      "-filter_complex", "[0:v][2:v]overlay=(W-w)/2:H*0.62-h/2:shortest=1[v]",
      "-map", "[v]", "-map", "1:a:0",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      "-t", durationSeconds.toFixed(3), "-shortest", "-movflags", "+faststart",
      "-map_metadata", "-1", tempOutput,
    ]);
    const outputProbe = await probe(tempOutput, run);
    if (!outputProbe.video || !outputProbe.audio || outputProbe.video.width !== 1080 || outputProbe.video.height !== 1920
      || outputProbe.durationSeconds < MIN_SECONDS || outputProbe.durationSeconds > MAX_SECONDS + 0.15) {
      throw new Error("render_qa_failed");
    }
    await rename(tempOutput, outputPath);
    const frames = await evidenceFrames(outputPath, evidenceDir, outputProbe.durationSeconds, run);
    const outputSha256 = await sha256File(outputPath);
    const row = {
      shortId: manifest.shortId,
      channelId,
      language,
      renderedAt: now.toISOString(),
      manifestFile: path.relative(root, manifestPath),
      manifestSha256,
      scriptSha256,
      audioMode,
      ...(audioMode === "local_voice" ? {
        voiceFile: path.relative(root, voicePath),
        voiceSha256,
        voiceRightsEvidenceFile: path.relative(root, rightsPath),
      } : {
        audioPlan: proceduralAudioPlan,
        audioPlanSha256,
      }),
      outputFile: path.relative(root, outputPath),
      outputSha256,
      subtitleFile: path.relative(root, subtitlePath),
      durationSeconds: Number(outputProbe.durationSeconds.toFixed(3)),
      width: 1080,
      height: 1920,
      evidenceFrames: frames.map((frame) => ({ ...frame, file: path.join(path.relative(root, evidenceDir), frame.file) })),
      rights: audioMode === "local_voice"
        ? { script: "owned_original", voice: evidence.rightsStatus, thirdPartyMaterial: false }
        : { script: "owned_original", audio: "owned_original_procedural", thirdPartyMaterial: false },
      apiCostUsd: 0,
      publishEnabled: false,
    };
    await atomicJson(path.join(evidenceDir, "provenance.json"), { schemaVersion: 1, ...row });
    await atomicJson(ledgerPath, { schemaVersion: 1, updatedAt: now.toISOString(), items: [...ledgerRows(ledger), row] });
    return { status: "rendered", ...row };
  } catch (error) {
    await rm(tempOutput, { force: true });
    await rm(outputPath, { force: true });
    await rm(subtitlePath, { force: true });
    await rm(evidenceDir, { recursive: true, force: true });
    const blocker = clean(error?.message) === "render_qa_failed" ? "render_qa_failed" : "render_failed";
    return { status: "blocked", shortId: manifest.shortId, blockers: [blocker], apiCostUsd: 0, publishEnabled: false };
  } finally {
    if (captionOverlay?.tempDir) await rm(captionOverlay.tempDir, { recursive: true, force: true });
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const workspaceRoot = path.resolve(cliValue("workspace") || process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const manifestFile = cliValue("manifest");
  if (!manifestFile) throw new Error("Usage: node script/clippers-motivation-shorts.mjs --workspace <path> --manifest <relative-manifest.json>");
  const report = await renderMotivationShort({ workspaceRoot, manifestFile });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "blocked") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
