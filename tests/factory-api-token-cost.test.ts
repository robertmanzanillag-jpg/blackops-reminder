import assert from 'node:assert/strict';
import test from 'node:test';
import { factoryTextActualMicroUsd as actual, factoryTextMaximumMicroUsd as maximum,
  requireFactoryCacheWritePrice, FactoryTokenCostError } from '../server/factory-api-token-cost';
// Synthetic rates only; these are not current provider pricing evidence.
const price = { maxInputTokens: 1_049_600, inputNanoUsdPerToken: 2000, outputNanoUsdPerToken: 10000,
  cachedInputNanoUsdPerToken: 100, cacheWrite30mNanoUsdPerToken: 2500, cacheWrite12hNanoUsdPerToken: 4000 };
const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0,
  cacheWriteTokens: 0, cacheWrite30mTokens: 0, cacheWrite12hTokens: 0 };
const throwsCode = (run: () => unknown, code: string) => assert.throws(run, error =>
  error instanceof FactoryTokenCostError && error.code === code && error.message === code);

test('covered zero usage still requires explicit approved cache read and both write rates', () => {
  assert.equal(actual(price, usage, true), 0);
  for (const field of ['cachedInputNanoUsdPerToken', 'cacheWrite30mNanoUsdPerToken', 'cacheWrite12hNanoUsdPerToken', 'maxInputTokens'] as const) {
    const incomplete = { ...price }; delete (incomplete as any)[field];
    throwsCode(() => actual(incomplete, usage, true), 'FACTORY_API_PRICING_UNVERIFIED');
    throwsCode(() => maximum(incomplete, 0, 0, true), 'FACTORY_API_PRICING_UNVERIFIED');
  }
  assert.equal(requireFactoryCacheWritePrice(price), price);
  assert.equal(actual({ ...price, cachedInputNanoUsdPerToken: 0 }, { ...usage, inputTokens: 5, cachedTokens: 5 }, true), 0);
});

test('ordinary, cache read, both writes and output are billed exactly once', () => {
  const cases = [
    [{ inputTokens: 10 }, 20],
    [{ inputTokens: 10, cachedTokens: 10 }, 1],
    [{ inputTokens: 10, cacheWriteTokens: 10, cacheWrite30mTokens: 10 }, 25],
    [{ inputTokens: 10, cacheWriteTokens: 10, cacheWrite12hTokens: 10 }, 40],
    [{ inputTokens: 20, cachedTokens: 3, cacheWriteTokens: 9, cacheWrite30mTokens: 4, cacheWrite12hTokens: 5, outputTokens: 2 }, 67],
  ] as const;
  for (const [overrides, cost] of cases) assert.equal(actual(price, { ...usage, ...overrides }, true), cost);
});

test('all write counters are required under coverage and must partition total input', () => {
  for (const field of ['cacheWriteTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens'] as const) {
    const incomplete = { ...usage }; delete (incomplete as any)[field];
    throwsCode(() => actual(price, incomplete, true), 'FACTORY_API_USAGE_UNVERIFIED');
  }
  for (const invalid of [
    { inputTokens: 3, cacheWriteTokens: 2, cacheWrite30mTokens: 1 },
    { inputTokens: 3, cacheWriteTokens: 4, cacheWrite30mTokens: 4 },
    { inputTokens: 3, cachedTokens: 2, cacheWriteTokens: 2, cacheWrite30mTokens: 2 },
    { inputTokens: 1, cachedTokens: 2 },
  ]) throwsCode(() => actual(price, { ...usage, ...invalid }, true), 'FACTORY_API_USAGE_UNVERIFIED');
});

test('legacy no-write protocol permits absent counters but refuses any positive write bucket', () => {
  const legacy = { inputTokens: 10, outputTokens: 5, cachedTokens: 8 };
  assert.equal(actual(price, legacy, false), 55);
  assert.equal(actual(price, { ...legacy, cacheWriteTokens: 0, cacheWrite12hTokens: 0 }, false), 55);
  for (const field of ['cacheWriteTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens']) {
    throwsCode(() => actual(price, { ...legacy, [field]: 1 }, false), 'FACTORY_API_CACHE_USAGE_UNPRICED');
  }
  const noReadPrice = { inputNanoUsdPerToken: 2000, outputNanoUsdPerToken: 10000 };
  throwsCode(() => actual(noReadPrice, legacy, false), 'FACTORY_API_CACHE_USAGE_UNPRICED');
  assert.equal(actual(noReadPrice, { ...legacy, cachedTokens: 0 }, false), 70);
});

test('maximum covers the worst approved input rate and bounded output', () => {
  assert.equal(maximum(price, 100, 10, true), 500);
  assert.equal(maximum(price, 100, 10, false), 300);
  assert.equal(maximum({ ...price, cachedInputNanoUsdPerToken: 9000 }, 100, 10, true), 1000);
  assert.equal(maximum({ ...price, cacheWrite30mNanoUsdPerToken: 12000 }, 100, 10, true), 1300);
  for (let ordinary = 0; ordinary <= 4; ordinary++) for (let cached = 0; cached <= 4; cached++) {
    const measured = { inputTokens: ordinary + cached + 5, outputTokens: 7, cachedTokens: cached,
      cacheWriteTokens: 5, cacheWrite30mTokens: 2, cacheWrite12hTokens: 3 };
    assert.ok(actual(price, measured, true) <= maximum(price, measured.inputTokens, measured.outputTokens, true));
  }
});

test('round total nanodollars once, never each bucket independently', () => {
  const tiny = { maxInputTokens: 1_049_600, inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 100,
    cachedInputNanoUsdPerToken: 100, cacheWrite30mNanoUsdPerToken: 100, cacheWrite12hNanoUsdPerToken: 100 };
  assert.equal(actual(tiny, { inputTokens: 4, outputTokens: 1, cachedTokens: 1,
    cacheWriteTokens: 2, cacheWrite30mTokens: 1, cacheWrite12hTokens: 1 }, true), 1);
  assert.equal(maximum(tiny, 4, 1, true), 1);
  assert.equal(maximum(tiny, 10, 0, true), 1);
  assert.equal(maximum(tiny, 10, 1, true), 2);
});

test('invalid prices and counters fail with static errors', () => {
  for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of Object.keys(usage)) throwsCode(() => actual(price, { ...usage, [field]: bad }, true), 'FACTORY_API_USAGE_UNVERIFIED');
    for (const field of Object.keys(price)) throwsCode(() => actual({ ...price, [field]: bad }, usage, true), 'FACTORY_API_PRICING_UNVERIFIED');
    throwsCode(() => maximum(price, bad, 1, true), 'FACTORY_API_USAGE_UNVERIFIED');
    throwsCode(() => maximum(price, 1, bad, true), 'FACTORY_API_USAGE_UNVERIFIED');
  }
  for (const field of ['inputNanoUsdPerToken', 'outputNanoUsdPerToken', 'cacheWrite30mNanoUsdPerToken', 'cacheWrite12hNanoUsdPerToken', 'maxInputTokens']) {
    throwsCode(() => actual({ ...price, [field]: 0 }, usage, true), 'FACTORY_API_PRICING_UNVERIFIED');
  }
  throwsCode(() => actual(price, { inputTokens: 0, outputTokens: 0 } as any, false), 'FACTORY_API_USAGE_UNVERIFIED');
  throwsCode(() => actual(price, usage, 'true' as any), 'FACTORY_API_USAGE_UNVERIFIED');
  throwsCode(() => actual(price, { ...usage, cacheWrite30mTokens: -1 }, false), 'FACTORY_API_USAGE_UNVERIFIED');
});

test('BigInt arithmetic preserves exact safe amounts and rejects final microUSD overflow', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const unit = { inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 1000 };
  assert.equal(maximum(unit, max, 0, false), max);
  assert.equal(actual(unit, { inputTokens: max, outputTokens: 0, cachedTokens: 0 }, false), max);
  throwsCode(() => maximum(unit, max, 1, false), 'FACTORY_API_COST_OVERFLOW');
  throwsCode(() => actual(unit, { inputTokens: max, outputTokens: 1, cachedTokens: 0 }, false), 'FACTORY_API_COST_OVERFLOW');
  throwsCode(() => maximum({ ...unit, inputNanoUsdPerToken: max }, max, max, false), 'FACTORY_API_COST_OVERFLOW');
});


test('explicit price tier accepts its boundary and rejects higher maximum or measured input', () => {
  const tier = {...price,maxInputTokens:10};
  assert.equal(maximum(tier,10,0,true),40);
  assert.equal(actual(tier,{...usage,inputTokens:10},true),20);
  throwsCode(()=>maximum(tier,11,0,true),'FACTORY_API_INPUT_TIER_UNVERIFIED');
  throwsCode(()=>actual(tier,{...usage,inputTokens:11},true),'FACTORY_API_INPUT_TIER_UNVERIFIED');
  const absent = {...price} as any; delete absent.maxInputTokens;
  throwsCode(()=>requireFactoryCacheWritePrice(absent),'FACTORY_API_PRICING_UNVERIFIED');
  // Legacy no-write protocols need no cap, but any explicit tier remains binding.
  const legacy = {inputNanoUsdPerToken:1000,outputNanoUsdPerToken:1000};
  assert.equal(maximum(legacy,11,0,false),11);
  assert.equal(actual(legacy,{inputTokens:11,outputTokens:0,cachedTokens:0},false),11);
  throwsCode(()=>maximum({...legacy,maxInputTokens:10},11,0,false),'FACTORY_API_INPUT_TIER_UNVERIFIED');
  throwsCode(()=>actual({...legacy,maxInputTokens:10},{inputTokens:11,outputTokens:0,cachedTokens:0},false),'FACTORY_API_INPUT_TIER_UNVERIFIED');
});
