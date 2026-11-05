// KONG operations from the Agents Office: verified cards -> Videos KONG, a single publisher
// with handoff, and per-publication results. Pure module (no IO) shared by server, client and tests.
//
// The office COORDINATES; it never publishes. The only publisher is the external KONG publisher
// (today Codex on Robert's machine). It holds the publisher lease, records each publication by
// UUID here, and reports what it published so a failed or unknown attempt is reconciled by UUID
// instead of being published twice.
import { z } from "zod";

// Roles reused from the office (shared/kong-supervisor.ts KONG_WORKERS).
export const KONG_CARD_AUTHORS = ["kong:Venues", "kong:Promoters + Mesas"] as const;
export const KONG_VIDEOS_AGENT = "kong-videos" as const;
export const KONG_METRICS_AGENT = "kong-metrics" as const;

export const CARD_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const LEASE_TTL_MS = 15 * 60_000;
/** An attempt with no answer for this long is reconciled by UUID before anyone retries it. */
export const RECONCILE_GRACE_MS = 30 * 60_000;
const MAX_CARDS = 200;
const MAX_INBOX = 200;
const MAX_LEDGER = 300;
const MAX_REJECTED = 50;
const MAX_EVENTS = 60;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "uuid invalido");
const shortText = z.string().trim().min(1).max(160);
const iso = z.string().datetime({ offset: true });

export const kongCardSchema = z.object({
  cardId: uuid,
  kind: z.enum(["venue", "promoter"]),
  name: shortText,
  city: shortText,
  /** What the video should say: the offer, night or table deal, as verified. */
  highlight: z.string().trim().min(1).max(400),
  schedule: z.string().trim().max(160).optional(),
  /** Public handle or page only; no personal phone numbers or emails. */
  publicHandle: z.string().trim().max(120).regex(/^[^@\s]*@?[A-Za-z0-9_.-]*$/, "solo un handle publico").optional(),
  sources: z.array(z.object({ url: z.string().url().startsWith("https://"), checkedAt: iso })).min(1).max(5),
  verifiedBy: z.enum(KONG_CARD_AUTHORS),
  verifiedAt: iso,
}).strict();
export type KongCard = z.infer<typeof kongCardSchema>;

export type VideoBrief = {
  briefId: string;
  cardId: string;
  cardVersion: string;
  from: (typeof KONG_CARD_AUTHORS)[number];
  to: typeof KONG_VIDEOS_AGENT;
  title: string;
  city: string;
  highlight: string;
  schedule?: string;
  publicHandle?: string;
  sources: string[];
  deliveredAt: string;
  status: "pendiente" | "en_produccion" | "publicado";
};

export type PublisherLease = { holder: string; leaseId: string; epoch: number; acquiredAt: string; expiresAt: string };

export type PublicationStatus = "planned" | "submitted" | "confirmed" | "failed" | "unknown" | "retryable";
export type Publication = {
  uuid: string;
  briefId: string;
  holder: string;
  epoch: number;
  network: string;
  status: PublicationStatus;
  attempts: number;
  externalPostId?: string;
  publishedAt?: string;
  lastError?: string;
  updatedAt: string;
};

export type PublicationResult = {
  uuid: string;
  briefId: string;
  title: string;
  network: string;
  externalPostId: string;
  publishedAt?: string;
  observedAt: string | null;
  impressions: number;
  reach: number;
  videoViews: number;
  engagements: number;
  clicks: number;
  shares: number;
};

export type KongOperationsState = {
  version: 1;
  cards: Array<{ card: KongCard; version: string; receivedAt: string }>;
  rejected: Array<{ at: string; cardId: string | null; name: string | null; reasons: string[] }>;
  inbox: VideoBrief[];
  lease: PublisherLease | null;
  publications: Publication[];
  results: PublicationResult[];
  metricsCheckedAt: string | null;
  events: Array<{ at: string; text: string }>;
};

export function emptyKongOperations(): KongOperationsState {
  return { version: 1, cards: [], rejected: [], inbox: [], lease: null, publications: [], results: [], metricsCheckedAt: null, events: [] };
}

export function parseKongOperations(value: unknown): KongOperationsState {
  const v = value as Partial<KongOperationsState> | null;
  if (!v || typeof v !== "object" || v.version !== 1) return emptyKongOperations();
  const list = <T,>(items: unknown, ok: (item: any) => boolean): T[] => (Array.isArray(items) ? (items.filter((item) => item && typeof item === "object" && ok(item)) as T[]) : []);
  return {
    version: 1,
    cards: list(v.cards, (item) => kongCardSchema.safeParse(item.card).success && typeof item.version === "string"),
    rejected: list(v.rejected, (item) => Array.isArray(item.reasons)),
    inbox: list(v.inbox, (item) => typeof item.briefId === "string" && typeof item.cardId === "string"),
    lease: v.lease && typeof v.lease === "object" && typeof (v.lease as PublisherLease).holder === "string" && Number.isFinite((v.lease as PublisherLease).epoch) ? (v.lease as PublisherLease) : null,
    publications: list(v.publications, (item) => uuid.safeParse(item.uuid).success && typeof item.briefId === "string"),
    results: list(v.results, (item) => typeof item.uuid === "string"),
    metricsCheckedAt: typeof v.metricsCheckedAt === "string" ? v.metricsCheckedAt : null,
    events: list(v.events, (item) => typeof item.text === "string"),
  };
}

function event(state: KongOperationsState, at: string, text: string): KongOperationsState["events"] {
  return [{ at, text }, ...state.events].slice(0, MAX_EVENTS);
}

/** Stable fingerprint of the verified content: a changed offer is a new version, a re-send is not. */
export function cardVersion(card: KongCard): string {
  const text = [card.kind, card.name, card.city, card.highlight, card.schedule || "", card.publicHandle || ""].join("|").toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------------------------
// 1. Venues / Promoters -> Videos KONG: only verified cards become video briefs.
// ---------------------------------------------------------------------------------------------

export function verifyCard(raw: unknown, now: number): { ok: true; card: KongCard } | { ok: false; reasons: string[] } {
  const parsed = kongCardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".") || "ficha"}: ${issue.message}`).slice(0, 6) };
  const card = parsed.data;
  const reasons: string[] = [];
  const verifiedAt = Date.parse(card.verifiedAt);
  if (verifiedAt > now + 60_000) reasons.push("verifiedAt esta en el futuro");
  if (now - verifiedAt > CARD_MAX_AGE_MS) reasons.push("verificacion de hace mas de 7 dias");
  const freshSource = card.sources.some((source) => now - Date.parse(source.checkedAt) <= CARD_MAX_AGE_MS && Date.parse(source.checkedAt) <= now + 60_000);
  if (!freshSource) reasons.push("ninguna fuente revisada en los ultimos 7 dias");
  return reasons.length ? { ok: false, reasons } : { ok: true, card };
}

export function deliverCards(
  state: KongOperationsState,
  rawCards: unknown[],
  now: number
): { state: KongOperationsState; delivered: VideoBrief[]; duplicates: string[]; rejected: Array<{ cardId: string | null; reasons: string[] }> } {
  const at = new Date(now).toISOString();
  let next = state;
  const delivered: VideoBrief[] = [];
  const duplicates: string[] = [];
  const rejected: Array<{ cardId: string | null; reasons: string[] }> = [];
  for (const raw of rawCards.slice(0, 50)) {
    const check = verifyCard(raw, now);
    if (!check.ok) {
      const cardId = typeof (raw as { cardId?: unknown })?.cardId === "string" ? String((raw as { cardId: string }).cardId).slice(0, 64) : null;
      const name = typeof (raw as { name?: unknown })?.name === "string" ? String((raw as { name: string }).name).slice(0, 80) : null;
      rejected.push({ cardId, reasons: check.reasons });
      next = { ...next, rejected: [{ at, cardId, name, reasons: check.reasons }, ...next.rejected].slice(0, MAX_REJECTED) };
      continue;
    }
    const card = check.card;
    const version = cardVersion(card);
    const briefId = `${card.cardId}:${version}`;
    if (next.inbox.some((brief) => brief.briefId === briefId)) {
      duplicates.push(briefId);
      continue;
    }
    const brief: VideoBrief = {
      briefId,
      cardId: card.cardId,
      cardVersion: version,
      from: card.verifiedBy,
      to: KONG_VIDEOS_AGENT,
      title: `${card.kind === "venue" ? "Venue" : "Promoter"}: ${card.name} (${card.city})`,
      city: card.city,
      highlight: card.highlight,
      ...(card.schedule ? { schedule: card.schedule } : {}),
      ...(card.publicHandle ? { publicHandle: card.publicHandle } : {}),
      sources: card.sources.map((source) => source.url),
      deliveredAt: at,
      status: "pendiente",
    };
    delivered.push(brief);
    next = {
      ...next,
      cards: [{ card, version, receivedAt: at }, ...next.cards.filter((item) => item.card.cardId !== card.cardId)].slice(0, MAX_CARDS),
      inbox: [brief, ...next.inbox].slice(0, MAX_INBOX),
      events: event(next, at, `${card.verifiedBy.replace("kong:", "")} entrego a Videos KONG la ficha verificada "${card.name}".`),
    };
  }
  return { state: next, delivered, duplicates, rejected };
}

// ---------------------------------------------------------------------------------------------
// 2. Single publisher with handoff (lease + fencing epoch) and a UUID ledger.
// ---------------------------------------------------------------------------------------------

export class KongOpsError extends Error {
  constructor(public code: "lease_held" | "not_holder" | "stale_epoch" | "unknown_brief" | "already_published" | "unknown_publication" | "invalid", message: string) {
    super(message);
  }
}

function leaseValid(lease: PublisherLease | null, now: number): lease is PublisherLease {
  return Boolean(lease) && Date.parse(lease!.expiresAt) > now;
}

export function claimLease(state: KongOperationsState, holder: string, leaseId: string, now: number, ttlMs = LEASE_TTL_MS): KongOperationsState {
  const at = new Date(now).toISOString();
  const current = state.lease;
  if (leaseValid(current, now) && current.holder !== holder) {
    throw new KongOpsError("lease_held", `El titular es ${current.holder} hasta ${current.expiresAt}. Solo hay un publicador.`);
  }
  const renewing = leaseValid(current, now) && current.holder === holder && current.leaseId === leaseId;
  const lease: PublisherLease = {
    holder,
    leaseId,
    // A new holder (or a new lease after expiry) gets a higher epoch: the old one is fenced out.
    epoch: renewing ? current!.epoch : (current?.epoch ?? 0) + 1,
    acquiredAt: renewing ? current!.acquiredAt : at,
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  return { ...state, lease, events: renewing ? state.events : event(state, at, `${holder} es el titular unico de publicacion (epoca ${lease.epoch}).`) };
}

export function releaseLease(state: KongOperationsState, holder: string, leaseId: string, now: number): KongOperationsState {
  if (!state.lease || state.lease.holder !== holder || state.lease.leaseId !== leaseId) return state;
  const at = new Date(now).toISOString();
  return { ...state, lease: { ...state.lease, expiresAt: at }, events: event(state, at, `${holder} libero la publicacion; otro titular puede tomarla.`) };
}

function assertHolder(state: KongOperationsState, holder: string, epoch: number, now: number): void {
  if (!leaseValid(state.lease, now) || state.lease.holder !== holder) throw new KongOpsError("not_holder", `${holder} no es el titular vigente.`);
  if (state.lease.epoch !== epoch) throw new KongOpsError("stale_epoch", `Epoca ${epoch} vencida; la vigente es ${state.lease.epoch}.`);
}

/** Before publishing, the holder reserves a UUID for one brief on one network. Idempotent by UUID. */
export function planPublication(
  state: KongOperationsState,
  input: { holder: string; epoch: number; uuid: string; briefId: string; network: string },
  now: number
): KongOperationsState {
  if (!uuid.safeParse(input.uuid).success) throw new KongOpsError("invalid", "uuid invalido");
  const existing = state.publications.find((publication) => publication.uuid === input.uuid);
  if (existing) return state;
  assertHolder(state, input.holder, input.epoch, now);
  const brief = state.inbox.find((item) => item.briefId === input.briefId);
  if (!brief) throw new KongOpsError("unknown_brief", "Esa ficha no esta en la bandeja de Videos KONG.");
  const network = input.network.trim().toLowerCase().slice(0, 30);
  const live = state.publications.find(
    (publication) => publication.briefId === input.briefId && publication.network === network && ["planned", "submitted", "confirmed", "unknown"].includes(publication.status)
  );
  if (live) throw new KongOpsError("already_published", `Ya hay una publicacion ${live.status} (${live.uuid}) para esa ficha en ${network}; concilia esa antes.`);
  const at = new Date(now).toISOString();
  const publication: Publication = { uuid: input.uuid, briefId: input.briefId, holder: input.holder, epoch: input.epoch, network, status: "planned", attempts: 0, updatedAt: at };
  return {
    ...state,
    publications: [publication, ...state.publications].slice(0, MAX_LEDGER),
    inbox: state.inbox.map((item) => (item.briefId === input.briefId && item.status === "pendiente" ? { ...item, status: "en_produccion" } : item)),
  };
}

/** The holder reports what happened to one attempt. A fenced (older) holder is rejected. */
export function recordAttempt(
  state: KongOperationsState,
  input: { holder: string; epoch: number; uuid: string; outcome: "submitted" | "confirmed" | "failed" | "unknown"; externalPostId?: string; publishedAt?: string; error?: string },
  now: number
): KongOperationsState {
  assertHolder(state, input.holder, input.epoch, now);
  const publication = state.publications.find((item) => item.uuid === input.uuid);
  if (!publication) throw new KongOpsError("unknown_publication", "UUID no reservado.");
  if (publication.status === "confirmed") return state;
  const at = new Date(now).toISOString();
  const updated: Publication = {
    ...publication,
    holder: input.holder,
    epoch: input.epoch,
    status: input.outcome,
    attempts: publication.attempts + (input.outcome === "submitted" ? 1 : 0),
    ...(input.externalPostId ? { externalPostId: input.externalPostId.slice(0, 120) } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    ...(input.error ? { lastError: input.error.slice(0, 200) } : {}),
    updatedAt: at,
  };
  return withPublication(state, updated, at);
}

function withPublication(state: KongOperationsState, updated: Publication, at: string): KongOperationsState {
  const confirmed = updated.status === "confirmed";
  return {
    ...state,
    publications: state.publications.map((item) => (item.uuid === updated.uuid ? updated : item)),
    inbox: confirmed ? state.inbox.map((item) => (item.briefId === updated.briefId ? { ...item, status: "publicado" } : item)) : state.inbox,
    events: confirmed ? event(state, at, `Publicacion ${updated.uuid.slice(0, 8)} confirmada en ${updated.network}.`) : state.events,
  };
}

/** What the publisher actually sees published (e.g. read from Metricool), with the UUID it tagged. */
export type ExternalPost = { uuid?: string | null; text?: string | null; postId: string; network?: string | null; publishedAt?: string | null };

/** Finds our UUID in an external post: explicit field, or the "kong:<uuid>" tag in the caption. */
export function uuidOf(post: ExternalPost): string | null {
  if (post.uuid && uuid.safeParse(post.uuid).success) return post.uuid.toLowerCase();
  const match = (post.text || "").match(/kong:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * After a failure or a lost answer: each open publication is matched by UUID against what really
 * went out. Found -> confirmed (never published again). Not found after the grace period -> retryable.
 */
export function reconcileByUuid(state: KongOperationsState, posts: ExternalPost[], now: number): { state: KongOperationsState; confirmed: string[]; retryable: string[] } {
  const at = new Date(now).toISOString();
  const seen = new Map<string, ExternalPost>();
  for (const post of posts) {
    const id = uuidOf(post);
    if (id && !seen.has(id)) seen.set(id, post);
  }
  let next = state;
  const confirmed: string[] = [];
  const retryable: string[] = [];
  for (const publication of state.publications) {
    if (!["submitted", "failed", "unknown", "planned"].includes(publication.status)) continue;
    const match = seen.get(publication.uuid.toLowerCase());
    if (match) {
      confirmed.push(publication.uuid);
      next = withPublication(next, { ...publication, status: "confirmed", externalPostId: match.postId.slice(0, 120), ...(match.publishedAt ? { publishedAt: match.publishedAt } : {}), updatedAt: at }, at);
      continue;
    }
    const waiting = now - Date.parse(publication.updatedAt) >= RECONCILE_GRACE_MS;
    if (publication.status !== "planned" && waiting) {
      retryable.push(publication.uuid);
      next = withPublication(next, { ...publication, status: "retryable", updatedAt: at }, at);
    }
  }
  if (confirmed.length || retryable.length) {
    next = { ...next, events: event(next, at, `Conciliacion por UUID: ${confirmed.length} confirmadas, ${retryable.length} para reintentar.`) };
  }
  return { state: next, confirmed, retryable };
}

// ---------------------------------------------------------------------------------------------
// 3. Metrics agent (separate): results per confirmed publication.
// ---------------------------------------------------------------------------------------------

export type PostMetricsRow = {
  postId: string | null;
  observedAt: string | null;
  impressions: number;
  reach: number;
  videoViews: number;
  engagements: number;
  clicks: number;
  shares: number;
};

/** Rows come from the existing Metricool parser (parseMetricoolPostMetrics), matched by external post id. */
export function measurePublications(state: KongOperationsState, rows: PostMetricsRow[], now: number): KongOperationsState {
  const at = new Date(now).toISOString();
  const latest = new Map<string, PostMetricsRow>();
  for (const row of rows) {
    if (!row.postId) continue;
    const previous = latest.get(row.postId);
    if (!previous || Date.parse(row.observedAt || "") >= Date.parse(previous.observedAt || "")) latest.set(row.postId, row);
  }
  const results: PublicationResult[] = [];
  for (const publication of state.publications) {
    if (publication.status !== "confirmed" || !publication.externalPostId) continue;
    const row = latest.get(publication.externalPostId);
    const kept = state.results.find((result) => result.uuid === publication.uuid);
    if (!row) {
      if (kept) results.push(kept);
      continue;
    }
    const brief = state.inbox.find((item) => item.briefId === publication.briefId);
    results.push({
      uuid: publication.uuid,
      briefId: publication.briefId,
      title: brief?.title || publication.briefId,
      network: publication.network,
      externalPostId: publication.externalPostId,
      ...(publication.publishedAt ? { publishedAt: publication.publishedAt } : {}),
      observedAt: row.observedAt,
      impressions: row.impressions,
      reach: row.reach,
      videoViews: row.videoViews,
      engagements: row.engagements,
      clicks: row.clicks,
      shares: row.shares,
    });
  }
  return { ...state, results, metricsCheckedAt: at };
}

/** Live status of the office agents involved, from this state only (fails closed). */
export function kongOperationsStatus(state: KongOperationsState, now: number) {
  const confirmed = state.publications.filter((publication) => publication.status === "confirmed");
  const measured = state.results.length;
  const metricsFresh = state.metricsCheckedAt && now - Date.parse(state.metricsCheckedAt) <= 48 * 60 * 60_000;
  return {
    [KONG_METRICS_AGENT]: !confirmed.length
      ? { state: "needs-setup" as const, label: "Sin publicaciones confirmadas que medir" }
      : metricsFresh
        ? { state: "working" as const, label: `${measured}/${confirmed.length} publicaciones medidas` }
        : { state: "needs-setup" as const, label: "Faltan metricas de las ultimas 48 h" },
    inbox: state.inbox.filter((brief) => brief.status === "pendiente").length,
    holder: leaseValid(state.lease, now) ? state.lease.holder : null,
  };
}
