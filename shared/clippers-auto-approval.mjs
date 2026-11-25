// Policy-based auto-approval for the streamer cloud lane (owner decision 2026-11-25).
// Default: a clip that passes every automatic gate is approved WITHOUT a manual review, unless the streamer
// explicitly prohibits clipping/reuploads (description/About text, clip settings off, prohibition detector),
// has any takedown/complaint (-> permanent auto-blocklist) or is on the owner blocklist.
// Streamer-stated requirements (credit, link, no music, #ad) are detected and applied automatically.
// Off unless CLIPPERS_AUTO_APPROVE_ENABLED=true. Never overrides an owner rejection. When the policy passes it records
// an owner standing-policy grant (basis owner_default_policy: Robert's rule "no objection from the streamer = permission");
// it never replaces an existing grant, and any takedown or later prohibition revokes it.
import { detectClipProhibition, takedownBlocks, resolveClipPolicy, clipLengthAllowed, captionHasCredit } from './clippers-streamer-policy.mjs';
import { KNOWN_PROHIBITED_CREATORS } from './clippers-priority-creators.mjs';
import { createHash } from 'node:crypto';

const HOUR = 3_600_000;
export const AUTO_APPROVE_RULE = 'default_no_prohibition_signals';
export const AUTO_APPROVE_MAX_AUDIT = 500;

const list = raw => String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);

export function autoApproveConfig(env = process.env) {
  const n = Number.parseInt(env.CLIPPERS_AUTO_APPROVE_DAILY_CAP_PER_ACCOUNT ?? '', 10);
  return {
    enabled: env.CLIPPERS_AUTO_APPROVE_ENABLED === 'true',
    dailyCapPerAccount: Number.isSafeInteger(n) && n >= 0 && n <= 20 ? n : 3,
    blocklist: new Set(list(env.CLIPPERS_AUTO_APPROVE_BLOCKLIST)),
  };
}

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Requirements the streamer states in their own text. Only what they ask for is enforced. */
export function detectStreamerRequirements(text) {
  const t = fold(text);
  return {
    credit: /\b(credit|give credit|credito|creditos|tag me|menciona(r)?me|etiquet)/.test(t),
    link: /\b(link (back|to)|include (the|a) link|enlace|link al canal|link in (the )?(caption|description))/.test(t),
    noMusic: /\b(no (added |extra )?music|sin musica|don'?t add music|no copyrighted music)/.test(t),
    adDisclosure: /(#ad\b|#sponsored|#publicidad|disclose|paid partnership)/.test(t),
  };
}

/** Clipping prohibition from every signal the system holds; null when none. */
export function prohibitionSignal(state, candidate, { description = null, blocklist = new Set() } = {}) {
  const creator = state?.creators?.[candidate.creatorKey];
  const group = creator?.creatorGroupId ?? null;
  const blocked = new Set([...(state?.cloudPublish?.autoApproveBlocklist ?? []).map(b => b.key), ...blocklist]);
  if (blocked.has(candidate.creatorKey) || (group && blocked.has(group))) return 'blocklisted';
  if (takedownBlocks(state?.takedowns, { creatorKey: candidate.creatorKey, creatorGroupId: group, candidateId: candidate.id })) return 'takedown';
  if (candidate.clipPolicy?.status === 'prohibited' || creator?.policy?.status === 'prohibited') return 'clip_prohibited';
  if (creator?.clipsDisabled === true || candidate.clipsDisabled === true) return 'clip_settings_disabled';
  const known = resolveClipPolicy({ creatorKey: candidate.creatorKey, creatorGroupId: group, candidateId: candidate.id, takedowns: state?.takedowns ?? [], knownProhibited: KNOWN_PROHIBITED_CREATORS });
  if (known.status === 'prohibited') return 'known_prohibited';
  for (const text of [description, creator?.description, creator?.policy?.statement]) if (text && detectClipProhibition(text).prohibited) return 'description_prohibits_clipping';
  return null;
}

/**
 * Decision for one candidate still waiting for an owner review.
 * Returns { approve: true, rule, evidence } or { approve: false, reason }.
 */
export function autoApprovalDecision(state, candidate, { now = Date.now(), config, maxSourceAgeHours = 48, ledger = null, description = null } = {}) {
  if (!config?.enabled) return { approve: false, reason: 'auto_approve_disabled' };
  if (!candidate) return { approve: false, reason: 'candidate_missing' };
  if (candidate.approval?.status !== 'pending') return { approve: false, reason: `approval_${candidate.approval?.status ?? 'missing'}` };
  const creator = state?.creators?.[candidate.creatorKey];
  if (!creator?.policy || creator.policy.source === 'not_checked') return { approve: false, reason: 'creator_policy_not_checked' };
  const prohibited = prohibitionSignal(state, candidate, { description, blocklist: config.blocklist });
  if (prohibited) return { approve: false, reason: prohibited };
  if (candidate.clipPolicy?.status !== 'allowed_unless_prohibited') return { approve: false, reason: 'clip_policy_unknown' };
  if (candidate.kind === 'live') return { approve: false, reason: 'live_stream_not_clipped' };
  if (candidate.platform === 'twitch' && !clipLengthAllowed(candidate.durationSec)) return { approve: false, reason: 'clip_too_long' };
  const age = now - Date.parse(candidate.publishedAt);
  if (!(age >= 0 && age <= maxSourceAgeHours * HOUR)) return { approve: false, reason: 'source_too_old' };
  if (ledger?.clips?.[candidate.id] && !['failed', 'deferred'].includes(ledger.clips[candidate.id].status)) return { approve: false, reason: 'duplicate' };
  if ((ledger?.posts ?? []).some(p => p.candidateId === candidate.id && !['deferred', 'not_found'].includes(p.status))) return { approve: false, reason: 'duplicate' };
  const requirements = detectStreamerRequirements([description, creator.description].filter(Boolean).join('\n'));
  return { approve: true, rule: AUTO_APPROVE_RULE, evidence: {
    creatorPolicySource: creator.policy.source ?? null, descriptionChecked: !!(description ?? creator.description), descriptionSha256: creator.policy.descriptionSha256 ?? null,
    takedowns: 0, blocklisted: false, clipsDisabled: false, durationSec: candidate.durationSec ?? null, ageHours: Math.round(age / HOUR * 10) / 10, requirements } };
}

/** Applies the streamer's stated requirements to a caption (credit/link always present; #ad only when asked). */
export function applyStreamerRequirements(caption, requirements, candidate) {
  let out = String(caption ?? '');
  const handle = `@${String(candidate.handle ?? '').replace(/^@/, '')}`;
  if ((requirements?.credit || requirements?.link || !captionHasCredit(out, candidate.handle, candidate.sourceUrl)) && !out.includes(handle)) out += `\nCréditos: ${handle}`;
  if (candidate.sourceUrl && !out.includes(new URL(candidate.sourceUrl).toString())) out += `\nFuente: ${new URL(candidate.sourceUrl).toString()}`;
  if (requirements?.adDisclosure && !/(^|\s)#ad\b/i.test(out)) out += ' #ad';
  return out;
}

/** Takedown/complaint -> permanent auto-blocklist entry in the cloud ledger c (idempotent). Returns the number added. */
export function blocklistFromTakedowns(state, c, now = Date.now()) {
  c.autoApproveBlocklist = Array.isArray(c.autoApproveBlocklist) ? c.autoApproveBlocklist : [];
  const have = new Set(c.autoApproveBlocklist.map(b => b.key));
  let added = 0;
  for (const t of state.takedowns ?? []) {
    const key = t.creatorKey ?? t.creatorGroupId ?? (t.candidateId ? state.candidates?.find(c => c.id === t.candidateId)?.creatorKey : null);
    if (!key || have.has(key)) continue;
    c.autoApproveBlocklist.push({ key, reason: 'takedown', at: new Date(now).toISOString() }); have.add(key); added++;
  }
  return added;
}

/** Auto-approved posts already given to one account on a local day. */
export function autoApprovedToday(posts, destKey, day, localDay) {
  return (posts ?? []).filter(p => p.autoApproval && p.destinationKey === destKey && !['deferred', 'not_found', 'blocked'].includes(p.status) &&
    localDay(new Date(p.scheduledAt)) === day).length;
}

export function recordAutoApproval(c, entry) {
  c.autoApprovals = [...(Array.isArray(c.autoApprovals) ? c.autoApprovals : []), entry].slice(-AUTO_APPROVE_MAX_AUDIT);
}

export function autoApprovalSummary(report) {
  const a = report.autoApproval;
  if (!a) return 'auto_approve=off';
  const why = Object.entries(a.rules ?? {}).map(([k, v]) => `${k}=${v}`).join(',') || 'none';
  const held = Object.entries(a.held ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(',') || 'none';
  return `auto_approve=${a.enabled ? 'on' : 'off'} approved=${a.approved} [${why}] manual[${held}]`;
}

export const OWNER_DEFAULT_POLICY_VERSION = 1;
export const OWNER_DEFAULT_POLICY_HOURS = 48;

/** Standing-policy grant for one source (satisfies sourceRightsGate; distinct basis, never 'permission'). */
export function ownerDefaultPolicyGrant(candidate, evidence, { now = Date.now(), destinations = [] } = {}) {
  const snapshot = createHash('sha256').update(JSON.stringify({ candidateId: candidate.id, creatorKey: candidate.creatorKey, sourceUrl: candidate.sourceUrl, evidence })).digest('hex');
  const at = new Date(now).toISOString();
  return { schemaVersion: 1, status: 'approved', basis: 'owner_default_policy', candidateId: candidate.id, sourceUrl: candidate.sourceUrl, creatorKey: candidate.creatorKey,
    rightsHolder: candidate.creatorKey, review: { actor: 'owner', method: 'standing_policy', id: `owner-default-policy:v${OWNER_DEFAULT_POLICY_VERSION}`, at },
    evidence: { reference: `clippers-auto-approve:${AUTO_APPROVE_RULE}`, sha256: snapshot }, policy: { version: OWNER_DEFAULT_POLICY_VERSION, rule: AUTO_APPROVE_RULE },
    scope: { video: true, audio: true, editing: true, commercialSocial: true, wholeSource: true, publicMediaStaging: true },
    validFrom: at, validUntil: new Date(now + OWNER_DEFAULT_POLICY_HOURS * HOUR).toISOString(), destinations: [...destinations] };
}

/** Records the grant only when no grant exists for that source (real owner grants are never replaced). */
export function recordOwnerDefaultGrant(state, grant) {
  state.sourceAuthorizations = state.sourceAuthorizations && typeof state.sourceAuthorizations === 'object' ? state.sourceAuthorizations : {};
  const prior = state.sourceAuthorizations[grant.candidateId];
  if (prior && !(prior.basis === 'owner_default_policy' && prior.status !== 'approved')) return prior.basis === 'owner_default_policy';
  if (prior?.status === 'revoked') return false; // a revoked standing grant is never re-issued for the same source
  state.sourceAuthorizations[grant.candidateId] = grant; return true;
}

/** Revokes standing-policy grants for a source/creator (takedown or prohibition). Returns the number revoked. */
export function revokeOwnerDefaultGrants(state, { candidateId = null, creatorKeys = [] } = {}, reason = 'prohibition', now = Date.now()) {
  let n = 0;
  for (const g of Object.values(state?.sourceAuthorizations ?? {})) {
    if (g?.basis !== 'owner_default_policy' || g.status !== 'approved') continue;
    if (g.candidateId === candidateId || creatorKeys.includes(g.creatorKey)) { g.status = 'revoked'; g.revokedAt = new Date(now).toISOString(); g.revokedReason = reason; n++; }
  }
  return n;
}
