import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { storage } from "./storage";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import { sendPushNotification } from "./push-notifications";
import { sendTelegramPlainMessage } from "./telegram";
import { ensureDriveFolderAtRoot, uploadLocalFileToDriveFolder } from "./google-drive";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "radio_video_edits", "03_listos_para_subir");
const DEFAULT_FALLBACK_INPUT_DIR = path.join(process.cwd(), "radio_video_edits", "01_originales");
const IG_RADIO_FOLDER_NAME = "videos editado para ig";
const TIKTOK_RADIO_FOLDER_NAME = "VIDEOS DE TIKTOK DE LA RADIO";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

type RadioEditStatus = "queued" | "analyzing" | "needs_dj_name" | "rendering" | "completed" | "failed";

type CommandResult = {
  stdout: string;
  stderr: string;
};

type RadioVideoJobInput = {
  videoPath: string;
  outputDir?: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  bestDropSecond?: number;
  djName?: string;
  userId?: string;
};

type RenderedClip = {
  kind: "horizontal_ig" | "vertical_tiktok";
  path: string;
  driveFolderName?: string;
  driveFileId?: string;
  driveWebViewLink?: string | null;
  durationSeconds: number;
  width: number;
  height: number;
};

export type RadioVideoProcessResult = {
  videoPath: string;
  status: RadioEditStatus;
  djName?: string;
  pendingActionId?: string;
  clips?: RenderedClip[];
  error?: string;
};

function runCommand(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let didTimeout = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          didTimeout = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (didTimeout) {
        reject(new Error(`${command} timed out`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} failed with code ${code}: ${stderr || stdout}`));
    });
  });
}

function sanitizeDjName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function cleanOcrName(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .map((line) => line.replace(/[^a-zA-Z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/\b(BR|DJ|RADIO|BLACK|ROOM|MIAMI)\b/gi, "").trim())
    .map(sanitizeDjName)
    .filter((line) => /^[A-Z0-9_]{2,24}$/.test(line));

  return candidates[0] || null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`No pude leer la duración de ${path.basename(videoPath)}`);
  }
  return duration;
}

async function getVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    videoPath,
  ]);
  const [width, height] = stdout.trim().split("x").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`No pude leer el tamaño de ${path.basename(videoPath)}`);
  }
  return { width, height };
}

async function hasAudio(videoPath: string): Promise<boolean> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    videoPath,
  ]);
  return stdout.trim().length > 0;
}

function clipStartAroundDrop(duration: number, targetSeconds: number, dropSecond: number): number {
  const clipDuration = Math.min(targetSeconds, duration);
  const start = dropSecond - clipDuration / 2;
  return Math.max(0, Math.min(start, Math.max(0, duration - clipDuration)));
}

async function measureAudioMeanVolume(videoPath: string, start: number, seconds: number): Promise<number> {
  const { stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-ss",
    start.toFixed(3),
    "-t",
    seconds.toFixed(3),
    "-i",
    videoPath,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ], { timeoutMs: 30000 });

  const match = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  if (!match) return Number.NEGATIVE_INFINITY;
  return Number.parseFloat(match[1]);
}

async function findBestDropSecond(videoPath: string, duration: number): Promise<number> {
  if (!(await hasAudio(videoPath))) {
    return duration / 2;
  }

  const sampleSeconds = Math.min(10, Math.max(3, duration / 8));
  const stepSeconds = duration > 900 ? 30 : duration > 300 ? 20 : 10;
  const maxStart = Math.max(0, duration - sampleSeconds);
  let bestStart = 0;
  let bestVolume = Number.NEGATIVE_INFINITY;

  for (let start = 0; start <= maxStart; start += stepSeconds) {
    const volume = await measureAudioMeanVolume(videoPath, start, sampleSeconds).catch(() => Number.NEGATIVE_INFINITY);
    if (volume > bestVolume) {
      bestVolume = volume;
      bestStart = start;
    }
  }

  return Math.min(duration, bestStart + sampleSeconds / 2);
}

async function detectDjNameByOcr(videoPath: string): Promise<string | null> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radio-dj-ocr-"));
  try {
    const duration = await getVideoDuration(videoPath);
    const sampleAt = Math.min(Math.max(2, duration * 0.08), Math.max(0, duration - 1));
    const framePath = path.join(tempDir, "frame.png");
    const cropPath = path.join(tempDir, "name.png");

    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      sampleAt.toFixed(3),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      framePath,
    ], { timeoutMs: 30000 });

    const { width, height } = await getVideoResolution(framePath);
    const cropWidth = Math.round(width * 0.38);
    const cropHeight = Math.round(height * 0.20);
    const cropY = Math.round(height * 0.76);

    await runCommand("magick", [
      framePath,
      "-crop",
      `${cropWidth}x${cropHeight}+0+${cropY}`,
      "-colorspace",
      "Gray",
      "-resize",
      "300%",
      "-contrast-stretch",
      "0x20%",
      "-threshold",
      "55%",
      cropPath,
    ], { timeoutMs: 30000 });

    const { stdout } = await runCommand("tesseract", [
      cropPath,
      "stdout",
      "--psm",
      "7",
      "-c",
      "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-. ",
    ], { timeoutMs: 30000 });

    return cleanOcrName(stdout);
  } catch (error) {
    console.warn("[radio-video-edit] OCR failed:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function collectVideos(dir: string, maxDepth: number): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (/^(CapCut|JianyingPro)$/i.test(entry.name) || /cache/i.test(entry.name)) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith("._")) continue;
      if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir, 0);
  return results.sort();
}

export async function findRadioVideos(options: {
  sourceDir?: string;
  fallbackInputDir?: string;
  searchDepth?: number;
} = {}): Promise<string[]> {
  const sourceDir = options.sourceDir || path.join(os.homedir(), "Movies");
  const fallbackInputDir = options.fallbackInputDir || DEFAULT_FALLBACK_INPUT_DIR;
  const searchDepth = options.searchDepth ?? 3;
  const sourceVideos = await collectVideos(sourceDir, searchDepth);
  if (sourceVideos.length > 0) return sourceVideos;
  return collectVideos(fallbackInputDir, 1);
}

function buildOutputPath(outputDir: string, djName: string, suffix: string): string {
  return path.join(outputDir, `${sanitizeDjName(djName)}_${suffix}.mp4`);
}

async function renderClip(params: {
  videoPath: string;
  outputPath: string;
  start: number;
  duration: number;
  mode: "horizontal_ig" | "vertical_tiktok";
  force?: boolean;
}): Promise<void> {
  if (!params.force && await pathExists(params.outputPath)) return;

  const filter = params.mode === "horizontal_ig"
    ? "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

  await runCommand("ffmpeg", [
    "-y",
    "-ss",
    params.start.toFixed(3),
    "-t",
    params.duration.toFixed(3),
    "-i",
    params.videoPath,
    "-vf",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    params.outputPath,
  ], { timeoutMs: 15 * 60 * 1000 });
}

function resolveDriveOutputDir(folderName: string): string | null {
  const explicit = process.env.DRIVE_OUTPUT_DIR?.trim();
  if (explicit) return explicit;
  const cloudStorage = path.join(os.homedir(), "Library", "CloudStorage");
  return path.join(cloudStorage, "__AUTO_DISCOVER__", folderName);
}

async function copyToGoogleDriveDesktop(filePath: string, folderName = IG_RADIO_FOLDER_NAME): Promise<string | null> {
  const driveTarget = resolveDriveOutputDir(folderName);
  if (!driveTarget) return null;

  if (driveTarget.includes("__AUTO_DISCOVER__")) {
    const cloudRoot = path.dirname(path.dirname(driveTarget));
    const entries = await fs.readdir(cloudRoot, { withFileTypes: true }).catch(() => []);
    const driveEntry = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("GoogleDrive"));
    if (!driveEntry) return null;

    const driveRoot = path.join(cloudRoot, driveEntry.name);
    const myDrive = await pathExists(path.join(driveRoot, "My Drive"))
      ? path.join(driveRoot, "My Drive")
      : await pathExists(path.join(driveRoot, "Mi unidad"))
        ? path.join(driveRoot, "Mi unidad")
        : driveRoot;
    const destinationDir = path.join(myDrive, folderName);
    await fs.mkdir(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, path.basename(filePath));
    await fs.copyFile(filePath, destination);
    return destination;
  }

  await fs.mkdir(driveTarget, { recursive: true });
  const destination = path.join(driveTarget, path.basename(filePath));
  await fs.copyFile(filePath, destination);
  return destination;
}

async function renderRadioVideoJob(input: RadioVideoJobInput & { djName: string; force?: boolean }): Promise<RenderedClip[]> {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "radio-drive-upload-"));

  const duration = await getVideoDuration(input.videoPath);
  const dropSecond = input.bestDropSecond ?? await findBestDropSecond(input.videoPath, duration);
  const longDuration = Math.min(60, duration);
  const shortDuration = Math.min(30, duration);
  const longStart = clipStartAroundDrop(duration, longDuration, dropSecond);
  const shortStart = clipStartAroundDrop(duration, shortDuration, dropSecond);

  const horizontalPath = buildOutputPath(stagingDir, input.djName, "60s_horizontal_ig");
  const verticalPath = buildOutputPath(stagingDir, input.djName, "30s_vertical_tiktok");

  try {
    await renderClip({
      videoPath: input.videoPath,
      outputPath: horizontalPath,
      start: longStart,
      duration: longDuration,
      mode: "horizontal_ig",
      force: true,
    });
    await renderClip({
      videoPath: input.videoPath,
      outputPath: verticalPath,
      start: shortStart,
      duration: shortDuration,
      mode: "vertical_tiktok",
      force: true,
    });

    const clips: RenderedClip[] = [
      {
        kind: "horizontal_ig",
        path: horizontalPath,
        driveFolderName: IG_RADIO_FOLDER_NAME,
        durationSeconds: longDuration,
        width: 1080,
        height: 1350,
      },
      {
        kind: "vertical_tiktok",
        path: verticalPath,
        driveFolderName: TIKTOK_RADIO_FOLDER_NAME,
        durationSeconds: shortDuration,
        width: 1080,
        height: 1920,
      },
    ];

    for (const clip of clips) {
      const folderName = clip.driveFolderName || IG_RADIO_FOLDER_NAME;
      const folderId = await ensureDriveFolderAtRoot(folderName, input.userId);
      const upload = await uploadLocalFileToDriveFolder({
        filePath: clip.path,
        folderId,
        mimeType: "video/mp4",
        userId: input.userId,
      });
      clip.driveFileId = upload.fileId;
      clip.driveWebViewLink = upload.webViewLink;
    }

    if (process.env.RADIO_EDIT_COPY_TO_DRIVE_DESKTOP === "1") {
      for (const clip of clips) {
        await copyToGoogleDriveDesktop(clip.path, clip.driveFolderName || IG_RADIO_FOLDER_NAME).catch((error) => {
          console.warn("[radio-video-edit] Google Drive Desktop copy failed:", error instanceof Error ? error.message : error);
        });
      }
    }

    return clips;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function notifyMissingDjName(userId: string, pendingActionId: string, videoPath: string): Promise<void> {
  const fileName = path.basename(videoPath);
  const command = `nombre ${pendingActionId} DJ NAME`;
  const message = [
    `No sé el nombre del DJ para ${fileName}.`,
    `Responde: ${command}`,
    "",
    "Ejemplo:",
    `nombre ${pendingActionId} MYNA`,
  ].join("\n");

  const telegramConfig = await storage.getTelegramConfig(userId).catch(() => undefined);
  if (TELEGRAM_BOT_TOKEN && telegramConfig?.enabled && telegramConfig.chatId) {
    await sendTelegramPlainMessage(TELEGRAM_BOT_TOKEN, telegramConfig.chatId, message).catch((error) => {
      console.warn("[radio-video-edit] Telegram notification failed:", error instanceof Error ? error.message : error);
    });
  }

  await sendPushNotification(userId, {
    title: "Falta nombre del DJ",
    body: `No sé el nombre del DJ para ${fileName}.`,
    url: "/?pending=radio_edit.resolve_dj_name",
    tag: `radio-edit-name-${pendingActionId}`,
  }).catch((error) => {
    console.warn("[radio-video-edit] Push notification failed:", error instanceof Error ? error.message : error);
  });
}

async function createMissingDjNameAction(params: {
  userId: string;
  videoPath: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  outputDir?: string;
  bestDropSecond?: number;
}): Promise<string> {
  const existing = (await storage.getPendingActions(params.userId)).find((action) => (
    action.actionType === "radio_edit.resolve_dj_name" &&
    action.resourceId === params.videoPath &&
    ["pending", "edited", "snoozed", "approved", "executing"].includes(action.status)
  ));
  if (existing) return existing.id;

  const pendingAction = await createPendingActionForApproval({
    userId: params.userId,
    actorType: "scheduler",
    actorId: "radio-video-edit-agent",
    origin: "scheduler",
    executionMode: "user_requested",
    actionType: "radio_edit.resolve_dj_name",
    resourceType: "radio_video",
    resourceId: params.videoPath,
    title: "Falta nombre del DJ",
    description: `No pude leer el nombre del DJ en ${path.basename(params.videoPath)}. Escribe el nombre para generar los clips.`,
    input: {
      videoPath: params.videoPath,
      sourceDir: params.sourceDir,
      fallbackInputDir: params.fallbackInputDir,
      outputDir: params.outputDir || DEFAULT_OUTPUT_DIR,
      bestDropSecond: params.bestDropSecond,
    },
    proposedChanges: {
      expectedTelegramFormat: "nombre <pendingActionId> MYNA",
      outputs: ["<DJ>_60s_horizontal_ig.mp4", "<DJ>_30s_vertical_tiktok.mp4"],
    },
    metadata: { status: "needs_dj_name" satisfies RadioEditStatus },
    scope: "system",
  });

  await notifyMissingDjName(params.userId, pendingAction.id, params.videoPath);
  return pendingAction.id;
}

export async function processRadioVideo(params: {
  userId: string;
  videoPath: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  outputDir?: string;
  force?: boolean;
}): Promise<RadioVideoProcessResult> {
  try {
    const duration = await getVideoDuration(params.videoPath);
    const bestDropSecond = await findBestDropSecond(params.videoPath, duration);
    const djName = await detectDjNameByOcr(params.videoPath);

    if (!djName) {
      const pendingActionId = await createMissingDjNameAction({
        userId: params.userId,
        videoPath: params.videoPath,
        sourceDir: params.sourceDir,
        fallbackInputDir: params.fallbackInputDir,
        outputDir: params.outputDir,
        bestDropSecond,
      });
      return { videoPath: params.videoPath, status: "needs_dj_name", pendingActionId };
    }

    const clips = await renderRadioVideoJob({
      videoPath: params.videoPath,
      outputDir: params.outputDir,
      sourceDir: params.sourceDir,
      fallbackInputDir: params.fallbackInputDir,
      bestDropSecond,
      djName,
      force: params.force,
      userId: params.userId,
    });

    await writeAuditLog({
      userId: params.userId,
      actorType: "scheduler",
      actorId: "radio-video-edit-agent",
      origin: "scheduler",
      actionType: "radio_edit.render",
      resourceType: "radio_video",
      resourceId: params.videoPath,
      metadata: { djName, bestDropSecond, clips },
      status: "succeeded",
      executionMode: "user_requested",
    }).catch(() => undefined);

    return { videoPath: params.videoPath, status: "completed", djName, clips };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { videoPath: params.videoPath, status: "failed", error: errorMessage };
  }
}

export async function processRadioVideos(options: {
  userId: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  outputDir?: string;
  searchDepth?: number;
  force?: boolean;
}): Promise<RadioVideoProcessResult[]> {
  const sourceDir = options.sourceDir || path.join(os.homedir(), "Movies");
  const fallbackInputDir = options.fallbackInputDir || DEFAULT_FALLBACK_INPUT_DIR;
  const videos = await findRadioVideos({
    sourceDir,
    fallbackInputDir,
    searchDepth: options.searchDepth,
  });

  const results: RadioVideoProcessResult[] = [];
  for (const videoPath of videos) {
    results.push(await processRadioVideo({
      userId: options.userId,
      videoPath,
      sourceDir,
      fallbackInputDir,
      outputDir: options.outputDir || DEFAULT_OUTPUT_DIR,
      force: options.force,
    }));
  }
  return results;
}

export async function resumeRadioVideoEditWithDjName(actionInput: RadioVideoJobInput): Promise<{
  djName: string;
  clips: RenderedClip[];
}> {
  const djName = sanitizeDjName(String(actionInput.djName || ""));
  if (!djName) {
    throw new Error("Falta el nombre del DJ.");
  }
  if (!actionInput.videoPath) {
    throw new Error("Falta el video original para continuar el render.");
  }

  const clips = await renderRadioVideoJob({
    ...actionInput,
    djName,
  });

  return { djName, clips };
}

export function parseDjNameResolutionCommand(message: string): { actionId: string; djName: string } | null {
  const match = message.trim().match(/^(?:nombre|dj)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+(.+)$/i);
  if (!match) return null;
  const djName = sanitizeDjName(match[2]);
  if (!djName) return null;
  return { actionId: match[1], djName };
}
