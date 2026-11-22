import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRightsGate } from '../shared/clippers-source-authorization.mjs';
import { fixtureGrants } from './helpers/clippers-source-authorization-fixture.mjs';
const now = Date.parse('2026-11-22T10:00:00Z');
const c = { id: 'twitch-clip:example', sourceUrl: 'https://clips.twitch.tv/example', creatorKey: 'twitch:123' };
const key = '6431685:tiktok:streamersus';
const options = { now, destinationKey: key, scheduledAt: '2026-11-22T16:00:00Z' };
const state = () => ({ candidates: [c], sourceAuthorizations: fixtureGrants([c], now) });
test('positive rights bind source, creator, candidate, audio, video, editing, commercial use, evidence and exact destination', () => {
  assert.equal(sourceRightsGate(state(), c, options), null);
  assert.equal(sourceRightsGate({ candidates: [c] }, c, options), 'rights_authorization_missing');
  for (const field of ['candidateId', 'sourceUrl', 'creatorKey']) {
    const s = state(); s.sourceAuthorizations[c.id][field] += '-another';
    assert.equal(sourceRightsGate(s, c, options), 'rights_source_mismatch', field);
  }
  for (const field of ['audio', 'video', 'editing', 'commercialSocial', 'wholeSource', 'publicMediaStaging']) {
    const s = state(); s.sourceAuthorizations[c.id].scope[field] = false;
    assert.equal(sourceRightsGate(s, c, options), 'rights_scope_incomplete', field);
  }
  const s = state(); s.sourceAuthorizations[c.id].destinations = ['6431687:tiktok:streamersclipusa'];
  assert.equal(sourceRightsGate(s, c, options), 'rights_destination_mismatch');
  for (const mutate of [g => g.review.actor = 'scheduler', g => delete g.evidence.sha256, g => g.basis = 'allowed_unless_prohibited', g => g.review.at = '2026-11-23T10:00:00Z']) {
    const s = state(); mutate(s.sourceAuthorizations[c.id]); assert.equal(sourceRightsGate(s, c, options), 'rights_evidence_unverified');
  }
});
test('rights expire at the boundary, cannot be future dated, and must cover the actual scheduled publication', () => {
  const s = state(), grant = s.sourceAuthorizations[c.id]; grant.validUntil = '2026-11-22T12:00:00Z';
  assert.equal(sourceRightsGate(s, c, { now }), null);
  assert.equal(sourceRightsGate(s, c, options), 'rights_publication_outside_validity');
  assert.equal(sourceRightsGate(s, c, { now: Date.parse(grant.validUntil) }), 'rights_outside_validity');
  grant.validFrom = '2026-11-22T11:00:00Z'; assert.equal(sourceRightsGate(s, c, { now }), 'rights_outside_validity');
  grant.validFrom = '2026-11-21T00:00:00'; assert.equal(sourceRightsGate(s, c, { now }), 'rights_outside_validity');
});
