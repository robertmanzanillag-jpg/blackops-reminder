import { spawn } from "child_process";
import { mkdir, readdir, stat, writeFile } from "fs/promises";
import path from "path";

export type PromoVideoStyle = "full" | "post";
export type PromoVideoObjective = "nightlife" | "dinner" | "pool" | "yacht" | "guestlist";

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
  inputVideos: PromoVideoFile[];
  outputVideos: PromoVideoFile[];
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
  hookText?: string;
  ctaText?: string;
}

export interface PromoVideoRunResult {
  ok: boolean;
  output: string;
  reportPath: string;
  options: PromoVideoRunOptions;
  status: PromoVideoStatus;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const ROOT_DIR = path.join(process.cwd(), "promo_video_edits");
const INPUT_DIR = path.join(ROOT_DIR, "01_originales");
const LINKS_DIR = path.join(ROOT_DIR, "02_links");
const OUTPUT_DIR = path.join(ROOT_DIR, "03_listos_para_subir");
const REPORT_DIR = path.join(ROOT_DIR, "04_reportes");

export const PROMO_TEMPLATES: PromoTemplate[] = [
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

async function listVideoFiles(dir: string): Promise<PromoVideoFile[]> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  const files = await Promise.all(
    entries
      .filter((entry) => VIDEO_EXTENSIONS.has(path.extname(entry).toLowerCase()))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry);
        const fileStat = await stat(fullPath);
        return {
          name: entry,
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
  const [inputVideos, outputVideos] = await Promise.all([
    listVideoFiles(INPUT_DIR),
    listVideoFiles(OUTPUT_DIR),
  ]);

  return {
    rootDir: ROOT_DIR,
    inputDir: INPUT_DIR,
    outputDir: OUTPUT_DIR,
    reportDir: REPORT_DIR,
    inputVideos,
    outputVideos,
    templates: PROMO_TEMPLATES,
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
    : "nightlife";
  const template = getPromoTemplate(objective);

  return {
    objective,
    clipsPerVideo: clampInteger(input.clipsPerVideo, 5, 1, 30),
    targetSeconds: clampInteger(input.targetSeconds, 15, 6, 90),
    cuts: clampInteger(input.cuts, 3, 1, 12),
    style: input.style === "post" ? "post" : "full",
    hookText: (input.hookText || template.hook).trim().slice(0, 80),
    ctaText: (input.ctaText || template.cta).trim().slice(0, 80),
  };
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
        HOOK_TEXT: options.hookText || "",
        CTA_TEXT: options.ctaText || "",
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

  const status = await getPromoVideoStatus();
  const result = { ok: true, output, reportPath, options, status };
  await writeFile(reportPath, JSON.stringify(result, null, 2));
  return result;
}

