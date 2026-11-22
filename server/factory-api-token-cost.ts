/** Pure billing arithmetic. No provider, configuration, storage or default prices. */
export interface FactoryTextTokenPrice {
  /** Explicit input-token boundary covered by this approved price tier. */
  maxInputTokens?: number;
  inputNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
  cachedInputNanoUsdPerToken?: number;
  cacheWrite30mNanoUsdPerToken?: number;
  cacheWrite12hNanoUsdPerToken?: number;
}
export interface FactoryTextTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens?: number;
  cacheWrite30mTokens?: number;
  cacheWrite12hTokens?: number;
}
export type FactoryCacheWritePrice = FactoryTextTokenPrice & Required<Pick<FactoryTextTokenPrice,
  'cachedInputNanoUsdPerToken' | 'cacheWrite30mNanoUsdPerToken' | 'cacheWrite12hNanoUsdPerToken' | 'maxInputTokens'>>;
export type FactoryTokenCostCode = 'FACTORY_API_PRICING_UNVERIFIED' | 'FACTORY_API_CACHE_USAGE_UNPRICED'
  | 'FACTORY_API_USAGE_UNVERIFIED' | 'FACTORY_API_COST_OVERFLOW' | 'FACTORY_API_INPUT_TIER_UNVERIFIED';
export class FactoryTokenCostError extends Error {
  constructor(readonly code: FactoryTokenCostCode) { super(code); this.name = 'FactoryTokenCostError'; }
}
const fail = (code: FactoryTokenCostCode): never => { throw new FactoryTokenCostError(code); };
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => amount(value) && value > 0;
function validatePrice(price: FactoryTextTokenPrice): void {
  if (!price || !positive(price.inputNanoUsdPerToken) || !positive(price.outputNanoUsdPerToken)) fail('FACTORY_API_PRICING_UNVERIFIED');
  if (price.maxInputTokens !== undefined && !positive(price.maxInputTokens)) fail('FACTORY_API_PRICING_UNVERIFIED');
  for (const rate of [price.cachedInputNanoUsdPerToken, price.cacheWrite30mNanoUsdPerToken, price.cacheWrite12hNanoUsdPerToken]) {
    if (rate !== undefined && !amount(rate)) fail('FACTORY_API_PRICING_UNVERIFIED');
  }
  for (const rate of [price.cacheWrite30mNanoUsdPerToken, price.cacheWrite12hNanoUsdPerToken]) {
    if (rate !== undefined && !positive(rate)) fail('FACTORY_API_PRICING_UNVERIFIED');
  }
}
/** Coverage requires all approved rates even when the eventual measured buckets are zero. */
export function requireFactoryCacheWritePrice(price: FactoryTextTokenPrice): FactoryCacheWritePrice {
  validatePrice(price);
  if (!amount(price.cachedInputNanoUsdPerToken) || !positive(price.cacheWrite30mNanoUsdPerToken)
    || !positive(price.cacheWrite12hNanoUsdPerToken) || !positive(price.maxInputTokens)) fail('FACTORY_API_PRICING_UNVERIFIED');
  return price as FactoryCacheWritePrice;
}
function microUsd(nanoUsd: bigint): number {
  const rounded = (nanoUsd + 999n) / 1000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) fail('FACTORY_API_COST_OVERFLOW');
  return Number(rounded);
}
/** Reserve against the most expensive input bucket, rounding the entire cost once. */
export function factoryTextMaximumMicroUsd(price: FactoryTextTokenPrice, maxInput: number, maxOutput: number,
  cacheWriteCoverage: boolean): number {
  validatePrice(price);
  if (cacheWriteCoverage) requireFactoryCacheWritePrice(price);
  if (typeof cacheWriteCoverage !== 'boolean' || !amount(maxInput) || !amount(maxOutput)) fail('FACTORY_API_USAGE_UNVERIFIED');
  if (price.maxInputTokens !== undefined && maxInput > price.maxInputTokens) fail('FACTORY_API_INPUT_TIER_UNVERIFIED');
  const rates = [price.inputNanoUsdPerToken, price.cachedInputNanoUsdPerToken ?? 0,
    ...(cacheWriteCoverage ? [price.cacheWrite30mNanoUsdPerToken!, price.cacheWrite12hNanoUsdPerToken!] : [])];
  const inputRate = Math.max(...rates);
  return microUsd(BigInt(maxInput) * BigInt(inputRate) + BigInt(maxOutput) * BigInt(price.outputNanoUsdPerToken));
}
/** Input includes ordinary, cached-read and cache-write tokens; no bucket is billed twice. */
export function factoryTextActualMicroUsd(price: FactoryTextTokenPrice, usage: FactoryTextTokenUsage,
  cacheWriteCoverage: boolean): number {
  validatePrice(price);
  if (cacheWriteCoverage) requireFactoryCacheWritePrice(price);
  if (typeof cacheWriteCoverage !== 'boolean' || !usage || !amount(usage.inputTokens)
    || !amount(usage.outputTokens) || !amount(usage.cachedTokens)) fail('FACTORY_API_USAGE_UNVERIFIED');
  if (price.maxInputTokens !== undefined && usage.inputTokens > price.maxInputTokens) fail('FACTORY_API_INPUT_TIER_UNVERIFIED');
  const writes = [usage.cacheWriteTokens, usage.cacheWrite30mTokens, usage.cacheWrite12hTokens];
  if (writes.some(value => value !== undefined && !amount(value))) fail('FACTORY_API_USAGE_UNVERIFIED');
  if (cacheWriteCoverage && writes.some(value => value === undefined)) fail('FACTORY_API_USAGE_UNVERIFIED');
  if (!cacheWriteCoverage && writes.some(value => value !== undefined && value > 0)) fail('FACTORY_API_CACHE_USAGE_UNPRICED');
  const totalWrites = BigInt(usage.cacheWriteTokens ?? 0), shortWrites = BigInt(usage.cacheWrite30mTokens ?? 0),
    longWrites = BigInt(usage.cacheWrite12hTokens ?? 0), cached = BigInt(usage.cachedTokens), input = BigInt(usage.inputTokens);
  if (cacheWriteCoverage && shortWrites + longWrites !== totalWrites || cached + totalWrites > input) fail('FACTORY_API_USAGE_UNVERIFIED');
  if (usage.cachedTokens > 0 && price.cachedInputNanoUsdPerToken === undefined) fail('FACTORY_API_CACHE_USAGE_UNPRICED');
  const ordinary = input - cached - totalWrites;
  return microUsd(ordinary * BigInt(price.inputNanoUsdPerToken) + cached * BigInt(price.cachedInputNanoUsdPerToken ?? 0)
    + shortWrites * BigInt(price.cacheWrite30mNanoUsdPerToken ?? 0) + longWrites * BigInt(price.cacheWrite12hNanoUsdPerToken ?? 0)
    + BigInt(usage.outputTokens) * BigInt(price.outputNanoUsdPerToken));
}
