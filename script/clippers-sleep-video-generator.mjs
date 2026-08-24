#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MINIMUM_PRODUCTION_DURATION_SECONDS = 8 * 60 * 60;
export const DEFAULT_PRODUCTION_DURATION_SECONDS = MINIMUM_PRODUCTION_DURATION_SECONDS + 5 * 60;
export const MAXIMUM_TEST_DURATION_SECONDS = 30;

function finiteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`);
  return parsed;
}

function integer(value, label) {
  const parsed = finiteNumber(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

export function parseCliArgs(argv) {
  const options = {
    durationSeconds: DEFAULT_PRODUCTION_DURATION_SECONDS,
    seed: 20260824,
    title: "Deep Night Rest",
    width: 1920,
    height: 1080,
    fps: 1,
    testMode: false,
    overwrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--test-mode") options.testMode = true;
    else if (arg === "--overwrite") options.overwrite = true;
    else if (arg === "--output") options.outputPath = argv[++index];
    else if (arg === "--duration-seconds") options.durationSeconds = finiteNumber(argv[++index], "durationSeconds");
    else if (arg === "--seed") options.seed = integer(argv[++index], "seed");
    else if (arg === "--title") options.title = argv[++index];
    else if (arg === "--width") options.width = integer(argv[++index], "width");
    else if (arg === "--height") options.height = integer(argv[++index], "height");
    else if (arg === "--fps") options.fps = integer(argv[++index], "fps");
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return validateOptions(options);
}

export function validateOptions(input) {
  const options = { ...input };
  if (!options.outputPath || typeof options.outputPath !== "string") {
    throw new Error("--output is required.");
  }
  if (!options.outputPath.toLowerCase().endsWith(".mp4")) {
    throw new Error("Output must use the .mp4 extension.");
  }
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new Error("durationSeconds must be greater than zero.");
  }
  if (options.testMode) {
    if (options.durationSeconds > MAXIMUM_TEST_DURATION_SECONDS) {
      throw new Error(`Test mode is limited to ${MAXIMUM_TEST_DURATION_SECONDS} seconds.`);
    }
  } else if (options.durationSeconds < MINIMUM_PRODUCTION_DURATION_SECONDS) {
    throw new Error("Production sleep videos must be at least 8 hours (28800 seconds).");
  }
  if (!Number.isInteger(options.seed)) throw new Error("seed must be an integer.");
  if (typeof options.title !== "string" || !options.title.trim()) throw new Error("title is required.");
  if (!Number.isInteger(options.width) || options.width < 320 || options.width % 2 !== 0) {
    throw new Error("width must be an even integer of at least 320.");
  }
  if (!Number.isInteger(options.height) || options.height < 180 || options.height % 2 !== 0) {
    throw new Error("height must be an even integer of at least 180.");
  }
  if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 30) {
    throw new Error("fps must be an integer between 1 and 30.");
  }
  return options;
}

function seededValues(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return {
    baseFrequency: 96 + Math.floor(next() * 24),
    breathFrequency: 0.035 + next() * 0.015,
    blue: 18 + Math.floor(next() * 20),
    indigo: 24 + Math.floor(next() * 24),
    glow: 50 + Math.floor(next() * 35),
  };
}

function chapterEnvelope(chapter, index, crossfadeSeconds) {
  const start = index === 0 ? 0 : chapter.nominalStartSeconds - crossfadeSeconds / 2;
  const end = index === 7 ? chapter.nominalEndSeconds : chapter.nominalEndSeconds + crossfadeSeconds / 2;
  const fadeIn = index === 0 ? "1" : `min(1,max(0,(t-${start})/${crossfadeSeconds}))`;
  const fadeOut = index === 7 ? "1" : `min(1,max(0,(${end}-t)/${crossfadeSeconds}))`;
  return `between(t,${start},${end})*${fadeIn}*${fadeOut}`;
}

function hex(value) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

export function buildProceduralPlan(options) {
  const values = seededValues(options.seed);
  const base = values.baseFrequency;
  const breath = values.breathFrequency.toFixed(6);
  const chapterSeconds = options.testMode ? options.durationSeconds / 8 : 3600;
  const crossfadeSeconds = options.testMode ? Math.min(0.1, chapterSeconds / 4) : 60;
  const chapterPlan = Array.from({ length: 8 }, (_, index) => {
    const harmonic = base + 18 + index * 7;
    return {
      chapter: index + 1,
      nominalStartSeconds: index * chapterSeconds,
      nominalEndSeconds: index === 7 ? options.durationSeconds : (index + 1) * chapterSeconds,
      harmonicFrequency: harmonic,
      visualInsetPercent: 12 + index * 3,
    };
  });
  const evolvingLeft = chapterPlan.map((chapter, index) =>
    `(${chapterEnvelope(chapter, index, crossfadeSeconds)})*0.004*sin(2*PI*${chapter.harmonicFrequency}*t+${(index * 0.17).toFixed(2)})`,
  ).join("+");
  const evolvingRight = chapterPlan.map((chapter, index) =>
    `(${chapterEnvelope(chapter, index, crossfadeSeconds)})*0.004*sin(2*PI*${chapter.harmonicFrequency + 1}*t+${(index * 0.17 + 0.35).toFixed(2)})`,
  ).join("+");
  const left = [
    `0.025*sin(2*PI*${base}*t)`,
    `0.013*sin(2*PI*${base * 1.5}*t+0.3)`,
    `0.009*sin(2*PI*${base * 2.25}*t+0.8)`,
    evolvingLeft,
  ].join("+");
  const right = [
    `0.024*sin(2*PI*${base + 2}*t+0.2)`,
    `0.012*sin(2*PI*${(base + 2) * 1.5}*t+0.6)`,
    `0.009*sin(2*PI*${(base + 2) * 2.25}*t+1.1)`,
    evolvingRight,
  ].join("+");
  const envelope = `(0.78+0.22*sin(2*PI*${breath}*t))`;
  const audioExpression = `${envelope}*(${left})|${envelope}*(${right})`;
  const background = `#${hex(5)}${hex(values.indigo)}${hex(values.blue)}`;
  const glow = `#${hex(10)}${hex(values.glow)}${hex(values.glow + 35)}@0.22`;
  const chapterVisuals = chapterPlan.map((chapter, index) => {
    const inset = chapter.visualInsetPercent;
    const start = chapter.nominalStartSeconds;
    const end = chapter.nominalEndSeconds;
    const color = `#${hex(12 + index * 3)}${hex(values.glow + index * 2)}${hex(values.glow + 30 + index * 3)}@0.08`;
    return `drawbox=x=iw*${inset / 100}:y=ih*${inset / 100}:w=iw*${(100 - inset * 2) / 100}:h=ih*${(100 - inset * 2) / 100}:color=${color}:t=fill:enable='between(t\\,${start}\\,${end})'`;
  });
  const visualFilter = [
    `color=c=${background}:s=${options.width}x${options.height}:r=${options.fps}:d=${options.durationSeconds}`,
    `drawbox=x=iw*0.18:y=ih*0.16:w=iw*0.64:h=ih*0.68:color=${glow}:t=fill`,
    ...chapterVisuals,
    "vignette=PI/4",
    "format=yuv420p",
  ].join(",");
  return { audioExpression, visualFilter, values, background, glow, chapterPlan };
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export async function probeVideo(videoPath, ffprobePath = "ffprobe") {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,sample_rate,channels",
    "-of", "json",
    videoPath,
  ], { capture: true });
  return JSON.parse(stdout);
}

export function assertProbe(probe, options) {
  const duration = Number(probe?.format?.duration);
  const video = probe?.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe?.streams?.find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration < options.durationSeconds - 0.25) {
    throw new Error(`QA failed: duration ${duration || 0}s is shorter than ${options.durationSeconds}s.`);
  }
  if (!options.testMode && duration < MINIMUM_PRODUCTION_DURATION_SECONDS - 0.25) {
    throw new Error("QA failed: production output is shorter than 8 hours.");
  }
  if (!video || video.codec_name !== "h264") throw new Error("QA failed: H.264 video stream is required.");
  if (video.width !== options.width || video.height !== options.height) {
    throw new Error(`QA failed: expected ${options.width}x${options.height} video.`);
  }
  if (!audio || audio.codec_name !== "aac") throw new Error("QA failed: AAC audio stream is required.");
  if (Number(audio.sample_rate) !== 48000 || Number(audio.channels) !== 2) {
    throw new Error("QA failed: 48 kHz stereo audio is required.");
  }
  return { durationSeconds: duration, video, audio };
}

export function buildQaSampleTimes(durationSeconds, testMode) {
  if (testMode) return [...new Set([0, Math.max(0, durationSeconds - 1)])];
  const hourly = Array.from({ length: 9 }, (_, index) => index * 3600)
    .filter((seconds) => seconds < durationSeconds);
  return [...new Set([...hourly, Math.max(0, durationSeconds - 2)])];
}

export function parseAstats(stderr) {
  const peaks = [...stderr.matchAll(/Peak level dB:\s*(-?inf|[-+\d.]+)/gi)].map((match) => Number(match[1]));
  const rmsValues = [...stderr.matchAll(/RMS level dB:\s*(-?inf|[-+\d.]+)/gi)].map((match) => Number(match[1]));
  const finitePeaks = peaks.filter(Number.isFinite);
  const finiteRms = rmsValues.filter(Number.isFinite);
  if (finitePeaks.length === 0 || finiteRms.length === 0) {
    throw new Error("Audio QA failed: astats did not return finite peak and RMS levels.");
  }
  const peakDb = Math.max(...finitePeaks);
  const rmsDb = Math.max(...finiteRms);
  if (peakDb >= -0.1) throw new Error(`Audio QA failed: clipping risk at ${peakDb} dB.`);
  if (rmsDb <= -60) throw new Error(`Audio QA failed: silence detected at ${rmsDb} dB RMS.`);
  return { peakDb, rmsDb };
}

export async function sampleMediaQa(videoPath, options) {
  const ffmpegPath = options.ffmpegPath || "ffmpeg";
  const samples = [];
  for (const startSeconds of buildQaSampleTimes(options.durationSeconds, options.testMode)) {
    const sampleDuration = Math.min(2, Math.max(0.25, options.durationSeconds - startSeconds));
    const audioResult = await run(ffmpegPath, [
      "-hide_banner", "-nostdin", "-ss", String(startSeconds), "-i", videoPath,
      "-t", String(sampleDuration), "-vn", "-af", "astats=metadata=0:reset=0",
      "-f", "null", "-",
    ], { capture: true });
    const levels = parseAstats(audioResult.stderr);
    const frameResult = await run(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(startSeconds),
      "-i", videoPath, "-frames:v", "1", "-f", "framemd5", "-",
    ], { capture: true });
    const frameLine = frameResult.stdout.split("\n").find((line) => line && !line.startsWith("#"));
    if (!frameLine) throw new Error(`Visual QA failed: no frame at ${startSeconds}s.`);
    samples.push({ startSeconds, sampleDuration, ...levels, frameMd5: frameLine.split(",").at(-1).trim() });
  }
  return samples;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function generateSleepVideo(rawOptions) {
  const options = validateOptions(rawOptions);
  const outputPath = path.resolve(options.outputPath);
  const manifestPath = `${outputPath}.rights.json`;
  const partialPath = `${outputPath}.partial.mp4`;
  if (!options.overwrite && (existsSync(outputPath) || existsSync(manifestPath))) {
    throw new Error("Output or rights manifest already exists; use --overwrite to replace generated artifacts.");
  }

  const plan = buildProceduralPlan(options);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(partialPath, { force: true });
  try {
    await run(options.ffmpegPath || "ffmpeg", [
      "-hide_banner", "-loglevel", "warning", "-nostdin", "-y",
      "-f", "lavfi", "-i", plan.visualFilter,
      "-f", "lavfi", "-i", `aevalsrc=exprs=${plan.audioExpression.replaceAll(",", "\\,")}:s=48000:d=${options.durationSeconds}`,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage",
      "-pix_fmt", "yuv420p", "-r", String(options.fps),
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-t", String(options.durationSeconds), "-movflags", "+faststart",
      "-metadata", `title=${options.title}`,
      "-metadata", "comment=Original procedural audio and visual; no external samples or media",
      partialPath,
    ]);

    const probe = await probeVideo(partialPath, options.ffprobePath || "ffprobe");
    const qa = assertProbe(probe, options);
    const mediaSamples = await sampleMediaQa(partialPath, options);
    await rename(partialPath, outputPath);
    const synthesisParameters = {
      seed: options.seed,
      durationSeconds: options.durationSeconds,
      width: options.width,
      height: options.height,
      fps: options.fps,
      values: plan.values,
      background: plan.background,
      glow: plan.glow,
      chapterPlan: plan.chapterPlan,
    };
    const manifest = {
      schemaVersion: 1,
      artifactType: "original_procedural_sleep_video",
      generatedAt: new Date().toISOString(),
      title: options.title,
      output: {
        path: outputPath,
        sha256: await sha256(outputPath),
        durationSeconds: qa.durationSeconds,
        width: options.width,
        height: options.height,
        fps: options.fps,
        videoCodec: qa.video.codec_name,
        audioCodec: qa.audio.codec_name,
        audioSampleRate: Number(qa.audio.sample_rate),
        audioChannels: Number(qa.audio.channels),
      },
      provenance: {
        origin: "Generated locally from deterministic mathematical synthesis and FFmpeg filters.",
        externalAudioSamples: [],
        externalVisualAssets: [],
        networkAccessRequired: false,
        paidServicesUsed: [],
        generator: "script/clippers-sleep-video-generator.mjs",
        generatorSha256: await sha256(fileURLToPath(import.meta.url)),
        seed: options.seed,
        synthesisParameters,
        synthesisParametersSha256: sha256Text(JSON.stringify(synthesisParameters)),
        audioMethod: "Stereo additive sine synthesis with deterministic breathing envelope.",
        visualMethod: "Procedural color field, glow geometry, and vignette.",
        chapterPlan: plan.chapterPlan,
        generatedForTestingOnly: options.testMode,
      },
      rights: {
        claimant: "workspace owner",
        basis: "Original procedural generation with no third-party media inputs.",
        reviewRequiredBeforePublishing: true,
        publicationAuthorizedByThisManifest: false,
      },
      qa: {
        status: "passed",
        tool: "ffprobe",
        productionMinimumSeconds: MINIMUM_PRODUCTION_DURATION_SECONDS,
        sampledMedia: mediaSamples,
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    return { outputPath, manifestPath, manifest };
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await generateSleepVideo(options);
  process.stdout.write(`${JSON.stringify({ status: "completed", ...result }, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
