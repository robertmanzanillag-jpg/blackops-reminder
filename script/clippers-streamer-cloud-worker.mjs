// Cloud publisher for the streamer clip pages (GitHub Actions, $0 AI, no Mac).
//
// approved candidates (pending_actions approved/executed, written by clippers-streamer-discovery.mjs)
//   -> publish-time policy gate (no-clip prohibition, takedown, known list, credit, <= 60 s, live re-check
//      of the creator's own description when the Twitch/YouTube keys are present)
//   -> download only the needed section (yt-dlp, --impersonate chrome for YouTube)
//   -> ffmpeg vertical edit (<= 60 s, hook + @handle credit burned in, bundled font)
//   -> temporary public media URL (GitHub release asset on this repo, deleted once Metricool copied it)
//   -> existing Metricool adapter (script/clippers-portfolio-metricool.mjs: allowlisted destinations,
//      identity + publish-permission check, daily cap 5, slot/caption/media duplicate check, verified receipt)
//   -> reconcile + 24-48 h analytics -> learning (hook variant + creator order) for the next run.
//
// Safety: off unless CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED=true. The kill switch
// (CLIPPERS_STREAMER_CLOUD_KILL_SWITCH=true) is read when a run starts (workflow `if` + here): it stops every
// later run. Repository variables are not visible to a run already in progress, so to stop an in-flight run
// cancel it in Actions. A Metricool write is never retried blindly (an uncertain outcome is reconciled
// read-only). Each run stops taking new clips after CLIPPERS_STREAMER_CLOUD_RUN_DEADLINE_MINUTES (default 20).
// Dry runs never write state. State: agent_council_state `clippers-streamers:<owner>` -> cloudPublish.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STREAMER_STATE_NAMESPACE, STREAMER_APPROVAL_ACTION, parseStreamerState, parseStreamerStateStrict, localWorkQueue, createTwitchClient, createYoutubeClient, createPendingActionsQueue } from './clippers-streamer-discovery.mjs';
import { resolveClipPolicy, takedownBlocks, captionHasCredit, buildCreditCaption, clipLengthAllowed, detectClipProhibition, STREAMER_CLIP_MAX_SECONDS } from '../shared/clippers-streamer-policy.mjs';
import { KNOWN_PROHIBITED_CREATORS } from '../shared/clippers-priority-creators.mjs';
import { DESTINATIONS, destinationKey, findDestination, createPortfolioMetricool, TIME_ZONE, localDay, localHour, canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';
import { downloadSource, renderVerticalClip, makeWorkDir, hookText, creditText } from './clippers-streamer-cloud-render.mjs';
import { computeLearning, chooseHookVariant, creatorBoostFor, OBSERVATION_WINDOW } from './clippers-streamer-cloud-learning.mjs';

const HOUR = 3_600_000;
const MAX_POSTS = 600;
const real = v => typeof v === 'string' && v.trim().length > 0 && !/^(replace|paste|your-|<|changeme)/i.test(v.trim());
const int = (v, d, min, max) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const sha = v => createHash('sha256').update(String(v)).digest('hex');
const iso = ms => new Date(ms).toISOString();
const code = (e, d = 'ERROR') => String(e?.message ?? d).replace(/https?:\/\/\S+/g, '[url]').replace(/[^A-Za-z0-9_:.-]+/g, '_').slice(0, 80);
export const DEFAULT_SLOTS = Object.freeze(['11:00', '13:30', '16:00', '18:30', '21:00']);
export const PRE_WRITE_ERRORS = new Set(['destination_publish_permission_missing', 'destination_identity_unverified', 'destination_not_allowlisted', 'metricool_credentials_unavailable', 'metricool_slot_duplicate_or_daily_cap', 'metricool_schedule_time_unverified']);
const UNCERTAIN = new Set(['pending_write', 'verification_pending']);
export const CLOUD_PUBLISH_SECRET_NAMES = Object.freeze(['METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID']);

/** Slots: distinct hours, America/New_York, inside 11:00-21:00, at most 5. */
export function parseSlots(raw) {
  const list = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const valid = [...new Set(list)].filter(s => /^(?:1[1-9]|20):[0-5][0-9]$|^21:00$/.test(s)).sort();
  const hours = new Set();
  const out = valid.filter(s => !hours.has(s.slice(0, 2)) && hours.add(s.slice(0, 2)));
  return out.length ? out.slice(0, 5) : [...DEFAULT_SLOTS];
}

export function cloudPublishConfig(env = process.env) {
  const keys = new Set(DESTINATIONS.map(destinationKey));
  const requested = String(env.CLIPPERS_STREAMER_CLOUD_DESTINATIONS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Default: the three TikTok streamer accounts. Facebook stays off until Robert lists it explicitly.
  const defaults = DESTINATIONS.filter(d => d.network === 'tiktok').map(destinationKey);
  const destinations = (requested.length ? requested.filter(k => keys.has(k)) : defaults).map(k => DESTINATIONS.find(d => destinationKey(d) === k));
  return {
    enabled: env.CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED === 'true',
    killSwitch: env.CLIPPERS_STREAMER_CLOUD_KILL_SWITCH === 'true',
    dryRun: env.CLIPPERS_STREAMER_CLOUD_DRY_RUN === 'true',
    clipsPerRun: int(env.CLIPPERS_STREAMER_CLOUD_CLIPS_PER_RUN, 2, 0, 5),
    dailyCap: int(env.CLIPPERS_STREAMER_CLOUD_DAILY_PER_DESTINATION, 5, 0, 5),
    slots: parseSlots(env.CLIPPERS_STREAMER_CLOUD_SLOTS || DEFAULT_SLOTS.join(',')),
    staggerMinutes: int(env.CLIPPERS_STREAMER_CLOUD_STAGGER_MINUTES, 7, 0, 14),
    leadMinutes: int(env.CLIPPERS_STREAMER_CLOUD_LEAD_MINUTES, 30, 15, 240),
    clipSeconds: int(env.CLIPPERS_STREAMER_CLIP_SECONDS, 45, 10, STREAMER_CLIP_MAX_SECONDS),
    maxSourceAgeHours: int(env.CLIPPERS_STREAMER_CLOUD_MAX_SOURCE_AGE_HOURS, 72, 6, 168),
    // YouTube answers GitHub-hosted runner IPs with "Sign in to confirm you're not a bot" (even with
    // --impersonate chrome), so the cloud lane takes Twitch clips only unless YouTube is listed explicitly.
    platforms: cloudPlatforms(env),
    maxAttempts: 3,
    runDeadlineMs: int(env.CLIPPERS_STREAMER_CLOUD_RUN_DEADLINE_MINUTES, 20, 5, 25) * 60_000,
    destinations,
    missing: CLOUD_PUBLISH_SECRET_NAMES.filter(n => !real(env[n])),
    unknownDestinations: requested.filter(k => !keys.has(k)).map(k => k.replace(/[^0-9a-z:_-]/gi, '').slice(0, 60)),
  };
}

export function cloudPlatforms(env = process.env) {
  const list = String(env.CLIPPERS_STREAMER_CLOUD_PLATFORMS || 'twitch').split(',').map(s => s.trim().toLowerCase()).filter(p => ['twitch', 'youtube'].includes(p));
  return list.length ? [...new Set(list)] : ['twitch'];
}

// ---------- Time / slots ----------
/** "YYYY-MM-DD" + "HH:MM" wall clock in `tz` -> UTC ISO (null when the wall time does not exist). */
export function wallClockToIso(day, hhmm, tz = TIME_ZONE) {
  const target = Date.parse(`${day}T${hhmm}:00Z`);
  if (!Number.isFinite(target)) return null;
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const wall = ms => Date.parse(f.format(new Date(ms)).replace(' ', 'T') + 'Z');
  let ms = target;
  for (let i = 0; i < 3; i++) ms += target - wall(ms);
  return wall(ms) === target ? new Date(ms).toISOString() : null;
}

function nextDay(day) { return new Date(Date.parse(`${day}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10); }

/**
 * Earliest free slot for one destination from our own ledger (Metricool's preflight remains the authority
 * across every lane). Destinations are staggered by `index * staggerMinutes` inside the same hour.
 */
export function nextSlot({ now, config, destination, index = 0, posts = [], skip = new Set() }) {
  const key = destinationKey(destination);
  const mine = posts.filter(p => canonicalDestinationKey(p.destinationKey) === key && !['deferred', 'blocked', 'not_found'].includes(p.status));
  let day = localDay(new Date(now));
  for (let d = 0; d < 2; d++, day = nextDay(day)) {
    const sameDay = mine.filter(p => localDay(new Date(p.scheduledAt)) === day);
    if (sameDay.length >= config.dailyCap) continue;
    const hours = new Set(sameDay.map(p => localHour(p.scheduledAt)));
    for (const slot of config.slots) {
      const [h, m] = slot.split(':').map(Number);
      const minute = Math.min(59, m + index * config.staggerMinutes);
      const at = wallClockToIso(day, `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
      if (!at || Date.parse(at) < now + config.leadMinutes * 60_000) continue;
      if (hours.has(localHour(at)) || skip.has(at)) continue;
      return at;
    }
  }
  return null;
}

// ---------- State ----------
export function emptyCloudPublish() { return { version: 1, clips: {}, posts: [], learning: null, lastRun: null }; }
export function cloudPublishOf(state) {
  const c = state?.cloudPublish;
  return c?.version === 1 && Array.isArray(c.posts) && c.clips && typeof c.clips === 'object' ? c : emptyCloudPublish();
}

/**
 * The public staging asset may be deleted only when no write for the clip is uncertain and every scheduled
 * post either references a Metricool-hosted copy (confirmed media URL differs from the staging URL; the
 * adapter SHA-verifies static.metricool.com copies) or its slot is at least 2 h in the past.
 */
export function stagedAssetRemovable(ledger, candidateId, assetUrl, now) {
  const posts = ledger.posts.filter(p => p.candidateId === candidateId);
  if (posts.some(p => UNCERTAIN.has(p.status))) return false;
  return posts.filter(p => p.status === 'scheduled').every(p =>
    (p.confirmedMediaUrl && p.confirmedMediaUrl !== assetUrl) || now >= Date.parse(p.scheduledAt) + 2 * HOUR);
}

/** Publish-time policy gate on the freshest state. Returns a reason code or null (allowed). */
export function publishGate(state, candidate) {
  if (!candidate) return 'candidate_missing';
  const creator = state.creators?.[candidate.creatorKey];
  if (candidate.clipPolicy?.status === 'prohibited') return 'clip_prohibited';
  if (creator?.policy?.status === 'prohibited') return 'creator_prohibited';
  if (!creator?.policy || creator.policy.source === 'not_checked') return 'creator_policy_not_checked';
  if (takedownBlocks(state.takedowns, { creatorKey: candidate.creatorKey, creatorGroupId: creator.creatorGroupId, candidateId: candidate.id })) return 'takedown';
  const known = resolveClipPolicy({ creatorKey: candidate.creatorKey, creatorGroupId: creator.creatorGroupId ?? null, candidateId: candidate.id, takedowns: state.takedowns ?? [], knownProhibited: KNOWN_PROHIBITED_CREATORS });
  if (known.status === 'prohibited') return 'known_prohibited';
  if (candidate.platform === 'twitch' && !clipLengthAllowed(candidate.durationSec)) return 'clip_too_long';
  if (candidate.kind === 'live') return 'live_stream_not_clipped';
  if (!captionHasCredit(candidate.caption, candidate.handle, candidate.sourceUrl)) return 'caption_missing_credit';
  return null;
}

/** Fresh read of the creator's own description (Twitch user / YouTube channel). */
export async function liveDescriptionCheck({ candidate, env, fetch: fetchImpl }) {
  const [platform, id] = String(candidate.creatorKey).split(':');
  try {
    if (platform === 'twitch' && real(env.TWITCH_CLIENT_ID) && real(env.TWITCH_CLIENT_SECRET)) {
      const client = createTwitchClient({ fetch: fetchImpl, clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET });
      const [user] = await client.helix('users', [['id', id]]);
      if (!user) return { checked: false, reason: 'creator_not_found' };
      return { checked: true, ...detectClipProhibition(user.description ?? '') };
    }
    if (platform === 'youtube' && real(env.YOUTUBE_API_KEY)) {
      const client = createYoutubeClient({ fetch: fetchImpl, apiKey: env.YOUTUBE_API_KEY, unitBudget: 2 });
      const [channel] = await client.api('channels', { part: 'snippet', id, maxResults: 1 });
      if (!channel) return { checked: false, reason: 'creator_not_found' };
      return { checked: true, ...detectClipProhibition(channel.snippet?.description ?? '') };
    }
  } catch (e) { return { checked: false, reason: code(e, 'LIVE_CHECK_FAILED') }; }
  return { checked: false, reason: 'live_check_keys_missing' };
}

export function postItem({ candidate, destination, scheduledAt, caption, mediaUrl, mediaSha256, hookVariant }) {
  const key = destinationKey(destination);
  return { id: `stc-${sha(`${candidate.id}|${key}`).slice(0, 24)}`, candidateId: candidate.id, creatorKey: candidate.creatorKey, destination: { ...destination }, destinationKey: key,
    scheduledAt, caption, mediaUrl, mediaSha256, hookVariant, language: 'es', thirdPartyCommercial: false, status: 'pending_write', metricoolId: null, attemptedAt: null, observation: null };
}

export function clipCaption(candidate, variant) {
  const title = variant === 'teaser' ? hookText({ variant, title: candidate.title, handle: candidate.handle }) + (candidate.title ? ` · ${candidate.title}` : '') : candidate.title;
  return buildCreditCaption({ handle: candidate.handle, platform: candidate.platform, sourceUrl: candidate.sourceUrl, title });
}

// ---------- Temporary public media: GitHub release asset ----------
export function createGithubReleaseStager({ token, repo, fetch: fetchImpl = globalThis.fetch, tag = 'clippers-media-staging' }) {
  if (!real(token) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) throw new Error('GITHUB_STAGING_UNAVAILABLE');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'clippers-streamer-cloud' };
  let release = null;
  async function api(url, init = {}, ok = [200, 201, 204]) {
    const response = await fetchImpl(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    if (!ok.includes(response.status)) throw Object.assign(new Error(`GITHUB_HTTP_${response.status}`), { status: response.status });
    return response.status === 204 ? null : response.json();
  }
  async function ensure() {
    if (release) return release;
    try { release = await api(`https://api.github.com/repos/${repo}/releases/tags/${tag}`); }
    catch (e) {
      if (e.status !== 404) throw e;
      release = await api(`https://api.github.com/repos/${repo}/releases`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag_name: tag, name: 'Clippers media staging (temporary)', prerelease: true, make_latest: 'false',
          body: 'Temporary staging so Metricool can copy rendered streamer clips. Assets are deleted after Metricool confirms the copy (and swept after 48 h). Not a product release.' }) });
    }
    return release;
  }
  return {
    async upload(file, name) {
      const r = await ensure();
      const bytes = await readFile(file);
      const asset = await api(`https://uploads.github.com/repos/${repo}/releases/${r.id}/assets?name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) }, body: bytes }, [201]);
      return { id: asset.id, url: asset.browser_download_url, createdAt: asset.created_at ?? new Date().toISOString() };
    },
    async remove(assetId) {
      try { await api(`https://api.github.com/repos/${repo}/releases/assets/${Number(assetId)}`, { method: 'DELETE' }, [204]); return true; }
      catch (e) { if (e.status === 404) return true; throw e; }
    },
    async sweep({ now = Date.now(), olderThanMs = 48 * HOUR, keep = new Set() } = {}) {
      const r = await ensure();
      const assets = await api(`https://api.github.com/repos/${repo}/releases/${r.id}/assets?per_page=100`);
      let removed = 0;
      for (const a of assets ?? []) {
        if (!String(a.name).startsWith('stc-') || keep.has(a.id) || now - Date.parse(a.created_at) < olderThanMs) continue;
        await this.remove(a.id); removed++;
      }
      return removed;
    },
  };
}

export async function verifyPublicMedia(url, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    return [200, 206].includes(r.status);
  } catch { return false; }
}

// ---------- pending_actions (existing table) ----------
export function createApprovalLedger(query) {
  const base = createPendingActionsQueue(query);
  return {
    statuses: (owner, ids) => base.statuses(owner, ids),
    async markExecuted(owner, id, result) {
      await query(`UPDATE pending_actions SET status='executed', executed_at=COALESCE(executed_at, CURRENT_TIMESTAMP), execution_result=$4::jsonb, updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND action_type=$2 AND id=$3 AND status IN ('approved','executed')`, [owner, STREAMER_APPROVAL_ACTION, id, JSON.stringify(result)]);
    },
  };
}

// ---------- One run ----------
/**
 * deps: { store, approvals, metricool (createPortfolioMetricool-like), stager, fetch, download, render, outputDir }
 */
export async function runCloudPublisher({ env = process.env, now = Date.now(), owner, store, approvals, metricool, stager, fetch: fetchImpl = globalThis.fetch,
  download = downloadSource, render = renderVerticalClip, makeDir = makeWorkDir, outputDir = null, minIntervalMs = 0, clock = () => Date.now() }) {
  const config = cloudPublishConfig(env);
  const ns = STREAMER_STATE_NAMESPACE(owner);
  const report = { at: iso(now), status: 'completed', heldReasons: [], errors: [], counts: { rendered: 0, scheduled: 0, verificationPending: 0, deferred: 0, blocked: 0, failed: 0, reconciled: 0, observed: 0, assetsRemoved: 0 }, dryRun: config.dryRun, paidSpendUsd: 0, aiSpendUsd: 0 };
  if (!config.enabled) return { report: { ...report, status: 'disabled' }, skipped: true };
  if (config.killSwitch) return { report: { ...report, status: 'kill_switch' }, skipped: true };
  report.heldReasons.push(...config.unknownDestinations.map(k => `destination_not_allowlisted:${k}`));
  if (!config.dryRun && config.missing.length) {
    report.status = 'held_missing_secrets';
    report.heldReasons.push(...config.missing.map(n => `missing_secret:${n}`));
  }
  if (!config.dryRun && !stager) report.heldReasons.push('media_staging_unavailable');

  const initial = parseStreamerState(await store.read(ns));
  const ledger0 = cloudPublishOf(initial);
  if (minIntervalMs > 0 && ledger0.lastRun?.at && now - Date.parse(ledger0.lastRun.at) >= 0 && now - Date.parse(ledger0.lastRun.at) < minIntervalMs) {
    return { report: { ...report, status: 'skipped_recent_run' }, skipped: true };
  }
  const canWrite = !config.dryRun && !config.missing.length && !!metricool && !!stager;

  // Durable ledger helper: every change goes through the same owner lock as discovery.
  const update = async change => {
    let out;
    if (config.dryRun) { // Dry runs never change state: approvals stay queued, lastRun untouched.
      const s = parseStreamerStateStrict(await store.read(ns));
      if (!s) throw new Error('STREAMER_STATE_INVALID');
      s.cloudPublish = cloudPublishOf(s);
      return change(s, s.cloudPublish);
    }
    await store.transact(ns, async raw => {
      const s = parseStreamerStateStrict(raw);
      if (!s) throw new Error('STREAMER_STATE_INVALID');
      s.cloudPublish = cloudPublishOf(s);
      out = await change(s, s.cloudPublish);
      s.cloudPublish.posts = s.cloudPublish.posts.slice(-MAX_POSTS);
      return JSON.stringify(s);
    });
    return out;
  };

  // 1) Reconcile uncertain writes (read-only; never resend) and collect 24-48 h analytics.
  if (metricool && !config.missing.length) {
    for (const post of ledger0.posts) {
      try {
        if (['verification_pending', 'pending_write'].includes(post.status)) {
          const found = await metricool.confirmSchedule(post.destination, post);
          const status = found ? 'scheduled' : now - Date.parse(post.scheduledAt) > 2 * HOUR ? 'not_found' : post.status;
          if (status !== post.status) {
            await update((s, c) => {
              const p = c.posts.find(x => x.id === post.id);
              if (p) { p.status = status; if (found) { p.metricoolId = found.id; p.confirmedMediaUrl = found.mediaUrl ?? null; } }
              const clip = c.clips[post.candidateId];
              if (found && clip?.status === 'verification_pending') clip.status = 'published';
            });
            report.counts.reconciled++;
          }
        } else if (post.status === 'scheduled' && post.metricoolId && !post.observation) {
          const age = (now - Date.parse(post.scheduledAt)) / HOUR;
          if (age < OBSERVATION_WINDOW.minHours || age >= OBSERVATION_WINDOW.maxHours) continue;
          const publication = await metricool.publication(post.destination, post, new Date(now));
          if (!publication) continue;
          const metrics = await metricool.metrics(post.destination, publication, new Date(now));
          if (!metrics) continue;
          const ageHours = (Date.parse(metrics.observedAt) - Date.parse(publication.publishedAt)) / HOUR;
          await update((s, c) => { const p = c.posts.find(x => x.id === post.id); if (p) p.observation = { views: metrics.views, completionRate: metrics.completionRate, observedAt: metrics.observedAt, publishedAt: publication.publishedAt, platformPostId: publication.id, ageHours: Math.round(ageHours * 100) / 100 }; });
          report.counts.observed++;
        }
      } catch (e) { report.heldReasons.push(`metricool_read:${code(e)}`); }
    }
  }
  const learning = await update((s, c) => (c.learning = computeLearning(c.posts, { now })));

  // 2) Remove staged media once no write for that clip is still uncertain; sweep leftovers after 48 h.
  if (stager && !config.dryRun) {
    try {
      const current = cloudPublishOf(parseStreamerState(await store.read(ns)));
      const keep = new Set();
      for (const [candidateId, clip] of Object.entries(current.clips)) {
        if (!clip.mediaAsset?.id) continue;
        if (!stagedAssetRemovable(current, candidateId, clip.mediaAsset.url, now)) { keep.add(clip.mediaAsset.id); continue; }
        await stager.remove(clip.mediaAsset.id);
        report.counts.assetsRemoved++;
        await update((s, c) => { if (c.clips[candidateId]) c.clips[candidateId].mediaAsset = null; });
      }
      report.counts.assetsRemoved += await stager.sweep({ now, keep });
    } catch (e) { report.heldReasons.push(`media_sweep:${code(e)}`); }
  }

  // 3) New clips.
  const state = parseStreamerState(await store.read(ns));
  const ledger = cloudPublishOf(state);
  const candidatesById = new Map(state.candidates.map(c => [c.id, c]));
  const queue = localWorkQueue(state).map(w => candidatesById.get(w.candidateId)).filter(Boolean)
    .filter(c => { const clip = ledger.clips[c.id]; return !clip || (['failed', 'deferred'].includes(clip.status) && (clip.attempts ?? 0) < config.maxAttempts); })
    .filter(c => now - Date.parse(c.publishedAt) <= config.maxSourceAgeHours * HOUR)
    .filter(c => config.platforms.includes(c.platform))
    .sort((a, b) => (b.score + creatorBoostFor(learning, b.creatorKey)) - (a.score + creatorBoostFor(learning, a.creatorKey)));
  const ids = queue.map(c => c.approval?.pendingActionId).filter(Boolean);
  const live = approvals && ids.length ? await approvals.statuses(owner, ids) : new Map();
  let processed = 0, tried = 0, botBlocked = false;
  const runStartedAt = clock();
  report.counts.platforms = config.platforms.join(',');
  const canStart = report.status !== 'held_missing_secrets' && (config.dryRun || canWrite);
  for (const candidate of canStart ? queue : []) {
    if (processed >= config.clipsPerRun || tried >= config.clipsPerRun + 3) break;
    if (botBlocked && candidate.platform === 'youtube') continue; // one bot check is enough for this run
    if (clock() - runStartedAt > config.runDeadlineMs) { report.heldReasons.push('run_deadline_reached'); break; }
    const setClip = (patch) => update((s, c) => { c.clips[candidate.id] = { ...(c.clips[candidate.id] ?? { attempts: 0 }), ...patch, updatedAt: iso(clock()) }; });
    // Approval gate (live): only approved/executed rows publish. AUTO_PUBLISH rows are inserted as approved.
    const approval = live.get(candidate.approval?.pendingActionId);
    if (!['approved', 'executed'].includes(approval)) {
      if (['rejected', 'failed'].includes(approval)) { await setClip({ status: 'blocked', reason: `approval_${approval}` }); report.counts.blocked++; }
      continue;
    }
    const gate = publishGate(state, candidate);
    if (gate) { await setClip({ status: 'blocked', reason: gate }); report.counts.blocked++; continue; }
    const fresh = await liveDescriptionCheck({ candidate, env, fetch: fetchImpl });
    if (fresh.checked && fresh.prohibited) { await setClip({ status: 'blocked', reason: 'live_description_prohibits_clipping', evidence: fresh.excerpt }); report.counts.blocked++; continue; }
    if (!fresh.checked && fresh.reason !== 'live_check_keys_missing') {
      // Keys are configured but the re-check failed: fail closed (retry on a later run, bounded by attempts).
      await setClip({ status: 'deferred', reason: `live_check_unavailable:${fresh.reason}`, attempts: (ledger.clips[candidate.id]?.attempts ?? 0) + 1 });
      report.counts.deferred++; continue;
    }
    // Destination slots from our own (fresh) ledger; Metricool preflight stays authoritative across lanes.
    const posts = cloudPublishOf(parseStreamerState(await store.read(ns))).posts;
    const plan = config.destinations.map((d, index) => ({ destination: d, index, scheduledAt: nextSlot({ now, config, destination: d, index, posts }) }))
      .filter(p => p.scheduledAt && !posts.some(x => x.candidateId === candidate.id && canonicalDestinationKey(x.destinationKey) === destinationKey(p.destination) && x.status !== 'deferred'));
    if (!plan.length) { report.heldReasons.push('no_free_slots'); break; }
    tried++;
    const { variant: hookVariant, mode: hookMode } = chooseHookVariant(learning, candidate.id);
    const caption = clipCaption(candidate, hookVariant);
    if (!captionHasCredit(caption, candidate.handle, candidate.sourceUrl)) { await setClip({ status: 'blocked', reason: 'caption_missing_credit' }); report.counts.blocked++; continue; }
    let workDir = null, rendered = null, asset = null;
    try {
      workDir = await makeDir();
      const source = await download({ candidate, workDir, targetSec: config.clipSeconds, env });
      if (clock() - runStartedAt > config.runDeadlineMs) { // Too late to render + publish safely in this run.
        report.heldReasons.push('run_deadline_reached');
        await setClip({ status: 'deferred', reason: 'run_deadline_reached' });
        break;
      }
      rendered = await render({ sourceFile: source.file, workDir, duration: Math.min(source.cut.duration, config.clipSeconds, STREAMER_CLIP_MAX_SECONDS),
        hook: hookText({ variant: hookVariant, title: candidate.title, handle: candidate.handle }), credit: creditText(candidate) });
      report.counts.rendered++;
      processed++;
      const base = { attempts: (ledger.clips[candidate.id]?.attempts ?? 0) + 1, hookVariant, hookMode, cut: source.cut, renderSha256: rendered.sha256, durationSec: rendered.durationSec, reason: null };
      if (config.dryRun) {
        if (outputDir) { await mkdir(outputDir, { recursive: true }); await copyFile(rendered.file, path.join(outputDir, `${candidate.id.replace(/[^A-Za-z0-9_-]/g, '_')}.mp4`)); }
        await setClip({ ...base, status: 'dry_run_rendered' });
        continue;
      }
      asset = await stager.upload(rendered.file, `stc-${rendered.sha256.slice(0, 24)}.mp4`);
      await setClip({ ...base, status: 'staged', mediaAsset: asset });
      if (!await verifyPublicMedia(asset.url, fetchImpl)) throw new Error('PUBLIC_MEDIA_UNREACHABLE');
      let scheduled = 0, pending = 0, gateBlocked = null;
      for (const p of plan) {
        if (gateBlocked) break;
        let at = p.scheduledAt;
        const tried = new Set();
        for (let attempt = 0; attempt < 3 && at; attempt++) {
          const item = postItem({ candidate, destination: p.destination, scheduledAt: at, caption, mediaUrl: asset.url, mediaSha256: rendered.sha256, hookVariant });
          // Fresh gate + durable "pending_write" BEFORE the write (a crash can never authorise a resend).
          const blocked = await update((s, c) => {
            const reason = publishGate(s, s.candidates.find(x => x.id === candidate.id) ?? candidate);
            if (reason) return reason;
            const prior = c.posts.find(x => x.id === item.id);
            if (prior && prior.status !== 'deferred') return 'already_attempted';
            c.posts = c.posts.filter(x => x.id !== item.id);
            c.posts.push({ ...item, attemptedAt: iso(clock()) });
            return null;
          });
          if (blocked) { report.heldReasons.push(`publish_gate:${blocked}`); if (blocked !== 'already_attempted') { report.counts.blocked++; gateBlocked = blocked; } at = null; break; }
          let status, metricoolId = null, reason = null, confirmedMediaUrl = null;
          try {
            await metricool.preflight(p.destination, item);
          } catch (e) {
            reason = code(e);
            await update((s, c) => { c.posts = c.posts.filter(x => x.id !== item.id); });
            if (reason === 'metricool_slot_duplicate_or_daily_cap') {
              tried.add(at);
              const freshPosts = cloudPublishOf(parseStreamerState(await store.read(ns))).posts;
              at = nextSlot({ now: clock(), config, destination: p.destination, index: p.index, posts: freshPosts, skip: tried });
              continue;
            }
            report.counts.deferred++; report.heldReasons.push(`destination_held:${p.destination.brandId}:${reason}`); at = null; break;
          }
          try {
            const found = await metricool.schedule(p.destination, item);
            status = found ? 'scheduled' : 'verification_pending'; metricoolId = found?.id ?? null; confirmedMediaUrl = found?.mediaUrl ?? null;
          } catch (e) {
            reason = code(e);
            status = PRE_WRITE_ERRORS.has(reason) ? 'deferred' : 'verification_pending';
          }
          await update((s, c) => { const x = c.posts.find(y => y.id === item.id); if (x) Object.assign(x, { status, metricoolId, reason, confirmedMediaUrl }); });
          if (status === 'scheduled') { scheduled++; report.counts.scheduled++; }
          else if (status === 'verification_pending') { pending++; report.counts.verificationPending++; }
          else report.counts.deferred++;
          break;
        }
      }
      // Metricool copied the media once the receipt is verified: remove the public staging asset now.
      let mediaAsset = asset;
      if (stagedAssetRemovable(cloudPublishOf(parseStreamerState(await store.read(ns))), candidate.id, asset.url, clock())) {
        await stager.remove(asset.id).then(() => { mediaAsset = null; report.counts.assetsRemoved++; }).catch(e => report.errors.push(`asset_remove:${code(e)}`));
      }
      await setClip({ ...base, status: scheduled ? 'published' : pending ? 'verification_pending' : gateBlocked ? 'blocked' : 'deferred', reason: gateBlocked, mediaAsset });
      if (scheduled && candidate.approval?.pendingActionId && approvals?.markExecuted) {
        const posts = cloudPublishOf(parseStreamerState(await store.read(ns))).posts.filter(x => x.candidateId === candidate.id).map(x => ({ destination: x.destinationKey, scheduledAt: x.scheduledAt, status: x.status, metricoolId: x.metricoolId }));
        await approvals.markExecuted(owner, candidate.approval.pendingActionId, { handoff: 'clippers_streamer_cloud', posts, externalCalls: posts.length }).catch(e => report.errors.push(`approval_update:${code(e)}`));
      }
    } catch (e) {
      report.counts.failed++;
      if (code(e) === 'SOURCE_BOT_CHECK') botBlocked = true;
      report.errors.push(`clip:${code(e)}`);
      // Public-log-safe diagnostics: platform, step, impersonation, exit code, scrubbed last stderr line.
      report.diagnostics = [...(report.diagnostics ?? []), { platform: candidate.platform, kind: candidate.kind ?? null, error: code(e),
        attempts: e?.diagnostics?.attempts ?? (e?.detail ? [{ step: 'render', error: code(e), exitCode: e.exitCode ?? null, detail: e.detail }] : []) }].slice(-10);
      // Never delete while a write for this clip may have been accepted (fail closed if the ledger is unreadable).
      const raw = asset ? await store.read(ns).catch(() => undefined) : undefined;
      if (asset && raw !== undefined && stagedAssetRemovable(cloudPublishOf(parseStreamerState(raw)), candidate.id, asset.url, clock())) {
        await stager.remove(asset.id).then(() => { asset = null; }).catch(() => undefined);
      }
      await setClip({ status: 'failed', attempts: (ledger.clips[candidate.id]?.attempts ?? 0) + 1, reason: code(e), mediaAsset: asset ?? null });
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  if (report.errors.length && report.status === 'completed') report.status = report.counts.scheduled || report.counts.rendered ? 'partial' : 'failed';
  report.heldReasons = [...new Set(report.heldReasons)].slice(0, 50);
  report.counts.queue = queue.length;
  report.learning = { samples: learning.samples, hookPreference: learning.hookPreference };
  await update((s, c) => { c.lastRun = report; });
  return { report, skipped: false };
}

async function main() {
  const args = process.argv.slice(2);
  const config = cloudPublishConfig(process.env);
  if (!config.enabled) { console.log('::notice::Streamer cloud publisher is off (set CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED=true).'); return; }
  if (config.killSwitch) { console.log('::notice::Streamer cloud publisher kill switch is on (CLIPPERS_STREAMER_CLOUD_KILL_SWITCH=true).'); return; }
  if (!process.env.DATABASE_URL?.trim() || !process.env.DEFAULT_USER_ID?.trim()) { console.log('::notice::Streamer cloud publisher skipped: OFFICE_DATABASE_URL / OFFICE_OWNER_ID not available.'); return; }
  const { getCouncilStore, createCouncilPool } = await import('../server/agent-council-store.ts');
  const store = await getCouncilStore();
  const pool = await createCouncilPool('streamers-cloud');
  const query = async (sql, values) => { const client = await pool.connect(); try { return await client.query(sql, values); } finally { client.release(); } };
  const owner = process.env.DEFAULT_USER_ID.trim();
  let metricool = null, stager = null;
  if (!config.missing.length) {
    try { metricool = createPortfolioMetricool({ token: process.env.METRICOOL_USER_TOKEN.trim(), userId: process.env.METRICOOL_USER_ID.trim() }); }
    catch (e) { console.log(`::warning::Metricool adapter unavailable: ${code(e)}`); }
  } else console.log(`::notice::Missing secrets for publishing: ${config.missing.join(', ')}.`);
  if (!config.dryRun) {
    try { stager = createGithubReleaseStager({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY }); }
    catch (e) { console.log(`::warning::Media staging unavailable: ${code(e)}`); }
  }
  const minIntervalMs = args.includes('--respect-interval') ? int(process.env.CLIPPERS_STREAMER_CLOUD_MIN_INTERVAL_MINUTES, 180, 30, 1440) * 60_000 : 0;
  const outIndex = args.indexOf('--dry-run-output');
  const { report, skipped } = await runCloudPublisher({ env: process.env, owner, store, approvals: createApprovalLedger(query), metricool, stager,
    outputDir: outIndex >= 0 ? path.resolve(args[outIndex + 1] ?? 'clippers-dry-run') : null, minIntervalMs });
  // Counts and codes only (public repository logs): no URLs, captions or tokens.
  console.log(JSON.stringify({ status: report.status, skipped, heldReasons: report.heldReasons, errors: report.errors, counts: report.counts, dryRun: report.dryRun, learning: report.learning ?? null }));
  for (const d of report.diagnostics ?? []) console.log(`clip diagnostics: ${JSON.stringify(d)}`);
  // Handled per-clip failures (e.g. a YouTube bot block) are recorded for the office, not a red job.
  if (report.errors.length) console.log(`::warning::Streamer cloud publisher: ${report.errors.length} handled error(s): ${report.errors.slice(0, 5).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch(error => { console.error(`clippers streamer cloud publisher failed: ${code(error)}`); process.exit(1); });
}
