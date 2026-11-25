// Black Room cloud clip agent (GitHub Actions, $0 AI).
// Drive "Black Room - Sets para clips" -> find the drops -> render vertical 15/30/60 s clips with ffmpeg ->
// upload to the Social Hub and schedule them on Facebook (Black Room). TikTok stays on Metricool until the app is approved.
// Rules: 3-5 clips per day, the same DJ never within 15 days, several clips per set on different days
// (16 days apart). Once every clip of a set is published, the set goes to Drive trash (recoverable 30 days).
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { buildBlackRoomRenderArgs, extractBlackRoomDj, parseBlackRoomEnergySamples, type BlackRoomEnergySample } from "../server/blackroom-deterministic-editor";
import { zonedToIso } from "../server/social-hub/metricool-calendar";

const run = promisify(execFile);
const BASE = (process.env.SOCIAL_HUB_URL || "https://robplanner.replit.app").replace(/\/$/, "");
const TOKEN = process.env.SOCIAL_HUB_AGENT_TOKEN || "";
const AGENT = "blackroom-cloud";
const TZ = "America/New_York";
const PER_DAY = Math.min(5, Math.max(3, Number(process.env.BLACKROOM_CLOUD_POSTS_PER_DAY || 4)));
const DAYS_AHEAD = Math.min(7, Math.max(1, Number(process.env.BLACKROOM_CLOUD_DAYS_AHEAD || 2)));
const CLIPS_PER_SET = Math.min(4, Math.max(1, Number(process.env.BLACKROOM_CLOUD_CLIPS_PER_SET || 3)));
const MAX_SETS_PER_RUN = Number(process.env.BLACKROOM_CLOUD_MAX_SETS_PER_RUN || 6);
const DRY = process.env.BLACKROOM_CLOUD_DRY_RUN === "true";
export const COOLDOWN_DAYS = 15;
export const SET_SPACING_DAYS = 16;
export const SLOT_HOURS = ["12:00", "15:00", "18:00", "21:00", "10:00"];
// Mostly 20-60 s; one 15 s learning test per set.
export const DURATIONS = [30, 60, 15, 45];

export interface ClipRecord { postId: string; publishAt: string; day: string; duration: number; offset: number }
export interface SetRecord { name: string; dj: string; processedAt: string; clips: ClipRecord[]; trashedAt?: string }
export interface CloudState { sets: Record<string, SetRecord>; failures: Record<string, number> }

const dayMs = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

/** DJs that already have a clip within ±15 days of `day`. */
export function djsOnCooldown(state: CloudState, day: string): Set<string> {
  const t = Date.parse(`${day}T12:00:00Z`);
  const out = new Set<string>();
  for (const s of Object.values(state.sets)) for (const c of s.clips) {
    if (Math.abs(Date.parse(`${c.day}T12:00:00Z`) - t) < COOLDOWN_DAYS * dayMs) out.add(s.dj.toLowerCase());
  }
  return out;
}
export const clipsOnDay = (state: CloudState, day: string) => Object.values(state.sets).reduce((n, s) => n + s.clips.filter((c) => c.day === day).length, 0);

/** Days a new set's clips would land on, or null if the DJ would repeat inside the cooldown. */
export function planSetDays(state: CloudState, dj: string, firstDay: string, count = CLIPS_PER_SET): string[] | null {
  const days = Array.from({ length: count }, (_, i) => addDays(firstDay, i * SET_SPACING_DAYS));
  return days.every((d) => !djsOnCooldown(state, d).has(dj.toLowerCase())) ? days : null;
}

/** Strongest distinct energy rises (drops), at least `gap` s apart, leaving room for the clip. */
export function pickDrops(samples: BlackRoomEnergySample[], total: number, count: number, maxDur = 60, gap = 180): number[] {
  const rises: Array<{ t: number; rise: number }> = [];
  for (let i = 4; i < samples.length; i++) {
    const before = (samples[i - 4].rmsDb + samples[i - 3].rmsDb + samples[i - 2].rmsDb) / 3;
    rises.push({ t: samples[i].timeSeconds, rise: samples[i].rmsDb - before });
  }
  rises.sort((a, b) => b.rise - a.rise);
  const picks: number[] = [];
  for (const r of rises) {
    if (r.t < 60 || r.t > total - maxDur - 5) continue; // skip intros and the very end
    if (picks.every((p) => Math.abs(p - r.t) >= gap)) picks.push(r.t);
    if (picks.length >= count) break;
  }
  return picks.map((t) => Math.max(0, Math.round((t - 2) * 10) / 10)); // start 2 s before the drop
}

async function api(p: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${p} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}
const json = async (p: string, init?: RequestInit) => (await api(p, init)).json();
const saveState = (s: CloudState) => DRY ? Promise.resolve() : api(`/social-hub-agent/state/${AGENT}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });

async function energy(file: string): Promise<BlackRoomEnergySample[]> {
  const { stdout, stderr } = await run("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-vn", "-af",
    "aresample=8000,asetnsamples=n=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"],
    { maxBuffer: 256_000_000 });
  return parseBlackRoomEnergySamples(`${stdout}\n${stderr}`);
}
async function duration(file: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}

async function main() {
  if (TOKEN.length < 32) throw new Error("Falta SOCIAL_HUB_AGENT_TOKEN.");
  const state: CloudState = (await json(`/social-hub-agent/state/${AGENT}`)) || { sets: {}, failures: {} };
  state.sets ||= {}; state.failures ||= {};
  const posts: any[] = await json(`/social-hub-agent/posts?agent=${AGENT}`);
  const byId = new Map(posts.map((p) => [p.id, p]));

  // 1) Sets whose clips are all published (or cancelled) -> Drive trash.
  for (const [id, s] of Object.entries(state.sets)) {
    if (s.trashedAt || !s.clips.length) continue;
    const done = s.clips.every((c) => ["published", "cancelled"].includes(byId.get(c.postId)?.status));
    if (!done) continue;
    console.log(`Set publicado completo, a la papelera de Drive: ${s.name}`);
    if (!DRY) {
      await api(`/social-hub-agent/drive/sets/${id}/trash`, { method: "POST" });
      for (const c of s.clips) if (byId.get(c.postId)?.status === "published") await api("/social-hub-agent/media/cleanup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postId: c.postId }) }).catch(() => undefined);
      s.trashedAt = new Date().toISOString(); await saveState(state);
    }
  }

  // 2) Fill the next days.
  const accounts: any[] = await json("/social-hub-agent/accounts");
  const fb = accounts.find((a) => a.network === "facebook" && /black\s*room/i.test(a.label || ""));
  if (!fb) throw new Error("No hay cuenta de Facebook Black Room conectada en el Social Hub.");
  const sets: Array<{ id: string; name: string; size: number | null }> = await json("/social-hub-agent/drive/sets");
  const fresh = sets.filter((s) => !state.sets[s.id] && (state.failures[s.id] || 0) < 2);
  console.log(`${sets.length} sets en Drive, ${fresh.length} sin procesar. Cuenta FB: ${fb.label}`);

  let processed = 0;
  for (let i = 1; i <= DAYS_AHEAD && processed < MAX_SETS_PER_RUN; i++) {
    const day = addDays(todayEt(), i);
    while (clipsOnDay(state, day) < PER_DAY && processed < MAX_SETS_PER_RUN) {
      const pick = fresh.find((s) => !state.sets[s.id] && planSetDays(state, extractBlackRoomDj(s.name), day));
      if (!pick) { console.log(`${day}: no queda DJ disponible fuera de los 15 días; sube más sets a Drive.`); break; }
      const dj = extractBlackRoomDj(pick.name);
      const days = planSetDays(state, dj, day)!;
      processed++;
      try {
        state.sets[pick.id] = await processSet(pick, dj, days, fb, state);
        await saveState(state);
      } catch (e: any) {
        state.failures[pick.id] = (state.failures[pick.id] || 0) + 1;
        console.error(`Falló ${pick.name}: ${e?.message || e}`);
        await saveState(state);
        fresh.splice(fresh.indexOf(pick), 1);
      }
    }
  }
  console.log("Listo.");
}

async function processSet(set: { id: string; name: string }, dj: string, days: string[], fb: any, state: CloudState): Promise<SetRecord> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brset-"));
  try {
    const src = path.join(dir, "set.mp4");
    console.log(`Descargando ${set.name} (${dj})…`);
    const r = await api(`/social-hub-agent/drive/sets/${set.id}`);
    await pipeline(Readable.fromWeb(r.body as any), createWriteStream(src));
    const total = await duration(src);
    const offsets = pickDrops(await energy(src), total, days.length);
    if (!offsets.length) throw new Error("No encontré drops en el audio.");
    const clips: ClipRecord[] = [];
    for (let k = 0; k < offsets.length; k++) {
      const dur = DURATIONS[k % DURATIONS.length];
      const out = path.join(dir, `clip-${k}.mp4`);
      await run("ffmpeg", buildBlackRoomRenderArgs(src, out, { format: "vertical", durationSeconds: dur }, offsets[k], "libx264"), { maxBuffer: 64_000_000 });
      const day = days[k];
      const slot = SLOT_HOURS[clipsOnDay(state, day) % SLOT_HOURS.length];
      const publishAt = zonedToIso(`${day}T${slot}:00`, TZ);
      console.log(`  clip ${k + 1}: ${dur}s desde ${offsets[k]}s -> ${publishAt} (${(await stat(out)).size >> 20} MB)`);
      if (DRY) { clips.push({ postId: `dry-${k}`, publishAt, day, duration: dur, offset: offsets[k] }); continue; }
      const up = await json("/social-hub-agent/media", { method: "POST", headers: { "content-type": "video/mp4", "x-filename": encodeURIComponent(`${dj}-${k}.mp4`) }, body: await readFile(out) });
      const post = await json("/social-hub-agent/posts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: AGENT, brand: "blackroom", caption: `${dj} en Black Room 🔊\n#blackroom #dj #techno #housemusic`, mediaKind: "video", mediaUrls: [up.url], targets: [{ network: "facebook", accountId: fb.accountId }], publishAt }),
      });
      clips.push({ postId: post.id, publishAt, day, duration: dur, offset: offsets[k] });
    }
    return { name: set.name, dj, processedAt: new Date().toISOString(), clips };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

if (process.argv[1]?.endsWith("blackroom-cloud-clips.ts")) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
