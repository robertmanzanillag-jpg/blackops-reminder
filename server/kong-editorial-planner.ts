import { createHash } from "node:crypto";
import { z } from "zod";
import { dayInNewYork, type Asset } from "./kong-autopilot-core";
import type { EditorialTask, ProductionState } from "./kong-production-pipeline";
import type { OnlineFootage } from "./kong-online-sources";
import { wrapRenderText } from "./kong-cloud-renderer";

type Rights = Asset["musicRights"];
const rightsSchema = z.object({ evidenceUrl: z.string().url().refine(s => new URL(s).protocol === "https:"), confirmedBy: z.string().trim().min(1), expiresAt: z.string().datetime({ offset: true }) });
const eventSchema = z.object({ title: z.string().trim().min(1).max(65), startsAt: z.string().datetime({ offset: true }),
  sourceUrl: z.string().url().refine(s => new URL(s).protocol === "https:"), verifiedAt: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }) });
export type VerifiedEditorialEvent = z.infer<typeof eventSchema>;
export interface EditorialPlanInput {
  now: Date; musicRights?: Rights; footageRights?: Rights; authorizedForPublicDistribution?: boolean;
  events?: unknown[];
}
const openers = ["Your group", "The dancefloor", "Tonight's plan", "The last track", "That one friend", "The first drop", "This weekend", "The group chat"];
const endings = ["understood the assignment", "changed the whole mood", "found a second wind", "needed one more track", "made it past midnight", "had other plans", "picked the right moment", "turned into a story", "took the scenic route", "kept the night going"];
const reveals = ["We are staying for one more", "That was never the last song", "The group chat called it", "Plot twist: another track", "Nobody checked the clock"];
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const safeCopy = (s: string) => !/\bfree\b|\bgratis\b|guestlist|complimentary|lineup|rent|table|yacht|car rental/i.test(s);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function validRights(rights: Rights | undefined, now: Date): rights is Rights {
  return rightsSchema.safeParse(rights).success && Date.parse(rights!.expiresAt) > +now;
}
function sourceEligible(source: OnlineFootage, now: Date) {
  try {
    const age = +now - Date.parse(source.discoveredAt);
    return source.id && source.rightsEvidence?.trim() && [source.sourceUrl, source.mediaUrl].every(s => new URL(s).protocol === "https:")
      && age >= 0 && age <= 7 * 86400_000 && Date.parse(source.rightsExpiresAt) > +now
      && source.audioPolicy === "remove_source_audio" && (source.durationSeconds === undefined || source.durationSeconds >= 3);
  } catch { return false; }
}

/** Pure task planning, not rights adjudication or visual approval. Call only with
 * an explicit recorded footage authorization and soundtrack authorization; caller
 * persists returned tasks before requesting another plan. No provider mutations. */
export function planDailyEditorial(state: ProductionState, input: EditorialPlanInput) {
  if (state.version !== 1 || !Number.isFinite(+input.now)) throw Error("invalid_editorial_state_or_clock");
  const now = input.now, day = dayInNewYork(now), tasks: EditorialTask[] = [];
  const experiments: { taskId: string; classification: "exploration" | "baseline"; hypothesis: string }[] = [];
  const reasons: string[] = [];
  if (!validRights(input.musicRights, now) || !validRights(input.footageRights, now) || input.authorizedForPublicDistribution !== true)
    return { day, tasks, experiments, missing: 5, reasons: ["recorded_footage_music_and_distribution_authorization_required"] };
  const recent = state.jobs.filter(j => +now - Date.parse(j.createdAt) >= 0 && +now - Date.parse(j.createdAt) < 14 * 86400_000 && j.stage !== "blocked");
  const todays = recent.filter(j => dayInNewYork(new Date(j.createdAt)) === day);
  const remaining = Math.max(0, 5 - todays.length);
  const usedSources = new Set(recent.flatMap(j => j.task.sourceIds));
  const usedHooks = new Set(recent.map(j => normalize(j.task.hook)));
  let previousLayout = recent.at(-1)?.task.layout;
  const candidates = [...new Map(state.candidates.filter(s => sourceEligible(s, now)).map(s => [s.id, s])).values()]
    .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || a.id.localeCompare(b.id));
  const eligibleEvents = (input.events || []).slice(0, 50).flatMap(raw => {
    const parsed = eventSchema.safeParse(raw); if (!parsed.success) return [];
    const e = parsed.data;
    if (Date.parse(e.startsAt) <= +now || Date.parse(e.validUntil) <= +now || Date.parse(e.validUntil) < Date.parse(e.startsAt)
      || +now - Date.parse(e.verifiedAt) < 0 || +now - Date.parse(e.verifiedAt) > 86400_000 || !safeCopy(e.title)) return [];
    try { wrapRenderText(e.title); return [e]; } catch { return []; }
  });
  let eventUsed = todays.some(j => j.task.family === "lineup");
  const hooks = openers.flatMap(a => endings.map(b => `${a} ${b}`)).filter(s => { try { wrapRenderText(s); return true; } catch { return false; } });
  const offset = parseInt(hash(day).slice(0, 8), 16) % hooks.length;
  const orderedHooks = hooks.slice(offset).concat(hooks.slice(0, offset));
  for (let index = 0; index < remaining; index++) {
    const available = candidates.filter(s => !usedSources.has(s.id));
    if (!available.length) { reasons.push("fresh_authorized_source_supply_exhausted"); break; }
    const slot = todays.length + tasks.length;
    let layout: EditorialTask["layout"] = (["pov", "reveal", "montage", "pov", "reveal"] as const)[slot];
    if (layout === previousLayout) layout = layout === "pov" ? "reveal" : "pov";
    if (layout === "montage" && available.length < 3) layout = previousLayout === "pov" ? "reveal" : "pov";
    const sources = available.slice(0, layout === "montage" ? 3 : 1);
    let hook = orderedHooks.find(h => !usedHooks.has(normalize(h)));
    if (!hook) { reasons.push("fresh_hook_supply_exhausted"); break; }
    let family: EditorialTask["family"] = layout === "pov" ? "pov" : layout === "reveal" ? "humor" : "dancefloor";
    let facts: Asset["facts"] | undefined;
    let caption = `${hook}. Send this to your party group. Discover your next night with KONG: https://kongnightlife.com`;
    if ([...todays.map(j => j.task), ...tasks].filter(t => t.family === family).length >= 2) family = "dancefloor";
    if (!eventUsed && eligibleEvents.length && layout !== "montage" && !usedHooks.has(normalize(eligibleEvents[0].title))) {
      const e = eligibleEvents[0]; hook = e.title; family = "lineup"; eventUsed = true;
      facts = { sourceUrl: e.sourceUrl, verifiedAt: e.verifiedAt, validUntil: e.validUntil };
      const eventDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(e.startsAt));
      caption = `${e.title} — ${eventDate}. Event details: ${e.sourceUrl}. Discover your next night with KONG: https://kongnightlife.com`;
    }
    const durationSeconds = layout === "montage" ? 9 : Math.min(12, Math.floor(sources[0].durationSeconds ?? 9));
    const task: EditorialTask = { id: `kong-${day}-${slot}-${hash(sources.map(s => s.id).join("|") + hook).slice(0, 12)}`,
      sourceIds: sources.map(s => s.id), layout, hook, reveal: layout === "reveal" ? reveals[slot % reveals.length] : undefined,
      durationSeconds, title: hook, caption, family, facts,
      footageRights: { ...input.footageRights, expiresAt: new Date(Math.min(Date.parse(input.footageRights.expiresAt), ...sources.map(s => Date.parse(s.rightsExpiresAt)))).toISOString() },
      musicRights: { ...input.musicRights }, authorizedForPublicDistribution: true };
    // Event pieces use only the verified title/date; a generic comedic reveal would
    // misrepresent the factual event card, so remove it by choosing POV instead.
    if (family === "lineup" && layout === "reveal") { task.layout = "pov"; task.reveal = undefined; }
    if (task.layout === previousLayout) { reasons.push("event_layout_would_repeat"); continue; }
    tasks.push(task); usedHooks.add(normalize(hook)); sources.forEach(s => usedSources.add(s.id)); previousLayout = task.layout;
    experiments.push({ taskId: task.id, classification: tasks.length % 2 === 1 ? "exploration" : "baseline",
      hypothesis: tasks.length % 2 === 1 ? "Test a new hook with a controlled layout; compare equal-age outcomes by network." : "Maintain a baseline format for comparison; this is not a claimed historical winner." });
  }
  return { day, tasks, experiments, missing: Math.max(0, 5 - todays.length - tasks.length), reasons: [...new Set(reasons)] };
}
