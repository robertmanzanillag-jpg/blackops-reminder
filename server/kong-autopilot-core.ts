import { createHash } from "node:crypto";
import { z } from "zod";
import type { LearningLedger } from "./kong-content-learning";
import type { PublishedCreative } from "./kong-metricool-learning";
import type { ProductionState } from "./kong-production-pipeline";

export const networks = ["tiktok", "facebook"] as const;
export type Network = typeof networks[number];
export const isKongNetwork = (value: unknown): value is Network => typeof value === "string" && (networks as readonly string[]).includes(value);
export const families = ["lineup", "pov", "humor", "app", "dancefloor", "tables", "guestlist", "yacht", "car"] as const;
const iso = z.string().datetime({ offset: true });
const url = z.string().url().refine(value => new URL(value).protocol === "https:");
const rights = z.object({ evidenceUrl: url, confirmedBy: z.string().min(1), expiresAt: iso });
export const assetSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), sourceUrl: url, mediaUrl: url,
  sha256: z.string().regex(/^[a-f0-9]{64}$/), family: z.enum(families), hook: z.string().min(1).max(180),
  caption: z.string().min(1).max(2000), title: z.string().min(1).max(100),
  durationSeconds: z.number().min(3).max(90), width: z.literal(1080), height: z.literal(1920),
  footageRights: rights, musicRights: rights,
  qa: z.object({ reviewedBy: z.string().min(1), reviewedAt: iso, officialWhiteLogo: z.literal(true),
    noLogoBackgroundOrShadow: z.literal(true), safeZones: z.literal(true), audioChecked: z.literal(true),
    spellingChecked: z.literal(true), renderedSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  facts: z.object({ sourceUrl: url, verifiedAt: iso, validUntil: iso }).optional(),
});
export const catalogSchema = z.object({ version: z.literal(1), assets: z.array(assetSchema).max(2000) });
export type Asset = z.infer<typeof assetSchema>;
export interface Job { id: string; day: string; network: Network; slot: number; at: string; asset: Asset;
  state: "planned" | "submitting" | "scheduled" | "uncertain" | "expired" | "blocked";
  receipt?: string; attempts: number; nextAttemptAt?: string; lastReconciledAt?: string; reason?: string; }
export interface State { version: 1; jobs: Job[]; lastCycleAt?: string; lastError?: string;
  learning?: LearningLedger; publishedCreatives?: PublishedCreative[];
  learningCheckedAt?: string; learningError?: string;
  production?: ProductionState; productionError?: string; productionNextAttemptAt?: string; catalogError?: string; }
export const emptyState = (): State => ({ version: 1, jobs: [] });
export const dayInNewYork = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export function dayPlus(day: string, days: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export function assetProblem(asset: Asset, instant: Date, checkedAt = instant): string | undefined {
  if (!assetSchema.safeParse(asset).success) return "invalid_asset";
  const text = `${asset.title} ${asset.hook} ${asset.caption}`;
  if (/\bfree\b|\bgratis\b/i.test(text)) return "prohibited_copy";
  if (!asset.caption.includes("https://kongnightlife.com")) return "missing_kong_cta";
  if (asset.qa.renderedSha256 !== asset.sha256) return "qa_hash_mismatch";
  if ([asset.footageRights, asset.musicRights].some(r => Date.parse(r.expiresAt) <= +instant)) return "rights_expired";
  if (Date.parse(asset.qa.reviewedAt) > +checkedAt) return "future_qa";
  const needsFacts = ["lineup", "app", "tables", "guestlist", "yacht", "car"].includes(asset.family)
    || /guestlist|complimentary|lineup|rent|table|yacht|car rental/i.test(text);
  if (needsFacts && !asset.facts) return "missing_offer_or_event_evidence";
  if (asset.facts && (Date.parse(asset.facts.validUntil) <= +instant || Date.parse(asset.facts.verifiedAt) > +checkedAt
    || +checkedAt - Date.parse(asset.facts.verifiedAt) > 86400_000)) return "stale_facts";
}

// Seed slots are explicitly hypotheses, not inferred best hours. Offset conversion is
// injected from the existing timezone-tested Metricool helper to handle DST.
const hours: Record<Network, string[]> = { tiktok: ["12:15", "15:15", "18:15", "20:15", "22:15"], facebook: ["11:45", "14:45", "17:45", "19:45", "21:45"] };
export function fillPlan(state: State, assets: Asset[], now: Date, toOffset: (wall: string) => string): State {
  const today = dayInNewYork(now);
  for (const job of state.jobs) if (isKongNetwork(job.network) && job.state === "planned" && Date.parse(job.at) <= +now) { job.state = "expired"; job.reason = "missed_slot"; }
  for (let d = 0; d < 14; d++) for (const network of networks) for (let slot = 0; slot < 5; slot++) {
    const day = dayPlus(today, d), at = toOffset(`${day}T${hours[network][slot]}:00`);
    if (Date.parse(at) <= +now + 15 * 60_000) continue;
    const id = `kong:${day}:${network}:${slot}`;
    const existing = state.jobs.find(j => j.id === id);
    if (existing && !(existing.state === "blocked" && existing.attempts === 0)) continue;
    const recent = state.jobs.filter(j => j.network === network && j.day >= dayPlus(day, -13) && j.day <= day && !["expired", "blocked"].includes(j.state));
    const used = new Set(recent.map(j => j.asset.sha256));
    const hooks = new Set(recent.map(j => j.asset.hook.toLowerCase().trim()));
    const daily = recent.filter(j => j.day === day);
    const previous = recent.at(-1)?.asset.family;
    const asset = assets.find(a => !used.has(a.sha256) && !hooks.has(a.hook.toLowerCase().trim())
      && a.family !== previous && daily.filter(j => j.asset.family === a.family).length < 2
      && !assetProblem(a, new Date(at), now));
    if (!asset) continue;
    const next: Job = { id, day, network, slot, at, asset, state: "planned", attempts: 0 };
    if (existing) Object.assign(existing, next, { reason: undefined, nextAttemptAt: undefined });
    else state.jobs.push(next);
  }
  return state;
}
export function coverage(state: State, now: Date) {
  const today = dayInNewYork(now);
  return Array.from({ length: 14 }, (_, i) => { const day = dayPlus(today, i);
    return { day, networks: Object.fromEntries(networks.map(network => {
      const rows = state.jobs.filter(j => j.day === day && j.network === network);
      const scheduled = rows.filter(j => j.state === "scheduled").length;
      return [network, { scheduled, prepared: rows.filter(j => j.state === "planned").length,
        missingScheduled: 5 - scheduled, uncertain: rows.filter(j => ["submitting", "uncertain"].includes(j.state)).length }];
    })) };
  });
}
export const contentHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export interface Delivery {
  find(job: Job): Promise<string | undefined>;
  create(job: Job): Promise<void>;
}
// Persist intent before remote mutation. Unknown outcomes are reconcile-only forever;
// automatic retries are limited to read failures, preventing duplicate remote posts.
export async function deliverJob(job: Job, delivery: Delivery, save: () => Promise<void>, now: Date) {
  if (!isKongNetwork(job.network)) return;
  if (!["planned", "submitting", "uncertain"].includes(job.state)) return;
  if (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > +now) return;
  const uncertain = job.state !== "planned";
  const found = await delivery.find(job);
  if (found) { job.receipt = found; job.state = "scheduled"; delete job.reason; await save(); return; }
  if (uncertain) { job.state = "uncertain"; job.reason = "remote_outcome_unconfirmed"; await save(); return; }
  const problem = assetProblem(job.asset, new Date(job.at), now);
  if (problem || Date.parse(job.at) <= +now) { job.state = "blocked"; job.reason = problem || "missed_slot"; await save(); return; }
  job.state = "submitting"; job.attempts += 1; await save();
  try {
    await delivery.create(job);
    const receipt = await delivery.find(job);
    job.state = receipt ? "scheduled" : "uncertain";
    if (receipt) job.receipt = receipt;
    else job.reason = "remote_outcome_unconfirmed";
  } catch { job.state = "uncertain"; job.reason = "remote_outcome_unconfirmed"; }
  await save();
}
