import { spawn } from "child_process";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { DRIVE_KONG_VIDEOS_FOLDER, ensureAppDriveFolderPath, uploadLocalFileToDriveFolder } from "./google-drive";
import { getSystemUserId } from "./user-context";

export type PromoVideoStyle = "full" | "post";
export type PromoVideoObjective = "auto" | "nightlife" | "dinner" | "pool" | "yacht" | "guestlist";
export type PromoVideoFontStyle = "bold" | "clean" | "luxury" | "impact" | "neon";

export interface PromoVideoFile {
  name: string;
  path: string;
  sizeMb: number;
  modifiedAt: string;
}

export interface PromoVideoStatus {
  rootDir: string;
  inputDir: string;
  outputDir: string;
  reportDir: string;
  sourceDir: string | null;
  inputVideos: PromoVideoFile[];
  outputVideos: PromoVideoFile[];
  sourceVideos: PromoVideoFile[];
  templates: PromoTemplate[];
}

export interface PromoTemplate {
  id: PromoVideoObjective;
  label: string;
  hook: string;
  cta: string;
}

export interface PromoVideoRunOptions {
  objective: PromoVideoObjective;
  clipsPerVideo: number;
  targetSeconds: number;
  cuts: number;
  style: PromoVideoStyle;
  maxVideos: number;
  hookText?: string;
  ctaText?: string;
  fontStyle?: PromoVideoFontStyle;
  customText?: boolean;
  sourceDir?: string;
  sourceHint?: string;
  userId?: string;
}

export interface PromoVideoRunResult {
  ok: boolean;
  output: string;
  reportPath: string;
  options: PromoVideoRunOptions;
  status: PromoVideoStatus;
  driveUploads: PromoVideoDriveUpload[];
}

export interface PromoVideoImportResult {
  imported: number;
  skipped: number;
  files: PromoVideoFile[];
  status: PromoVideoStatus;
}

export interface PromoVideoAutoRunResult extends PromoVideoRunResult {
  importResult: PromoVideoImportResult;
}

interface PromoVideoConfig {
  sourceDir: string | null;
  lastAutoRunDate?: string | null;
}

export interface PromoVideoDriveUpload {
  fileName: string;
  filePath: string;
  category: string;
  dateFolder: string;
  folderId: string;
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
}

export class PromoVideoSourceError extends Error {
  requested: string;
  suggestions: string[];

  constructor(message: string, requested: string, suggestions: string[] = []) {
    super(message);
    this.name = "PromoVideoSourceError";
    this.requested = requested;
    this.suggestions = suggestions;
  }
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const ROOT_DIR = path.join(process.cwd(), "promo_video_edits");
const INPUT_DIR = path.join(ROOT_DIR, "01_originales");
const LINKS_DIR = path.join(ROOT_DIR, "02_links");
const OUTPUT_DIR = path.join(ROOT_DIR, "03_listos_para_subir");
const REPORT_DIR = path.join(ROOT_DIR, "04_reportes");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");

export const PROMO_TEMPLATES: PromoTemplate[] = [
  {
    id: "auto",
    label: "Auto selector",
    hook: "BEST APP TO GO OUT",
    cta: "JOIN THE GUESTLIST",
  },
  {
    id: "nightlife",
    label: "Nightlife app",
    hook: "BEST APP TO GO OUT",
    cta: "JOIN THE GUESTLIST",
  },
  {
    id: "dinner",
    label: "Promo dinners",
    hook: "PROMO DINNERS TONIGHT",
    cta: "RESERVE YOUR SPOT",
  },
  {
    id: "pool",
    label: "Pool party",
    hook: "POOL PARTY THIS WEEK",
    cta: "GET ON THE LIST",
  },
  {
    id: "yacht",
    label: "Yacht party",
    hook: "YACHT PARTY WEEKEND",
    cta: "DM FOR ACCESS",
  },
  {
    id: "guestlist",
    label: "Guestlist",
    hook: "GUESTLIST OPEN",
    cta: "TAP IN TONIGHT",
  },
];

async function ensurePromoVideoDirs() {
  await Promise.all([
    mkdir(INPUT_DIR, { recursive: true }),
    mkdir(LINKS_DIR, { recursive: true }),
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(REPORT_DIR, { recursive: true }),
  ]);
}

async function readPromoConfig(): Promise<PromoVideoConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { sourceDir?: unknown; lastAutoRunDate?: unknown };
    return {
      sourceDir: typeof parsed.sourceDir === "string" && parsed.sourceDir.trim()
        ? path.resolve(parsed.sourceDir.trim())
        : null,
      lastAutoRunDate: typeof parsed.lastAutoRunDate === "string" ? parsed.lastAutoRunDate : null,
    };
  } catch {
    return { sourceDir: null };
  }
}

async function writePromoConfig(config: PromoVideoConfig) {
  await ensurePromoVideoDirs();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isPromoVideoCandidate(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  if (!isVideoFile(filePath)) return false;
  return !/(screenshot|screen[-_\s]?recording|screenrecording|captura[-_\s]?de[-_\s]?pantalla)/i.test(name);
}

async function listVideoFiles(dir: string, options: { create?: boolean; recursive?: boolean } = { create: true }): Promise<PromoVideoFile[]> {
  if (options.create !== false) {
    await mkdir(dir, { recursive: true });
  }

  let entries: Array<{ name: string; fullPath: string }>;
  try {
    const names = await readdir(dir, { withFileTypes: true });
    if (options.recursive) {
      const nested = await Promise.all(
        names.map(async (entry) => {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            return listVideoFiles(fullPath, { create: false, recursive: true });
          }

          return isPromoVideoCandidate(fullPath) ? [{
            name: path.relative(dir, fullPath),
            path: fullPath,
            sizeMb: 0,
            modifiedAt: "",
          }] : [];
        })
      );
      const flattened = nested.flat();
      const withStats = await Promise.all(
        flattened.map(async (entry) => {
          const fileStat = await stat(entry.path);
          return {
            name: entry.name,
            path: entry.path,
            sizeMb: Math.round((fileStat.size / 1024 / 1024) * 10) / 10,
            modifiedAt: fileStat.mtime.toISOString(),
          };
        })
      );
      return withStats.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    }

    entries = names.map((entry) => ({ name: entry.name, fullPath: path.join(dir, entry.name) }));
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries
      .filter((entry) => isPromoVideoCandidate(entry.fullPath))
      .map(async (entry) => {
        const fullPath = entry.fullPath;
        const fileStat = await stat(fullPath);
        return {
          name: entry.name,
          path: fullPath,
          sizeMb: Math.round((fileStat.size / 1024 / 1024) * 10) / 10,
          modifiedAt: fileStat.mtime.toISOString(),
        };
      })
  );

  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function getPromoTemplate(objective: PromoVideoObjective): PromoTemplate {
  return PROMO_TEMPLATES.find((template) => template.id === objective) || PROMO_TEMPLATES[0];
}

export async function getPromoVideoStatus(): Promise<PromoVideoStatus> {
  await ensurePromoVideoDirs();
  const config = await readPromoConfig();
  const [inputVideos, outputVideos, sourceVideos] = await Promise.all([
    listVideoFiles(INPUT_DIR),
    listVideoFiles(OUTPUT_DIR),
    config.sourceDir ? listVideoFiles(config.sourceDir, { create: false, recursive: true }) : Promise.resolve([]),
  ]);

  return {
    rootDir: ROOT_DIR,
    inputDir: INPUT_DIR,
    outputDir: OUTPUT_DIR,
    reportDir: REPORT_DIR,
    sourceDir: config.sourceDir,
    inputVideos,
    outputVideos,
    sourceVideos,
    templates: PROMO_TEMPLATES,
  };
}

export async function setPromoVideoSourceDir(sourceDir: unknown): Promise<PromoVideoStatus> {
  await ensurePromoVideoDirs();
  const current = await readPromoConfig();
  if (typeof sourceDir !== "string" || !sourceDir.trim()) {
    await writePromoConfig({ ...current, sourceDir: null });
    return getPromoVideoStatus();
  }

  const resolved = path.resolve(sourceDir.trim().replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  const sourceStat = await stat(resolved);
  if (!sourceStat.isDirectory()) {
    throw new Error("La ruta indicada no es una carpeta.");
  }

  await writePromoConfig({ ...current, sourceDir: resolved });
  return getPromoVideoStatus();
}

function sanitizeFilenamePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "video";
}

async function findCaseInsensitiveSubdir(parent: string, hint: string): Promise<string | null> {
  const wanted = hint.toLowerCase().replace(/\s+/g, " ").trim();
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const direct = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === wanted);
    if (direct) return path.join(parent, direct.name);

    const loose = entries.find((entry) => {
      const name = entry.name.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      return entry.isDirectory() && (name === wanted || name.includes(wanted) || wanted.includes(name));
    });
    return loose ? path.join(parent, loose.name) : null;
  } catch {
    return null;
  }
}

export async function getPromoVideoSourceFolders(): Promise<string[]> {
  const config = await readPromoConfig();
  if (!config.sourceDir) return [];

  try {
    const entries = await readdir(config.sourceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function resolvePromoVideoSourceDir(source: unknown): Promise<string | null> {
  if (typeof source !== "string" || !source.trim()) return null;
  const raw = source.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  const config = await readPromoConfig();
  const expanded = raw.replace(/^~(?=$|\/)/, process.env.HOME || "~");

  const candidates: string[] = [];
  if (path.isAbsolute(expanded)) {
    candidates.push(path.resolve(expanded));
  } else {
    if (config.sourceDir) {
      candidates.push(path.resolve(config.sourceDir, expanded));
      const matched = await findCaseInsensitiveSubdir(config.sourceDir, expanded);
      if (matched) candidates.push(matched);
    }
    candidates.push(path.resolve(expanded));
  }

  for (const candidate of candidates) {
    try {
      const sourceStat = await stat(candidate);
      if (sourceStat.isDirectory()) return candidate;
    } catch {}
  }

  throw new PromoVideoSourceError(
    `No encontre la carpeta de videos: ${raw}`,
    raw,
    await getPromoVideoSourceFolders(),
  );
}

export async function importPromoVideosFromSource(input: { limit?: unknown; sourceDir?: unknown; sourceHint?: unknown } = {}): Promise<PromoVideoImportResult> {
  await ensurePromoVideoDirs();
  const config = await readPromoConfig();
  const requestedSource = await resolvePromoVideoSourceDir(input.sourceDir || input.sourceHint).catch((error) => {
    throw error;
  });
  const sourceDir = requestedSource || config.sourceDir;
  if (!sourceDir) {
    throw new Error("Primero indica una carpeta origen.");
  }

  const sourceVideos = await listVideoFiles(sourceDir, { create: false, recursive: true });
  if (sourceVideos.length === 0) {
    throw new PromoVideoSourceError(
      `No encontre videos .mp4, .mov o .m4v en la carpeta: ${sourceDir}`,
      String(input.sourceDir || input.sourceHint || sourceDir),
      await getPromoVideoSourceFolders(),
    );
  }

  const limit = clampInteger(input.limit, sourceVideos.length, 1, 5000);
  let imported = 0;
  let skipped = 0;

  for (const video of sourceVideos.slice(0, limit)) {
    const relative = path.relative(sourceDir, video.path);
    const destinationName = sanitizeFilenamePart(relative.replace(/[\\/]+/g, "__"));
    const destination = path.join(INPUT_DIR, destinationName);
    try {
      await stat(destination);
      skipped += 1;
      continue;
    } catch {
      await copyFile(video.path, destination);
      imported += 1;
    }
  }

  return {
    imported,
    skipped,
    files: sourceVideos,
    status: await getPromoVideoStatus(),
  };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function normalizePromoVideoOptions(input: Partial<PromoVideoRunOptions>): PromoVideoRunOptions {
  const objective = PROMO_TEMPLATES.some((template) => template.id === input.objective)
    ? input.objective as PromoVideoObjective
    : "auto";
  const template = getPromoTemplate(objective);

  return {
    objective,
    clipsPerVideo: clampInteger(input.clipsPerVideo, 5, 1, 30),
    targetSeconds: clampInteger(input.targetSeconds, 15, 6, 90),
    cuts: clampInteger(input.cuts, 3, 1, 12),
    style: input.style === "post" ? "post" : "full",
    maxVideos: clampInteger(input.maxVideos, 0, 0, 5000),
    hookText: (input.hookText || template.hook).trim().slice(0, 80),
    ctaText: (input.ctaText || template.cta).trim().slice(0, 80),
    fontStyle: ["bold", "clean", "luxury", "impact", "neon"].includes(String(input.fontStyle))
      ? input.fontStyle as PromoVideoFontStyle
      : "bold",
    customText: Boolean(input.customText || input.hookText?.trim() || input.ctaText?.trim()),
    sourceDir: input.sourceDir,
    sourceHint: input.sourceHint,
    userId: input.userId,
  };
}

function extractGeneratedOutputFiles(output: string): string[] {
  const files: string[] = [];
  const regex = /Listo:\s+(.+?\.mp4)\s*$/gm;
  let match;
  while ((match = regex.exec(output)) !== null) {
    files.push(match[1].trim());
  }
  return [...new Set(files)];
}

function sanitizeDriveFolderName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "General";
}

function categoryFromOutputFile(filePath: string, options: PromoVideoRunOptions): string {
  if (options.sourceHint) return sanitizeDriveFolderName(options.sourceHint);
  const name = path.basename(filePath);
  const prefix = name.includes("__") ? name.split("__")[0] : "";
  if (prefix) return sanitizeDriveFolderName(prefix);
  if (options.objective && options.objective !== "auto") return sanitizeDriveFolderName(options.objective);
  return "General";
}

async function uploadPromoOutputsToDrive(outputFiles: string[], options: PromoVideoRunOptions): Promise<PromoVideoDriveUpload[]> {
  const uploads: PromoVideoDriveUpload[] = [];
  const userId = options.userId || getSystemUserId();
  const dateFolder = getLocalDateKey(new Date());

  for (const filePath of outputFiles) {
    const category = categoryFromOutputFile(filePath, options);
    const folderId = await ensureAppDriveFolderPath([DRIVE_KONG_VIDEOS_FOLDER, category, dateFolder], userId);
    const upload = await uploadLocalFileToDriveFolder({
      filePath,
      folderId,
      mimeType: "video/mp4",
      userId,
    });
    uploads.push({
      fileName: path.basename(filePath),
      filePath,
      category,
      dateFolder,
      folderId,
      fileId: upload.fileId,
      webViewLink: upload.webViewLink,
      webContentLink: upload.webContentLink,
    });
  }

  return uploads;
}

export async function runPromoVideoEdit(input: Partial<PromoVideoRunOptions>): Promise<PromoVideoRunResult> {
  await ensurePromoVideoDirs();
  const options = normalizePromoVideoOptions(input);
  const scriptPath = path.join(process.cwd(), "scripts", "edit-promo-videos.sh");
  const reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("bash", [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OBJECTIVE: options.objective,
        CLIPS_PER_VIDEO: String(options.clipsPerVideo),
        TARGET_SECONDS: String(options.targetSeconds),
        CUTS: String(options.cuts),
        STYLE: options.style,
        MAX_VIDEOS: String(options.maxVideos),
        HOOK_TEXT: options.hookText || "",
        CTA_TEXT: options.ctaText || "",
        FONT_STYLE: options.fontStyle || "bold",
        CUSTOM_TEXT: options.customText ? "1" : "0",
        INPUT_SOURCE_DIR: options.sourceDir || "",
      },
    });

    let combined = "";
    child.stdout.on("data", (chunk) => {
      combined += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      combined += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(combined);
      } else {
        reject(new Error(combined || `Promo video editor failed with exit code ${code}`));
      }
    });
  });

  const outputFiles = extractGeneratedOutputFiles(output);
  const driveUploads = await uploadPromoOutputsToDrive(outputFiles, options);
  const status = await getPromoVideoStatus();
  const result = { ok: true, output, reportPath, options, status, driveUploads };
  await writeFile(reportPath, JSON.stringify(result, null, 2));
  return result;
}

export async function runPromoVideoAutoDaily(input: Partial<PromoVideoRunOptions> = {}): Promise<PromoVideoAutoRunResult> {
  const resolvedSourceDir = await resolvePromoVideoSourceDir(input.sourceDir || input.sourceHint);
  const importResult = await importPromoVideosFromSource({
    limit: input.maxVideos || 5,
    sourceDir: resolvedSourceDir || undefined,
  });
  const runResult = await runPromoVideoEdit({
    objective: "auto",
    clipsPerVideo: 1,
    targetSeconds: input.targetSeconds || 15,
    cuts: input.cuts || 3,
    style: input.style || "full",
    maxVideos: input.maxVideos || 5,
    hookText: input.hookText,
    ctaText: input.ctaText,
    fontStyle: input.fontStyle,
    customText: Boolean(input.customText || input.hookText?.trim() || input.ctaText?.trim()),
    sourceDir: resolvedSourceDir || undefined,
    sourceHint: input.sourceHint,
    userId: input.userId,
  });

  const config = await readPromoConfig();
  await writePromoConfig({
    ...config,
    lastAutoRunDate: getLocalDateKey(new Date()),
  });

  return {
    ...runResult,
    importResult,
  };
}

function getLocalDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function maybeRunPromoVideoDaily() {
  const config = await readPromoConfig();
  if (!config.sourceDir) return;

  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(now));
  if (hour < 8) return;

  const today = getLocalDateKey(now);
  if (config.lastAutoRunDate === today) return;

  await runPromoVideoAutoDaily({ maxVideos: 5, targetSeconds: 15, cuts: 3, style: "full" });
}

export function startPromoVideoDailyScheduler() {
  const run = () => {
    maybeRunPromoVideoDaily().catch((error) => {
      console.error(`[PromoVideo] Auto daily failed: ${error.message}`);
    });
  };

  setTimeout(run, 15 * 1000);
  setInterval(run, 60 * 60 * 1000);
}

export async function deletePromoOutputVideo(filename: unknown): Promise<PromoVideoStatus> {
  if (typeof filename !== "string" || !filename.trim()) {
    throw new Error("Falta el nombre del video.");
  }

  const target = path.resolve(OUTPUT_DIR, filename);
  if (!target.startsWith(path.resolve(OUTPUT_DIR) + path.sep)) {
    throw new Error("Video invalido.");
  }

  await unlink(target);
  return getPromoVideoStatus();
}
