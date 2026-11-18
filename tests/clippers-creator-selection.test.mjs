import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { selectCreatorPreferences } from '../script/clippers-creator-selection.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const NOW = '2026-11-18T12:00:00.000Z';
const time = hours => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString();
const context = () => ({ destination: { brandId: 6591612, network: 'facebook', account: '1193011863901514' },
  baselineCreatorGroupId: 'jordi-wild', language: 'es', format: 'interview', context: 'news-interview',
  renderManifestSha256: hash('manifest'), renderEngineSha256: hash('engine'), postingSlot: '10:00', windowHours: 24,
  readyUntil: time(10), readinessReceiptSha256: hash('ready') });
function fixture() {
  const ctx = context(), samples = [];
  for (let batch = 0; batch < 3; batch++) {
    for (const arm of ['control', 'challenger']) {
      for (let index = 0; index < 5; index++) {
        const id = `${batch}-${arm}-${index}`;
        samples.push({ ...ctx, deliveryId: id, postId: String(samples.length + 1),
          publishedAt: time(-25), observedAt: time(-1), windowHours: 24, actualAgeHours: 24,
          timing: 'provider_observation_time', creatorGroupId: arm === 'control' ? 'jordi-wild' : 'thegrefg',
          channelId: 'UCCEmjNPpJYhGDgaEqeeA4HA', sourceVideoId: String(samples.length + 1).padStart(11, '0'),
          sourceSha256: hash('source-' + id), sourceStartSeconds: 0, durationSeconds: 30,
          views: arm === 'control' ? 100 : 120, completionRate: 0.6, qualityDefinition: 'completion_rate', costUsd: 0, elapsedMs: 100,
          evidence: { status: 'ready', publicationReceiptSha256: hash('pub-' + id), renderReceiptSha256: hash('render-' + id),
            rightsEvidenceSha256: hash('rights-' + id), assignmentSha256: hash('assignment-' + batch),
            rightsObservedAt: time(-26), rightsValidUntil: time(12), sourcePublishedAt: time(-26) },
          selectionExperiment: { id: 'batch-' + batch, registeredAt: time(-30 + batch),
            controlCreatorGroupId: 'jordi-wild', challengerCreatorGroupId: 'thegrefg', arm } });
      }
    }
  }
  return { samples, contexts: [ctx], previousPreferences: [], evaluatedAt: NOW };
}
const preference = input => selectCreatorPreferences(input).preferences[0];

test('three real disjoint 5+5 lots with exactly 20% lift promote only a bounded ready-asset preference', () => {
  const input = fixture(), before = structuredClone(input), result = preference(input);
  assert.equal(result.status, 'preferred');
  assert.equal(result.preferredCreatorGroupId, 'thegrefg');
  assert.equal(result.candidates[0].batches.length, 3);
  assert.ok(result.candidates[0].batches.every(batch => batch.passed));
  assert.equal(result.expiresAt, time(10));
  assert.equal(result.allowedUse, 'ready_asset_order_only');
  assert.equal(result.mayAuthorizePublication, false);
  assert.equal(result.mayIncreaseDailyLimit, false);
  assert.equal(result.paidSpendUsd, 0);
  assert.deepEqual(input, before);
});

test('empty/legacy/missing metrics remain unmeasured without inferred quality or zero', () => {
  const empty = fixture(); empty.samples = [];
  assert.equal(preference(empty).status, 'unmeasured');
  for (const field of ['completionRate', 'views', 'qualityDefinition', 'selectionExperiment', 'sourceVideoId']) {
    const input = fixture(); for (const row of input.samples) delete row[field];
    assert.equal(preference(input).status, 'unmeasured', field);
  }
  const missing = fixture(); missing.samples.forEach(row => row.completionRate = null);
  assert.equal(preference(missing).excluded.direct_quality_metric_required, 30);
});

test('scope never borrows another account, brand, network, language, format, context, renderer or slot', () => {
  for (const [field, value] of [['language', 'en'], ['format', 'gaming'], ['context', 'other'], ['renderManifestSha256', hash('other')], ['renderEngineSha256', hash('other')], ['postingSlot', '11:00'], ['windowHours', 72]]) {
    const input = fixture(); input.samples.forEach(row => row[field] = value);
    assert.equal(preference(input).status, 'unmeasured', field);
  }
  for (const [field, value] of [['brandId', 123], ['network', 'tiktok'], ['account', 'other']]) {
    const input = fixture(); input.samples.forEach(row => row.destination = { ...row.destination, [field]: value });
    assert.equal(preference(input).status, 'unmeasured', field);
  }
});

test('observation time and actual age must be real, recent and within same one-hour measurement band', () => {
  for (const patch of [
    { observedAt: time(1), actualAgeHours: 26 },
    { observedAt: time(-721), publishedAt: time(-745) },
    { actualAgeHours: 24.1 },
    { publishedAt: time(-26), actualAgeHours: 25 },
    { timing: 'feed_view_count' },
  ]) {
    const input = fixture(); input.samples.forEach(row => Object.assign(row, patch));
    assert.equal(preference(input).status, 'unmeasured');
  }
});

test('ready proof and at-publication rights/source freshness cannot be bypassed', () => {
  for (const patch of [
    { status: 'unknown' }, { rightsObservedAt: time(-50) }, { rightsObservedAt: time(-24) }, { rightsValidUntil: time(-25.1) },
    { sourcePublishedAt: time(-100) }, { sourcePublishedAt: time(-24) },
    { publicationReceiptSha256: null }, { renderReceiptSha256: null }, { rightsEvidenceSha256: null }, { assignmentSha256: null },
  ]) {
    const input = fixture(); input.samples.forEach(row => Object.assign(row.evidence, patch));
    assert.equal(preference(input).status, 'unmeasured');
  }
  for (const patch of [{ readyUntil: time(0) }, { readinessReceiptSha256: null }]) {
    const input = fixture(); Object.assign(input.contexts[0], patch);
    assert.equal(preference(input).status, 'baseline');
    assert.equal(preference(input).reason, 'current_readiness_required');
  }
});

test('insufficient batches, fewer or extra arm samples never qualify', () => {
  for (const count of [0, 10, 20, 29]) {
    const input = fixture(); input.samples = input.samples.slice(0, count);
    assert.notEqual(preference(input).status, 'preferred');
  }
  const extra = fixture(); extra.samples.push({ ...extra.samples[0], deliveryId: 'extra', postId: '999', sourceVideoId: '99999999999', sourceSha256: hash('extra'), evidence: { ...extra.samples[0].evidence, publicationReceiptSha256: hash('extra-pub'), renderReceiptSha256: hash('extra-render') } });
  assert.notEqual(preference(extra).status, 'preferred');
});

test('a single failed lot or quality/cost regression prevents promotion', () => {
  for (const patch of [{ views: 119 }, { completionRate: 0.59 }, { elapsedMs: 101 }, { costUsd: 0.01 }]) {
    const input = fixture(); input.samples.filter(row => row.selectionExperiment.id === 'batch-1' && row.selectionExperiment.arm === 'challenger').forEach(row => Object.assign(row, patch));
    assert.notEqual(preference(input).status, 'preferred');
  }
  const zero = fixture(); zero.samples.filter(row => row.selectionExperiment.arm === 'control').forEach(row => row.views = 0);
  assert.equal(preference(zero).candidates[0].reason, 'positive_control_median_required');
});

test('posts, receipts, source bytes, source videos and shared episodes cannot be reused across lots', () => {
  for (const field of ['postId', 'deliveryId', 'sourceSha256', 'sourceVideoId']) {
    const input = fixture(); input.samples[10][field] = input.samples[0][field];
    assert.equal(preference(input).candidates[0].reason, 'duplicate_post_or_source', field);
  }
  for (const field of ['publicationReceiptSha256', 'renderReceiptSha256']) {
    const input = fixture(); input.samples[10].evidence[field] = input.samples[0].evidence[field];
    assert.equal(preference(input).candidates[0].reason, 'duplicate_post_or_source', field);
  }
  const reencoded = fixture(); reencoded.samples[0].sourceEpisodeId = reencoded.samples[10].sourceEpisodeId = 'same-original';
  assert.equal(preference(reencoded).candidates[0].reason, 'duplicate_post_or_source');
  const segments = fixture(); segments.samples[10].sourceSha256 = segments.samples[0].sourceSha256; segments.samples[10].sourceStartSeconds = 100;
  assert.equal(preference(segments).candidates[0].reason, 'duplicate_post_or_source');
});

test('assignments are prepublication, consistently bound and distinct between lots', () => {
  const late = fixture(); late.samples.forEach(row => row.selectionExperiment.registeredAt = row.publishedAt);
  assert.equal(preference(late).status, 'unmeasured');
  const conflict = fixture(); conflict.samples[0].evidence.assignmentSha256 = hash('other-assignment');
  assert.equal(preference(conflict).candidates[0].reason, 'assignment_binding_conflict');
  const reused = fixture(); reused.samples.forEach(row => row.evidence.assignmentSha256 = hash('reused-assignment'));
  assert.notEqual(preference(reused).status, 'preferred');
});

test('earliest three lots are used, never best three or a duplicate later observation', () => {
  const input = fixture(); input.samples.filter(row => row.selectionExperiment.id === 'batch-0').forEach(row => row.views = 100);
  const fourth = fixture().samples.filter(row => row.selectionExperiment.id === 'batch-2').map((row, i) => ({ ...row, deliveryId: 'fourth-' + i, postId: String(100 + i), sourceVideoId: String(100 + i).padStart(11, '0'), sourceSha256: hash('fourth-' + i), evidence: { ...row.evidence, publicationReceiptSha256: hash('fourth-pub-' + i), renderReceiptSha256: hash('fourth-render-' + i), assignmentSha256: hash('fourth-assignment') }, selectionExperiment: { ...row.selectionExperiment, id: 'batch-3', registeredAt: time(-26) } }));
  input.samples.push(...fourth);
  assert.equal(preference(input).candidates[0].reason, 'median_lift_below_twenty_percent');
  const duplicate = fixture(); duplicate.samples.push(structuredClone(duplicate.samples[0]));
  assert.notEqual(preference(duplicate).status, 'preferred');
});

test('receipt is reproducible regardless input order, bound to facts, and does not revive stale preferences', () => {
  const input = fixture(), result = preference(input);
  assert.deepEqual(preference({ ...input, samples: [...input.samples].reverse() }), result);
  const changed = fixture(); changed.samples[0].views = 101;
  assert.notEqual(preference(changed).inputSha256, result.inputSha256);
  const empty = fixture(); empty.samples = []; empty.previousPreferences = [result];
  const next = preference(empty);
  assert.equal(next.status, 'unmeasured');
  assert.equal(next.preferredCreatorGroupId, 'jordi-wild');
  assert.deepEqual(next.previousPreferenceHashes.length, 1);
});

test('invalid contexts, time, unbounded policy and oversized inputs fail closed', () => {
  for (const patch of [{ evaluatedAt: 'bad' }, { samples: Array(10001).fill(null) }, { policy: { preferenceTtlHours: 25 } }, { policy: { batches: 2 } }, { policy: { maxObservationAgeHours: 721 } }, { evaluatedAt: '2026-11-31T12:00:00.000Z' }]) {
    assert.throws(() => selectCreatorPreferences({ ...fixture(), ...patch }), /creator_selection_input_invalid/);
  }
  const duplicate = fixture(); duplicate.contexts.push(structuredClone(duplicate.contexts[0]));
  assert.throws(() => selectCreatorPreferences(duplicate), /duplicate_scope/);
  const bad = fixture(); bad.contexts[0].format = 'unknown';
  assert.throws(() => selectCreatorPreferences(bad), /context_invalid/);
});


test('historically valid expired rights can measure past posts but cannot replace current readiness', () => {
  const input = fixture(); input.samples.forEach(row => row.evidence.rightsValidUntil = time(-24));
  assert.equal(preference(input).status, 'preferred');
  input.contexts[0].readyUntil = time(-1);
  assert.equal(preference(input).reason, 'current_readiness_required');
});

test('an invalid assigned member poisons its lot rather than being dropped to cherry-pick five', () => {
  const input = fixture(); input.samples.push({ ...structuredClone(input.samples[0]), deliveryId: 'bad-extra', postId: '999', completionRate: null });
  assert.equal(preference(input).candidates[0].reason, 'assigned_sample_invalid_or_conflicting');
});


test('a wholly invalid earliest lot cannot disappear so later winners replace it', () => {
  const input = fixture();
  const first = input.samples.filter(row => row.selectionExperiment.id === 'batch-0').map((row, index) => ({
    ...structuredClone(row), deliveryId: 'invalid-' + index, postId: String(100 + index), completionRate: null,
    selectionExperiment: { ...row.selectionExperiment, id: 'invalid-earliest', registeredAt: time(-31) },
  }));
  input.samples.push(...first);
  assert.equal(preference(input).candidates[0].reason, 'assigned_sample_invalid_or_conflicting');
  assert.equal(preference(input).candidates[0].batches[0].id, 'invalid-earliest');
});


test('three lots are reachable with one control+challenger per day across 15 real days, under five daily cap', () => {
  const input = fixture();
  for (const [index, row] of input.samples.entries()) {
    const batch = Math.floor(index / 10), withinArm = index % 5;
    const day = batch * 5 + withinArm;
    row.publishedAt = time(-24 * (16 - day));
    row.observedAt = time(-24 * (15 - day));
    row.actualAgeHours = 24;
    row.evidence.sourcePublishedAt = time(-24 * (16 - day) - 1);
    row.evidence.rightsObservedAt = row.evidence.sourcePublishedAt;
    row.evidence.rightsValidUntil = row.observedAt;
    row.selectionExperiment.registeredAt = time(-24 * (16 - batch * 5) - 2);
  }
  assert.ok(new Set(input.samples.map(row => row.publishedAt)).size === 15);
  assert.ok(input.samples.every(row => input.samples.filter(other => other.publishedAt === row.publishedAt).length === 2));
  assert.equal(preference(input).status, 'preferred');
  assert.equal(preference({ ...input, policy: { maxObservationAgeHours: 24 } }).status, 'unmeasured');
});
