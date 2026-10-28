import { createHash } from "node:crypto";
import { z } from "zod";
import { dayInNewYork, dayPlus, type Asset } from "./kong-autopilot-core";
import { formatMetricoolMcpDate } from "./blackroom-metricool-bridge";
import type { EditorialTask, ProductionState } from "./kong-production-pipeline";
import type { OnlineFootage } from "./kong-online-sources";
import { wrapRenderText } from "./kong-cloud-renderer";

type Rights = Asset["musicRights"];
const rightsSchema = z.object({ evidenceUrl: z.string().url().refine(s => new URL(s).protocol === "https:"), confirmedBy: z.string().trim().min(1), expiresAt: z.string().datetime({ offset: true }) });
const eventSchema = z.object({ title: z.string().trim().min(1).max(65), startsAt: z.string().datetime({ offset: true }),
  sourceUrl: z.string().url().refine(s => new URL(s).protocol === "https:"), verifiedAt: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }) });
export type VerifiedEditorialEvent = z.infer<typeof eventSchema>;
const protocolSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), primaryVariable: z.literal("hook_text"),
  layout: z.enum(["pov", "reveal", "montage"]), durationSeconds: z.number().int().min(3).max(30),
  baselineHook: z.string().min(1).max(120), challengerHooks: z.array(z.string().min(1).max(120)).min(1).max(20),
  hypothesis: z.string().trim().min(10).max(300) }).strict();
export interface EditorialPlanInput {
  now: Date; musicRights?: Rights; footageRights?: Rights; authorizedForPublicDistribution?: boolean;
  events?: unknown[];
  /** Calendar target only. Rights/facts freshness always uses the real `now`. */
  targetDay?: string;
  /** Optional explicit comparison protocol; never inferred from missing data. */
  experimentProtocol?: unknown;
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
  const now = input.now, today = dayInNewYork(now), day = input.targetDay || today, tasks: EditorialTask[] = [];
  const protocol = input.experimentProtocol === undefined ? undefined : protocolSchema.parse(input.experimentProtocol);
  if (protocol) {
    const hooks = [protocol.baselineHook, ...protocol.challengerHooks];
    if (new Set(hooks.map(normalize)).size !== hooks.length || hooks.some(h => !safeCopy(h))) throw Error("invalid_experiment_protocol_hooks");
    hooks.forEach(wrapRenderText);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today || day > dayPlus(today, 13)) throw Error("invalid_editorial_target_day");
  const targetStart = new Date(formatMetricoolMcpDate(`${day}T00:00:00`, "America/New_York"));
  const targetEnd = new Date(+new Date(formatMetricoolMcpDate(`${dayPlus(day, 1)}T00:00:00`, "America/New_York")) - 1);
  const experiments: { taskId: string; classification: "exploration" | "baseline"; hypothesis: string }[] = [];
  const reasons: string[] = [];
  if (!validRights(input.musicRights, targetEnd) || !validRights(input.footageRights, targetEnd) || input.authorizedForPublicDistribution !== true)
    return { day, tasks, experiments, missing: 5, reasons: ["recorded_footage_music_and_distribution_authorization_required"] };
  const jobDay = (j: ProductionState["jobs"][number]) => j.task.plannedDay || dayInNewYork(new Date(j.createdAt));
  const recent = state.jobs.filter(j => jobDay(j) >= dayPlus(day, -13) && jobDay(j) <= dayPlus(day, 13));
  const eligibleTask = (j: ProductionState["jobs"][number]) => j.stage !== "blocked" && j.task.authorizedForPublicDistribution
    && validRights(j.task.musicRights, targetEnd) && validRights(j.task.footageRights, targetEnd)
    && (!j.task.facts || (Date.parse(j.task.facts.validUntil) > +targetEnd && Date.parse(j.task.facts.verifiedAt) <= +now
      && +now - Date.parse(j.task.facts.verifiedAt) <= 86400_000));
  const todays = recent.filter(j => jobDay(j) === day && eligibleTask(j));
  const remaining = Math.max(0, 5 - todays.length);
  const usedSources = new Set([...recent, ...state.jobs.filter(j => j.stage === "blocked")].flatMap(j => j.task.sourceIds));
  const usedHooks = new Set(recent.map(j => normalize(j.task.hook)));
  let previousLayout = recent.filter(j => j.stage !== "blocked" && jobDay(j) <= day).at(-1)?.task.layout;
  const candidates = [...new Map(state.candidates.filter(s => sourceEligible(s, now) && Date.parse(s.rightsExpiresAt) > +targetEnd).map(s => [s.id, s])).values()]
    .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || a.id.localeCompare(b.id));
  const eligibleEvents = (input.events || []).slice(0, 50).flatMap(raw => {
    const parsed = eventSchema.safeParse(raw); if (!parsed.success) return [];
    const e = parsed.data;
    if (Date.parse(e.startsAt) <= Math.max(+now, +targetStart) || Date.parse(e.validUntil) <= +targetEnd || Date.parse(e.validUntil) < Date.parse(e.startsAt)
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
    const task: EditorialTask = { id: `kong-${day}-${slot}-${hash(sources.map(s => s.id).join("|") + hook).slice(0, 12)}`, plannedDay: day,
      sourceIds: sources.map(s => s.id), layout, hook, reveal: layout === "reveal" ? reveals[slot % reveals.length] : undefined,
      durationSeconds, title: hook, caption, family, facts,
      footageRights: { ...input.footageRights, expiresAt: new Date(Math.min(Date.parse(input.footageRights.expiresAt), ...sources.map(s => Date.parse(s.rightsExpiresAt)))).toISOString() },
      musicRights: { ...input.musicRights }, authorizedForPublicDistribution: true };
    // Event pieces use only the verified title/date; a generic comedic reveal would
    // misrepresent the factual event card, so remove it by choosing POV instead.
    if (family === "lineup" && layout === "reveal") { task.layout = "pov"; task.reveal = undefined; }
    if (task.layout === previousLayout) { reasons.push("event_layout_would_repeat"); continue; }
    const matchesProtocol = protocol && task.family !== "lineup" && task.layout === protocol.layout && task.durationSeconds === protocol.durationSeconds;
    const challenger = !!matchesProtocol && protocol!.challengerHooks.some(h => normalize(h) === normalize(task.hook));
    const control = !!matchesProtocol && normalize(protocol!.baselineHook) === normalize(task.hook);
    task.creativeTest = { testId: challenger || control ? protocol!.id : `baseline-${task.id}`,
      kind: challenger ? "exploration" : "baseline", hookStyle: challenger || control ? `${protocol!.id}:${challenger ? "challenger" : "control"}` : task.layout,
      sourceIds: [...task.sourceIds], primaryVariable: "hook_text",
      hypothesis: challenger || control ? protocol!.hypothesis : "Establish a descriptive baseline for this hook and layout; no improvement or novelty is claimed." };
    tasks.push(task); usedHooks.add(normalize(hook)); sources.forEach(s => usedSources.add(s.id)); previousLayout = task.layout;
    experiments.push({ taskId: task.id, classification: challenger ? "exploration" : "baseline", hypothesis: task.creativeTest.hypothesis! });
  }
  return { day, tasks, experiments, missing: Math.max(0, 5 - todays.length - tasks.length), reasons: [...new Set(reasons)] };
}

/** Generates a bounded rolling horizon without pretending future verification.
 * Synthetic queued rows exist only in this local copy to reserve source/hook
 * choices; callers persist returned tasks through the production ledger. */
export function planRollingEditorial(state: ProductionState, input: EditorialPlanInput) {
  const virtual: ProductionState = { ...state, jobs: [...state.jobs] };
  const tasks: EditorialTask[] = [];
  const days: ReturnType<typeof planDailyEditorial>[] = [];
  const today = dayInNewYork(input.now);
  for (let offset = 0; offset < 14; offset++) {
    const plan = planDailyEditorial(virtual, { ...input, targetDay: dayPlus(today, offset) });
    days.push(plan); tasks.push(...plan.tasks);
    for (const task of plan.tasks) virtual.jobs.push({ id: `planned-${task.id}`, task,
      sources: state.candidates.filter(s => task.sourceIds.includes(s.id)), stage: "queued",
      createdAt: input.now.toISOString(), updatedAt: input.now.toISOString() });
  }
  return { asOf: input.now.toISOString(), tasks, days, missing: days.reduce((total, d) => total + d.missing, 0) };
}
