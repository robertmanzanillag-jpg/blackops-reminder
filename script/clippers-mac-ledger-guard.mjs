// Mac clipping lanes -> the same cross-account media ledger as the cloud streamer publisher.
//
// Every Mac script that schedules to Metricool (clippers-metricool-autopilot.mjs, clippers-daily-learning.mjs,
// clippers-weekly-scheduler.mjs) calls reserve() right before its write. reserve() refuses (fail closed) unless:
//   1. the per-account routing/language rules of shared/clippers-account-lanes.mjs hold for the destination
//      (language of the account, creator allowlist lane, stream already owned by another account);
//   2. the Metricool cross-brand calendar check (read-only GETs) finds no same caption/media on another account
//      -- mandatory, always runs;
//   3. no entry of the shared ledger gives the same source segment / file hash / source to another account.
//      Shared ledger = Postgres (agent_council_state, the cloud streamer namespace, same row and lock as the cloud
//      worker) when OFFICE_DATABASE_URL + OFFICE_OWNER_ID are available on the Mac, plus a local mirror file
//      (<workspace>/reports/clippers-media-ledger.json). Without the database the calendar check + local mirror
//      are the guard, and unmirrored entries are pushed to Postgres on the next run that has it.
// Any error -> { ok: false }: the caller must not schedule. No Metricool writes happen here.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STREAMER_STATE_NAMESPACE, parseStreamerStateStrict, emptyStreamerState } from './clippers-streamer-discovery.mjs';
import { canonicalDestinationKey, destinationKey } from './clippers-portfolio-metricool.mjs';
import { cloudPublishOf, mediaEntriesOf } from './clippers-streamer-cloud-worker.mjs';
import { loadClipperSelectedEnv } from './clippers-selected-env.mjs';
import { laneForDestinationKey, mediaConflict, routeCandidate } from '../shared/clippers-account-lanes.mjs';

export const MAC_LEDGER_FILE = path.join('reports', 'clippers-media-ledger.json');
const MAX_LOCAL = 5000;
const code = e => String(e?.message ?? e ?? 'error').replace(/[^A-Za-z0-9_:.-]+/g, '_').slice(0, 80);

/** Canonical source identity, in the same key space the cloud worker uses for candidate ids / VOD segments. */
export function sourceIdentity(sourceUrl) {
  let url;
  try { url = new URL(String(sourceUrl ?? '').trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const id = v => String(v ?? '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 100);
  if (host === 'youtu.be' && parts[0]) return `youtube:${id(parts[0])}`;
  if (host === 'youtube.com') {
    if (url.searchParams.get('v')) return `youtube:${id(url.searchParams.get('v'))}`;
    if (['shorts', 'live', 'embed'].includes(parts[0]) && parts[1]) return `youtube:${id(parts[1])}`;
  }
  if (host === 'clips.twitch.tv' && parts[0]) return `twitch-clip:${id(parts[0])}`;
  if (host === 'twitch.tv') {
    if (parts[0] === 'videos' && parts[1]) return `twitch-vod:${id(parts[1])}`;
    if (parts[1] === 'clip' && parts[2]) return `twitch-clip:${id(parts[2])}`;
  }
  url.hash = ''; for (const k of [...url.searchParams.keys()]) if (/^utm_|^si$|^feature$/.test(k)) url.searchParams.delete(k);
  return `url:${host}${url.pathname.replace(/\/+$/, '')}${url.search}`.slice(0, 200);
}

/** Source segment of a Mac item. Unknown cut offset -> start null (overlaps every cut of that source). */
export function macSegment(item) {
  const key = sourceIdentity(item?.sourceUrl);
  if (!key) return null;
  const raw = item?.sourceStartSec ?? item?.cutStartSec ?? item?.cut?.start;
  const vod = Number(item?.vodOffsetSec);
  const start = Number.isFinite(Number(raw)) && raw !== null && raw !== '' ? Math.round(Number(raw) + (Number.isFinite(vod) ? vod : 0)) : null;
  return { key, start };
}

const ES = new Set(['que', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una', 'no', 'se', 'lo', 'por', 'con', 'para', 'pero', 'esto', 'esta', 'qué', 'cómo', 'tú', 'él', 'muy', 'nadie', 'fuente']);
const EN = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'it', 'you', 'this', 'that', 'what', 'with', 'for', 'was', 'he', 'she', 'his', 'did', 'not', 'wait', 'would', 'have', 'source', 'on']);
/** Confident caption language ('es' | 'en') or null. Hashtags, mentions and URLs are ignored. */
export function captionLanguage(text) {
  const words = String(text ?? '').toLowerCase().replace(/https?:\/\/\S+|[#@]\S+/g, ' ').normalize('NFC').split(/[^\p{L}]+/u).filter(Boolean);
  let es = 0, en = 0;
  for (const w of words) { if (ES.has(w)) es++; if (EN.has(w)) en++; }
  if (es >= 3 && es >= 2 * en) return 'es';
  if (en >= 3 && en >= 2 * es) return 'en';
  return null;
}

/**
 * Per-account routing/language rules for a Mac item -> null (ok) or a refusal reason.
 * Applies only to lane accounts (shared/clippers-account-lanes.mjs); other destinations only get the dedupe.
 */
export function macRoutingRefusal({ destination, item, entries }) {
  const key = canonicalDestinationKey(destinationKey(destination));
  const lane = laneForDestinationKey(key);
  const segment = macSegment(item);
  // Follow-up clips of a stream stay on the account that first used it.
  const owner = segment ? (entries ?? []).find(e => e?.lane && (e.streamKey === segment.key || e.segment?.key === segment.key) && canonicalDestinationKey(e.destinationKey) !== key) : null;
  if (owner && owner.lane !== lane?.id) return 'stream_owned_by_other_account';
  if (!lane) return null;
  const declared = typeof item?.language === 'string' ? item.language.toLowerCase().slice(0, 2) : null;
  const language = declared || captionLanguage(item?.caption);
  if (language && language !== lane.language) return `language_mismatch:${language}_on_${lane.language}`;
  const handle = item?.creatorHandle ?? item?.creator?.handle ?? null;
  if (handle || item?.creatorGroupId) {
    const route = routeCandidate({ handle, title: '', language: language ?? lane.language }, { creator: item?.creatorGroupId ? { creatorGroupId: item.creatorGroupId } : null });
    if (route.reason === 'creator_allowlist' && route.lane !== lane.id) return `creator_routed_to_other_account:${route.lane}`;
  }
  return null;
}

/** Ledger entry for a Mac delivery (same shape the cloud worker's mediaEntriesOf() reads). */
export function macEntry({ destination, item, at }) {
  const key = canonicalDestinationKey(destinationKey(destination));
  const segment = macSegment(item);
  const itemId = String(item?.id ?? item?.itemId ?? createHash('sha256').update(`${key}|${item?.mediaSha256 ?? ''}|${item?.sourceUrl ?? ''}`).digest('hex').slice(0, 24)).slice(0, 100);
  return { candidateId: `mac:${itemId}`, streamKey: segment?.key ?? null, segment, mediaSha256: item?.mediaSha256 || item?.sha256 || null,
    destinationKey: key, lane: laneForDestinationKey(key)?.id ?? null, at, origin: 'mac' };
}

/** Guard env: process env first, then the allowlisted keys of the Mac config root's env files (OFFICE_DATABASE_URL, OFFICE_OWNER_ID). */
export function macLedgerEnv(env = process.env) {
  const out = { ...env };
  if (env.CLIPPERS_CONFIG_ROOT && !(out.OFFICE_DATABASE_URL && out.OFFICE_OWNER_ID)) { try { loadClipperSelectedEnv(env.CLIPPERS_CONFIG_ROOT, out); } catch { /* guard falls back to calendar + local */ } }
  return out;
}

/** Same row, same advisory lock and owner_key hashing as server/agent-council-store.ts (plain pg; Mac runs without tsx). */
export function createPgCouncilStore(connectionString, { Pool } = {}) {
  let pool;
  const key = owner => createHash('sha256').update(owner).digest('hex');
  const connect = async () => {
    if (!pool) { const Ctor = Pool ?? (await import('pg')).default.Pool; pool = new Ctor({ connectionString, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 10000, statement_timeout: 30000, application_name: 'blackops-council:clippers-mac' }); }
    return pool.connect();
  };
  return {
    async read(owner) {
      const client = await connect();
      try { const r = await client.query('SELECT state FROM agent_council_state WHERE owner_key = $1', [key(owner)]); return r.rows[0] ? JSON.stringify(r.rows[0].state) : null; }
      finally { client.release(); }
    },
    async transact(owner, update) {
      const client = await connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key(owner)]);
        const r = await client.query('SELECT state FROM agent_council_state WHERE owner_key = $1 FOR UPDATE', [key(owner)]);
        const raw = await update(r.rows[0] ? JSON.stringify(r.rows[0].state) : null);
        JSON.parse(raw);
        await client.query('INSERT INTO agent_council_state(owner_key, state) VALUES ($1, $2::jsonb) ON CONFLICT(owner_key) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP', [key(owner), raw]);
        await client.query('COMMIT');
        return raw;
      } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; }
      finally { client.release(); }
    },
    async close() { await pool?.end?.().catch(() => undefined); },
  };
}

/**
 * deps: env (OFFICE_DATABASE_URL, OFFICE_OWNER_ID, CLIPPERS_LEDGER_REQUIRE_DATABASE), workspaceRoot,
 * metricool (createPortfolioMetricool-like; only crossAccountPreflight is used), store (optional, tests), now.
 */
export function createMacLedgerGuard({ env = process.env, workspaceRoot, metricool, store = null, now = () => new Date() } = {}) {
  const file = path.join(path.resolve(workspaceRoot ?? 'clippers_workspace'), MAC_LEDGER_FILE);
  const dbUrl = String(env.OFFICE_DATABASE_URL ?? '').trim();
  const owner = String(env.OFFICE_OWNER_ID ?? '').trim();
  const db = store ?? (dbUrl && owner ? createPgCouncilStore(dbUrl) : null);
  const requireDb = env.CLIPPERS_LEDGER_REQUIRE_DATABASE === 'true';
  const ns = owner ? STREAMER_STATE_NAMESPACE(owner) : null;

  async function readLocal() {
    let raw;
    try { raw = await readFile(file, 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return { version: 1, entries: [] }; throw e; }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('local_ledger_invalid');
    return parsed;
  }
  async function writeLocal(value) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, entries: value.entries.slice(-MAX_LOCAL) }, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }
  const strip = ({ mirrored, ...e }) => e;
  // Only other accounts count here: same-account repeats are each Mac script's own dedupe/cap responsibility.
  const conflictOf = (entries, entry) => mediaConflict(entries.filter(e => canonicalDestinationKey(e?.destinationKey) !== entry.destinationKey),
    { segment: entry.segment, mediaSha256: entry.mediaSha256, destinationKey: entry.destinationKey, candidateId: entry.candidateId });

  /**
   * Check + claim one Mac delivery. Call immediately before the Metricool write.
   * -> { ok: true, evidence } | { ok: false, reason }
   */
  async function reserve(destination, item) {
    const evidence = { ledger: db ? 'postgres' : 'local_plus_calendar', calendarCheck: null, at: now().toISOString() };
    try {
      if (!destination || !item) return { ok: false, reason: 'ledger_item_invalid' };
      if (!item.mediaSha256 && !item.sha256 && !macSegment(item)) return { ok: false, reason: 'ledger_identity_missing' };
      if (requireDb && !db) return { ok: false, reason: 'ledger_database_required_unavailable' };
      if (!metricool?.crossAccountPreflight) return { ok: false, reason: 'calendar_check_unavailable' };
      const local = await readLocal();
      const entry = macEntry({ destination, item, at: evidence.at });
      const firstLocal = local.entries.map(strip);
      const refusal = macRoutingRefusal({ destination, item, entries: firstLocal }) ?? conflictOf(firstLocal, entry)?.reason;
      if (refusal) return { ok: false, reason: refusal, evidence };
      // Mandatory cross-brand calendar check (read-only).
      try { evidence.calendarCheck = (await metricool.crossAccountPreflight(destination, item)) ?? { ok: true }; }
      catch (e) { return { ok: false, reason: code(e) === 'cross_account_duplicate' ? 'cross_account_duplicate' : `calendar_check_failed:${code(e)}`, evidence }; }
      let mirrored = false;
      if (db) {
        let blocked = null;
        await db.transact(ns, async raw => {
          const s = raw ? parseStreamerStateStrict(raw) : emptyStreamerState();
          if (!s) throw new Error('STREAMER_STATE_INVALID');
          s.cloudPublish = cloudPublishOf(s);
          const shared = [...mediaEntriesOf(s.cloudPublish), ...local.entries.map(strip)];
          blocked = macRoutingRefusal({ destination, item, entries: shared }) ?? conflictOf(shared, entry)?.reason ?? null;
          if (blocked) return raw ?? JSON.stringify(s);
          const known = new Set((s.cloudPublish.mediaLedger ?? []).map(e => `${e.candidateId}|${e.destinationKey}`));
          const pending = local.entries.filter(e => !e.mirrored && !known.has(`${e.candidateId}|${e.destinationKey}`)).map(strip);
          s.cloudPublish.mediaLedger = [...(Array.isArray(s.cloudPublish.mediaLedger) ? s.cloudPublish.mediaLedger : []).filter(e => !(e.candidateId === entry.candidateId && e.destinationKey === entry.destinationKey)), ...pending, entry].slice(-5000);
          return JSON.stringify(s);
        });
        if (blocked) return { ok: false, reason: blocked, evidence };
        mirrored = true;
        for (const e of local.entries) e.mirrored = true;
      }
      local.entries = [...local.entries.filter(e => !(e.candidateId === entry.candidateId && e.destinationKey === entry.destinationKey)), { ...entry, mirrored }];
      await writeLocal(local);
      return { ok: true, evidence: { ...evidence, mirrored, entry: { streamKey: entry.streamKey, lane: entry.lane, destinationKey: entry.destinationKey } } };
    } catch (e) {
      return { ok: false, reason: `ledger_check_unavailable:${code(e)}`, evidence };
    }
  }
  return { reserve, file, mode: db ? 'postgres' : 'local_plus_calendar', close: async () => { if (!store) await db?.close?.(); } };
}
