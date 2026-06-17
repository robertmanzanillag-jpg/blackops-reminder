import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

export type ClipperAccountCategory = "sports" | "memes" | "streamers";
export type ClipperAccountStatus = "ready" | "needs_connection" | "paused";
export type ClipperSourceType = "owned_folder" | "official_api" | "creator_allowlist" | "manual_drop";
export type ClipperAgentStatus = "active" | "waiting" | "review_required";
export type ClipperPlatform = "tiktok" | "instagram" | "youtube";
export type ClipperPlatformConnectionStatus = "not_created" | "created" | "needs_oauth" | "needs_review" | "ready";
export type ClipperPermissionStatus = "missing" | "requested" | "approved" | "blocked";
export type ClipperReadinessStatus = "ready" | "missing" | "partial";

export interface ClipperPlatformAccount {
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  status: ClipperPlatformConnectionStatus;
  requiredScopes: string[];
  missingSteps: string[];
  notes: string;
}

export interface ClipperAccount {
  id: string;
  name: string;
  category: ClipperAccountCategory;
  platforms: string[];
  platformAccounts: ClipperPlatformAccount[];
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
  sourceRootDir: string;
  accounts: ClipperAccount[];
  sources: ClipperSource[];
  sourceFolders: ClipperSourceFolder[];
  credentialChecks: ClipperCredentialCheck[];
  platformRequirements: ClipperPlatformRequirement[];
  permissionQueue: ClipperPermissionRequest[];
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

export interface ClipperPlatformRequirement {
  platform: ClipperPlatform;
  label: string;
  developerPortalUrl: string;
  accountCreationUrl: string;
  requiredAccountType: string;
  scopes: string[];
  appReview: string;
  postingMode: string;
  humanRequired: string[];
  docs: string[];
}

export interface ClipperPermissionRequest {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionStatus;
  reason: string;
  evidenceRequired: string;
  docsUrl: string;
}

export interface ClipperCredentialCheck {
  platform: ClipperPlatform;
  label: string;
  status: ClipperReadinessStatus;
  requiredEnvVars: string[];
  configuredEnvVars: string[];
  missingEnvVars: string[];
  nextStep: string;
}

export interface ClipperSourceFolder {
  category: ClipperAccountCategory | "allowlist" | "drafts" | "scheduled";
  label: string;
  path: string;
  status: "ready";
  purpose: string;
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
const SOURCES_DIR = path.join(ROOT_DIR, "sources");
const DRAFTS_DIR = path.join(ROOT_DIR, "drafts");
const SCHEDULED_DIR = path.join(ROOT_DIR, "scheduled");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");

const SOURCE_FOLDERS: ClipperSourceFolder[] = [
  {
    category: "sports",
    label: "Deportes",
    path: path.join(SOURCES_DIR, "sports"),
    status: "ready",
    purpose: "Videos propios, licenciados o oficiales listos para detectar highlights deportivos.",
  },
  {
    category: "memes",
    label: "Memes",
    path: path.join(SOURCES_DIR, "memes"),
    status: "ready",
    purpose: "Assets originales, templates permitidos y clips remix-safe para memes.",
  },
  {
    category: "streamers",
    label: "Streamers",
    path: path.join(SOURCES_DIR, "streamers"),
    status: "ready",
    purpose: "VODs propios, clips con permiso o material de creadores en allowlist.",
  },
  {
    category: "allowlist",
    label: "Allowlist",
    path: path.join(ROOT_DIR, "allowlist"),
    status: "ready",
    purpose: "Evidencia de permiso/licencia por creador, liga, marca o fuente.",
  },
  {
    category: "drafts",
    label: "Drafts",
    path: DRAFTS_DIR,
    status: "ready",
    purpose: "Clips generados antes de aprobacion/publicacion.",
  },
  {
    category: "scheduled",
    label: "Scheduled",
    path: SCHEDULED_DIR,
    status: "ready",
    purpose: "Paquetes listos para publicar cuando haya OAuth y aprobacion.",
  },
];

const CREDENTIAL_ENV_REQUIREMENTS: Array<Pick<ClipperCredentialCheck, "platform" | "label" | "requiredEnvVars" | "nextStep">> = [
  {
    platform: "tiktok",
    label: "TikTok Content Posting API",
    requiredEnvVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    nextStep: "Crear app en TikTok Developers, pedir Content Posting API y guardar client key/secret.",
  },
  {
    platform: "instagram",
    label: "Meta / Instagram Graph API",
    requiredEnvVars: ["META_APP_ID", "META_APP_SECRET"],
    nextStep: "Crear app en Meta Developers, configurar Instagram Graph API y guardar app id/secret.",
  },
  {
    platform: "youtube",
    label: "YouTube Data API",
    requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    nextStep: "Activar YouTube Data API v3 en Google Cloud y reutilizar/guardar OAuth client id/secret.",
  },
];

const PLATFORM_REQUIREMENTS: ClipperPlatformRequirement[] = [
  {
    platform: "tiktok",
    label: "TikTok",
    developerPortalUrl: "https://developers.tiktok.com/",
    accountCreationUrl: "https://www.tiktok.com/signup",
    requiredAccountType: "Cuenta TikTok por marca + app en TikTok for Developers",
    scopes: ["video.publish", "video.upload"],
    appReview: "Content Posting API con Direct Post habilitado; video.publish requiere aprobacion de scope y autorizacion del usuario.",
    postingMode: "Direct Post para autopost; Upload/InBox si quieres que el usuario termine el post en TikTok.",
    humanRequired: [
      "Crear o iniciar sesion en cada cuenta TikTok.",
      "Verificar email/telefono si TikTok lo pide.",
      "Crear app en TikTok for Developers y pedir Content Posting API.",
      "Completar app review para levantar restricciones de visibilidad.",
    ],
    docs: [
      "https://developers.tiktok.com/doc/content-posting-api-get-started/",
      "https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/",
    ],
  },
  {
    platform: "instagram",
    label: "Instagram Reels",
    developerPortalUrl: "https://developers.facebook.com/",
    accountCreationUrl: "https://www.instagram.com/accounts/emailsignup/",
    requiredAccountType: "Cuenta profesional de Instagram conectada a una Facebook Page",
    scopes: ["instagram_content_publish", "instagram_basic", "pages_show_list"],
    appReview: "Meta app review para publicar contenido y leer cuentas conectadas.",
    postingMode: "Instagram Graph API Content Publishing para Reels en cuentas profesionales elegibles.",
    humanRequired: [
      "Crear o iniciar sesion en cada cuenta Instagram.",
      "Cambiar la cuenta a Professional/Creator/Business si no lo esta.",
      "Conectarla a una Facebook Page.",
      "Crear Meta app y completar App Review para permisos de Instagram.",
    ],
    docs: [
      "https://developers.facebook.com/docs/instagram-platform/",
      "https://developers.facebook.com/docs/permissions/reference/instagram_content_publish/",
    ],
  },
  {
    platform: "youtube",
    label: "YouTube Shorts",
    developerPortalUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    accountCreationUrl: "https://www.youtube.com/create_channel",
    requiredAccountType: "Canal de YouTube por marca o cuenta Google autorizada",
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    appReview: "Proyectos no verificados pueden quedar limitados; Google puede requerir OAuth verification/API compliance audit.",
    postingMode: "YouTube Data API videos.insert con metadata de Shorts.",
    humanRequired: [
      "Crear o iniciar sesion en cada canal/cuenta Google.",
      "Activar YouTube Data API v3 en Google Cloud.",
      "Configurar OAuth consent screen.",
      "Autorizar cada canal con youtube.upload.",
    ],
    docs: ["https://developers.google.com/youtube/v3/docs/videos/insert"],
  },
];

const PERMISSION_QUEUE: ClipperPermissionRequest[] = PLATFORM_REQUIREMENTS.flatMap((platform) =>
  platform.scopes.map((scope) => ({
    id: `${platform.platform}-${scope.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    platform: platform.platform,
    scope,
    label: `${platform.label}: ${scope}`,
    status: "missing",
    reason: `Necesario para publicar o preparar clips en ${platform.label}.`,
    evidenceRequired: "Token OAuth valido, app review aprobada cuando aplique, y cuenta destino autorizada.",
    docsUrl: platform.docs[0],
  }))
);

const defaultPlatformAccounts = (slug: string, displayName: string): ClipperPlatformAccount[] => [
  {
    platform: "tiktok",
    handle: `@${slug}`,
    displayName,
    status: "not_created",
    requiredScopes: ["video.publish", "video.upload"],
    missingSteps: ["Crear cuenta", "Conectar OAuth", "Aprobar Content Posting API", "Autorizar video.publish/video.upload"],
    notes: "Preparado en la app; requiere accion humana en TikTok.",
  },
  {
    platform: "instagram",
    handle: `@${slug}`,
    displayName,
    status: "not_created",
    requiredScopes: ["instagram_content_publish", "instagram_basic", "pages_show_list"],
    missingSteps: ["Crear cuenta profesional", "Conectar Facebook Page", "Conectar OAuth Meta", "Aprobar permisos"],
    notes: "Preparado en la app; requiere login y Page conectada.",
  },
  {
    platform: "youtube",
    handle: `@${slug}`,
    displayName,
    status: "not_created",
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    missingSteps: ["Crear canal", "Activar YouTube Data API", "Conectar OAuth", "Autorizar youtube.upload"],
    notes: "Preparado en la app; requiere canal Google/YouTube real.",
  },
];

const DEFAULT_ACCOUNTS: ClipperAccount[] = [
  {
    id: "sports-daily",
    name: "Sports Daily Clips",
    category: "sports",
    platforms: ["TikTok", "Instagram Reels", "YouTube Shorts"],
    platformAccounts: defaultPlatformAccounts("sportsdailyclips", "Sports Daily Clips"),
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
    platformAccounts: defaultPlatformAccounts("memeradarclips", "Meme Radar"),
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
    platformAccounts: defaultPlatformAccounts("streamerpulseclips", "Streamer Pulse"),
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
    ...SOURCE_FOLDERS.map((folder) => mkdir(folder.path, { recursive: true })),
  ]);
}

function buildCredentialChecks(): ClipperCredentialCheck[] {
  return CREDENTIAL_ENV_REQUIREMENTS.map((requirement) => {
    const configuredEnvVars = requirement.requiredEnvVars.filter((name) => Boolean(process.env[name]));
    const missingEnvVars = requirement.requiredEnvVars.filter((name) => !process.env[name]);
    return {
      ...requirement,
      configuredEnvVars,
      missingEnvVars,
      status:
        missingEnvVars.length === 0
          ? "ready"
          : configuredEnvVars.length > 0
            ? "partial"
            : "missing",
    };
  });
}

async function writeWorkspaceReadme() {
  const readmePath = path.join(ROOT_DIR, "README.md");
  try {
    await stat(readmePath);
  } catch {
    await writeFile(
      readmePath,
      [
        "# Clippers Workspace",
        "",
        "Pon aqui solo videos propios, licenciados, de fuentes oficiales o con permiso explicito.",
        "",
        "- sources/sports: deportes",
        "- sources/memes: memes",
        "- sources/streamers: streamers",
        "- allowlist: evidencia de permisos/licencias",
        "- drafts: clips generados para revision",
        "- scheduled: paquetes aprobados para publicar",
        "",
      ].join("\n")
    );
  }
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

function ensureAccountShape(account: ClipperAccount): ClipperAccount {
  if (Array.isArray(account.platformAccounts) && account.platformAccounts.length) return account;
  const slug = account.id.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return {
    ...account,
    platformAccounts: defaultPlatformAccounts(slug, account.name),
  };
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
  await writeWorkspaceReadme();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const sources = Array.isArray(config.sources) && config.sources.length ? config.sources : DEFAULT_SOURCES;
  const dailyClipsTarget = accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);
  const weeklyViewsPerAccount = 1_000_000;

  return {
    rootDir: ROOT_DIR,
    reportsDir: REPORTS_DIR,
    sourceRootDir: SOURCES_DIR,
    accounts,
    sources,
    sourceFolders: SOURCE_FOLDERS,
    credentialChecks: buildCredentialChecks(),
    platformRequirements: PLATFORM_REQUIREMENTS,
    permissionQueue: PERMISSION_QUEUE,
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
      "La app puede preparar cuentas internas y checklists, pero crear cuentas reales requiere login, verificacion y aceptacion de terminos en cada plataforma.",
    ],
  };
}

export async function bootstrapClipperAccounts(): Promise<ClipperStatus> {
  await ensureClipperDirs();
  await writeWorkspaceReadme();
  const config = await readConfig();
  const accounts = (Array.isArray(config.accounts) && config.accounts.length ? config.accounts : DEFAULT_ACCOUNTS).map(ensureAccountShape);
  const sources = Array.isArray(config.sources) && config.sources.length ? config.sources : DEFAULT_SOURCES;
  await writeFile(CONFIG_PATH, JSON.stringify({ ...config, accounts, sources }, null, 2));
  return getClipperStatus();
}

export async function bootstrapClipperWorkspace(): Promise<ClipperStatus> {
  await bootstrapClipperAccounts();
  return getClipperStatus();
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
      "Completar creacion/verificacion humana de las 9 cuentas plataforma preparadas en Setup.",
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
  defaultPlatformAccounts,
};
