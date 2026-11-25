import test from 'node:test';
import assert from 'node:assert/strict';
import { autoApproveConfig, autoApprovalDecision, applyStreamerRequirements, blocklistFromTakedowns, autoApprovedToday, detectStreamerRequirements, autoApprovalSummary, AUTO_APPROVE_RULE } from '../shared/clippers-auto-approval.mjs';
import { funnelSummary } from '../script/clippers-streamer-cloud-worker.mjs';
import { buildCycleReport } from '../script/clippers-office-sources.mjs';

const NOW = Date.parse('2026-11-25T15:00:00Z');
const KEY = 'twitch:123';
const on = autoApproveConfig({ CLIPPERS_AUTO_APPROVE_ENABLED: 'true' });
const cand = (o = {}) => ({ id: 'c1', creatorKey: KEY, platform: 'twitch', handle: 'streamer', sourceUrl: 'https://clips.twitch.tv/abc', durationSec: 30,
  publishedAt: new Date(NOW - 3_600_000).toISOString(), clipPolicy: { status: 'allowed_unless_prohibited' }, approval: { status: 'pending', pendingActionId: '9' }, download: { mode: 'needs_local_download' }, ...o });
const st = (o = {}, creator = {}) => ({ creators: { [KEY]: { policy: { status: 'allowed_unless_prohibited', source: 'twitch_description' }, ...creator } }, takedowns: [], candidates: [cand()], ...o });

test('config: off by default, cap 3 by default', () => {
  const c = autoApproveConfig({});
  assert.equal(c.enabled, false); assert.equal(c.dailyCapPerAccount, 3);
  assert.deepEqual(autoApprovalDecision(st(), cand(), { now: NOW, config: c }), { approve: false, reason: 'auto_approve_disabled' });
});

test('no prohibition signals -> auto-approved with audit evidence', () => {
  const d = autoApprovalDecision(st(), cand(), { now: NOW, config: on, description: 'Streams daily, follow me' });
  assert.equal(d.approve, true); assert.equal(d.rule, AUTO_APPROVE_RULE); assert.equal(d.evidence.descriptionChecked, true);
});

test('explicit no-clips / clip settings off / owner blocklist -> never', () => {
  assert.equal(autoApprovalDecision(st(), cand(), { now: NOW, config: on, description: 'No clips please. Do not reupload my content.' }).approve, false);
  assert.equal(autoApprovalDecision(st({}, { policy: { status: 'prohibited', source: 'twitch_description' } }), cand(), { now: NOW, config: on }).reason, 'clip_prohibited');
  assert.equal(autoApprovalDecision(st({}, { clipsDisabled: true }), cand(), { now: NOW, config: on }).reason, 'clip_settings_disabled');
  const bl = autoApproveConfig({ CLIPPERS_AUTO_APPROVE_ENABLED: 'true', CLIPPERS_AUTO_APPROVE_BLOCKLIST: KEY });
  assert.equal(autoApprovalDecision(st(), cand(), { now: NOW, config: bl }).reason, 'blocklisted');
});

test('takedown -> blocked now and permanently blocklisted', () => {
  const s = st({ takedowns: [{ creatorKey: KEY, at: new Date(NOW).toISOString() }] });
  assert.equal(autoApprovalDecision(s, cand(), { now: NOW, config: on }).reason, 'takedown');
  const c = {}; assert.equal(blocklistFromTakedowns(s, c, NOW), 1); assert.equal(blocklistFromTakedowns(s, c, NOW), 0);
  const after = { ...st(), cloudPublish: c }; // even once the takedown row is gone
  assert.equal(autoApprovalDecision(after, cand(), { now: NOW, config: on }).reason, 'blocklisted');
});

test('existing gates: length, age, live, unchecked creator, dedupe, owner rejection', () => {
  assert.equal(autoApprovalDecision(st(), cand({ durationSec: 90 }), { now: NOW, config: on }).reason, 'clip_too_long');
  assert.equal(autoApprovalDecision(st(), cand({ publishedAt: new Date(NOW - 72 * 3_600_000).toISOString() }), { now: NOW, config: on }).reason, 'source_too_old');
  assert.equal(autoApprovalDecision(st(), cand({ kind: 'live' }), { now: NOW, config: on }).reason, 'live_stream_not_clipped');
  assert.equal(autoApprovalDecision(st({}, { policy: { source: 'not_checked' } }), cand(), { now: NOW, config: on }).reason, 'creator_policy_not_checked');
  assert.equal(autoApprovalDecision(st(), cand(), { now: NOW, config: on, ledger: { clips: { c1: { status: 'published' } }, posts: [] } }).reason, 'duplicate');
  assert.equal(autoApprovalDecision(st(), cand({ approval: { status: 'rejected' } }), { now: NOW, config: on }).reason, 'approval_rejected');
});

test('streamer asks for credit/link/#ad -> applied; nothing added that was not asked', () => {
  const req = detectStreamerRequirements('Clips allowed, give credit and link back to the channel. Paid partnership: use #ad');
  assert.deepEqual(req, { credit: true, link: true, noMusic: false, adDisclosure: true });
  const out = applyStreamerRequirements('Great play', req, cand());
  assert.match(out, /@streamer/); assert.match(out, /https:\/\/clips\.twitch\.tv\/abc/); assert.match(out, /#ad/);
  const plain = applyStreamerRequirements('Great play @streamer https://clips.twitch.tv/abc', detectStreamerRequirements(''), cand());
  assert.doesNotMatch(plain, /#ad/);
});

test('daily cap per account counts only auto-approved live posts that day', () => {
  const day = d => d.toISOString().slice(0, 10);
  const posts = [1, 2, 3].map(i => ({ autoApproval: { rule: 'x' }, destinationKey: 'A', status: 'scheduled', scheduledAt: `2026-11-25T1${i}:00:00Z` }))
    .concat([{ destinationKey: 'A', status: 'scheduled', scheduledAt: '2026-11-25T18:00:00Z' }, { autoApproval: {}, destinationKey: 'A', status: 'deferred', scheduledAt: '2026-11-25T19:00:00Z' }]);
  assert.equal(autoApprovedToday(posts, 'A', '2026-11-25', day), 3);
  assert.ok(autoApprovedToday(posts, 'A', '2026-11-25', day) >= on.dailyCapPerAccount);
  assert.equal(autoApprovedToday(posts, 'B', '2026-11-25', day), 0);
});

test('summary line and office clip_report carry auto-approved count and reasons', () => {
  const report = { status: 'completed', heldReasons: [], counts: { rendered: 1, scheduled: 1 }, funnel: { candidates: 2, eligible: 1, dropped: {} },
    autoApproval: { enabled: true, approved: 1, rules: { [AUTO_APPROVE_RULE]: 1 }, held: { description_prohibits_clipping: 1 } } };
  assert.match(funnelSummary(report), /auto_approve=on approved=1 \[default_no_prohibition_signals=1\] manual\[description_prohibits_clipping=1\]/);
  assert.equal(autoApprovalSummary({}), 'auto_approve=off');
  const cycle = buildCycleReport({ posts: [{ status: 'scheduled', scheduledAt: new Date(NOW).toISOString(), autoApproval: { rule: AUTO_APPROVE_RULE } }], lastRun: { autoApproval: { held: { auto_approve_daily_cap: 2 } } } }, { owner: 'o', now: NOW, dailyTargetPosts: 3 });
  assert.equal(cycle.document.automation.totals.autoApproved, 1); assert.equal(cycle.document.automation.totals.autoApproveCapped, 2);
  assert.equal(cycle.document.automation.posts[0].autoApprovalRule, AUTO_APPROVE_RULE);
});
