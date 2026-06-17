import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

export type ClipperAccountCategory = "sports" | "memes" | "streamers";
export type ClipperAccountStatus = "ready" | "needs_connection" | "paused";
export type ClipperSourceType = "owned_folder" | "official_api" | "creator_allowlist" | "manual_drop";
export type ClipperAgentStatus = "active" | "waiting" | "review_required";

export interface ClipperAccount {
  id: string;
  name: string;
  category: ClipperAccountCategory;
  platforms: string[];
  dailyClipTarget: number;
  weeklyViewsGoal: number;
  lastWeekViews: number;
  status: ClipperAccountStatus;
  contentPolicy: string;
}

export interface ClipperSource {
  id: string;
  label: string;
  type: ClipperSourceType;
  freshness: string;
  rightsMode: "owned" | "licensed" | "permissioned" | "review_required";
  status: "connected" | "planned" | "needs_setup";
}

export interface ClipperSubAgent {
  id: string;
  name: string;
  job: string;
  status: ClipperAgentStatus;
  output: string;
}

export interface ClipperPipelineItem {
  stage: string;
  count: number;
  owner: string;
  status: ClipperAgentStatus;
}

export interface ClipperStatus {
  rootDir: string;
  reportsDir: string;
  accounts: ClipperAccount[];
  sources: ClipperSource[];
  agents: ClipperSubAgent[];
  pipeline: ClipperPipelineItem[];
  goals: {
    weeklyViewsPerAccount: number;
    totalWeeklyGoal: number;
    dailyClipsTarget: number;
    connectedAccounts: number;
  };
  latestReport: ClipperReport | null;
  guardrails: string[];
}

export interface ClipperRunOptions {
  clipsPerAccount?: number;
  publishMode?: "draft_only" | "approval_required" | "auto_after_connection";
  riskTolerance?: "safe" | "growth" | "aggressive";
}

export interface ClipperPlannedClip {
  accountId: string;
  title: string;
  sourceStrategy: string;
  format: string;
  hook: string;
  publishWindow: string;
  status: "drafted" | "needs_source" | "needs_review";
}

export interface ClipperReport {
  id: string;
  createdAt: string;
  summary: string;
  publishMode: "draft_only" | "approval_required" | "auto_after_connection";
  riskTolerance: "safe" | "growth" | "aggressive";
  plannedClips: ClipperPlannedClip[];
  accountRecommendations: Array<{
    accountId: string;
    recommendation: string;
    reason: string;
  }>;
  nextActions: string[];
  reportPath: string;
}

const ROOT_DIR = path.join(process.cwd(), "clippers_workspace");
const REPORTS_DIR = path.join(ROOT_DIR, "reports");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");

const DEFAULT_ACCOUNTS: ClipperAccount[] = [
  {
    id: "sports-daily",
    name: "Sports Daily Clips",
    category: "sports",
    platforms: ["TikTok", "Instagram Reels", "YouTube Shorts"],
    dailyClipTarget: 10,
    weeklyViewsGoal: 1_000_000,
    lastWeekViews: 286_000,
    status: "needs_connection",
    contentPolicy: "Use official highlights, licensed footage, owned commentary, or creator-approved clips.",
  },
  {
    id: "meme-radar",
    name: "Meme Radar",
    category: "memes",
    platforms: ["TikTok", "Instagram Reels"],
    dailyClipTarget: 12,
    weeklyViewsGoal: 1_000_000,
    lastWeekViews: 412_000,
    status: "needs_connection",
    contentPolicy: "Use original edits, permissioned templates, public-domain media, or remix-safe assets.",
  },
  {
    id: "streamer-pulse",
    name: "Streamer Pulse",
    category: "streamers",
    platforms: ["TikTok", "YouTube Shorts", "Instagram Reels"],
    dailyClipTarget: 8,
    weeklyViewsGoal: 1_000_000,
    lastWeekViews: 198_000,
    status: "needs_connection",
    contentPolicy: "Use creator allowlists, owned VODs, or explicit clip permission before publishing.",
  },
];

const DEFAULT_SOURCES: ClipperSource[] = [
  {
    id: "owned-dropbox",
    label: "Carpeta local de videos propios",
    type: "owned_folder",
    freshness: "cada hora",
    rightsMode: "owned",
    status: "planned",
  },
  {
    id: "platform-trends",
    label: "Tendencias por APIs oficiales",
    type: "official_api",
    freshness: "reciente/viral",
    rightsMode: "review_required",
    status: "needs_setup",
  },
  {
    id: "creator-whitelist",
    label: "Allowlist de creadores/streamers",
    type: "creator_allowlist",
    freshness: "diario",
    rightsMode: "permissioned",
    status: "planned",
  },
  {
    id: "manual-drop",
    label: "Drop manual urgente",
    type: "manual_drop",
    freshness: "on demand",
    rightsMode: "review_required",
    status: "connected",
  },
];

const DEFAULT_AGENTS: ClipperSubAgent[] = [
  {
    id: "trend-scout",
    name: "Trend Scout",
    job: "Detecta temas con momentum por categoria y plataforma.",
    status: "active",
    output: "Prioriza recencia, velocidad de comentarios y angulo repetible.",
  },
  {
    id: "rights-gate",
    name: "Rights Gate",
    job: "Bloquea fuentes sin permiso claro antes de editar o publicar.",
    status: "review_required",
    output: "Todo clip externo queda en revision hasta tener permiso/licencia/fuente oficial.",
  },
  {
    id: "clip-factory",
    name: "Clip Factory",
    job: "Convierte ideas en drafts verticales con hook, caption y CTA.",
    status: "waiting",
    output: "Listo para conectarse al editor local y carpetas de assets.",
  },
  {
    id: "publisher",
    name: "Publisher",
    job: "Programa posts por cuenta cuando la plataforma esta conectada.",
    status: "waiting",
    output: "Publicacion real requiere credenciales y permisos oficiales por plataforma.",
  },
  {
    id: "optimizer",
    name: "Optimizer",
    job: "Lee views, retencion y shares para ajustar hooks, horarios y formatos.",
    status: "active",
    output: "Sube frecuencia en cuentas con mejor ratio views/clip y pausa formatos flojos.",
  },
];

async function ensureClipperDirs() {
  await Promise.all([
    mkdir(ROOT_DIR, { recursive: true }),
    mkdir(REPORTS_DIR, { recursive: true }),
  ]);
}

async function readConfig(): Promise<{ accounts?: ClipperAccount[]; sources?: ClipperSource[] }> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { accounts?: ClipperAccount[]; sources?: ClipperSource[] };
    return parsed;
  } catch {
    return {};
  }
}

async function writeDefaultConfigIfMissing() {
  await ensureClipperDirs();
  try {
    await stat(CONFIG_PATH);
  } catch {
    await writeFile(CONFIG_PATH, JSON.stringify({ accounts: DEFAULT_ACCOUNTS, sources: DEFAULT_SOURCES }, null, 2));
  }
}

function normalizeRunOptions(input: unknown): Required<ClipperRunOptions> {
  const value = (input && typeof input === "object" ? input : {}) as ClipperRunOptions;
  const clipsPerAccount = Number(value.clipsPerAccount);
  return {
    clipsPerAccount: Number.isFinite(clipsPerAccount) ? Math.min(Math.max(Math.round(clipsPerAccount), 1), 50) : 8,
    publishMode:
      value.publishMode === "auto_after_connection" || value.publishMode === "draft_only" || value.publishMode === "approval_required"
        ? value.publishMode
        : "approval_required",
    riskTolerance:
      value.riskTolerance === "aggressive" || value.riskTolerance === "growth" || value.riskTolerance === "safe"
        ? value.riskTolerance
        : "growth",
  };
}

export function getClipperCategoryLabel(category: ClipperAccountCategory): string {
  if (category === "sports") return "Deportes";
  if (category === "memes") return "Memes";
  return "Streamers";
}

function buildPipeline(accounts: ClipperAccount[]): ClipperPipelineItem[] {
  const dailyTarget = accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  return [
    { stage: "Trend scan", count: dailyTarget * 4, owner: "Trend Scout", status: "active" },
    { stage: "Rights review", count: Math.ceil(dailyTarget * 1.8), owner: "Rights Gate", status: "review_required" },
    { stage: "Draft edits", count: dailyTarget, owner: "Clip Factory", status: "waiting" },
    { stage: "Scheduled posts", count: 0, owner: "Publisher", status: "waiting" },
    { stage: "Performance loops", count: accounts.length, owner: "Optimizer", status: "active" },
  ];
}

async function getLatestReport(): Promise<ClipperReport | null> {
  await ensureClipperDirs();
  const files = await readdir(REPORTS_DIR).catch(() => []);
  const reports = files.filter((file) => file.endsWith(".json")).sort().reverse();
  if (!reports[0]) return null;
  try {
    const raw = await readFile(path.join(REPORTS_DIR, reports[0]), "utf8");
    return JSON.parse(raw) as ClipperReport;
  } catch {
    return null;
  }
}

export async function getClipperStatus(): Promise<ClipperStatus> {
  await writeDefaultConfigIfMissing();
  const config = await readConfig();
  const accounts = Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS;
  const sources = Array.isArray(config.sources) && config.sources.length ? config.sources : DEFAULT_SOURCES;
  const dailyClipsTarget = accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  const weeklyViewsPerAccount = 1_000_000;

  return {
    rootDir: ROOT_DIR,
    reportsDir: REPORTS_DIR,
    accounts,
    sources,
    agents: DEFAULT_AGENTS,
    pipeline: buildPipeline(accounts),
    goals: {
      weeklyViewsPerAccount,
      totalWeeklyGoal: accounts.length * weeklyViewsPerAccount,
      dailyClipsTarget,
      connectedAccounts: accounts.filter((account) => account.status === "ready").length,
    },
    latestReport: await getLatestReport(),
    guardrails: [
      "Publicar solo contenido propio, licenciado, permitido por el creador o disponible desde una fuente oficial.",
      "Las cuentas nuevas empiezan con aprobacion manual hasta validar calidad, permisos y riesgo de strikes.",
      "El optimizador puede cambiar hooks, horarios y volumen; no debe evadir derechos, marcas de agua o reglas de plataforma.",
    ],
  };
}

function buildPlannedClips(accounts: ClipperAccount[], clipsPerAccount: number): ClipperPlannedClip[] {
  const hooksByCategory: Record<ClipperAccountCategory, string[]> = {
    sports: ["Ultimo minuto", "La jugada que cambio todo", "Nadie esta hablando de esto"],
    memes: ["POV del dia", "Esto se salio de control", "El internet hoy"],
    streamers: ["Clip del momento", "Chat no podia creerlo", "El fail mas rapido del stream"],
  };

  return accounts.flatMap((account) =>
    Array.from({ length: Math.min(clipsPerAccount, account.dailyClipTarget) }, (_, index) => {
      const hooks = hooksByCategory[account.category];
      return {
        accountId: account.id,
        title: `${getClipperCategoryLabel(account.category)} draft ${index + 1}`,
        sourceStrategy: account.status === "ready" ? "fuente conectada + derechos verificados" : "pendiente conectar fuente/cuenta",
        format: index % 3 === 0 ? "9:16 hook + captions + punchline" : "9:16 fast cut + loop ending",
        hook: hooks[index % hooks.length],
        publishWindow: index % 2 === 0 ? "12:00-15:00" : "18:00-22:00",
        status: account.status === "ready" ? "drafted" : "needs_source",
      };
    })
  );
}

function buildRecommendations(accounts: ClipperAccount[]): ClipperReport["accountRecommendations"] {
  return accounts.map((account) => {
    const progress = account.lastWeekViews / account.weeklyViewsGoal;
    if (progress >= 0.75) {
      return {
        accountId: account.id,
        recommendation: "Duplicar el formato ganador y subir 20% mas clips.",
        reason: "La cuenta esta cerca de la meta semanal y conviene explotar momentum.",
      };
    }
    if (progress >= 0.35) {
      return {
        accountId: account.id,
        recommendation: "Probar hooks mas agresivos y dos horarios nuevos.",
        reason: "Hay traccion, pero falta mejorar retencion y share rate.",
      };
    }
    return {
      accountId: account.id,
      recommendation: "Conectar mejores fuentes y bajar volumen hasta validar senales.",
      reason: "La cuenta esta lejos de 1M/week; publicar mas sin buen material puede cansar el algoritmo.",
    };
  });
}

export async function runClipperDailyPlan(input: unknown = {}): Promise<{ report: ClipperReport; status: ClipperStatus }> {
  await writeDefaultConfigIfMissing();
  const options = normalizeRunOptions(input);
  const status = await getClipperStatus();
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `${id}.json`);
  const plannedClips = buildPlannedClips(status.accounts, options.clipsPerAccount);
  const report: ClipperReport = {
    id,
    createdAt: new Date().toISOString(),
    summary: `Plan diario generado: ${plannedClips.length} drafts propuestos para ${status.accounts.length} cuentas.`,
    publishMode: options.publishMode,
    riskTolerance: options.riskTolerance,
    plannedClips,
    accountRecommendations: buildRecommendations(status.accounts),
    nextActions: [
      "Conectar credenciales oficiales de TikTok, Instagram y YouTube por cuenta.",
      "Crear allowlist de fuentes/creadores con permiso explicito.",
      "Definir carpetas locales por categoria para que Clip Factory pueda generar archivos reales.",
      "Activar reportes diarios por Telegram cuando existan metricas reales de plataforma.",
    ],
    reportPath,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return { report, status: await getClipperStatus() };
}

export async function readClipperReport(id: string): Promise<ClipperReport | null> {
  const safeId = path.basename(id).replace(/\.json$/i, "");
  const reportPath = path.join(REPORTS_DIR, `${safeId}.json`);
  try {
    const raw = await readFile(reportPath, "utf8");
    return JSON.parse(raw) as ClipperReport;
  } catch {
    return null;
  }
}

export const __clipperInternals = {
  normalizeRunOptions,
  buildPlannedClips,
};
