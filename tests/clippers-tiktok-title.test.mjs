import test from 'node:test';
import assert from 'node:assert/strict';
import { tiktokTitle } from '../script/clippers-portfolio-metricool.mjs';

test('tiktok title uses the first non-empty caption line without URLs', () => {
  assert.equal(tiktokTitle('\n  Lacy on coaching  \nmore text https://x.y'), 'Lacy on coaching');
  assert.equal(tiktokTitle('See https://example.com/a?b=1 now'), 'See now');
});

test('tiktok title is capped at 80 code points', () => {
  const long = 'é'.repeat(120);
  const t = tiktokTitle(long);
  assert.equal([...t].length, 80);
  assert.ok(t.endsWith('…'));
});

test('empty caption gives an empty title', () => {
  assert.equal(tiktokTitle(''), '');
  assert.equal(tiktokTitle(undefined), '');
  assert.equal(tiktokTitle('https://only.url'), '');
});
