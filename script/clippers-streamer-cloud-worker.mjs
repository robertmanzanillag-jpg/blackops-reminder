// Cloud publisher for the streamer clip pages (GitHub Actions, $0 AI, no Mac).
//
// approved candidates (pending_actions approved/executed, written by clippers-streamer-discovery.mjs)
//   -> positive owner-reviewed audio/video rights for the exact source, destination and publication window
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
import { sourceRightsGate } from '../shared/clippers-source-authorization.mjs';
import { KNOWN_PROHIBITED_CREATORS } from '../shared/clippers-priority-creators.mjs';
import { DESTINATIONS, destinationKey, findDestination, createPortfolioMetricool, TIME_ZONE, localDay, localHour, canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';
export { facebookOwnerActionReason, providerHealthFromRows } from './clippers-portfolio-metricool.mjs';
import { downloadSource, renderVerticalClip, makeWorkDir, hookText, creditText, detectSpeechLanguage, whisperConfigured } from './clippers-streamer-cloud-render.mjs';
import { computeLearning, chooseHookVariant, creatorBoostFor, OBSERVATION_WINDOW, computeGrowth, growthWeight, killedHooks, killedHours, promotedHours } from './clippers-streamer-cloud-learning.mjs';
import { emptyCloudPublish, cloudPublishOf, mediaEntriesOf, isProtectedMediaClaim, retainLegacyUncertainReservation, legacyUncertainAttemptKey, upsertMediaLedgerClaim } from '../shared/clippers-media-ledger.mjs';
import { laneById, routeCandidate, sourceSegment, streamKeyOf, mediaConflict, mediaEntry, streamOwnerLane, laneHook, laneCaption, laneSchedule, parseBestTimes, autoPublishAllowed, parseAutopublishOverride, CLIP_SECONDS, resolveCandidateLanguage, LANGUAGE_DETECT_MIN_CONFIDENCE, normalizeLanguage, SERVED_LANGUAGES } from '../shared/clippers-account-lanes.mjs';

const HOUR = 3_600_000;
const MAX_POSTS = 600;
const real = v => typeof v === 'string' && v.trim().length > 0 && !/^(replace|paste|your-|<|changeme)/i.test(v.trim());
const int = (v, d, min, max) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const sha = v => createHash('sha256').update(String(v)).digest('hex');
const iso = ms => new Date(ms).toISOString();
const code = (e, d = 'ERROR') => String(e?.message ?? d).replace(/https?:\/\/\S+/g, '[url]').replace(/[^A-Za-z0-9_:.-]+/g, '_').slice(0, 80);
export const DEFAULT_SLOTS = Object.freeze(['11:00', '13:30', '16:00', '18:30', '21:00']);
export const PRE_WRITE_ERRORS = new Set(['destination_publish_permission_missing', 'destination_identity_unverified', 'destination_not_allowlisted', 'metricool_credentials_unavailable', 'metricool_slot_duplicate_or_daily_cap', 'metricool_schedule_time_unverified', 'cloud_owned_brand_mac_write_refused', 'tiktok_title_missing']);
export const TRANSIENT_LANE_MISS = /^(?:lane_)?(?:no_free_slots|destination_held|lane_destination_not_connected)(?::|$)/;
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
    clipsPerRun: int(env.CLIPPERS_STREAMER_CLOUD_CLIPS_PER_RUN, 4, 0, 8),
    // Account lanes (one clip -> one account, niche routing, per-account slots/caps, growth loop). On by default.
    // 'false' never restores the old fan-out: each clip still goes to ONE account (the first listed) as a draft.
    lanesEnabled: env.CLIPPERS_STREAMER_LANES_ENABLED !== 'false',
    // Per-account auto-publish once the weekly median passes 1k; set 'false' to keep every lane on drafts.
    laneAutoPublish: env.CLIPPERS_STREAMER_LANE_AUTOPUBLISH !== 'false',
    // Owner override: these destinations auto-publish without the median gate (kill switch: set it to "").
    autopublishOverride: parseAutopublishOverride(env.CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE),
    growthIntervalMs: int(env.CLIPPERS_STREAMER_GROWTH_INTERVAL_HOURS, 6, 1, 48) * HOUR,
    dailyCap: int(env.CLIPPERS_STREAMER_CLOUD_DAILY_PER_DESTINATION, 5, 0, 5),
    slots: parseSlots(env.CLIPPERS_STREAMER_CLOUD_SLOTS || DEFAULT_SLOTS.join(',')),
    staggerMinutes: int(env.CLIPPERS_STREAMER_CLOUD_STAGGER_MINUTES, 7, 0, 14),
    leadMinutes: int(env.CLIPPERS_STREAMER_CLOUD_LEAD_MINUTES, 30, 15, 240),
    clipSeconds: env.CLIPPERS_STREAMER_LANES_ENABLED !== 'false'
      ? int(env.CLIPPERS_STREAMER_CLIP_SECONDS, CLIP_SECONDS.target, CLIP_SECONDS.min, CLIP_SECONDS.max)
      : int(env.CLIPPERS_STREAMER_CLIP_SECONDS, 45, 10, STREAMER_CLIP_MAX_SECONDS),
    // Unknown clip language: Twitch broadcaster_language prior, then whisper detection on the cut (>= this confidence).
    languageMinConfidence: (() => { const n = Number.parseFloat(env.CLIPPERS_STREAMER_LANGUAGE_MIN_CONFIDENCE ?? ''); return Number.isFinite(n) ? Math.min(0.99, Math.max(0.5, n)) : LANGUAGE_DETECT_MIN_CONFIDENCE; })(),
    maxSourceAgeHours: int(env.CLIPPERS_STREAMER_CLOUD_MAX_SOURCE_AGE_HOURS, 72, 6, 168),
    // YouTube answers GitHub-hosted runner IPs with "Sign in to confirm you're not a bot" (even with
    // --impersonate chrome), so the cloud lane takes Twitch clips only unless YouTube is listed explicitly.
    platforms: cloudPlatforms(env),
    maxAttempts: 3,
    runDeadlineMs: int(env.CLIPPERS_STREAMER_CLOUD_RUN_DEADLINE_MINUTES, 20, 5, 25) * 60_000,
    destinations,
    // Gradual release of Facebook copies queued while the Page was on owner-action hold.
    heldReleasePerRun: int(env.CLIPPERS_STREAMER_CLOUD_HELD_RELEASE_PER_RUN, 1, 0, 5),
    // Owner flag: ISO time at which Robert confirmed the Facebook identity check; clears older holds.
    holdResolvedAt: Number.isFinite(Date.parse(env.CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT ?? '')) ? new Date(Date.parse(env.CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT)).toISOString() : null,
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
export function nextSlot({ now, config, destination, index = 0, posts = [], skip = new Set(), skipDays = new Set() }) {
  const key = destinationKey(destination);
  const mine = posts.filter(p => canonicalDestinationKey(p.destinationKey) === key && !['deferred', 'blocked', 'not_found'].includes(p.status));
  let day = localDay(new Date(now));
  for (let d = 0; d < 2; d++, day = nextDay(day)) {
    const sameDay = mine.filter(p => localDay(new Date(p.scheduledAt)) === day);
    const quotaReservations = sameDay.filter(p => !(p.draft === true && p.status === 'scheduled' && p.metricoolId));
    if (skipDays.has(day) || quotaReservations.length >= config.dailyCap) continue;
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
export { emptyCloudPublish, cloudPublishOf } from '../shared/clippers-media-ledger.mjs';

// ---------- Per-brand per-network owner-action hold ----------
export const HOLD_OWNER_ACTION = 'held_owner_action';
export const HOLD_OWNER_NOTE = 'Facebook pide verificar identidad en la app';
export const isHeld = (ledger, destination) => ledger.holds?.[destinationKey(destination)]?.status === HOLD_OWNER_ACTION;
/**
 * Pure hold transition for one destination. health = providerHealth result; ownerResolvedAt = owner flag/endpoint.
 * Returns the next hold record (or the unchanged one) plus what happened.
 */
export function nextHold(hold, health, { now, ownerResolvedAt = null }) {
  const held = hold?.status === HOLD_OWNER_ACTION;
  if (held) {
    const resolved = [ownerResolvedAt, hold.ownerResolvedAt].filter(Boolean).find(t => Date.parse(t) > Date.parse(hold.since));
    if (resolved) return { hold: { status: 'active', clearedAt: iso(now), clearedBy: 'owner_resolved', lastReason: hold.reason }, change: 'cleared' };
    if (health?.published && Date.parse(health.published.at) > Date.parse(hold.since)) {
      return { hold: { status: 'active', clearedAt: iso(now), clearedBy: 'provider_published', lastReason: hold.reason }, change: 'cleared' };
    }
    return { hold, change: null };
  }
  const oa = health?.ownerAction;
  if (!oa) return { hold, change: null };
  // An error older than the last clear, or older than a later successful publication, is history.
  if (hold?.clearedAt && Date.parse(oa.at) <= Date.parse(hold.clearedAt)) return { hold, change: null };
  if (health.published && Date.parse(health.published.at) > Date.parse(oa.at)) return { hold, change: null };
  return { hold: { status: HOLD_OWNER_ACTION, reason: oa.reason, since: oa.at, detectedAt: iso(now), evidenceId: oa.id || null, note: HOLD_OWNER_NOTE }, change: 'held' };
}
function localDaysAround(now) { const today = localDay(new Date(now)); return [localDay(new Date(now - 24 * HOUR)), today].filter((d, i, a) => a.indexOf(d) === i); }

/**
 * The public staging asset may be deleted only when no write for the clip is uncertain and every scheduled
 * post either references a Metricool-hosted copy (confirmed media URL differs from the staging URL; the
 * adapter SHA-verifies static.metricool.com copies) or its slot is at least 2 h in the past.
 */
function heldMediaBindingMatches(q, clip) {
  return !!clip?.mediaAsset?.url && /^[a-f0-9]{64}$/.test(q.mediaSha256 ?? '') &&
    typeof q.sourceUrl === 'string' && typeof q.creatorKey === 'string' && typeof q.caption === 'string' &&
    ['title', 'teaser'].includes(q.hookVariant) && q.mediaSha256 === clip.renderSha256 &&
    q.sourceUrl === clip.sourceUrl && q.creatorKey === clip.creatorKey &&
    q.caption === clip.caption && q.hookVariant === clip.hookVariant;
}

export function stagedAssetRemovable(ledger, candidateId, assetUrl, now) {
  if((ledger.mediaLedger??[]).some(e=>isProtectedMediaClaim(e)&&(e.candidateId===candidateId||(typeof assetUrl==='string'&&assetUrl.length>0&&(e.mediaUrl===assetUrl||e.mediaAsset?.url===assetUrl)))))return false;
  const posts = ledger.posts.filter(p => p.candidateId === candidateId);
  if (posts.some(p => UNCERTAIN.has(p.status))) return false;
  const queued = (ledger.heldQueue ?? []).filter(q => q.candidateId === candidateId);
  if (queued.some(q => q.status !== 'held_rights')) return false; // permissioned queued copies still need media
  // A rights hold stops pinning media, but known scheduled posts still require a verified copy or reconciliation.
  return posts.filter(p => p.status === 'scheduled').every(p =>
    (p.confirmedMediaUrl && p.confirmedMediaUrl !== assetUrl) || now >= Date.parse(p.scheduledAt) + 2 * HOUR);
}

/** Publish-time policy gate on the freshest state. Returns a reason code or null (allowed). */
export function publishGate(state, candidate, options = {}) {
  if (!candidate) return 'candidate_missing';
  if (!candidate.sourceUrl) return 'rights_source_missing';
  const creator = state?.creators?.[candidate.creatorKey];
  const currentCandidate = state?.candidates?.find(c => c.id === candidate.id);
  if (candidate.clipPolicy?.status === 'prohibited' || currentCandidate?.clipPolicy?.status === 'prohibited') return 'clip_prohibited';
  if (creator?.policy?.status === 'prohibited') return 'creator_prohibited';
  if (!creator?.policy || creator.policy.source === 'not_checked') return 'creator_policy_not_checked';
  if (takedownBlocks(state?.takedowns, { creatorKey: candidate.creatorKey, creatorGroupId: creator.creatorGroupId, candidateId: candidate.id })) return 'takedown';
  const known = resolveClipPolicy({ creatorKey: candidate.creatorKey, creatorGroupId: creator.creatorGroupId ?? null, candidateId: candidate.id, takedowns: state?.takedowns ?? [], knownProhibited: KNOWN_PROHIBITED_CREATORS });
  if (known.status === 'prohibited') return 'known_prohibited';
  if (candidate.platform === 'twitch' && !clipLengthAllowed(candidate.durationSec)) return 'clip_too_long';
  if (candidate.kind === 'live') return 'live_stream_not_clipped';
  if (!captionHasCredit(candidate.caption, candidate.handle, candidate.sourceUrl)) return 'caption_missing_credit';
  const rights=sourceRightsGate(state,candidate,options);if(rights)return rights;
  const protectedClaims=(state?.cloudPublish?.mediaLedger??[]).filter(isProtectedMediaClaim);
  if(mediaConflict(protectedClaims,{candidateId:candidate.id,sourceId:candidate.sourceId,segment:options.segment??sourceSegment(candidate),mediaSha256:options.mediaSha256??null,destinationKey:options.destinationKey??''}))return 'legacy_uncertain_delivery_requires_reconciliation';
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

/** Twitch channel broadcaster_language (Helix channels) as a cheap language prior; null when unknown/unavailable. */
export async function broadcasterLanguage({ candidate, env, fetch: fetchImpl, client = null }) {
  const [platform, id] = String(candidate?.creatorKey ?? '').split(':');
  if (platform !== 'twitch' || !id) return null;
  return (await broadcasterLanguages({ ids: [id], env, fetch: fetchImpl, client })).get(id) ?? null;
}

/** Batched broadcaster_language lookup: one Twitch client, Helix channels with up to 100 broadcaster_id per call. */
export async function broadcasterLanguages({ ids, env, fetch: fetchImpl, client = null }) {
  const out = new Map();
  const unique = [...new Set((ids ?? []).map(String).filter(Boolean))];
  if (!unique.length) return out;
  if (!client && (!real(env.TWITCH_CLIENT_ID) || !real(env.TWITCH_CLIENT_SECRET))) return out;
  const twitch = client ?? createTwitchClient({ fetch: fetchImpl, clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET });
  for (let i = 0; i < unique.length; i += 100) {
    try {
      const rows = await twitch.helix('channels', unique.slice(i, i + 100).map(id => ['broadcaster_id', id]));
      for (const row of rows) if (row?.broadcaster_id && typeof row.broadcaster_language === 'string') out.set(String(row.broadcaster_id), row.broadcaster_language.slice(0, 8));
    } catch { /* unavailable: no prior for this batch */ }
  }
  return out;
}

export function postItem({ candidate, destination, scheduledAt, caption, mediaUrl, mediaSha256, hookVariant, lane = null }) {
  const key = destinationKey(destination);
  return { id: `stc-${sha(`${candidate.id}|${key}`).slice(0, 24)}`, candidateId: candidate.id, creatorKey: candidate.creatorKey, destination: { ...destination }, destinationKey: key,
    scheduledAt, caption, mediaUrl, mediaSha256, hookVariant, language: lane?.language ?? 'es', thirdPartyCommercial: false, status: 'pending_write', metricoolId: null, attemptedAt: null, observation: null,
    ...(lane ? { lane: lane.lane, streamKey: lane.streamKey, segment: lane.segment, draft: lane.draft, dailyLimit: lane.dailyLimit, countDrafts: true, allowDuetStitch: true } : {}) };
}

// ---------- Account lanes ----------
/** Remove the media-ledger claim of a post that was never written to Metricool. */
export function dropClaim(c, item) {
  if (Array.isArray(c.mediaLedger)) c.mediaLedger = c.mediaLedger.filter(e => isProtectedMediaClaim(e)||!(e.candidateId === item.candidateId && e.destinationKey === item.destinationKey));
}
export { mediaEntriesOf } from '../shared/clippers-media-ledger.mjs';

/** Slots + cap for one account today (weekly median, Metricool best time, killed and promoted hours). */
export function accountSchedule(c, destination, now) {
  const key = destinationKey(destination);
  const account = c?.growth?.accounts?.[key] ?? null;
  const plan = laneSchedule({ day: localDay(new Date(now)), scaled: !!account?.scaled, bestTimes: c?.bestTimes?.[key]?.rows ?? null, killedHours: killedHours(c?.growth, key, now) });
  const promoted = promotedHours(c?.growth, key, now).map(h => `${String(h).padStart(2, '0')}:00`).filter(h => !plan.slots.includes(h));
  if (promoted.length) plan.slots = [...plan.slots.slice(0, Math.max(0, plan.cap - promoted.length)), ...promoted.slice(0, plan.cap)].sort();
  return { ...plan, account };
}

/**
 * One account for one candidate, or a skip reason. Never more than one: same stream stays on its first
 * account; a source/segment already given to any account is refused.
 */
export function laneTarget({ state, ledger, candidate, config, now }) {
  const entries = mediaEntriesOf(ledger);
  const route = routeCandidate(candidate, { creator: state.creators?.[candidate.creatorKey] ?? null, streamOwner: streamOwnerLane(entries, candidate) });
  if (!route.lane) return { ok: false, reason: `lane_unrouted:${route.reason}` };
  const lane = laneById(route.lane);
  const enabled = new Set(config.destinations.map(destinationKey));
  const options = lane.destinations.map(d => findDestination(d)).filter(d => d && enabled.has(destinationKey(d)));
  if (!options.length) return { ok: false, reason: `lane_destination_not_connected:${lane.id}`, lane: lane.id };
  const segment = sourceSegment(candidate);
  const seen = mediaConflict(entries, { segment, candidateId: candidate.id, destinationKey: '' });
  if (seen) return { ok: false, reason: options.some(d => destinationKey(d) === seen.entry.destinationKey) ? 'already_posted' : 'cross_account_duplicate', lane: lane.id };
  const tries = [];
  for (const destination of options) {
    const key = destinationKey(destination);
    // Owner-action hold (Facebook identity check lane): never pick a held destination.
    if (ledger?.holds?.[key]?.status === 'held_owner_action') { tries.push('destination_held'); continue; }
    const weight = growthWeight(ledger?.growth, { destinationKey: key, creatorKey: candidate.creatorKey, streamKey: streamKeyOf(candidate) }, now);
    if (weight.killed) { tries.push('lane_creator_killed'); continue; }
    const plan = accountSchedule(ledger, destination, now);
    const scheduledAt = nextSlot({ now, config: { ...config, slots: plan.slots, dailyCap: plan.cap }, destination, index: 0, posts: ledger?.posts ?? [] });
    if (!scheduledAt) { tries.push('no_free_slots'); continue; }
    const today = (ledger?.posts ?? []).filter(p => canonicalDestinationKey(p.destinationKey) === key && localDay(new Date(p.scheduledAt)) === localDay(new Date(scheduledAt)) && !['deferred', 'blocked', 'not_found'].includes(p.status)).length;
    tries.push({ destination, key, scheduledAt, today, plan, weight });
  }
  const best = tries.filter(t => typeof t === 'object').sort((a, b) => a.today - b.today || Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  if (!best) return { ok: false, reason: `lane_${tries.includes('lane_creator_killed') ? 'creator_killed' : tries.includes('destination_held') && !tries.includes('no_free_slots') ? 'destination_held' : 'no_free_slots'}:${lane.id}`, lane: lane.id };
  // Auto-publish only from Metricool account analytics of a growth pass < 36 h old; otherwise drafts.
  const autoPublish = config.laneAutoPublish && autoPublishAllowed(best.plan.account, { evaluatedAt: ledger?.growth?.evaluatedAt ?? null, now, override: overrideApplies(config, best.destination, best.key) });
  return { ok: true, lane: lane.id, language: lane.language, destination: best.destination, destinationKey: best.key, scheduledAt: best.scheduledAt, segment, streamKey: streamKeyOf(candidate),
    draft: !autoPublish, dailyLimit: best.plan.cap, slots: best.plan.slots, slotsSource: best.plan.source, killedHooks: killedHooks(ledger?.growth, best.key, now), breakout: best.weight.breakout };
}

/** Owner override applies only to TikTok destinations listed in it (Facebook, incl. released held copies, never). */
export function overrideApplies(config, destination, key = destination ? destinationKey(destination) : null) {
  return destination?.network === 'tiktok' && !!key && !!config?.autopublishOverride?.has(key);
}

/** Selection weight of a candidate on the account it would route to (kills, breakouts, doubled creators). */
export function laneSortWeight(state, ledger, candidate, now) {
  const route = routeCandidate(candidate, { creator: state.creators?.[candidate.creatorKey] ?? null, streamOwner: streamOwnerLane(mediaEntriesOf(ledger), candidate) });
  const lane = route.lane ? laneById(route.lane) : null;
  if (!lane?.destinations.length) return 1;
  return Math.max(...lane.destinations.map(d => growthWeight(ledger?.growth, { destinationKey: destinationKey(d), creatorKey: candidate.creatorKey, streamKey: streamKeyOf(candidate) }, now).weight));
}

/** Read-only growth pass: Metricool account analytics + best-time -> computeGrowth (stored in the ledger). */
export async function refreshGrowth({ metricool, ledger, now, report, override = new Set() }) {
  const accountPosts = {}, bestTimes = { ...(ledger.bestTimes ?? {}) };
  for (const d of DESTINATIONS) {
    const key = destinationKey(d);
    try { const r = await metricool.accountAnalytics(d, new Date(now)); accountPosts[key] = Array.isArray(r?.posts) ? r.posts : []; }
    catch (e) { report.heldReasons.push(`growth_analytics:${d.brandId}:${code(e)}`); }
    if (metricool.bestTimes && (!bestTimes[key] || now - Date.parse(bestTimes[key].at) > 7 * 24 * HOUR)) {
      try { bestTimes[key] = { at: iso(now), rows: parseBestTimes(await metricool.bestTimes(d, new Date(now))).slice(0, 200) }; }
      catch (e) { report.heldReasons.push(`best_time:${d.brandId}:${code(e)}`); }
    }
  }
  return { growth: computeGrowth({ posts: ledger.posts, accountPosts, previous: ledger.growth ?? null, now, override }), bestTimes };
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
    async findAsset(name) {
      const r=await ensure(),assets=[];let complete=false;
      for(let page=1;page<=20;page++){const batch=await api(`https://api.github.com/repos/${repo}/releases/${r.id}/assets?per_page=100&page=${page}`);if(!Array.isArray(batch))throw Error('DERIVATIVE_STAGING_LIST_UNVERIFIED');assets.push(...batch);if(batch.length<100){complete=true;break;}}
      if(!complete)throw Error('DERIVATIVE_STAGING_LIST_UNVERIFIED');
      const matches=assets.filter(a=>a.name===name);if(matches.length>1)throw Error('DERIVATIVE_STAGING_LIST_UNVERIFIED');const a=matches[0];
      return a?{id:a.id,url:a.browser_download_url,createdAt:a.created_at,name:a.name}:null;
    },
    async remove(assetId) {
      try { await api(`https://api.github.com/repos/${repo}/releases/assets/${Number(assetId)}`, { method: 'DELETE' }, [204]); return true; }
      catch (e) { if (e.status === 404) return true; throw e; }
    },
    async sweep({ now = Date.now(), olderThanMs = 48 * HOUR, keep = new Set(), keepUrls = new Set() } = {}) {
      const r = await ensure();
      const assets = await api(`https://api.github.com/repos/${repo}/releases/${r.id}/assets?per_page=100`);
      let removed = 0;
      for (const a of assets ?? []) {
        if (!String(a.name).startsWith('stc-') || keep.has(a.id) || keepUrls.has(a.browser_download_url) || now - Date.parse(a.created_at) < olderThanMs) continue;
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
/** Why the work queue is what it is: every discovered candidate lands in exactly one bucket (counts only, no URLs). */
export function queueFunnel(state, ledger, config, now) {
  const dropped = {};
  const drop = r => { dropped[r] = (dropped[r] ?? 0) + 1; };
  const workIds = new Set(localWorkQueue(state).map(w => w.candidateId));
  let eligible = 0;
  for (const c of state.candidates ?? []) {
    const clip = ledger.clips?.[c.id];
    if (!config.platforms.includes(c.platform)) drop(`platform_not_served:${c.platform}`);
    else if (c.approval?.status !== 'approved') drop(`approval_${c.approval?.status ?? 'missing'}`);
    else if (!workIds.has(c.id)) drop('policy_or_takedown');
    else if (clip && !(['failed', 'deferred'].includes(clip.status) && (clip.attempts ?? 0) < config.maxAttempts))
      drop(['failed', 'deferred'].includes(clip.status) ? `attempts_exhausted:${clip.status}` : `already_${String(clip.status ?? 'done').split(':')[0]}`);
    else if (!(now - Date.parse(c.publishedAt) <= config.maxSourceAgeHours * HOUR)) drop('source_too_old');
    else if (config.lanesEnabled && !(laneSortWeight(state, ledger, c, now) > 0)) drop('lane_weight_zero');
    else eligible++;
  }
  return { candidates: (state.candidates ?? []).length, eligible, dropped };
}

/** One safe line: candidates found -> dropped per reason -> rendered -> scheduled (so a 0 is always explained). */
export function funnelSummary(report) {
  const f = report.funnel;
  if (!f) return `clippers funnel: status=${report.status} (no queue evaluated) rendered=${report.counts?.rendered ?? 0} scheduled=${report.counts?.scheduled ?? 0}`;
  const drops = Object.entries(f.dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  const held = [...new Set(report.heldReasons ?? [])].slice(0, 8).join(',') || 'none';
  return `clippers funnel: candidates=${f.candidates} -> dropped[${drops}] -> eligible=${f.eligible} -> rendered=${report.counts.rendered} -> scheduled=${report.counts.scheduled} (held: ${held}; status=${report.status})`;
}

export async function runCloudPublisher({ env = process.env, now = Date.now(), owner, store, approvals, metricool, stager, fetch: fetchImpl = globalThis.fetch,
  download = downloadSource, render = renderVerticalClip, detectLanguage = detectSpeechLanguage, makeDir = makeWorkDir, outputDir = null, minIntervalMs = 0, clock = () => Date.now(), growthOnly = false }) {
  // A growth-only pass (read-only analytics) runs even while publishing is off; the kill switch still stops it.
  const config = { ...cloudPublishConfig(env), ...(growthOnly ? { enabled: true } : {}) };
  const ns = STREAMER_STATE_NAMESPACE(owner);
  const report = { at: iso(now), status: 'completed', heldReasons: [], errors: [], counts: { rendered: 0, scheduled: 0, heldQueued: 0, heldReleased: 0, verificationPending: 0, deferred: 0, blocked: 0, failed: 0, reconciled: 0, observed: 0, assetsRemoved: 0 }, dryRun: config.dryRun, paidSpendUsd: 0, aiSpendUsd: 0 };
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
      const protectedPosts=s.cloudPublish.posts.filter(p=>p.origin==='owner_authorized_external_review'||UNCERTAIN.has(p.status));
      const ordinary=s.cloudPublish.posts.filter(p=>!protectedPosts.includes(p));
      s.cloudPublish.posts=[...ordinary.slice(-MAX_POSTS),...protectedPosts];
      return JSON.stringify(s);
    });
    return out;
  };

  // 1) Reconcile uncertain writes (read-only; never resend) and collect 24-48 h analytics.
  if (metricool && !config.missing.length) {
    for (const post of ledger0.posts) {
      if(post.origin==='owner_authorized_external_review')continue; // Manual reconciliation only for these distinct final-file receipts.
      try {
        if (['verification_pending', 'pending_write'].includes(post.status)) {
          const found = await metricool.confirmSchedule(post.destination, post);
          const status = found ? 'scheduled' : now - Date.parse(post.scheduledAt) > 2 * HOUR ? 'not_found' : post.status;
          if (status !== post.status) {
            const changed=await update((s,c)=>{
              const p=c.posts.find(x=>x.id===post.id);
              if(!p||!UNCERTAIN.has(p.status)||legacyUncertainAttemptKey(p)!==legacyUncertainAttemptKey(post))return false;
              if(status==='not_found')retainLegacyUncertainReservation(c,p,{now});
              p.status=status;if(found){p.metricoolId=found.id;p.confirmedMediaUrl=found.mediaUrl??null;}
              const clip=c.clips[post.candidateId];
              if(found&&clip?.status==='verification_pending')clip.status='published';
              return true;
            });
            if(changed)report.counts.reconciled++;
          }
        } else if (post.status === 'scheduled' && post.metricoolId && !post.observation) {
          const age = (now - Date.parse(post.scheduledAt)) / HOUR;
          if (age < OBSERVATION_WINDOW.minHours || age >= OBSERVATION_WINDOW.maxHours) continue;
          const publication = await metricool.publication(post.destination, post, new Date(now));
          if (!publication) continue;
          const metrics = await metricool.metrics(post.destination, publication, new Date(now));
          if (!metrics) continue;
          const ageHours = (Date.parse(metrics.observedAt) - Date.parse(publication.publishedAt)) / HOUR;
          await update((s, c) => { const p = c.posts.find(x => x.id === post.id); if (p) p.observation = { views: metrics.views, completionRate: metrics.completionRate, likes: metrics.likes ?? null, comments: metrics.comments ?? null, shares: metrics.shares ?? null, saves: metrics.saves ?? null, observedAt: metrics.observedAt, publishedAt: publication.publishedAt, platformPostId: publication.id, ageHours: Math.round(ageHours * 100) / 100 }; });
          report.counts.observed++;
        }
      } catch (e) { report.heldReasons.push(`metricool_read:${code(e)}`); }
    }
  }
  const learning = await update((s, c) => (c.learning = computeLearning(c.posts, { now })));

  // 1b) Owner-action holds (e.g. Facebook "Confirm your identity"): read-only provider probe, one per network.
  if (metricool?.providerHealth && !config.missing.length) {
    const watched = DESTINATIONS.filter(d => d.network === 'facebook' && (config.destinations.some(x => destinationKey(x) === destinationKey(d)) || ledger0.holds?.[destinationKey(d)]));
    for (const d of watched) {
      try {
        const health = await metricool.providerHealth(d, localDaysAround(now));
        const key = destinationKey(d);
        const change = await update((s, c) => {
          const r = nextHold(c.holds[key], health, { now, ownerResolvedAt: config.holdResolvedAt });
          if (r.change) c.holds[key] = r.hold;
          return r.change;
        });
        if (change) report.holdChanges = [...(report.holdChanges ?? []), `${key}:${change}`];
      } catch (e) { report.heldReasons.push(`metricool_read:${code(e)}`); }
    }
  }
  {
    const c = cloudPublishOf(parseStreamerState(await store.read(ns)));
    report.ownerHolds = Object.entries(c.holds).filter(([, h]) => h?.status === HOLD_OWNER_ACTION)
      .map(([destination, h]) => ({ destination, status: h.status, reason: h.reason, since: h.since, note: h.note ?? HOLD_OWNER_NOTE, queued: c.heldQueue.filter(q => q.destinationKey === destination).length }));
  }

  // 1c) Gradual release of queued copies for destinations whose hold cleared (pacing via nextSlot + preflight).
  if (canWrite) {
    const c0 = cloudPublishOf(parseStreamerState(await store.read(ns)));
    const expired = c0.heldQueue.filter(q => now - Date.parse(q.queuedAt) > config.maxSourceAgeHours * HOUR).map(q => q.id);
    if (expired.length) await update((s, c) => { c.heldQueue = c.heldQueue.filter(q => !expired.includes(q.id)); });
    let released = 0;
    for (const q of c0.heldQueue.filter(q => !expired.includes(q.id))) {
      if (released >= config.heldReleasePerRun) break;
      const destination = findDestination(q.destination);
      if (!destination || isHeld(c0, destination) || !config.destinations.some(x => destinationKey(x) === destinationKey(destination))) continue;
      const fresh = cloudPublishOf(parseStreamerState(await store.read(ns)));
      const otherDelivery = fresh.posts.some(p => p.candidateId === q.candidateId && canonicalDestinationKey(p.destinationKey) !== destinationKey(destination) && !['deferred', 'not_found', 'blocked'].includes(p.status));
      if (otherDelivery) { report.heldReasons.push('held_release:other_destination_delivery_requires_reconciliation'); continue; }
      if (fresh.clips[q.candidateId]?.status === 'held_media_review') { report.heldReasons.push('held_release_gate:rights_media_binding_unverified'); continue; }
      const mediaUrl = fresh.clips[q.candidateId]?.mediaAsset?.url;
      if (mediaUrl && !heldMediaBindingMatches(q, fresh.clips[q.candidateId])) {
        await update((s, c) => { const held = c.heldQueue.find(x => x.id === q.id); if (held) { held.status = 'held_rights'; held.rightsHoldReason = 'rights_media_binding_unverified'; }
          if (c.clips[q.candidateId]) Object.assign(c.clips[q.candidateId], { status: 'held_media_review', reason: 'rights_media_binding_unverified' }); });
        report.heldReasons.push('held_release_gate:rights_media_binding_unverified'); continue;
      }
      const drop = () => update((s, c) => { c.heldQueue = c.heldQueue.filter(x => x.id !== q.id); });
      if (!mediaUrl && q.status === 'held_rights') {
        if (fresh.clips[q.candidateId]?.status === 'held_media_review') { report.heldReasons.push('held_release_gate:rights_media_binding_unverified'); continue; }
        const sourceState = parseStreamerStateStrict(await store.read(ns));
        const source = { id: q.candidateId, creatorKey: q.creatorKey, sourceUrl: q.sourceUrl };
        const rights = sourceRightsGate(sourceState, source, { now: clock(), destinationKey: destinationKey(destination) });
        if (!rights) { await drop(); report.heldReasons.push('held_release:authorized_rerender_required'); }
        else report.heldReasons.push(`held_release_gate:${rights}`);
        continue; // a fresh render is required; never send a removed public asset
      }
      if (!mediaUrl || !await verifyPublicMedia(mediaUrl, fetchImpl)) { await drop(); report.heldReasons.push('held_release:media_unavailable'); continue; }
      // Lane copies keep the lane's per-account slots/cap; the 1k auto-publish gate is re-evaluated now.
      const plan = q.lane ? accountSchedule(fresh, destination, now) : null;
      const slotConfig = plan ? { ...config, slots: plan.slots, dailyCap: plan.cap } : config;
      const scheduledAt = nextSlot({ now, config: slotConfig, destination, index: q.index ?? 0, posts: fresh.posts });
      if (!scheduledAt) { report.heldReasons.push('held_release:no_free_slots'); break; }
      const lane = q.lane ? { ...q.lane, dailyLimit: plan.cap,
        draft: !(config.lanesEnabled && config.laneAutoPublish && autoPublishAllowed(plan.account, { evaluatedAt: fresh.growth?.evaluatedAt ?? null, now, override: overrideApplies(config, destination) })) } : null; // override: TikTok only, so Facebook releases need the real 1k gate
      const item = postItem({ candidate: { id: q.candidateId, creatorKey: q.creatorKey }, destination, scheduledAt, caption: q.caption, mediaUrl, mediaSha256: q.mediaSha256, hookVariant: q.hookVariant, lane });
      if (!lane) item.draft = true; // queued without lane fields (lanes off): owner approves it as a draft, whatever the current lane mode
      const blocked = await update((s, c) => {
        const cand = s.candidates.find(x => x.id === q.candidateId);
        const queuedSource = cand ? { ...cand, id: q.candidateId, creatorKey: q.creatorKey, sourceUrl: q.sourceUrl } : null;
        const reason = cand ? publishGate(s, queuedSource, { now: clock(), destinationKey: destinationKey(destination), scheduledAt,segment:item.segment,mediaSha256:item.mediaSha256 }) : 'candidate_missing';
        if (reason) { if (!reason.startsWith('rights_')) c.heldQueue = c.heldQueue.filter(x => x.id !== q.id); return reason; }
        const prior = c.posts.find(x => x.id === item.id);
        if (prior && prior.status !== 'deferred') { c.heldQueue = c.heldQueue.filter(x => x.id !== q.id); return 'already_attempted'; }
        if (lane) { // Same one-file-one-account check + claim as the main write path, inside this transaction.
          const others = mediaEntriesOf({ ...c, posts: c.posts.filter(x => x.id !== item.id) }).filter(e => isProtectedMediaClaim(e)||!(e.candidateId === q.candidateId && e.destinationKey === item.destinationKey));
          const conflict = mediaConflict(others, { segment: item.segment, mediaSha256: item.mediaSha256, candidateId: q.candidateId, destinationKey: item.destinationKey });
          if (conflict) { c.heldQueue = c.heldQueue.filter(x => x.id !== q.id); return conflict.reason; }
          upsertMediaLedgerClaim(c,mediaEntry({candidate:cand,segment:item.segment,mediaSha256:item.mediaSha256,destinationKey:item.destinationKey,at:iso(clock())}));
        }
        c.posts = c.posts.filter(x => x.id !== item.id);
        c.posts.push({ ...item, attemptedAt: iso(clock()), releasedFromHold: true });
        return null;
      });
      if (blocked) { report.heldReasons.push(`held_release_gate:${blocked}`); continue; }
      try {
        await metricool.preflight(destination, item);
        if (lane) {
          if (!metricool.crossAccountPreflight) throw new Error('cross_account_check_unavailable');
          await metricool.crossAccountPreflight(destination, item);
        }
      } catch (e) { // Keep it queued; a later run retries the slot (nothing was written): drop post + claim.
        await update((s, c) => { c.posts = c.posts.filter(x => x.id !== item.id); dropClaim(c, item); });
        report.heldReasons.push(`held_release_deferred:${code(e)}`); break;
      }
      let status, metricoolId = null, reason = null, confirmedMediaUrl = null;
      try {
        const current = parseStreamerStateStrict(await store.read(ns));
        const queuedCandidate = current?.candidates.find(x => x.id === q.candidateId);
        const rights = publishGate(current, queuedCandidate ? { ...queuedCandidate, id: q.candidateId, creatorKey: q.creatorKey, sourceUrl: q.sourceUrl, caption: q.caption } : null, { now: clock(), destinationKey: destinationKey(destination), scheduledAt:item.scheduledAt,segment:item.segment,mediaSha256:item.mediaSha256 });
        if (rights) { await update((s, c) => { c.posts = c.posts.filter(x => x.id !== item.id); dropClaim(c, item); }); report.heldReasons.push(`held_release_gate:${rights}`); continue; }
        const found = await metricool.schedule(destination, item); status = found ? 'scheduled' : 'verification_pending'; metricoolId = found?.id ?? null; confirmedMediaUrl = found?.mediaUrl ?? null; }
      catch (e) { reason = code(e); status = PRE_WRITE_ERRORS.has(reason) ? 'deferred' : 'verification_pending'; }
      await update((s, c) => {
        const x = c.posts.find(y => y.id === item.id); if (x) Object.assign(x, { status, metricoolId, reason, confirmedMediaUrl });
        if (status !== 'deferred') c.heldQueue = c.heldQueue.filter(y => y.id !== q.id); else dropClaim(c, item);
      });
      if (status === 'scheduled') report.counts.scheduled++; else if (status === 'verification_pending') report.counts.verificationPending++; else { report.counts.deferred++; break; }
      released++; report.counts.heldReleased++;
    }
  }

  // 2) Remove staged media once no write for that clip is still uncertain; sweep leftovers after 48 h.
  if (stager && !config.dryRun) {
    try {
      // Rights can expire while Facebook is still held. Recheck every queued source before deciding
      // which temporary public assets to retain, even when the release loop skipped that destination.
      await update((s, c) => {
        for (const q of c.heldQueue) {
          const reason = sourceRightsGate(s, { id: q.candidateId, creatorKey: q.creatorKey, sourceUrl: q.sourceUrl }, { now: clock(), destinationKey: canonicalDestinationKey(q.destinationKey) });
          if (reason) {
            q.status = 'held_rights'; q.rightsHoldReason = reason;
            const activePost = c.posts.some(p => p.candidateId === q.candidateId && !['deferred', 'not_found', 'blocked'].includes(p.status));
            const clip = c.clips[q.candidateId];
            if (!activePost && clip && clip.status !== 'held_media_review') Object.assign(clip, { status: 'deferred', reason, attempts: clip.status === HOLD_OWNER_ACTION ? (clip.rightsRetryBudget ?? clip.attempts ?? 0) : (clip.attempts ?? 0) });
          } else if (q.status === 'held_rights' && heldMediaBindingMatches(q, c.clips[q.candidateId])) {
            q.status = HOLD_OWNER_ACTION; delete q.rightsHoldReason;
            if (c.clips[q.candidateId]?.status !== 'held_media_review' && c.clips[q.candidateId]?.reason?.startsWith('rights_')) Object.assign(c.clips[q.candidateId], { status: HOLD_OWNER_ACTION, reason: null });
          }
        }
      });
      const current = cloudPublishOf(parseStreamerState(await store.read(ns)));
      const keep = new Set((current.mediaLedger??[]).filter(isProtectedMediaClaim).map(e=>e.mediaAsset?.id).filter(Boolean));
      for (const [candidateId, clip] of Object.entries(current.clips)) {
        if (!clip.mediaAsset?.id) continue;
        if (!stagedAssetRemovable(current, candidateId, clip.mediaAsset.url, now)) { keep.add(clip.mediaAsset.id); continue; }
        await stager.remove(clip.mediaAsset.id);
        report.counts.assetsRemoved++;
        await update((s, c) => { if (c.clips[candidateId]) c.clips[candidateId].mediaAsset = null; });
      }
      const keepUrls=new Set((current.mediaLedger??[]).filter(isProtectedMediaClaim).flatMap(e=>[e.mediaUrl,e.mediaAsset?.url]).filter(v=>typeof v==='string'&&v));
      report.counts.assetsRemoved += await stager.sweep({ now, keep, keepUrls });
    } catch (e) { report.heldReasons.push(`media_sweep:${code(e)}`); }
  }

  // 2b) Per-account growth loop (read-only Metricool analytics + best time), at most every growthIntervalMs.
  if (config.lanesEnabled && metricool?.accountAnalytics && !config.missing.length) {
    const cur = cloudPublishOf(parseStreamerState(await store.read(ns)));
    if (growthOnly || !cur.growth?.evaluatedAt || now - Date.parse(cur.growth.evaluatedAt) >= config.growthIntervalMs) {
      try {
        const { growth, bestTimes } = await refreshGrowth({ metricool, ledger: cur, now, report, override: config.autopublishOverride });
        await update((s, c) => { c.growth = growth; c.bestTimes = bestTimes; });
        report.growth = { accounts: growth.accounts, decisions: growth.decisions.slice(0, 20) };
      } catch (e) { report.heldReasons.push(`growth:${code(e)}`); }
    }
  }
  if (growthOnly) {
    report.heldReasons = [...new Set(report.heldReasons)].slice(0, 50);
    if (!config.dryRun) await update((s, c) => { c.lastGrowthRun = { at: report.at, heldReasons: report.heldReasons, growth: report.growth ?? null }; });
    return { report: { ...report, status: report.growth ? 'growth_updated' : 'growth_unavailable' }, skipped: false };
  }

  // 3) New clips.
  const state = parseStreamerState(await store.read(ns));
  const ledger = cloudPublishOf(state);
  const candidatesById = new Map(state.candidates.map(c => [c.id, c]));
  const funnel = queueFunnel(state, ledger, config, now);
  report.funnel = funnel;
  const queue = localWorkQueue(state).map(w => candidatesById.get(w.candidateId)).filter(Boolean)
    .filter(c => { const clip = ledger.clips[c.id]; return !clip || (['failed', 'deferred'].includes(clip.status) && (clip.attempts ?? 0) < config.maxAttempts); })
    .filter(c => now - Date.parse(c.publishedAt) <= config.maxSourceAgeHours * HOUR)
    .filter(c => config.platforms.includes(c.platform))
    .map(c => ({ c, w: config.lanesEnabled ? laneSortWeight(state, ledger, c, now) : 1 })).filter(x => x.w > 0)
    .sort((a, b) => (b.w * (b.c.score + creatorBoostFor(learning, b.c.creatorKey))) - (a.w * (a.c.score + creatorBoostFor(learning, a.c.creatorKey)))).map(x => x.c);
  const ids = queue.map(c => c.approval?.pendingActionId).filter(Boolean);
  const live = approvals && ids.length ? await approvals.statuses(owner, ids) : new Map();
  let processed = 0, tried = 0, botBlocked = false;
  // One Twitch client per run; channel languages fetched in batches only for clips whose language is unknown.
  const needsLanguage = c => config.lanesEnabled && routeCandidate(c, { creator: state.creators?.[c.creatorKey] ?? null, streamOwner: null }).reason === 'language_unknown';
  const twitchLanguageIds = queue.filter(needsLanguage).map(c => String(c.creatorKey ?? '').split(':')).filter(([p, id]) => p === 'twitch' && id).map(([, id]) => id);
  const channelLanguages = twitchLanguageIds.length ? await broadcasterLanguages({ ids: twitchLanguageIds, env, fetch: fetchImpl }) : new Map();
  const runStartedAt = clock();
  report.counts.platforms = config.platforms.join(',');
  const canStart = report.status !== 'held_missing_secrets' && (config.dryRun || canWrite);
  for (const queued of canStart ? queue : []) {
    let candidate = queued;
    if (processed >= config.clipsPerRun || tried >= config.clipsPerRun + 3) break;
    if (botBlocked && candidate.platform === 'youtube') continue; // one bot check is enough for this run
    if (clock() - runStartedAt > config.runDeadlineMs) { report.heldReasons.push('run_deadline_reached'); break; }
    const setClip = (patch) => update((s, c) => { c.clips[candidate.id] = { ...(c.clips[candidate.id] ?? { attempts: 0 }), ...patch, updatedAt: iso(clock()) }; });
    // Approval gate (live): only approved/executed rows publish. AUTO_PUBLISH rows are inserted as approved.
    const approval = live.get(candidate.approval?.pendingActionId);
    if (!['approved', 'executed'].includes(approval)) {
      if (['rejected', 'failed'].includes(approval)) { await setClip({ status: 'blocked', reason: `approval_${approval}` }); report.counts.blocked++; }
      else report.heldReasons.push(`approval_not_live:${approval ?? 'missing'}`);
      continue;
    }
    const gate = publishGate(parseStreamerStateStrict(await store.read(ns)), candidate, { now: clock() });
    if (gate) { const rightsHeld = gate.startsWith('rights_'); await setClip({ status: rightsHeld ? 'deferred' : 'blocked', reason: gate }); report.counts[rightsHeld ? 'deferred' : 'blocked']++; if (rightsHeld) report.heldReasons.push(gate); continue; }
    const fresh = await liveDescriptionCheck({ candidate, env, fetch: fetchImpl });
    if (fresh.checked && fresh.prohibited) { await setClip({ status: 'blocked', reason: 'live_description_prohibits_clipping', evidence: fresh.excerpt }); report.counts.blocked++; continue; }
    if (!fresh.checked && fresh.reason !== 'live_check_keys_missing') {
      // Keys are configured but the re-check failed: fail closed (retry on a later run, bounded by attempts).
      await setClip({ status: 'deferred', reason: `live_check_unavailable:${fresh.reason}`, attempts: (ledger.clips[candidate.id]?.attempts ?? 0) + 1 });
      report.counts.deferred++; continue;
    }
    // Destination slots from our own (fresh) ledger; Metricool preflight stays authoritative across lanes.
    const ledgerNow = cloudPublishOf(parseStreamerState(await store.read(ns)));
    const posts = ledgerNow.posts;
    if (ledgerNow.clips[candidate.id]?.reason?.startsWith('rights_') && posts.some(p => p.candidateId === candidate.id && !['deferred', 'not_found', 'blocked'].includes(p.status))) {
      report.heldReasons.push('rights_existing_delivery_requires_reconciliation'); report.counts.deferred++; continue;
    }
    // Held destinations (owner action pending) are left out of the Metricool post; their copy is queued locally.
    // Never more than one account per clip: a copy is queued only when the single picked target is held.
    let heldTargets = [];
    const plan = config.destinations.map((d, index) => ({ destination: d, index, scheduledAt: nextSlot({ now, config, destination: d, index, posts }) }))
      .filter(p => !isHeld(ledgerNow, p.destination))
      .filter(p => p.scheduledAt && !posts.some(x => x.candidateId === candidate.id && canonicalDestinationKey(x.destinationKey) === destinationKey(p.destination) && x.status !== 'deferred'));
    // Account lanes: exactly one account per clip (replaces the fan-out to every destination).
    let lanePick = null, pre = null, languageEvidence = null;
    const discardPre = async () => { if (pre?.workDir) await rm(pre.workDir, { recursive: true, force: true }).catch(() => undefined); pre = null; };
    const priorAttempts = ledger.clips[candidate.id]?.attempts ?? 0;
    const storedEvidence = ledger.clips[candidate.id]?.status === 'deferred' ? ledger.clips[candidate.id]?.languageEvidence : null;
    if (needsLanguage(candidate) && storedEvidence?.language && SERVED_LANGUAGES.includes(normalizeLanguage(storedEvidence.language))) {
      // Retry of a transient lane miss: reuse the stored language decision (no re-download, no re-detection).
      languageEvidence = { ...storedEvidence };
      report.counts.language_reused = (report.counts.language_reused ?? 0) + 1;
      candidate = { ...candidate, language: normalizeLanguage(storedEvidence.language), languageSource: storedEvidence.source ?? 'ledger', languageConfidence: storedEvidence.confidence ?? null };
    } else if (needsLanguage(candidate)) {
      // Clip/VOD language missing: channel broadcaster_language prior, plus whisper on the cut when configured
      // (run even with a known channel language so bilingual channels are caught; a confident disagreement holds).
      const [platform, channelId] = String(candidate.creatorKey ?? '').split(':');
      const channelLanguage = platform === 'twitch' ? channelLanguages.get(channelId) ?? null : null;
      const prior = resolveCandidateLanguage({ broadcasterLanguage: channelLanguage, minConfidence: config.languageMinConfidence });
      let resolved = prior;
      if (whisperConfigured(env)) {
        try {
          const languageDownloadRights = sourceRightsGate(parseStreamerStateStrict(await store.read(ns)), candidate, { now: clock() });
          if (languageDownloadRights) { report.heldReasons.push(languageDownloadRights); report.counts.deferred++; await setClip({ status: 'deferred', reason: languageDownloadRights }); continue; }
          const dir = await makeDir();
          pre = { workDir: dir, source: null };
          pre.source = await download({ candidate, workDir: dir, targetSec: config.clipSeconds, env });
        } catch (e) {
          await discardPre();
          tried++; // counts toward the clipsPerRun + 3 cap
          report.counts.failed++; report.errors.push(`clip:${code(e)}`);
          if (code(e) === 'SOURCE_BOT_CHECK') botBlocked = true;
          await setClip({ status: 'failed', attempts: priorAttempts + 1, reason: code(e) });
          continue;
        }
        if (clock() - runStartedAt > config.runDeadlineMs) { await discardPre(); report.heldReasons.push('run_deadline_reached'); await setClip({ status: 'deferred', reason: 'run_deadline_reached' }); break; }
        const detection = await detectLanguage({ sourceFile: pre.source.file, workDir: pre.workDir, env, maxSec: Math.min(30, pre.source.cut?.duration ?? 30) });
        const heard = resolveCandidateLanguage({ detection, minConfidence: config.languageMinConfidence });
        languageEvidence = { source: 'whisper', status: detection.status, detected: detection.language ?? null, confidence: detection.confidence ?? null, error: detection.error ?? null, threshold: config.languageMinConfidence,
          ...(prior.language ? { channelLanguage: prior.language } : {}) };
        if (prior.language && heard.language && heard.language !== prior.language) {
          resolved = { language: null, reason: 'language_conflict' };
          languageEvidence = { ...languageEvidence, conflict: { channel: prior.language, detected: heard.language, confidence: heard.confidence } };
        } else if (prior.language) {
          languageEvidence = { ...languageEvidence, source: 'broadcaster_language' };
        } else resolved = heard;
      } else if (prior.language) languageEvidence = { source: prior.source, detected: prior.language, confidence: null };
      else { resolved = { language: null, reason: 'language_detect_whisper_not_configured' }; languageEvidence = { source: 'none', status: 'whisper_not_configured', detected: null, confidence: null }; }
      if (!resolved.language) {
        await discardPre();
        report.heldReasons.push(`lane_unrouted:${resolved.reason}`); report.counts.laneSkipped = (report.counts.laneSkipped ?? 0) + 1;
        if (['language_low_confidence', 'language_conflict'].includes(resolved.reason)) {
          // Kept held (the same audio gives the same answer); evidence stays in the ledger.
          report.counts.languageHeld = (report.counts.languageHeld ?? 0) + 1;
          await setClip({ status: 'held_language', reason: resolved.reason, languageEvidence });
        } else {
          // Not configured / unknown: retried later, bounded by maxAttempts. Detection errors count as failed.
          const attempts = priorAttempts + 1;
          if (resolved.reason === 'language_detect_whisper_not_configured' && attempts >= config.maxAttempts) {
            // No channel language and no whisper after every attempt: final hold with evidence.
            report.counts.languageHeld = (report.counts.languageHeld ?? 0) + 1;
            await setClip({ status: 'held_language', reason: 'whisper_not_configured', languageEvidence, attempts });
          } else {
            const status = resolved.reason === 'language_detect_detection_failed' ? 'failed' : 'deferred';
            report.counts[status === 'failed' ? 'failed' : 'deferred']++;
            await setClip({ status, reason: resolved.reason, languageEvidence, attempts });
          }
        }
        continue;
      }
      languageEvidence = { ...languageEvidence, language: resolved.language };
      if (!SERVED_LANGUAGES.includes(normalizeLanguage(resolved.language))) {
        await discardPre();
        report.heldReasons.push(`lane_unrouted:language_not_served:${resolved.language}`); report.counts.laneSkipped = (report.counts.laneSkipped ?? 0) + 1;
        // Whisper-heard unserved language stays held with evidence; a channel language we do not serve is final.
        if (resolved.source === 'whisper') { report.counts.languageHeld = (report.counts.languageHeld ?? 0) + 1; await setClip({ status: 'held_language', reason: `language_not_served:${resolved.language}`, languageEvidence }); }
        else await setClip({ status: 'language_not_served', reason: `language_not_served:${resolved.language}`, languageEvidence });
        continue;
      }
      report.counts[`language_${resolved.source}`] = (report.counts[`language_${resolved.source}`] ?? 0) + 1;
      candidate = { ...candidate, language: resolved.language, languageSource: resolved.source, languageConfidence: resolved.confidence };
    }
    if (config.lanesEnabled) {
      const freshLedger = cloudPublishOf(parseStreamerState(await store.read(ns)));
      lanePick = laneTarget({ state, ledger: freshLedger, candidate, config, now });
      if (!lanePick.ok && String(lanePick.reason).startsWith('lane_destination_held:')) {
        // Every destination of this lane is on owner-action hold: pick as if unheld, render, queue that one copy.
        const heldPick = laneTarget({ state, ledger: { ...freshLedger, holds: {} }, candidate, config, now });
        if (heldPick.ok && isHeld(freshLedger, heldPick.destination)) { lanePick = heldPick; heldTargets = [{ destination: heldPick.destination, index: 0, lane: heldPick }]; }
      }
      if (!lanePick.ok) {
        await discardPre();
        // Evidence is only written together with a status. Transient misses are deferred (bounded by attempts,
        // and counted as tried); permanent ones (already_posted, cross_account_duplicate, creator_killed, ...) are final.
        if (languageEvidence) {
          const r = String(lanePick.reason);
          if (/language_not_served:/.test(r)) await setClip({ status: 'language_not_served', reason: r, languageEvidence });
          else if (TRANSIENT_LANE_MISS.test(r)) { tried++; report.counts.deferred++; await setClip({ status: 'deferred', reason: r, languageEvidence, attempts: priorAttempts + 1 }); }
          else await setClip({ status: 'lane_final', reason: r, languageEvidence });
        }
        report.heldReasons.push(lanePick.reason); report.counts.laneSkipped = (report.counts.laneSkipped ?? 0) + 1; continue; }
      plan.splice(0, plan.length, ...(heldTargets.length ? [] : [{ destination: lanePick.destination, index: 0, scheduledAt: lanePick.scheduledAt }]));
      report.counts[`lane_${lanePick.lane}`] = (report.counts[`lane_${lanePick.lane}`] ?? 0) + 1;
    } else if (plan.length > 1) {
      // Lanes off: still one account per clip (never the old fan-out); posts are forced to drafts below.
      plan.splice(1);
    } else if (!plan.length) {
      const first = config.destinations.findIndex(d => isHeld(ledgerNow, d) && !posts.some(x => x.candidateId === candidate.id && canonicalDestinationKey(x.destinationKey) === destinationKey(d) && x.status !== 'deferred'));
      if (first >= 0 && config.destinations.every(d => isHeld(ledgerNow, d))) heldTargets = [{ destination: config.destinations[first], index: first, lane: null }];
    }
    if (!plan.length && !heldTargets.length) { await discardPre(); report.heldReasons.push('no_free_slots'); break; }
    tried++;
    let { variant: hookVariant, mode: hookMode } = chooseHookVariant(learning, candidate.id);
    if (lanePick?.killedHooks?.includes(hookVariant)) { hookVariant = hookVariant === 'title' ? 'teaser' : 'title'; hookMode = 'killed_arm_swap'; }
    const creatorName = state.creators?.[candidate.creatorKey]?.displayName ?? candidate.handle;
    const caption = lanePick
      ? laneCaption({ lane: lanePick.lane, title: candidate.title, name: creatorName, handle: candidate.handle, platform: candidate.platform, sourceUrl: candidate.sourceUrl })
      : clipCaption(candidate, hookVariant);
    if (!captionHasCredit(caption, candidate.handle, candidate.sourceUrl)) { await discardPre(); await setClip({ status: 'blocked', reason: 'caption_missing_credit' }); report.counts.blocked++; continue; }
    let workDir = null, rendered = null, asset = null;
    try {
      workDir = pre?.workDir ?? await makeDir();
      const beforeDownloadRights = sourceRightsGate(parseStreamerStateStrict(await store.read(ns)), candidate, { now: clock() });
      if (beforeDownloadRights) { report.heldReasons.push(beforeDownloadRights); report.counts.deferred++; await setClip({ status: 'deferred', reason: beforeDownloadRights }); continue; }
      const source = pre?.source ?? await download({ candidate, workDir, targetSec: config.clipSeconds, env });
      pre = null; // owned by workDir now (removed in finally)
      if (clock() - runStartedAt > config.runDeadlineMs) { // Too late to render + publish safely in this run.
        report.heldReasons.push('run_deadline_reached');
        await setClip({ status: 'deferred', reason: 'run_deadline_reached' });
        break;
      }
      const beforeRenderState = parseStreamerStateStrict(await store.read(ns));
      const beforeRenderRights = sourceRightsGate(beforeRenderState, candidate, { now: clock() });
      if (beforeRenderRights) { report.heldReasons.push(beforeRenderRights); report.counts.deferred++; await setClip({ status: 'deferred', reason: beforeRenderRights }); continue; }
      rendered = await render({ sourceFile: source.file, workDir, duration: Math.min(source.cut.duration, config.clipSeconds, STREAMER_CLIP_MAX_SECONDS),
        hook: lanePick ? laneHook({ variant: hookVariant, title: candidate.title, name: creatorName, language: lanePick.language }) : hookText({ variant: hookVariant, title: candidate.title, handle: candidate.handle }),
        credit: creditText(candidate), peakFirst: !!lanePick, env, language: lanePick?.language ?? 'en' });
      // Caption evidence: word_by_word | no_speech | transcription_failed (rendered without word captions) | whisper_not_configured.
      report.captions = { ...(report.captions ?? {}), [rendered.captions ?? 'none']: ((report.captions ?? {})[rendered.captions ?? 'none'] ?? 0) + 1 };
      report.counts.rendered++;
      processed++;
      const base = { attempts: (ledger.clips[candidate.id]?.attempts ?? 0) + 1, rightsRetryBudget: priorAttempts, sourceUrl: candidate.sourceUrl, creatorKey: candidate.creatorKey, caption, hookVariant, hookMode, cut: source.cut, renderSha256: rendered.sha256, durationSec: rendered.durationSec, reason: null,
        captions: rendered.captions ?? null, captionsError: rendered.captionsError ?? null, captionLanguage: rendered.captionLanguage ?? null, languageEvidence };
      if (config.dryRun) {
        if (outputDir) { await mkdir(outputDir, { recursive: true }); await copyFile(rendered.file, path.join(outputDir, `${candidate.id.replace(/[^A-Za-z0-9_-]/g, '_')}.mp4`)); }
        await setClip({ ...base, status: 'dry_run_rendered' });
        continue;
      }
      // Temporary release media is public too: it needs explicit staging rights and a permitted target.
      const stageTarget = plan[0] ?? heldTargets[0];
      const stageState = parseStreamerStateStrict(await store.read(ns));
      const stageRights = sourceRightsGate(stageState, candidate, { now: clock(), destinationKey: destinationKey(stageTarget.destination), scheduledAt: stageTarget.scheduledAt ?? null });
      if (stageRights) { report.heldReasons.push(stageRights); report.counts.deferred++; await setClip({ ...base, attempts: priorAttempts, status: 'deferred', reason: stageRights }); continue; }
      asset = await stager.upload(rendered.file, `stc-${rendered.sha256.slice(0, 24)}.mp4`);
      await setClip({ ...base, status: 'staged', mediaAsset: asset });
      // A fresh render cannot revive an old queue binding on a different account or with another hash.
      await update((s, c) => { c.heldQueue = c.heldQueue.filter(q => q.candidateId !== candidate.id || q.status !== 'held_rights'); });
      if (!await verifyPublicMedia(asset.url, fetchImpl)) throw new Error('PUBLIC_MEDIA_UNREACHABLE');
      let scheduled = 0, pending = 0, gateBlocked = null, dropReason = null;
      for (const p of plan) {
        if (gateBlocked) break;
        let at = p.scheduledAt;
        const tried = new Set(), fullDays = new Set();
        let slotMiss = null; // last Metricool slot/cap rejection: reported if no slot is left (never a silent drop)
        for (let attempt = 0; attempt < 3 && at; attempt++) {
          const item = postItem({ candidate, destination: p.destination, scheduledAt: at, caption, mediaUrl: asset.url, mediaSha256: rendered.sha256, hookVariant,
            lane: lanePick ? { ...lanePick, segment: sourceSegment(candidate, { start: (source.cut?.start ?? 0) + (rendered.cutStart ?? 0) }) } : null });
          item.byteLength=Number.isSafeInteger(rendered.sizeBytes)?rendered.sizeBytes:null;
          item.segment??=sourceSegment(candidate,{start:(source.cut?.start??0)+(rendered.cutStart??0)});
          item.streamKey??=streamKeyOf(candidate);
          if (!lanePick) item.draft = true; // lanes off: single account, owner approves every post
          // Fresh gate + durable "pending_write" BEFORE the write (a crash can never authorise a resend).
          const blocked = await update((s, c) => {
            const reason = publishGate(s, candidate, { now: clock(), destinationKey: destinationKey(p.destination), scheduledAt:at,segment:item.segment,mediaSha256:item.mediaSha256 });
            if (reason) return reason;
            const prior = c.posts.find(x => x.id === item.id);
            if (prior && prior.status !== 'deferred') return 'already_attempted';
            if (lanePick) { // One video file / source segment -> one account (checked and claimed atomically).
              const others = mediaEntriesOf({ ...c, posts: c.posts.filter(x => x.id !== item.id) }).filter(e => isProtectedMediaClaim(e)||!(e.candidateId === candidate.id && e.destinationKey === item.destinationKey));
              const conflict = mediaConflict(others, { segment: item.segment, mediaSha256: item.mediaSha256, candidateId: candidate.id, destinationKey: item.destinationKey });
              if (conflict) return conflict.reason;
              upsertMediaLedgerClaim(c,mediaEntry({candidate,segment:item.segment,mediaSha256:item.mediaSha256,destinationKey:item.destinationKey,at:iso(clock())}));
            }
            c.posts = c.posts.filter(x => x.id !== item.id);
            c.posts.push({ ...item, attemptedAt: iso(clock()) });
            return null;
          });
          if (blocked) { report.heldReasons.push(`publish_gate:${blocked}`); if (blocked !== 'already_attempted') report.counts[blocked.startsWith('rights_') ? 'deferred' : 'blocked']++; gateBlocked = blocked; at = null; break; }
          let status, metricoolId = null, reason = null, confirmedMediaUrl = null;
          try {
            await metricool.preflight(p.destination, item);
            if (lanePick) { // Required on the lane path: no cross-account read, no write.
              if (!metricool.crossAccountPreflight) throw new Error('cross_account_check_unavailable');
              await metricool.crossAccountPreflight(p.destination, item);
            }
          } catch (e) {
            reason = code(e);
            // Nothing was written: drop the post and its media-ledger claim.
            await update((s, c) => { c.posts = c.posts.filter(x => x.id !== item.id); dropClaim(c, item); });
            if (reason === 'metricool_slot_duplicate_or_daily_cap' && e?.detail === 'slot_duplicate_content') {
              // Same caption/media already on this account: never repeat a clip, no other hour, no next day.
              gateBlocked = 'metricool_duplicate_content'; report.counts.blocked++;
              report.heldReasons.push(`metricool_duplicate_content:${p.destination.brandId}:${p.destination.network}`); at = null; break;
            }
            if (reason === 'metricool_slot_duplicate_or_daily_cap') {
              tried.add(at);
              // Metricool's day is already at the cap (drafts count, e.g. another pipeline's drafts): skip the whole day.
              if (e?.detail === 'daily_cap') fullDays.add(localDay(new Date(at)));
              slotMiss = `${e?.detail ?? 'slot_duplicate_or_daily_cap'}${e?.detail === 'daily_cap' && Number.isFinite(e?.dayRows) ? `:${e.dayRows}/${e.dayLimit}` : ''}`;
              const freshPosts = cloudPublishOf(parseStreamerState(await store.read(ns))).posts;
              const slotConfig = lanePick ? { ...config, slots: lanePick.slots, dailyCap: lanePick.dailyLimit } : config;
              at = nextSlot({ now: clock(), config: slotConfig, destination: p.destination, index: p.index, posts: freshPosts, skip: tried, skipDays: fullDays });
              if (!at || attempt === 2) { report.counts.deferred++; report.counts.slotExhausted = (report.counts.slotExhausted ?? 0) + 1; dropReason = `metricool_no_free_slot:${p.destination.brandId}:${p.destination.network}:${slotMiss}`; report.heldReasons.push(dropReason); at = null; break; }
              continue;
            }
            report.counts.deferred++; dropReason = `destination_held:${p.destination.brandId}:${reason}`; report.heldReasons.push(dropReason); at = null; break;
          }
          try {
            const current = parseStreamerStateStrict(await store.read(ns));
            const rights = publishGate(current, candidate, { now: clock(), destinationKey: destinationKey(p.destination), scheduledAt:item.scheduledAt,segment:item.segment,mediaSha256:item.mediaSha256 });
            if (rights) {
              await update((s, c) => { c.posts = c.posts.filter(x => x.id !== item.id); dropClaim(c, item); });
              report.heldReasons.push(rights); report.counts[rights.startsWith('rights_') ? 'deferred' : 'blocked']++;
              if (rights.startsWith('rights_')) dropReason = rights; else gateBlocked = rights; at = null; break;
            }
            const found = await metricool.schedule(p.destination, item);
            status = found ? 'scheduled' : 'verification_pending'; metricoolId = found?.id ?? null; confirmedMediaUrl = found?.mediaUrl ?? null;
          } catch (e) {
            reason = code(e);
            status = PRE_WRITE_ERRORS.has(reason) ? 'deferred' : 'verification_pending';
          }
          await update((s, c) => { const x = c.posts.find(y => y.id === item.id); if (x) Object.assign(x, { status, metricoolId, reason, confirmedMediaUrl }); if (status === 'deferred') dropClaim(c, item); });
          if (status === 'scheduled') { scheduled++; report.counts.scheduled++; }
          else if (status === 'verification_pending') { pending++; report.counts.verificationPending++; }
          else { report.counts.deferred++; dropReason = `destination_held:${p.destination.brandId}:${reason}`; report.heldReasons.push(dropReason); }
          break;
        }
      }
      if (heldTargets.length && !gateBlocked) {
        await update((s, c) => {
          for (const h of heldTargets) {
            const key = destinationKey(h.destination);
            const id = `held-${sha(`${candidate.id}|${key}`).slice(0, 24)}`;
            const priorHeld = c.heldQueue.find(q => q.id === id || (q.candidateId === candidate.id && canonicalDestinationKey(q.destinationKey) === key));
            if ((priorHeld && priorHeld.status !== 'held_rights') || c.posts.some(x => x.candidateId === candidate.id && canonicalDestinationKey(x.destinationKey) === key && x.status !== 'deferred')) continue;
            c.heldQueue = c.heldQueue.filter(q => q.id !== id && q.id !== priorHeld?.id);
            const lane = h.lane ? { lane: h.lane.lane, language: h.lane.language, streamKey: h.lane.streamKey,
              segment: sourceSegment(candidate, { start: (source.cut?.start ?? 0) + (rendered.cutStart ?? 0) }), dailyLimit: h.lane.dailyLimit, draft: h.lane.draft, countDrafts: true, allowDuetStitch: true } : null;
            c.heldQueue.push({ id, candidateId: candidate.id, creatorKey: candidate.creatorKey, sourceUrl: candidate.sourceUrl, destination: { ...h.destination }, destinationKey: key, index: h.index,
              caption, mediaSha256: rendered.sha256, hookVariant, queuedAt: iso(clock()), status: HOLD_OWNER_ACTION, lane, draft: lane ? lane.draft : true });
            report.counts.heldQueued++;
          }
          c.heldQueue = c.heldQueue.slice(-100);
        });
      }
      // Metricool copied the media once the receipt is verified: remove the public staging asset now.
      let mediaAsset = asset;
      if (stagedAssetRemovable(cloudPublishOf(parseStreamerState(await store.read(ns))), candidate.id, asset.url, clock())) {
        await stager.remove(asset.id).then(() => { mediaAsset = null; report.counts.assetsRemoved++; }).catch(e => report.errors.push(`asset_remove:${code(e)}`));
      }
      const queuedOnly = !scheduled && !pending && !gateBlocked && heldTargets.length > 0;
      if (!scheduled && !pending && !gateBlocked && !queuedOnly && !dropReason) {
        // Rendered but nothing written or queued: always name it (deferred/held reasons above, or this catch-all).
        dropReason = plan.length ? 'rendered_not_scheduled:no_write_attempt' : 'rendered_not_scheduled:no_target';
        report.heldReasons.push(dropReason); report.counts.deferred++;
      }
      await setClip({ ...base, status: scheduled ? 'published' : pending ? 'verification_pending' : gateBlocked ? (gateBlocked.startsWith('rights_') ? 'deferred' : 'blocked') : queuedOnly ? HOLD_OWNER_ACTION : 'deferred', reason: gateBlocked ?? dropReason, mediaAsset, ...(queuedOnly || (gateBlocked ?? dropReason)?.startsWith('rights_') ? { attempts: priorAttempts } : {}) });
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
  await update((s, c) => {
    c.lastRun = report;
    if (report.dryRun) return;
    // Code failures only for the office self-heal; missing secrets keep the streak (owner action), success resets it.
    c.failureStreak = report.status === 'failed' ? (Number.isSafeInteger(c.failureStreak) ? c.failureStreak : 0) + 1 : report.status === 'held_missing_secrets' ? (Number.isSafeInteger(c.failureStreak) ? c.failureStreak : 0) : 0;
    // Success = completed without errors, partial, or an idle held_* run other than missing secrets (nothing to do).
    if ((report.status === 'completed' && !report.errors.length) || report.status === 'partial' || (report.status.startsWith('held_') && report.status !== 'held_missing_secrets' && !report.errors.length)) c.lastSuccessAt = report.at;
    c.successTrackedSince ??= report.at;
  });
  return { report, skipped: false };
}

async function main() {
  const args = process.argv.slice(2);
  const config = cloudPublishConfig(process.env);
  const growthOnly = args.includes('--growth-only');
  if (!config.enabled && !growthOnly) { console.log('::notice::Streamer cloud publisher is off (set CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED=true).'); return; }
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
  if (!config.dryRun && !growthOnly) {
    try { stager = createGithubReleaseStager({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY }); }
    catch (e) { console.log(`::warning::Media staging unavailable: ${code(e)}`); }
  }
  const minIntervalMs = args.includes('--respect-interval') ? int(process.env.CLIPPERS_STREAMER_CLOUD_MIN_INTERVAL_MINUTES, 180, 30, 1440) * 60_000 : 0;
  const outIndex = args.indexOf('--dry-run-output');
  const { report, skipped } = await runCloudPublisher({ env: process.env, owner, store, approvals: createApprovalLedger(query), metricool, stager,
    outputDir: outIndex >= 0 ? path.resolve(args[outIndex + 1] ?? 'clippers-dry-run') : null, minIntervalMs, growthOnly });
  // Office evidence (Mac OFF): project the cloud ledger into clip_metrics + clip_report office source documents.
  if (!config.dryRun && process.env.CLIPPERS_OFFICE_SOURCES_SYNC !== 'false') {
    try {
      const { syncClippersOfficeSources } = await import('./clippers-office-sources.mjs');
      const { prepareOfficeSourceDocument, persistOfficeSourceDocument } = await import('../server/office-source-documents.ts');
      const state = parseStreamerState(await store.read(STREAMER_STATE_NAMESPACE(owner)));
      const office = await syncClippersOfficeSources({ cloudPublish: cloudPublishOf(state), owner, now: Date.now(), dailyTargetPosts: config.dailyCap * Math.max(1, (config.destinations ?? []).length),
        db: { query }, prepare: prepareOfficeSourceDocument, persist: persistOfficeSourceDocument });
      console.log(JSON.stringify({ officeSources: office }));
    } catch (e) { console.log(`::warning::Clippers office source sync failed: ${code(e)}`); }
  }
  if (!growthOnly) {
    const { runReviewedDerivatives } = await import('./clippers-reviewed-derivative-worker.mjs');
    const derivativeReport = await runReviewedDerivatives({owner,store,metricool,stager,config});
    console.log(JSON.stringify({reviewedDerivative:derivativeReport}));
  }
  // Counts and codes only (public repository logs): no URLs, captions or tokens.
  console.log(JSON.stringify({ status: report.status, skipped, heldReasons: report.heldReasons, errors: report.errors, counts: report.counts, dryRun: report.dryRun, captions: report.captions ?? null, learning: report.learning ?? null,
    growth: report.growth ? { accounts: Object.fromEntries(Object.entries(report.growth.accounts).map(([k, a]) => [k, { weeklyPosts: a.weeklyPosts, weeklyViews: a.weeklyViews, weeklyMedian: a.weeklyMedian, autoPublish: a.autoPublish, autoPublishMode: a.autoPublishMode }])), decisions: report.growth.decisions.length } : null }));
  console.log(funnelSummary({ ...report, status: report.status }));
  for (const d of report.diagnostics ?? []) console.log(`clip diagnostics: ${JSON.stringify(d)}`);
  // Handled per-clip failures (e.g. a YouTube bot block) are recorded for the office, not a red job.
  if (report.errors.length) console.log(`::warning::Streamer cloud publisher: ${report.errors.length} handled error(s): ${report.errors.slice(0, 5).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch(error => { console.error(`clippers streamer cloud publisher failed: ${code(error)}`); process.exit(1); });
}
