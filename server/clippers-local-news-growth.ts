import { createHash } from "node:crypto";

export type LocalNewsGrowthVariantId = "utility" | "impact";
export type LocalNewsGrowthLanguage = "es" | "en";

export interface LocalNewsGrowthEvent {
  id: string;
  lane: "miami-news" | "ny-news";
  title: string;
  location: string;
  section: "traffic" | "weather" | "breaking" | "public_safety" | "local";
  editorialUrgency: "routine" | "developing" | "breaking";
  lifecycle: "active" | "resolved";
}

export interface LocalNewsGrowthMetric {
  variantId?: LocalNewsGrowthVariantId | null;
  impressions: number;
  engagements: number;
  clicks: number;
  shares: number;
}

export interface LocalNewsGrowthPackage {
  zeroCost: true;
  experiment: "deterministic_observed_metrics";
  variantId: LocalNewsGrowthVariantId;
  headline: Record<LocalNewsGrowthLanguage, string>;
  headlineVariants: Record<LocalNewsGrowthVariantId, Record<LocalNewsGrowthLanguage, string>>;
  ownedArticleUrl: string | null;
  hashtags: string[];
  shortForm: {
    ready: true;
    format: "9:16";
    durationSeconds: 8;
    soundRequired: true;
    renderMode: "local_template";
    scenes: Array<{ startSecond: number; endSecond: number; text: string }>;
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slugPart(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "local-update";
}

export function localNewsArticleSlug(eventId: string, lane: LocalNewsGrowthEvent["lane"]): string {
  const city = lane === "miami-news" ? "miami" : "new-york";
  const stableId = slugPart(eventId).slice(0, 48);
  return `${city}-update-${stableId}-${digest(eventId).slice(0, 8)}`;
}

function safeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function variantScore(metrics: LocalNewsGrowthMetric[]): { impressions: number; score: number } {
  const totals = metrics.reduce((result, metric) => ({
    impressions: result.impressions + metric.impressions,
    engagements: result.engagements + metric.engagements,
    clicks: result.clicks + metric.clicks,
    shares: result.shares + metric.shares,
  }), { impressions: 0, engagements: 0, clicks: 0, shares: 0 });
  if (!totals.impressions) return { impressions: 0, score: 0 };
  return {
    impressions: totals.impressions,
    score: (totals.clicks + totals.shares * 2 + totals.engagements * 0.25) / totals.impressions,
  };
}

export function selectLocalNewsGrowthVariant(eventId: string, metrics: LocalNewsGrowthMetric[]): LocalNewsGrowthVariantId {
  const utility = variantScore(metrics.filter((metric) => metric.variantId === "utility"));
  const impact = variantScore(metrics.filter((metric) => metric.variantId === "impact"));
  if (utility.impressions >= 100 && impact.impressions >= 100 && utility.score !== impact.score) {
    return utility.score > impact.score ? "utility" : "impact";
  }
  return Number.parseInt(digest(eventId).slice(0, 2), 16) % 2 === 0 ? "utility" : "impact";
}

function sectionLabel(section: LocalNewsGrowthEvent["section"], language: LocalNewsGrowthLanguage): string {
  const labels = {
    traffic: { es: "Tráfico", en: "Traffic" },
    weather: { es: "Tiempo", en: "Weather" },
    breaking: { es: "Última hora", en: "Breaking" },
    public_safety: { es: "Seguridad pública", en: "Public safety" },
    local: { es: "Noticia local", en: "Local news" },
  } as const;
  return labels[section][language];
}

function headlines(event: LocalNewsGrowthEvent): LocalNewsGrowthPackage["headlineVariants"] {
  const statusEs = event.lifecycle === "resolved" ? "Resuelto" : sectionLabel(event.section, "es");
  const statusEn = event.lifecycle === "resolved" ? "Resolved" : sectionLabel(event.section, "en");
  return {
    utility: {
      es: `${statusEs} en ${event.location}: ${event.title}`,
      en: `${statusEn} in ${event.location}: ${event.title}`,
    },
    impact: {
      es: `Lo que debes saber en ${event.location}: ${event.title}`,
      en: `What to know in ${event.location}: ${event.title}`,
    },
  };
}

function hashtags(event: LocalNewsGrowthEvent): string[] {
  const city = event.lane === "miami-news" ? "#Miami" : "#NewYork";
  const section = {
    traffic: "#Trafico",
    weather: "#Tiempo",
    breaking: "#UltimaHora",
    public_safety: "#SeguridadPublica",
    local: "#NoticiasLocales",
  }[event.section];
  return [city, section];
}

export function buildLocalNewsGrowthPackage(
  event: LocalNewsGrowthEvent,
  metrics: LocalNewsGrowthMetric[],
  publicBaseUrl?: string,
): LocalNewsGrowthPackage {
  const headlineVariants = headlines(event);
  const variantId = selectLocalNewsGrowthVariant(event.id, metrics);
  const baseUrl = safeBaseUrl(publicBaseUrl);
  const ownedArticleUrl = baseUrl
    ? `${baseUrl}/news/article/${encodeURIComponent(localNewsArticleSlug(event.id, event.lane))}?lang=es&utm_source=metricool&utm_medium=organic_social&utm_campaign=local_news&utm_content=${variantId}`
    : null;
  const headline = headlineVariants[variantId];
  return {
    zeroCost: true,
    experiment: "deterministic_observed_metrics",
    variantId,
    headline,
    headlineVariants,
    ownedArticleUrl,
    hashtags: hashtags(event),
    shortForm: {
      ready: true,
      format: "9:16",
      durationSeconds: 8,
      soundRequired: true,
      renderMode: "local_template",
      scenes: [
        { startSecond: 0, endSecond: 2, text: sectionLabel(event.section, "es").toUpperCase() },
        { startSecond: 2, endSecond: 6, text: headline.es },
        { startSecond: 6, endSecond: 8, text: "Detalles y fuente oficial en Metro Current" },
      ],
    },
  };
}

export const __localNewsGrowthInternals = { safeBaseUrl, variantScore, headlines, hashtags };
