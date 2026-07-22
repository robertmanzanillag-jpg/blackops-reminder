import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashLocalNewsQueueReview, hashLocalNewsReviewValue, runLocalNewsReviewCommittee } from "./clippers-local-news-review-committee";
import { buildLocalNewsGrowthPackage, type LocalNewsGrowthPackage, type LocalNewsGrowthVariantId } from "./clippers-local-news-growth";

export type ClipperLocalNewsLane = "miami-news" | "ny-news";
export type ClipperLocalNewsPlatform = "x" | "facebook";
export type ClipperLocalNewsRisk = "low" | "medium" | "high" | "critical";
export type ClipperLocalNewsLifecycle = "active" | "resolved";
export type ClipperLocalNewsQueueStatus = "approval_required" | "auto_eligible" | "quarantined" | "rejected";
export type ClipperLocalNewsSection = "traffic" | "weather" | "breaking" | "public_safety" | "local";
export type ClipperLocalNewsEditorialUrgency = "routine" | "developing" | "breaking";
export type ClipperLocalNewsRevisionKind = "original" | "update" | "resolved" | "correction";
export type ClipperLocalNewsCommitteeRole = "source_verifier" | "safety_editor" | "monetization_editor";
export type ClipperLocalNewsCommitteeVerdict = "approve" | "quarantine" | "reject";
export type ClipperLocalNewsPublishDecision = "auto_publish" | "quarantine" | "reject";

export interface ClipperLocalNewsCommitteeReview {
  role: ClipperLocalNewsCommitteeRole;
  verdict: ClipperLocalNewsCommitteeVerdict;
  reasons: string[];
  evidence: string[];
  checkedAt: string;
}

export interface ClipperLocalNewsRawEvent {
  id?: string;
  sourceEventId?: string;
  source?: string;
  sourceUrl?: string;
  lane?: ClipperLocalNewsLane;
  title?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  location?: string;
  areaDesc?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  eventType?: string;
  effective?: string;
  expires?: string;
  status?: string;
  active?: boolean;
  properties?: Record<string, unknown>;
  provenance?: ClipperLocalNewsProvenance;
  [key: string]: unknown;
}

export interface ClipperLocalNewsProvenance {
  connectorId: string;
  canonicalHost: string;
  fetchedAt: string;
  claimHash: string;
  verified: boolean;
}

export interface ClipperLocalNewsEvent {
  id: string;
  sourceEventId: string;
  source: string;
  sourceUrl: string;
  lane: ClipperLocalNewsLane;
  title: string;
  description: string;
  instruction: string;
  location: string;
  eventType: string;
  severity: string;
  urgency: string;
  certainty: string;
  risk: ClipperLocalNewsRisk;
  lifecycle: ClipperLocalNewsLifecycle;
  effective: string | null;
  expires: string | null;
  firstSeenAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  revision: number;
  fingerprint: string;
  section: ClipperLocalNewsSection;
  editorialUrgency: ClipperLocalNewsEditorialUrgency;
  revisionKind: ClipperLocalNewsRevisionKind;
  provenance: ClipperLocalNewsProvenance | null;
}

export interface ClipperLocalNewsQueueItem {
  id: string;
  eventId: string;
  eventRevision: number;
  lane: ClipperLocalNewsLane;
  platform: ClipperLocalNewsPlatform;
  copy: string;
  source: string;
  sourceUrl: string;
  risk: ClipperLocalNewsRisk;
  lifecycle: ClipperLocalNewsLifecycle;
  status: ClipperLocalNewsQueueStatus;
  approvalRequired: boolean;
  autoEligible: boolean;
  published: false;
  createdAt: string;
  section: ClipperLocalNewsSection;
  editorialUrgency: ClipperLocalNewsEditorialUrgency;
  revisionKind: ClipperLocalNewsRevisionKind;
  textOnly: true;
  mediaRequired: false;
  gateReason: "none" | "risk" | "operator_opt_out" | "cadence" | "committee_quarantine" | "committee_reject";
  notBefore: string | null;
  verdicts: ClipperLocalNewsCommitteeReview[];
  evidence: string[];
  consensus: "unanimous_approve" | "not_unanimous";
  publishDecision: ClipperLocalNewsPublishDecision;
  reasons: string[];
  checkedAt: string;
  reviewHash: string;
  organicGrowth?: LocalNewsGrowthPackage;
}

export interface ClipperLocalNewsMetricInput {
  queueItemId?: string;
  eventId?: string;
  lane: ClipperLocalNewsLane;
  platform: ClipperLocalNewsPlatform;
  impressions?: number;
  engagements?: number;
  clicks?: number;
  shares?: number;
  revenueUsd?: number;
  costUsd?: number;
  observedAt?: string;
  variantId?: LocalNewsGrowthVariantId;
}

export interface ClipperLocalNewsMetric extends Required<Omit<ClipperLocalNewsMetricInput, "queueItemId" | "eventId" | "observedAt" | "variantId">> {
  id: string;
  queueItemId: string | null;
  eventId: string | null;
  observedAt: string;
  recordedAt: string;
  variantId: LocalNewsGrowthVariantId | null;
}

export interface ClipperLocalNewsStatus {
  workspaceDir: string;
  bootstrapped: boolean;
  scheduleMinutes: number;
  lastRunAt: string | null;
  lanes: Record<ClipperLocalNewsLane, { active: number; resolved: number; queued: number }>;
  events: { total: number; active: number; resolved: number };
  queue: { total: number; approvalRequired: number; autoEligible: number; quarantined: number; rejected: number; published: 0 };
  editorial: {
    owner: "Local News CEO";
    operatingMode: "professional_newsroom";
    sections: Record<ClipperLocalNewsSection, { events: number; queued: number }>;
    urgency: Record<ClipperLocalNewsEditorialUrgency, number>;
    autoSafe: number;
    reviewRequired: number;
    cadenceHeld: number;
    textOnlyFacebook: number;
    duplicates: number;
    revisions: number;
    corrections: number;
    resolvedRevisions: number;
    cadence: { windowMinutes: 60; facebookPerLane: 6; facebookRoutinePerLane: 2; xPerLane: 8; xRoutinePerLane: 3; facebookRelevantMax: 10; adaptive: "urgency_and_observed_performance" };
    committee: { reviewed: number; unanimous: number; quarantined: number; rejected: number; roles: ClipperLocalNewsCommitteeRole[] };
    growth: { mode: "zero_cost_organic"; paidAds: false; paidAiPerPost: false; ownedLinks: number; experiments: number; shortFormReady: number };
  };
  metrics: { total: number; impressions: number; engagements: number; clicks: number; shares: number; revenueUsd: number; costUsd: number; profitUsd: number };
  monetization: {
    targetUsd: 10000;
    revenueUsd: number;
    remainingUsd: number;
    progressPct: number;
    externalEligibility: "unverified";
    pagesEligible: null;
    policyViolations: null;
    verifiedAt: null;
    bySection: Partial<Record<ClipperLocalNewsSection, { posts: number; reach: number; engagement: number; revenueUsd: number }>>;
  };
  connectors: Array<{ id: string; lane: ClipperLocalNewsLane; configured: boolean; requiresKey: boolean; public: boolean }>;
  coverage: {
    weather: "nws_public";
    miamiTraffic: "public_incident_feed" | "configured_feed" | "not_configured";
    nyTraffic: "notify_nyc_public" | "ny511_configured" | "not_configured";
    roadCoverageComplete: false;
    note: string;
  };
  artifacts: Record<string, string>;
  guardrails: string[];
}

export interface ClipperLocalNewsOptions {
  workspaceDir?: string;
  now?: string | Date;
  env?: NodeJS.ProcessEnv;
}

export interface ClipperLocalNewsIngestInput extends ClipperLocalNewsOptions {
  events: ClipperLocalNewsRawEvent[];
  resolveMissing?: boolean;
  snapshotLanes?: ClipperLocalNewsLane[];
}

export interface ClipperLocalNewsCycleInput extends ClipperLocalNewsOptions {
  events?: ClipperLocalNewsRawEvent[];
  fetch?: typeof globalThis.fetch;
  resolveMissing?: boolean;
  snapshotLanes?: ClipperLocalNewsLane[];
}

export interface ClipperLocalNewsMetricsInput extends ClipperLocalNewsOptions {
  metrics: ClipperLocalNewsMetricInput[];
}

interface LocalNewsState {
  version: 1;
  bootstrappedAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  scheduleMinutes: number;
  events: ClipperLocalNewsEvent[];
  queue: ClipperLocalNewsQueueItem[];
  metrics: ClipperLocalNewsMetric[];
  editorialCounters?: { duplicates: number; revisions: number; corrections: number; resolvedRevisions: number; cadenceHeld: number };
}

const LANES: ClipperLocalNewsLane[] = ["miami-news", "ny-news"];
const PLATFORMS: ClipperLocalNewsPlatform[] = ["x", "facebook"];
const MAX_BATCH_SIZE = 500;
const SECTIONS: ClipperLocalNewsSection[] = ["traffic", "weather", "breaking", "public_safety", "local"];
const EDITORIAL_URGENCIES: ClipperLocalNewsEditorialUrgency[] = ["routine", "developing", "breaking"];
const CADENCE = { windowMinutes: 60 as const, facebookPerLane: 6 as const, facebookRoutinePerLane: 2 as const, xPerLane: 8 as const, xRoutinePerLane: 3 as const };
const FACEBOOK_MAX_RELEVANT_PER_LANE = 10;
const MONETIZATION_TARGET_USD = 10_000;
const RSS_STALE_MS = 72 * 60 * 60_000;
const RSS_FUTURE_SKEW_MS = 6 * 60 * 60_000;
const ARCGIS_STALE_MS = 48 * 60 * 60_000;
const MIAMI_TRANSIT_LOOKBACK_MS = 120 * 24 * 60 * 60_000;
const MIAMI_TRANSIT_MAX_ACTIVE = 20;
const FACEBOOK_DETAIL_LIMIT = 700;
const verifiedFetchedEvents = new WeakSet<object>();
const DEFAULT_WORKSPACE = path.join(process.cwd(), "clippers_workspace", "local-news");
const FILES = {
  state: "state.json",
  events: "events.json",
  queue: "metricool-queue.json",
  queueCsv: "metricool-queue.csv",
  analytics: "analytics.json",
  analyticsCsv: "analytics.csv",
  growth: "organic-growth.json",
  runbook: "RUNBOOK.md",
  sources: "SOURCE_SETUP.md",
} as const;

function workspace(options?: ClipperLocalNewsOptions): string {
  return path.resolve(options?.workspaceDir || options?.env?.CLIPPERS_LOCAL_NEWS_WORKSPACE || process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE || DEFAULT_WORKSPACE);
}

function isoNow(value?: string | Date): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid now value");
  return date.toISOString();
}

function clean(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function urlHost(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function attachVerifiedProvenance(raw: ClipperLocalNewsRawEvent, source: SourceDefinition, fetchedAt: string): ClipperLocalNewsRawEvent {
  const sourceUrl = clean(raw.sourceUrl, source.url);
  raw.provenance = {
    connectorId: source.id,
    canonicalHost: urlHost(sourceUrl),
    fetchedAt,
    claimHash: digest(JSON.stringify([raw.sourceEventId, raw.title, raw.description, raw.instruction, raw.location, raw.eventType, sourceUrl])),
    verified: true,
  };
  verifiedFetchedEvents.add(raw);
  return raw;
}

function safeUrl(value: unknown, fallback: string): string {
  const candidate = clean(value);
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function riskFor(input: { severity: string; urgency: string; title: string; eventType: string; description?: string; instruction?: string; location?: string }): ClipperLocalNewsRisk {
  const text = `${input.severity} ${input.urgency} ${input.title} ${input.eventType} ${input.description || ""} ${input.instruction || ""} ${input.location || ""}`.toLowerCase();
  if (/extreme|catastrophic|tornado emergency|hurricane warning|flash flood emergency|evacuat|\bdeath\b|\bdead\b|fatalit|fallecid|muerte|tiroteo|shooting|homicid|asesinat/.test(text)) return "critical";
  if (/severe|immediate|warning|tornado|hurricane|flash flood|life[- ]threat|arrest|detenid|acusad|charged|indict|\bcrime\b|crimen|delito|robbery|burglary|assault|rape|sexual|kidnap|secuestr|\bminor child\b|\bmenor(?:es)?\b|victim|víctima|violence|violencia|rumou?r|rumor|unconfirmed|no confirmado|sin confirmar|identified as|identificad[oa] como|named as/.test(text)) return "high";
  if (/moderate|expected|watch|flood|storm|snow|traffic|closure|crash|incident/.test(text)) return "medium";
  return "low";
}

function sectionFor(input: { title: string; eventType: string; description: string; source: string }): ClipperLocalNewsSection {
  const text = `${input.title} ${input.eventType} ${input.description} ${input.source}`.toLowerCase();
  if (/traffic|tr[aá]nsito|road|route|highway|street|bridge|tunnel|closure|closed|reopened|crash|collision|congestion|lane|subway|transit|\btrains?\b|metropolitan transportation authority|mta|fhp|fl511|511ny/.test(text)) return "traffic";
  if (/weather|nws|storm|\brain\b|flood|snow|wind|heat|cold|hurricane|tornado|thunder|coastal/.test(text)) return "weather";
  if (/police|fire|public safety|seguridad p[uú]blica|emergency|rescue|missing person|shelter/.test(text)) return "public_safety";
  if (/breaking|urgent|urgente|ultima hora|última hora/.test(text)) return "breaking";
  return "local";
}

function editorialUrgencyFor(input: { risk: ClipperLocalNewsRisk; section: ClipperLocalNewsSection; title: string; eventType: string; urgency: string; lifecycle: ClipperLocalNewsLifecycle }): ClipperLocalNewsEditorialUrgency {
  const text = `${input.title} ${input.eventType} ${input.urgency}`.toLowerCase();
  if (input.risk === "critical" || /breaking|urgent|urgente|immediate|emergency|última hora|ultima hora/.test(text)) return "breaking";
  if (input.lifecycle === "resolved") return "routine";
  if (input.risk === "high" || input.risk === "medium" || input.section === "traffic" || input.section === "weather") return "developing";
  return "routine";
}

function revisionKindFor(raw: ClipperLocalNewsRawEvent, lifecycle: ClipperLocalNewsLifecycle): ClipperLocalNewsRevisionKind {
  if (lifecycle === "resolved") return "resolved";
  const text = `${clean(raw.status)} ${clean(raw.title || raw.headline)} ${clean(raw.eventType)}`.toLowerCase();
  return /correction|corrected|correcci[oó]n|corregid/.test(text) ? "correction" : "original";
}

function inferLane(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>): ClipperLocalNewsLane {
  if (raw.lane && LANES.includes(raw.lane)) return raw.lane;
  const text = `${clean(raw.location || raw.areaDesc || props.areaDesc)} ${clean(raw.source)} ${clean(raw.title || raw.headline || props.headline)}`.toLowerCase();
  return /miami|dade|broward|florida|\bfl\b/.test(text) ? "miami-news" : "ny-news";
}

function isResolved(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>, now: string): boolean {
  if (raw.active === false) return true;
  if (/\b(resolved|cleared|cancelled|canceled|expired|ended|reopened)\b/.test(clean(raw.status || props.status).toLowerCase())) return true;
  const expires = clean(raw.expires || props.expires || props.ends);
  if (!expires) return false;
  const expiresAt = new Date(expires).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= new Date(now).getTime();
}

export function normalizeClipperLocalNewsEvent(raw: ClipperLocalNewsRawEvent, now = isoNow()): Omit<ClipperLocalNewsEvent, "firstSeenAt" | "updatedAt" | "resolvedAt" | "revision"> {
  const props = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
  const source = clean(raw.source || props.senderName || props.source, "public-feed");
  const sourceUrl = safeUrl(raw.sourceUrl || props.web || props.url || props.uri || raw.id, "https://www.weather.gov/");
  const sourceEventId = clean(raw.sourceEventId || props.id || raw.id) || digest(JSON.stringify([source, raw.title, raw.location, raw.effective]));
  const title = clean(raw.title || raw.headline || props.headline || props.event, "Local public update");
  const description = decodeXml(clean(raw.description || props.description));
  const instruction = decodeXml(clean(raw.instruction || props.instruction));
  const location = clean(raw.location || raw.areaDesc || props.areaDesc, inferLane(raw, props) === "miami-news" ? "Miami area" : "New York area");
  const eventType = clean(raw.eventType || props.event, title);
  const severity = clean(raw.severity || props.severity, "Unknown");
  const urgency = clean(raw.urgency || props.urgency, "Unknown");
  const certainty = clean(raw.certainty || props.certainty, "Unknown");
  const lane = inferLane(raw, props);
  const lifecycle: ClipperLocalNewsLifecycle = isResolved(raw, props, now) ? "resolved" : "active";
  const effective = clean(raw.effective || props.effective || props.sent) || null;
  const expires = clean(raw.expires || props.expires || props.ends) || null;
  const risk = riskFor({ severity, urgency, title, eventType, description, instruction, location });
  const section = sectionFor({ title, eventType, description, source });
  const editorialUrgency = editorialUrgencyFor({ risk, section, title, eventType, urgency, lifecycle });
  const revisionKind = revisionKindFor(raw, lifecycle);
  const provenance = verifiedFetchedEvents.has(raw) && raw.provenance?.verified ? raw.provenance : null;
  const fingerprint = digest(JSON.stringify({ title, description, instruction, location, eventType, severity, urgency, certainty, lifecycle, effective, expires, sourceUrl, section, editorialUrgency, revisionKind, claimHash: provenance?.claimHash }));
  return { id: digest(`${source.toLowerCase()}|${sourceEventId.toLowerCase()}`), sourceEventId, source, sourceUrl, lane, title, description, instruction, location, eventType, severity, urgency, certainty, risk, lifecycle, effective, expires, fingerprint, section, editorialUrgency, revisionKind, provenance };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 1) return text.slice(0, limit);
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function buildClipperLocalNewsCopy(event: ClipperLocalNewsEvent, platform: ClipperLocalNewsPlatform, growth?: LocalNewsGrowthPackage): string {
  const prefix = event.revisionKind === "correction" ? "CORRECCIÓN" : event.lifecycle === "resolved" ? "RESUELTO" : event.editorialUrgency === "breaking" ? "ÚLTIMA HORA" : event.revision > 1 ? "ACTUALIZACIÓN" : event.section === "traffic" ? "TRÁFICO" : event.section === "weather" ? "TIEMPO" : "NOTICIA LOCAL";
  const observedAt = event.effective || event.updatedAt;
  const time = new Intl.DateTimeFormat("es-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(observedAt));
  const attribution = `Según ${event.source}`;
  const impact = truncate(event.description || "La fuente oficial no publicó detalles adicionales.", FACEBOOK_DETAIL_LIMIT);
  const action = truncate(event.instruction || "Consulta el enlace oficial antes de tomar una decisión.", FACEBOOK_DETAIL_LIMIT);
  const headline = growth?.headline.es || event.title;
  const ownedLink = growth?.ownedArticleUrl ? `\nLee la actualización completa: ${growth.ownedArticleUrl}` : "";
  const tags = growth?.hashtags.length ? `\n${growth.hashtags.join(" ")}` : "";
  if (platform === "x") {
    // X has a hard length limit: preserve the primary official source instead of risking
    // truncation by adding a second, tracked URL. Facebook carries the owned-site link.
    const ending = `\n${attribution} (${time}): ${event.sourceUrl}${tags}`;
    const body = `${prefix}: ${headline}. ${event.instruction || event.description || "Consulta la fuente oficial."}`.trim();
    return `${truncate(body, Math.max(1, 280 - ending.length))}${ending}`.slice(0, 280);
  }
  return `${prefix}: ${headline}\n\nLugar: ${event.location}\nHora: ${time}\nImpacto: ${impact}\nQué hacer: ${action}${ownedLink}\n\n${attribution}. Esta página no es la agencia emisora; verifica la actualización oficial:\n${event.sourceUrl}${tags}`;
}

const rawEventSchema = z.object({
  id: z.string().max(2_000).optional(),
  sourceEventId: z.string().min(1).max(500).optional(),
  source: z.string().min(1).max(300).optional(),
  sourceUrl: z.string().url().max(2_000).optional(),
  lane: z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]]).optional(),
  title: z.string().max(1_000).optional(),
  headline: z.string().max(1_000).optional(),
  description: z.string().max(20_000).optional(),
  instruction: z.string().max(10_000).optional(),
  location: z.string().max(1_000).optional(),
  areaDesc: z.string().max(1_000).optional(),
  severity: z.string().max(100).optional(),
  urgency: z.string().max(100).optional(),
  certainty: z.string().max(100).optional(),
  eventType: z.string().max(500).optional(),
  effective: z.string().datetime({ offset: true }).optional(),
  expires: z.string().datetime({ offset: true }).optional(),
  status: z.string().max(100).optional(),
  active: z.boolean().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const snapshotFieldsSchema = z.object({
  events: z.array(rawEventSchema).max(MAX_BATCH_SIZE),
  resolveMissing: z.boolean().optional(),
  snapshotLanes: z.array(z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]])).min(1).max(LANES.length).optional(),
}).superRefine((value, context) => {
  if (value.resolveMissing && !value.snapshotLanes?.length) context.addIssue({ code: "custom", path: ["snapshotLanes"], message: "snapshotLanes is required when resolveMissing is true" });
});
const ingestPayloadSchema = snapshotFieldsSchema;
const cyclePayloadSchema = z.object({
  events: z.array(rawEventSchema).max(MAX_BATCH_SIZE).optional(), resolveMissing: z.boolean().optional(),
  snapshotLanes: z.array(z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]])).min(1).max(LANES.length).optional(),
}).superRefine((value, context) => {
  if (value.resolveMissing && (value.events === undefined || !value.snapshotLanes?.length)) context.addIssue({ code: "custom", path: ["snapshotLanes"], message: "events and snapshotLanes are required when resolveMissing is true" });
});
const metricPayloadSchema = z.object({
  metrics: z.array(z.object({
    queueItemId: z.string().min(1).max(500).optional(), eventId: z.string().min(1).max(500).optional(),
    lane: z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]]), platform: z.enum(PLATFORMS as [ClipperLocalNewsPlatform, ...ClipperLocalNewsPlatform[]]),
    impressions: z.number().finite().nonnegative().optional(), engagements: z.number().finite().nonnegative().optional(), clicks: z.number().finite().nonnegative().optional(), shares: z.number().finite().nonnegative().optional(),
    revenueUsd: z.number().finite().nonnegative().optional(), costUsd: z.number().finite().nonnegative().optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
    variantId: z.enum(["utility", "impact"]).optional(),
  }).strict()).max(MAX_BATCH_SIZE),
});

function scheduleMinutes(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES || "3", 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(2, parsed)) : 3;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

async function readState(dir: string): Promise<LocalNewsState | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, FILES.state), "utf8")) as LocalNewsState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv<T extends object>(rows: T[], columns: string[]): string {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell((row as Record<string, unknown>)[column])).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

async function persist(dir: string, state: LocalNewsState): Promise<void> {
  const analytics = summarizeMetrics(state.metrics);
  const queueColumns = ["id", "eventId", "eventRevision", "lane", "platform", "section", "editorialUrgency", "revisionKind", "risk", "lifecycle", "status", "gateReason", "notBefore", "publishDecision", "consensus", "checkedAt", "reviewHash", "textOnly", "mediaRequired", "approvalRequired", "autoEligible", "published", "copy", "source", "sourceUrl", "createdAt"];
  const metricColumns = ["id", "queueItemId", "eventId", "lane", "platform", "variantId", "impressions", "engagements", "clicks", "shares", "revenueUsd", "costUsd", "observedAt", "recordedAt"];
  await Promise.all([
    atomicWrite(path.join(dir, FILES.state), `${JSON.stringify(state, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.events), `${JSON.stringify({ generatedAt: state.updatedAt, events: state.events }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.queue), `${JSON.stringify({ generatedAt: state.updatedAt, disclaimer: "Queue only; no real publication is claimed.", items: state.queue }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.queueCsv), csv(state.queue, queueColumns)),
    atomicWrite(path.join(dir, FILES.analytics), `${JSON.stringify({ generatedAt: state.updatedAt, summary: analytics, metrics: state.metrics }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.analyticsCsv), csv(state.metrics, metricColumns)),
    atomicWrite(path.join(dir, FILES.growth), `${JSON.stringify({
      generatedAt: state.updatedAt,
      costPolicy: { paidAds: false, paidAiPerPost: false, generation: "deterministic_local_templates" },
      items: state.queue.filter((item) => item.organicGrowth).map((item) => ({ queueItemId: item.id, lane: item.lane, platform: item.platform, ...item.organicGrowth })),
    }, null, 2)}\n`),
  ]);
}

function summarizeMetrics(metrics: ClipperLocalNewsMetric[]) {
  const totals = metrics.reduce((summary, metric) => ({ total: summary.total + 1, impressions: summary.impressions + metric.impressions, engagements: summary.engagements + metric.engagements, clicks: summary.clicks + metric.clicks, shares: summary.shares + metric.shares, revenueUsd: summary.revenueUsd + (metric.revenueUsd || 0), costUsd: summary.costUsd + (metric.costUsd || 0) }), { total: 0, impressions: 0, engagements: 0, clicks: 0, shares: 0, revenueUsd: 0, costUsd: 0 });
  const revenueUsd = Math.round(totals.revenueUsd * 100) / 100;
  const costUsd = Math.round(totals.costUsd * 100) / 100;
  return { ...totals, revenueUsd, costUsd, profitUsd: Math.round((revenueUsd - costUsd) * 100) / 100 };
}

function summarizeMetricsBySection(state: LocalNewsState | null): ClipperLocalNewsStatus["monetization"]["bySection"] {
  if (!state?.metrics.length) return {};
  const queueById = new Map(state.queue.map((item) => [item.id, item]));
  const eventByAnyId = new Map(state.events.flatMap((event) => [[event.id, event] as const, [event.sourceEventId, event] as const]));
  const summaries = new Map<ClipperLocalNewsSection, { postIds: Set<string>; reach: number; engagement: number; revenueUsd: number }>();
  for (const metric of state.metrics) {
    const queueItem = metric.queueItemId ? queueById.get(metric.queueItemId) : undefined;
    const event = metric.eventId ? eventByAnyId.get(metric.eventId) : queueItem ? eventByAnyId.get(queueItem.eventId) : undefined;
    const section = queueItem?.section || event?.section;
    if (!section) continue;
    const current = summaries.get(section) || { postIds: new Set<string>(), reach: 0, engagement: 0, revenueUsd: 0 };
    current.postIds.add(metric.queueItemId || metric.eventId || metric.id);
    current.reach += metric.impressions;
    current.engagement += metric.engagements;
    current.revenueUsd += metric.revenueUsd;
    summaries.set(section, current);
  }
  return Object.fromEntries([...summaries].map(([section, summary]) => [section, { posts: summary.postIds.size, reach: summary.reach, engagement: summary.engagement, revenueUsd: Math.round(summary.revenueUsd * 100) / 100 }]));
}

function sourceSetup(): string {
  return `# Local News Source Setup\n\n- NWS: public, no API key. The agent reads point alerts for Miami and New York City.\n- Notify NYC: official public RSS, no API key. Attribution must make clear that this newsroom is not the issuing agency.\n- MTA: official public real-time subway alerts in JSON. Only live unscheduled alerts are ingested; planned-work floods are excluded.\n- Miami-Dade County: official public news RSS, no API key.\n- Miami-Dade Transit: official service updates. The public webpage supplies its short-lived browser key at request time; it is never stored.\n- Miami International Airport: official Latest News RSS; third-party “In the News” aggregation is intentionally excluded.\n- Florida road incidents: public ArcGIS layers for closures, crashes, brush fires and other incidents, restricted to Miami-Dade. This is useful incident coverage, not a claim of every road condition.\n- NY511: optional and subject to its access agreement. Set both \`NY511_API_KEY\` and \`NY511_FEED_URL\`; the key is sent only at request time and is never written here.\n- Optional authorized feeds: \`FL511_FEED_URL\`, \`MIAMI_NEWS_FEED_URL\`, and \`NY_NEWS_FEED_URL\`.\n- Webhook/manual ingestion: call the ingest function with attributed official/public events.\n\nOnly use official public or authorized feeds. Never copy commercial news articles. Keep secrets in environment variables. Public incident sources do not guarantee complete road coverage.\n`;
}

function runbook(minutes: number): string {
  return `# Local News Agent Runbook\n\n1. The Local News CEO runs the desk every ${minutes} minutes (supported range: 2–5) using deterministic templates; no story is invented.\n2. Organic growth uses deterministic headline experiments, owned-site links, brand media and local short-form manifests. Paid ads and paid AI per post remain off.\n3. Every item passes a deterministic three-role committee: source verifier, safety editor, and monetization editor. No paid LLM API is called. Only unanimous approval from an official/authorized source can become \`auto_eligible\`.\n4. Unresolved accusations, identifiable minors, victim private addresses, graphic violence, contradictory information, unconfirmed claims, and unverifiable critical evacuations receive an automatic final \`quarantined\` or \`rejected\` state; they do not wait in a human-review queue. Sensitive manual events without verified connector provenance are quarantined.\n5. Facebook cadence is adaptive but conservative: 6 base posts per city/hour, up to 8 for developing stories and 10 for breaking stories or strong observed performance. Routine posts remain capped at 2; relevance, never filler, unlocks volume.\n6. Overflow stays auto-eligible with \`gateReason=cadence\` and a future \`notBefore\`; the Metricool executor waits until that timestamp.\n7. Corrections, updates and resolved/reopened notices create attributed revisions. Absence-based resolution is allowed only for an explicit controlled snapshot.\n8. Revenue progress toward $10,000 uses observed imported revenue only. Reach, engagement, revenue, cost, and profit are never inferred from queue state.\n9. Public incident sources do not guarantee complete road coverage; NY511 still needs its key and agreement.\n`;
}

function migrateLegacyCommitteeState(state: LocalNewsState, now: string): void {
  const events = new Map(state.events.map((event) => [event.id, event]));
  for (const item of state.queue) {
    if (Array.isArray(item.verdicts) && item.publishDecision && item.reviewHash) continue;
    const event = events.get(item.eventId);
    const committee = runLocalNewsReviewCommittee({
      source: item.source, sourceUrl: item.sourceUrl, title: event?.title || item.copy, description: event?.description || "",
      instruction: event?.instruction || "", location: event?.location || "", eventType: event?.eventType || item.section,
      risk: item.risk, section: item.section, editorialUrgency: item.editorialUrgency,
      connectorId: event?.provenance?.connectorId, canonicalHost: event?.provenance?.canonicalHost, fetchedAt: event?.provenance?.fetchedAt,
      claimHash: event?.provenance?.claimHash, provenanceVerified: event?.provenance?.verified, effective: event?.effective, expires: event?.expires,
    }, item.createdAt || now);
    const copyHash = hashLocalNewsReviewValue(item.copy);
    item.verdicts = committee.verdicts;
    item.evidence = [...committee.evidence, `copyHash=${copyHash}`, "migrated_from_legacy_queue=true"];
    item.consensus = committee.consensus;
    item.publishDecision = committee.publishDecision;
    item.reasons = [...committee.reasons, "legacy_queue_review_backfilled"];
    item.checkedAt = committee.checkedAt;
    item.reviewHash = hashLocalNewsQueueReview({ copy: item.copy, platform: item.platform, verdicts: item.verdicts, evidence: item.evidence, consensus: item.consensus, publishDecision: item.publishDecision, checkedAt: item.checkedAt });
    if (committee.publishDecision !== "auto_publish") {
      item.status = committee.publishDecision === "reject" ? "rejected" : "quarantined";
      item.approvalRequired = false;
      item.autoEligible = false;
      item.gateReason = committee.publishDecision === "reject" ? "committee_reject" : "committee_quarantine";
    }
  }
}

export async function bootstrapClipperLocalNews(options: ClipperLocalNewsOptions = {}): Promise<ClipperLocalNewsStatus> {
  const dir = workspace(options);
  const now = isoNow(options.now);
  const env = options.env || process.env;
  await mkdir(dir, { recursive: true });
  let state = await readState(dir);
  if (!state) state = { version: 1, bootstrappedAt: now, updatedAt: now, lastRunAt: null, scheduleMinutes: scheduleMinutes(env), events: [], queue: [], metrics: [], editorialCounters: { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 } };
  state.editorialCounters ||= { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 };
  state.metrics ||= [];
  migrateLegacyCommitteeState(state, now);
  state.scheduleMinutes = scheduleMinutes(env);
  state.updatedAt = now;
  await Promise.all([
    atomicWrite(path.join(dir, FILES.runbook), runbook(state.scheduleMinutes)),
    atomicWrite(path.join(dir, FILES.sources), sourceSetup()),
  ]);
  await persist(dir, state);
  return getClipperLocalNewsStatus({ ...options, workspaceDir: dir });
}

function facebookCadenceLimit(event: ClipperLocalNewsEvent, existingQueue: ClipperLocalNewsQueueItem[], metrics: ClipperLocalNewsMetric[]): number {
  const relevanceLimit = event.editorialUrgency === "breaking" ? FACEBOOK_MAX_RELEVANT_PER_LANE : event.editorialUrgency === "developing" ? 8 : CADENCE.facebookPerLane;
  const relevantQueueIds = new Set(existingQueue.filter((item) => item.lane === event.lane && item.platform === "facebook" && item.section === event.section).map((item) => item.id));
  const observed = metrics.filter((metric) => metric.lane === event.lane && metric.platform === "facebook" && Boolean(metric.queueItemId && relevantQueueIds.has(metric.queueItemId)));
  const impressions = observed.reduce((total, metric) => total + metric.impressions, 0);
  const engagements = observed.reduce((total, metric) => total + metric.engagements, 0);
  const observedBoost = impressions >= 500 && engagements / impressions >= 0.03 ? 2 : 0;
  return Math.min(FACEBOOK_MAX_RELEVANT_PER_LANE, relevanceLimit + observedBoost);
}

function queueFor(event: ClipperLocalNewsEvent, now: string, env: NodeJS.ProcessEnv, existingQueue: ClipperLocalNewsQueueItem[], metrics: ClipperLocalNewsMetric[]): ClipperLocalNewsQueueItem[] {
  const autoEnabled = !/^(0|false|no)$/i.test(env.CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE || "true");
  const nowMs = new Date(now).getTime();
  const windowStart = nowMs - CADENCE.windowMinutes * 60_000;
  return PLATFORMS.map((platform) => {
    const recent = existingQueue.filter((item) => item.lane === event.lane && item.platform === platform && item.autoEligible && new Date(item.createdAt).getTime() >= windowStart);
    const totalLimit = platform === "facebook" ? facebookCadenceLimit(event, existingQueue, metrics) : CADENCE.xPerLane;
    const routineLimit = platform === "facebook" ? CADENCE.facebookRoutinePerLane : CADENCE.xRoutinePerLane;
    const cadenceHeld = recent.length >= totalLimit || (event.editorialUrgency === "routine" && recent.filter((item) => item.editorialUrgency === "routine").length >= routineLimit);
    const committee = runLocalNewsReviewCommittee({
      source: event.source, sourceUrl: event.sourceUrl, title: event.title, description: event.description, instruction: event.instruction,
      location: event.location, eventType: event.eventType, risk: event.risk, section: event.section, editorialUrgency: event.editorialUrgency,
      connectorId: event.provenance?.connectorId, canonicalHost: event.provenance?.canonicalHost, fetchedAt: event.provenance?.fetchedAt,
      claimHash: event.provenance?.claimHash, provenanceVerified: event.provenance?.verified,
      effective: event.effective, expires: event.expires,
    }, now);
    const committeeGated = committee.publishDecision !== "auto_publish";
    const gateReason = committee.publishDecision === "reject" ? "committee_reject" as const : committeeGated ? "committee_quarantine" as const : !autoEnabled ? "operator_opt_out" as const : cadenceHeld ? "cadence" as const : "none" as const;
    const gated = committeeGated || !autoEnabled;
    const latestRecent = recent.reduce((latest, item) => Math.max(latest, new Date(item.notBefore || item.createdAt).getTime()), nowMs);
    const notBefore = cadenceHeld ? new Date(latestRecent + CADENCE.windowMinutes * 60_000).toISOString() : null;
    const relevantMetrics = metrics.filter((metric) => metric.lane === event.lane && metric.platform === platform);
    const organicGrowth = buildLocalNewsGrowthPackage(event, relevantMetrics, env.PUBLIC_BASE_URL);
    const copy = buildClipperLocalNewsCopy(event, platform, organicGrowth);
    const copyHash = hashLocalNewsReviewValue(copy);
    const publishDecision = !autoEnabled && committee.publishDecision === "auto_publish" ? "quarantine" as const : committee.publishDecision;
    const status: ClipperLocalNewsQueueStatus = committee.publishDecision === "reject" ? "rejected" : committee.publishDecision === "quarantine" ? "quarantined" : !autoEnabled ? "approval_required" : "auto_eligible";
    const evidence = [...committee.evidence, `copyHash=${copyHash}`];
    const reviewHash = hashLocalNewsQueueReview({ copy, platform, verdicts: committee.verdicts, evidence, consensus: committee.consensus, publishDecision, checkedAt: committee.checkedAt });
    return { id: digest(`${event.id}|${event.revision}|${platform}`), eventId: event.id, eventRevision: event.revision, lane: event.lane, platform, copy, source: event.source, sourceUrl: event.sourceUrl, risk: event.risk, lifecycle: event.lifecycle, section: event.section, editorialUrgency: event.editorialUrgency, revisionKind: event.revisionKind, textOnly: true, mediaRequired: false, gateReason, notBefore, status, approvalRequired: status === "approval_required", autoEligible: !gated, published: false, createdAt: now, verdicts: committee.verdicts, evidence, consensus: committee.consensus, publishDecision, reasons: !autoEnabled && committee.publishDecision === "auto_publish" ? [...committee.reasons, "operator_disabled_automatic_publication"] : committee.reasons, checkedAt: committee.checkedAt, reviewHash, organicGrowth };
  });
}

export async function ingestClipperLocalNewsEvents(input: ClipperLocalNewsIngestInput): Promise<{ created: number; updated: number; duplicates: number; resolved: number; queued: number; status: ClipperLocalNewsStatus }> {
  ingestPayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const state = (await readState(dir))!;
  const now = isoNow(input.now);
  const env = input.env || process.env;
  state.editorialCounters ||= { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 };
  const byId = new Map(state.events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  let created = 0, updated = 0, duplicates = 0, resolved = 0, queued = 0;
  for (const raw of input.events) {
    const normalized = normalizeClipperLocalNewsEvent(raw, now);
    seen.add(normalized.id);
    const previous = byId.get(normalized.id);
    if (previous?.fingerprint === normalized.fingerprint) { duplicates += 1; state.editorialCounters.duplicates += 1; continue; }
    const revisionKind: ClipperLocalNewsRevisionKind = normalized.revisionKind === "correction" ? "correction" : normalized.lifecycle === "resolved" ? "resolved" : previous ? "update" : "original";
    const event: ClipperLocalNewsEvent = { ...normalized, revisionKind, firstSeenAt: previous?.firstSeenAt || now, updatedAt: now, resolvedAt: normalized.lifecycle === "resolved" ? now : null, revision: (previous?.revision || 0) + 1 };
    byId.set(event.id, event);
    previous ? updated += 1 : created += 1;
    if (previous) state.editorialCounters.revisions += 1;
    if (event.revisionKind === "correction") state.editorialCounters.corrections += 1;
    if (event.revisionKind === "resolved") state.editorialCounters.resolvedRevisions += 1;
    if (event.lifecycle === "resolved") resolved += 1;
    const newItems = queueFor(event, now, env, state.queue, state.metrics);
    for (const item of newItems) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; if (item.gateReason === "cadence") state.editorialCounters.cadenceHeld += 1; }
  }
  if (input.resolveMissing) {
    const lanes = new Set(input.snapshotLanes?.length ? input.snapshotLanes : LANES);
    for (const [id, previous] of byId) {
      if (previous.lifecycle !== "active" || !lanes.has(previous.lane) || seen.has(id)) continue;
      const event = { ...previous, lifecycle: "resolved" as const, revisionKind: "resolved" as const, editorialUrgency: "routine" as const, resolvedAt: now, updatedAt: now, revision: previous.revision + 1 };
      event.fingerprint = digest(`${previous.fingerprint}|resolved`);
      byId.set(id, event);
      updated += 1; resolved += 1; state.editorialCounters.revisions += 1; state.editorialCounters.resolvedRevisions += 1;
      for (const item of queueFor(event, now, env, state.queue, state.metrics)) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; if (item.gateReason === "cadence") state.editorialCounters.cadenceHeld += 1; }
    }
  }
  const nowMs = new Date(now).getTime();
  for (const [id, previous] of byId) {
    if (previous.lifecycle !== "active" || !previous.expires) continue;
    const expiresAt = new Date(previous.expires).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs) continue;
    const event = { ...previous, lifecycle: "resolved" as const, revisionKind: "resolved" as const, editorialUrgency: "routine" as const, resolvedAt: now, updatedAt: now, revision: previous.revision + 1 };
    event.fingerprint = digest(`${previous.fingerprint}|expired`);
    byId.set(id, event);
    updated += 1; resolved += 1; state.editorialCounters.revisions += 1; state.editorialCounters.resolvedRevisions += 1;
    for (const item of queueFor(event, now, env, state.queue, state.metrics)) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; if (item.gateReason === "cadence") state.editorialCounters.cadenceHeld += 1; }
  }
  state.events = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  state.updatedAt = now;
  await persist(dir, state);
  return { created, updated, duplicates, resolved, queued, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

interface SourceDefinition { id: string; lane: ClipperLocalNewsLane; url: string; requiresKey: boolean; key?: string; format?: "json" | "rss" | "mta-json" | "miami-transit-bootstrap"; sourceName?: string }
interface ConnectorDefinition { id: string; lane: ClipperLocalNewsLane; configured: boolean; requiresKey: boolean; public: boolean }

function connectorCatalog(env: NodeJS.ProcessEnv): ConnectorDefinition[] {
  return [
    { id: "nws-miami", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "nws-nyc", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "notify-nyc", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "mta-subway-alerts", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "miami-dade-news", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "miami-dade-transit", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "mia-airport-news", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "fhp-miami-dade", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "ny511", lane: "ny-news", configured: Boolean(env.NY511_FEED_URL && env.NY511_API_KEY), requiresKey: true, public: false },
    { id: "fl511", lane: "miami-news", configured: Boolean(env.FL511_FEED_URL), requiresKey: false, public: false },
    { id: "miami-generic", lane: "miami-news", configured: Boolean(env.MIAMI_NEWS_FEED_URL), requiresKey: false, public: false },
    { id: "ny-generic", lane: "ny-news", configured: Boolean(env.NY_NEWS_FEED_URL), requiresKey: false, public: false },
  ];
}

function sources(env: NodeJS.ProcessEnv): SourceDefinition[] {
  const result: SourceDefinition[] = [
    { id: "nws-miami", lane: "miami-news", url: "https://api.weather.gov/alerts/active?point=25.7617,-80.1918", requiresKey: false, sourceName: "National Weather Service" },
    { id: "nws-nyc", lane: "ny-news", url: "https://api.weather.gov/alerts/active?point=40.7128,-74.0060", requiresKey: false, sourceName: "National Weather Service" },
    { id: "notify-nyc", lane: "ny-news", url: "https://feeds.everbridge.net/feeds/453003085617722/rss/rss.xml", requiresKey: false, format: "rss", sourceName: "Notify NYC" },
    { id: "mta-subway-alerts", lane: "ny-news", url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json", requiresKey: false, format: "mta-json", sourceName: "Metropolitan Transportation Authority" },
    { id: "miami-dade-news", lane: "miami-news", url: "https://www.miamidade.gov/global/rss-news.page", requiresKey: false, format: "rss", sourceName: "Miami-Dade County" },
    { id: "miami-dade-transit", lane: "miami-news", url: "https://www.miamidade.gov/global/transportation/tracker/service-updates.page", requiresKey: false, format: "miami-transit-bootstrap", sourceName: "Miami-Dade Transit" },
    { id: "mia-airport-news", lane: "miami-news", url: "https://news.miami-airport.com/tagfeed/en-us/tags/airport%2Clatest__news", requiresKey: false, format: "rss", sourceName: "Miami International Airport" },
  ];
  const arcGisBase = "https://services.arcgis.com/3wFbqsFPLeKqOlIK/ArcGIS/rest/services/Road_Closures/FeatureServer";
  ["closures", "crashes", "brush-fires", "other-incidents"].forEach((label, layer) => result.push({ id: `fhp-miami-${label}`, lane: "miami-news", url: `${arcGisBase}/${layer}/query?where=COUNTY%3D%27MIAMI-DADE%27&outFields=*&returnGeometry=false&f=json`, requiresKey: false, sourceName: "Florida Highway Patrol / FL511" }));
  if (env.NY511_FEED_URL && env.NY511_API_KEY) result.push({ id: "ny511", lane: "ny-news", url: env.NY511_FEED_URL, requiresKey: true, key: env.NY511_API_KEY });
  if (env.FL511_FEED_URL) result.push({ id: "fl511", lane: "miami-news", url: env.FL511_FEED_URL, requiresKey: false });
  if (env.MIAMI_NEWS_FEED_URL) result.push({ id: "miami-generic", lane: "miami-news", url: env.MIAMI_NEWS_FEED_URL, requiresKey: false });
  if (env.NY_NEWS_FEED_URL) result.push({ id: "ny-generic", lane: "ny-news", url: env.NY_NEWS_FEED_URL, requiresKey: false });
  return result;
}

function extractEvents(payload: unknown): ClipperLocalNewsRawEvent[] {
  if (Array.isArray(payload)) return payload as ClipperLocalNewsRawEvent[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["features", "events", "incidents", "items", "results"]) if (Array.isArray(record[key])) return record[key] as ClipperLocalNewsRawEvent[];
  return [];
}

function rssTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function rssEvents(xml: string, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  const nowMs = new Date(now).getTime();
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, MAX_BATCH_SIZE).flatMap((match) => {
    const item = match[1];
    const title = rssTag(item, "title") || "Official local update";
    const description = rssTag(item, "description");
    const link = rssTag(item, "link") || source.url;
    const guid = rssTag(item, "guid") || link || digest(`${title}|${description}`);
    const published = rssTag(item, "pubDate") || rssTag(item, "dc:date");
    const publishedDate = published ? new Date(published) : null;
    const publishedMs = publishedDate?.getTime();
    if (publishedMs && Number.isFinite(publishedMs) && (nowMs - publishedMs > RSS_STALE_MS || publishedMs - nowMs > RSS_FUTURE_SKEW_MS)) return [];
    return [attachVerifiedProvenance({ sourceEventId: guid, source: source.sourceName || source.id, sourceUrl: safeUrl(link, source.url), lane: source.lane, title, description, eventType: rssTag(item, "category") || title, effective: publishedDate && Number.isFinite(publishedDate.getTime()) ? publishedDate.toISOString() : undefined }, source, now)];
  });
}

function englishTranslation(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const translations = (value as { translation?: unknown }).translation;
  if (!Array.isArray(translations)) return "";
  const preferred = translations.find((item) => item && typeof item === "object" && (item as { language?: unknown }).language === "en")
    || translations.find((item) => item && typeof item === "object" && !String((item as { language?: unknown }).language || "").includes("html"));
  return preferred && typeof preferred === "object" ? clean((preferred as { text?: unknown }).text) : "";
}

function unixIso(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1_000).toISOString();
}

function mtaAlertEvents(payload: unknown, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { entity?: unknown }).entity)) return [];
  const nowMs = new Date(now).getTime();
  return ((payload as { entity: unknown[] }).entity).slice(0, MAX_BATCH_SIZE).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entity = value as Record<string, unknown>;
    const id = clean(entity.id);
    if (!id.startsWith("lmm:alert:")) return [];
    const alert = entity.alert && typeof entity.alert === "object" ? entity.alert as Record<string, unknown> : null;
    if (!alert) return [];
    const periods = Array.isArray(alert.active_period) ? alert.active_period.filter((period): period is Record<string, unknown> => Boolean(period && typeof period === "object")) : [];
    const isActivePeriod = (period: Record<string, unknown>) => {
      const start = Number(period.start || 0) * 1_000;
      const end = Number(period.end || 0) * 1_000;
      return (!start || start <= nowMs + RSS_FUTURE_SKEW_MS) && (!end || end >= nowMs);
    };
    if (periods.length > 0 && !periods.some(isActivePeriod)) return [];
    const mercury = alert["transit_realtime.mercury_alert"] && typeof alert["transit_realtime.mercury_alert"] === "object"
      ? alert["transit_realtime.mercury_alert"] as Record<string, unknown>
      : {};
    const informed = Array.isArray(alert.informed_entity) ? alert.informed_entity.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
    const routes = [...new Set(informed.map((item) => clean(item.route_id)).filter(Boolean))];
    const title = englishTranslation(alert.header_text);
    if (!title) return [];
    const description = englishTranslation(alert.description_text);
    const primaryPeriod = periods.find(isActivePeriod) || periods[0];
    return [attachVerifiedProvenance({
      sourceEventId: id,
      source: source.sourceName || source.id,
      sourceUrl: "https://www.mta.info/alerts",
      lane: source.lane,
      title,
      description,
      instruction: description,
      location: routes.length ? `NYC Subway · Lines ${routes.join(", ")}` : "New York City Subway",
      eventType: clean(mercury.alert_type, "Subway service alert"),
      effective: unixIso(primaryPeriod?.start || mercury.created_at),
      expires: unixIso(primaryPeriod?.end),
      status: "active",
    }, source, now)];
  });
}

function miamiTransitEvents(payload: unknown, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const nowMs = new Date(now).getTime();
  const items = ["universal", "metrorail", "metrobus", "metromover"]
    .flatMap((key) => Array.isArray(record[key]) ? record[key] as unknown[] : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => {
      const expires = item.expireDate ? new Date(String(item.expireDate)).getTime() : 0;
      if (expires && Number.isFinite(expires) && expires < nowMs) return false;
      const effective = item.inEffect ? new Date(String(item.inEffect)).getTime() : 0;
      return Boolean(expires && expires >= nowMs) || !effective || !Number.isFinite(effective) || nowMs - effective <= MIAMI_TRANSIT_LOOKBACK_MS;
    })
    .slice(0, MIAMI_TRANSIT_MAX_ACTIVE);
  return items.flatMap((item) => {
    const id = clean(String(item.id ?? ""));
    const title = clean(item.title);
    if (!id || !title) return [];
    const html = typeof item.serviceUpdate === "string" ? item.serviceUpdate : "";
    const link = html.match(/href=["']([^"']+)["']/i)?.[1];
    const effective = item.inEffect ? new Date(String(item.inEffect)) : null;
    const expires = item.expireDate ? new Date(String(item.expireDate)) : null;
    const mode = clean(item.serviceUpdateType, "Transit");
    const route = clean(item.serviceUpdateTypeID);
    return [attachVerifiedProvenance({
      sourceEventId: `service-update-${id}`,
      source: source.sourceName || source.id,
      sourceUrl: safeUrl(link, source.url),
      lane: source.lane,
      title,
      description: decodeXml(html),
      instruction: "Check the official service update before traveling.",
      location: `Miami-Dade ${mode}${route ? ` · Route ${route}` : ""}`,
      eventType: `${mode} service update`,
      effective: effective && Number.isFinite(effective.getTime()) ? effective.toISOString() : undefined,
      expires: expires && Number.isFinite(expires.getTime()) ? expires.toISOString() : undefined,
      status: "active",
    }, source, now)];
  });
}

function arcGisEffective(attributes: Record<string, unknown>): string | undefined {
  const rawDate = clean(attributes.DATESTR);
  if (!rawDate) return undefined;
  const rawTime = clean(attributes.TIMESTR, "00:00");
  const parts = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const time = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!parts || !time) return undefined;
  const candidate = new Date(`${parts[3]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}T${time[1].padStart(2, "0")}:${time[2]}:${time[3] || "00"}-04:00`);
  if (!Number.isFinite(candidate.getTime())) return undefined;
  return candidate.toISOString();
}

function sourceEvents(payload: unknown, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  return extractEvents(payload).flatMap((raw) => {
    const record = raw as Record<string, unknown>;
    const attributes = record.attributes && typeof record.attributes === "object" ? record.attributes as Record<string, unknown> : null;
    if (!attributes) return [attachVerifiedProvenance({ ...raw, lane: raw.lane || source.lane, source: raw.source || source.sourceName || source.id, sourceUrl: raw.sourceUrl || source.url }, source, now)];
    const value = (...keys: string[]) => keys.map((key) => attributes[key]).find((candidate) => candidate !== undefined && candidate !== null);
    const county = clean(value("COUNTY", "COUNTYNAME", "COUNTY_NAME")).toUpperCase();
    if (source.id.startsWith("fhp-miami-") && county && county !== "MIAMI-DADE" && county !== "MIAMI DADE") return [];
    const effective = arcGisEffective(attributes);
    if (effective && new Date(now).getTime() - new Date(effective).getTime() > ARCGIS_STALE_MS) return [];
    const kind = clean(value("TYPEEVENT", "INCIDENT_TYPE", "EVENT_TYPE", "TYPE", "CATEGORY"), source.id.includes("closures") ? "Road closure" : source.id.includes("crashes") ? "Traffic crash" : source.id.includes("brush-fires") ? "Brush fire" : "Road incident");
    const road = clean(value("ROADWAY", "ROAD_NAME", "STREET", "LOCATION", "ROUTE"), "Miami-Dade road");
    return [attachVerifiedProvenance({
      ...raw,
      properties: attributes,
      sourceEventId: clean(String(value("INCIDENTID", "INCIDENT_ID", "EVENT_ID", "OBJECTID", "FID") ?? "")) || undefined,
      source: source.sourceName || source.id,
      sourceUrl: source.url.split("/query?")[0],
      lane: source.lane,
      title: clean(value("TITLE", "HEADLINE"), `${kind} en ${road}`),
      description: clean(value("REMARKS", "DESCRIPTION", "DETAILS", "COMMENTS")),
      instruction: clean(value("INSTRUCTION", "ADVICE")),
      location: road,
      eventType: kind,
      status: clean(value("STATUS", "EVENT_STATUS")),
      effective,
    }, source, now)];
  });
}

export async function runClipperLocalNewsCycle(input: ClipperLocalNewsCycleInput = {}): Promise<{ fetchedSources: number; failedSources: Array<{ id: string; error: string }>; created: number; updated: number; duplicates: number; resolved: number; queued: number; status: ClipperLocalNewsStatus }> {
  cyclePayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const now = isoNow(input.now);
  const env = input.env || process.env;
  let events = input.events;
  let fetchedSources = 0;
  const failedSources: Array<{ id: string; error: string }> = [];
  if (!events) {
    events = [];
    const fetcher = input.fetch || globalThis.fetch;
    for (const source of sources(env)) {
      if (source.requiresKey && !source.key) { failedSources.push({ id: source.id, error: "missing_api_key" }); continue; }
      try {
        const requestUrl = new URL(source.url);
        if (source.id === "ny511" && source.key) requestUrl.searchParams.set("key", source.key);
        const response = await fetcher(requestUrl, { headers: { Accept: source.format === "rss" ? "application/rss+xml, application/xml, text/xml" : source.format === "miami-transit-bootstrap" ? "text/html" : "application/geo+json, application/json", "User-Agent": "asistente-local-news/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let extracted: ClipperLocalNewsRawEvent[];
        if (source.format === "rss") extracted = rssEvents(await response.text(), source, now);
        else if (source.format === "mta-json") extracted = mtaAlertEvents(await response.json(), source, now);
        else if (source.format === "miami-transit-bootstrap") {
          const page = await response.text();
          const apiKey = page.match(/<service-updates\b[^>]*\bapikey=["']([^"']+)["']/i)?.[1];
          if (!apiKey) throw new Error("public_transit_key_not_found");
          const transitResponse = await fetcher("https://www.miamidade.gov/apps/dtpw/transitapps/api/serviceupdates", {
            headers: { Accept: "application/json", "User-Agent": "asistente-local-news/1.0", "x-api-key": apiKey },
          });
          if (!transitResponse.ok) throw new Error(`HTTP ${transitResponse.status}`);
          extracted = miamiTransitEvents(await transitResponse.json(), source, now);
        } else extracted = sourceEvents(await response.json(), source, now);
        events.push(...extracted); fetchedSources += 1;
      } catch (error) { failedSources.push({ id: source.id, error: error instanceof Error ? error.message : "fetch_failed" }); }
    }
  }
  const controlledSnapshot = input.events !== undefined && input.resolveMissing === true;
  const result = await ingestClipperLocalNewsEvents({ ...input, workspaceDir: dir, now, events, resolveMissing: controlledSnapshot, snapshotLanes: controlledSnapshot ? input.snapshotLanes : undefined });
  const state = (await readState(dir))!;
  state.lastRunAt = now; state.updatedAt = now;
  await persist(dir, state);
  return { fetchedSources, failedSources, created: result.created, updated: result.updated, duplicates: result.duplicates, resolved: result.resolved, queued: result.queued, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

function nonNegativeInteger(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(number);
}

function nonNegativeMoney(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(number * 100) / 100;
}

export async function recordClipperLocalNewsMetrics(input: ClipperLocalNewsMetricsInput): Promise<{ recorded: number; status: ClipperLocalNewsStatus }> {
  metricPayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const state = (await readState(dir))!;
  const now = isoNow(input.now);
  for (const item of input.metrics) {
    if (!LANES.includes(item.lane) || !PLATFORMS.includes(item.platform)) throw new Error("Invalid metric lane or platform");
    const metric: ClipperLocalNewsMetric = { id: digest(JSON.stringify([item.queueItemId, item.eventId, item.lane, item.platform, item.observedAt || now, state.metrics.length])), queueItemId: item.queueItemId || null, eventId: item.eventId || null, lane: item.lane, platform: item.platform, impressions: nonNegativeInteger(item.impressions, "impressions"), engagements: nonNegativeInteger(item.engagements, "engagements"), clicks: nonNegativeInteger(item.clicks, "clicks"), shares: nonNegativeInteger(item.shares, "shares"), revenueUsd: nonNegativeMoney(item.revenueUsd, "revenueUsd"), costUsd: nonNegativeMoney(item.costUsd, "costUsd"), observedAt: isoNow(item.observedAt || now), recordedAt: now, variantId: item.variantId || null };
    state.metrics.push(metric);
  }
  state.updatedAt = now;
  await persist(dir, state);
  return { recorded: input.metrics.length, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

export async function getClipperLocalNewsStatus(options: ClipperLocalNewsOptions = {}): Promise<ClipperLocalNewsStatus> {
  const dir = workspace(options);
  const state = await readState(dir);
  const env = options.env || process.env;
  const artifacts = Object.fromEntries(Object.entries(FILES).map(([key, filename]) => [key, path.join(dir, filename)]));
  const emptyLane = () => ({ active: 0, resolved: 0, queued: 0 });
  const lanes: ClipperLocalNewsStatus["lanes"] = { "miami-news": emptyLane(), "ny-news": emptyLane() };
  if (state) {
    for (const event of state.events) lanes[event.lane][event.lifecycle] += 1;
    for (const item of state.queue) lanes[item.lane].queued += 1;
  }
  const metrics = summarizeMetrics(state?.metrics || []);
  const sections = Object.fromEntries(SECTIONS.map((section) => [section, { events: state?.events.filter((event) => event.section === section).length || 0, queued: state?.queue.filter((item) => item.section === section).length || 0 }])) as ClipperLocalNewsStatus["editorial"]["sections"];
  const urgency = Object.fromEntries(EDITORIAL_URGENCIES.map((level) => [level, state?.events.filter((event) => event.editorialUrgency === level).length || 0])) as ClipperLocalNewsStatus["editorial"]["urgency"];
  const counters = state?.editorialCounters || { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 };
  const committeeItems = state?.queue.filter((item) => Array.isArray(item.verdicts) && item.verdicts.length === 3) || [];
  const revenueUsd = metrics.revenueUsd;
  return {
    workspaceDir: dir, bootstrapped: Boolean(state), scheduleMinutes: state?.scheduleMinutes ?? scheduleMinutes(env), lastRunAt: state?.lastRunAt || null, lanes,
    events: { total: state?.events.length || 0, active: state?.events.filter((event) => event.lifecycle === "active").length || 0, resolved: state?.events.filter((event) => event.lifecycle === "resolved").length || 0 },
    queue: { total: state?.queue.length || 0, approvalRequired: state?.queue.filter((item) => item.approvalRequired).length || 0, autoEligible: state?.queue.filter((item) => item.autoEligible).length || 0, quarantined: state?.queue.filter((item) => item.status === "quarantined" || item.publishDecision === "quarantine").length || 0, rejected: state?.queue.filter((item) => item.status === "rejected" || item.publishDecision === "reject").length || 0, published: 0 },
    editorial: {
      owner: "Local News CEO", operatingMode: "professional_newsroom", sections, urgency,
      autoSafe: state?.queue.filter((item) => item.autoEligible && item.risk !== "high" && item.risk !== "critical").length || 0,
      reviewRequired: state?.queue.filter((item) => item.approvalRequired).length || 0,
      cadenceHeld: state?.queue.filter((item) => item.gateReason === "cadence").length || counters.cadenceHeld,
      textOnlyFacebook: state?.queue.filter((item) => item.platform === "facebook" && item.textOnly === true && item.mediaRequired === false).length || 0,
      duplicates: counters.duplicates, revisions: counters.revisions, corrections: counters.corrections, resolvedRevisions: counters.resolvedRevisions,
      cadence: { ...CADENCE, facebookRelevantMax: FACEBOOK_MAX_RELEVANT_PER_LANE, adaptive: "urgency_and_observed_performance" },
      committee: {
        reviewed: committeeItems.length,
        unanimous: committeeItems.filter((item) => item.consensus === "unanimous_approve").length,
        quarantined: state?.queue.filter((item) => item.publishDecision === "quarantine" || item.gateReason === "committee_quarantine").length || 0,
        rejected: state?.queue.filter((item) => item.publishDecision === "reject" || item.gateReason === "committee_reject").length || 0,
        roles: ["source_verifier", "safety_editor", "monetization_editor"],
      },
      growth: {
        mode: "zero_cost_organic",
        paidAds: false,
        paidAiPerPost: false,
        ownedLinks: state?.queue.filter((item) => Boolean(item.organicGrowth?.ownedArticleUrl)).length || 0,
        experiments: state?.queue.filter((item) => Boolean(item.organicGrowth?.variantId)).length || 0,
        shortFormReady: state?.queue.filter((item) => item.organicGrowth?.shortForm.ready === true).length || 0,
      },
    },
    metrics,
    monetization: {
      targetUsd: MONETIZATION_TARGET_USD,
      revenueUsd,
      remainingUsd: Math.max(0, Math.round((MONETIZATION_TARGET_USD - revenueUsd) * 100) / 100),
      progressPct: Math.min(100, Math.round((revenueUsd / MONETIZATION_TARGET_USD) * 10_000) / 100),
      externalEligibility: "unverified",
      pagesEligible: null,
      policyViolations: null,
      verifiedAt: null,
      bySection: summarizeMetricsBySection(state),
    },
    connectors: connectorCatalog(env),
    coverage: {
      weather: "nws_public",
      miamiTraffic: env.FL511_FEED_URL || env.MIAMI_NEWS_FEED_URL ? "configured_feed" : "public_incident_feed",
      nyTraffic: env.NY511_FEED_URL && env.NY511_API_KEY ? "ny511_configured" : "notify_nyc_public",
      roadCoverageComplete: false,
      note: "Notify NYC and Miami-Dade public incident feeds provide official updates but do not guarantee complete road coverage. NY511 remains optional and requires explicit authorized configuration.",
    },
    artifacts,
    guardrails: ["Queue state never proves or claims real publication.", "Facebook stories are text-only and do not require a photo.", "Only official/public or authorized sources with unanimous committee approval can become auto-eligible; commercial news articles are never scraped.", "Revenue progress, cost, reach, and engagement include only explicitly recorded observations; no money or performance is inferred.", "Unresolved accusations, identifiable minors, victim private addresses, graphic violence, contradictory information, unconfirmed claims, and unverifiable critical evacuations receive automatic final quarantine/reject decisions, not a human-review wait.", "Facebook volume can rise only for relevant developing/breaking events or strong observed performance; routine filler and engagement bait remain blocked.", "Cadence overflow remains automatic but cannot publish before its notBefore timestamp.", "Secrets are read from environment variables and never persisted."],
  };
}

export const __clipperLocalNewsInternals = { riskFor, sectionFor, editorialUrgencyFor, sources, connectorCatalog, truncate, extractEvents, rssEvents, sourceEvents, mtaAlertEvents, miamiTransitEvents, scheduleMinutes };
