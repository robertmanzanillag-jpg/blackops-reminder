// Single Metricool writer: the cloud (GitHub Actions) owns the Clippers brands, the Mac never writes to them.
//
// On 2026-11-19 a Mac run created 10 TikTok drafts on brand 6431685 that filled Metricool's daily cap and blocked
// the cloud publisher. The LaunchAgent gate (macLaneGate) fails open without the database and only guards the
// agent entry points, so a manual or leftover Mac run could still write. This check sits at the write itself
// (portfolio adapter schedule(), the Mac ledger guard reserve()) and fails closed: no database, no network needed.
//
// - Cloud runtime = GITHUB_ACTIONS=true (set by Actions on every runner) or CLIPPERS_RUNTIME=cloud.
// - Cloud-owned brands default to the four Clippers brands. CLIPPERS_CLOUD_OWNED_BRANDS (comma list) replaces
//   the list; "none" empties it (owner rollback, together with `clippers-mac-retire.sh restore`).
// - CLIPPERS_MAC_METRICOOL_WRITES=owner_override lets the Mac write again (explicit owner decision, e.g. rollback).

export const DEFAULT_CLOUD_OWNED_BRANDS = Object.freeze([6431685, 6431687, 6591612, 6595747]);
export const MAC_WRITE_REFUSED = 'cloud_owned_brand_mac_write_refused';

export function isCloudRuntime(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' || env.CLIPPERS_RUNTIME === 'cloud';
}

export function cloudOwnedBrands(env = process.env) {
  const raw = String(env.CLIPPERS_CLOUD_OWNED_BRANDS ?? '').trim();
  if (!raw) return new Set(DEFAULT_CLOUD_OWNED_BRANDS);
  if (raw.toLowerCase() === 'none') return new Set();
  const ids = raw.split(',').map(v => Number(v.trim())).filter(n => Number.isInteger(n) && n > 0);
  return new Set(ids.length ? ids : DEFAULT_CLOUD_OWNED_BRANDS); // unparsable -> keep the safe default
}

/** null when this process may write to the brand, else the refusal code. */
export function metricoolWriteRefusal(brandId, env = process.env) {
  if (isCloudRuntime(env)) return null;
  if (env.CLIPPERS_MAC_METRICOOL_WRITES === 'owner_override') return null;
  const id = Number(brandId);
  if (!Number.isInteger(id) || id <= 0) return MAC_WRITE_REFUSED; // unknown destination: fail closed
  return cloudOwnedBrands(env).has(id) ? MAC_WRITE_REFUSED : null;
}
