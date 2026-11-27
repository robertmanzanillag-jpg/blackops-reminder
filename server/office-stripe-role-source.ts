import {
  STRIPE_AUDIT_ROLES, STRIPE_MAX_ROWS, STRIPE_WINDOW_DAYS, sourceDigest, stripeRecordId, validateRoleSnapshot,
  type RoleSnapshot, type StripeAuditRole, type StripeBlockCode,
} from "./office-role-snapshots";

/**
 * Read-only Stripe observation for the `control` and `revenue` office roles.
 *
 * - Only a RESTRICTED key (`rk_live_` / `rk_test_`) from STRIPE_READONLY_KEY is
 *   accepted. A full secret key (`sk_`) is refused without being sent: the
 *   office must never hold a key able to write to Stripe.
 * - GET-only to https://api.stripe.com/v1 with redirect:"error", per-request
 *   timeout, overall deadline and bounded pagination.
 * - The key lives only in the Authorization header; snapshots and errors never
 *   contain it, nor customer emails, names or card data (only aggregates).
 * - Revenue is split KONG vs Black Room from charge metadata
 *   (business/brand/app/product/source) or the statement descriptor/description.
 */
export const STRIPE_READONLY_KEY_ENV = "STRIPE_READONLY_KEY";
export const STRIPE_REQUEST_TIMEOUT_MS = 10_000;
export const STRIPE_READ_DEADLINE_MS = 40_000;
const API = "https://api.stripe.com";
const MAX_PAGES = 5;
const MAX_BODY_CHARS = 4_000_000;
const RESTRICTED = /^rk_(live|test)_[A-Za-z0-9]{10,255}$/;
const PAYOUT_STATUS = new Set(["paid", "pending", "in_transit", "canceled", "failed"]);

class StripeReadBlock extends Error {
  constructor(readonly code: StripeBlockCode) { super(code); this.name = "StripeReadBlock"; }
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const invalid = (): never => { throw new StripeReadBlock("STRIPE_RESPONSE_INVALID"); };
const nonNegInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const int = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) ? v : invalid();
const cur = (v: unknown) => typeof v === "string" && /^[a-z]{3}$/.test(v) ? v : invalid();

export function classifyStripeBusiness(charge: any): "kong" | "blackroom" | "unattributed" {
  const md = charge && typeof charge.metadata === "object" && charge.metadata ? charge.metadata : {};
  const texts = [md.business, md.brand, md.app, md.product, md.source, md.project, charge?.calculated_statement_descriptor, charge?.statement_descriptor, charge?.statement_descriptor_suffix, charge?.description]
    .filter((v): v is string => typeof v === "string").map(v => v.toLowerCase());
  for (const t of texts) {
    if (/\bkong\b/.test(t)) return "kong";
    if (/black\s*-?\s*room|blackroom/.test(t)) return "blackroom";
  }
  return "unattributed";
}

function createClient(key: string, fetch: Fetch, deadline: number, now: () => number, requestTimeoutMs: number) {
  const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20", "User-Agent": "office-role-audit" };
  return async function get(path: string, params: Array<[string, string]>): Promise<any> {
    const url = new URL(path, API);
    for (const [k, v] of params) url.searchParams.append(k, v);
    if (url.origin !== API || !url.pathname.startsWith("/v1/")) invalid();
    const remaining = deadline - now();
    if (remaining <= 0) throw new StripeReadBlock("STRIPE_TIMEOUT");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(requestTimeoutMs, remaining));
    try {
      let response: Response;
      try { response = await fetch(url.toString(), { method: "GET", headers, redirect: "error", signal: ctl.signal }); }
      catch { throw new StripeReadBlock(ctl.signal.aborted ? "STRIPE_TIMEOUT" : "STRIPE_NETWORK_ERROR"); }
      const status = response.status;
      if (status === 401) throw new StripeReadBlock("STRIPE_AUTH_REJECTED");
      if (status === 403) throw new StripeReadBlock("STRIPE_PERMISSION_DENIED");
      if (status === 429) throw new StripeReadBlock("STRIPE_RATE_LIMITED");
      if (status >= 500) throw new StripeReadBlock("STRIPE_UPSTREAM_ERROR");
      if (status !== 200) invalid();
      let text: string;
      try { text = await response.text(); } catch { throw new StripeReadBlock(ctl.signal.aborted ? "STRIPE_TIMEOUT" : "STRIPE_NETWORK_ERROR"); }
      if (text.length > MAX_BODY_CHARS) invalid();
      try { return JSON.parse(text); } catch { return invalid(); }
    } finally { clearTimeout(timer); }
  };
}

async function list(get: ReturnType<typeof createClient>, path: string, params: Array<[string, string]>) {
  const items: any[] = [];
  let after: string | null = null, truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await get(path, [...params, ["limit", "100"], ...(after ? [["starting_after", after] as [string, string]] : [])]);
    if (!body || body.object !== "list" || !Array.isArray(body.data) || typeof body.has_more !== "boolean") invalid();
    items.push(...body.data);
    if (!body.has_more || !body.data.length) return { items, truncated: false };
    const last = body.data[body.data.length - 1];
    if (typeof last?.id !== "string") invalid();
    after = last.id;
    truncated = page === MAX_PAGES - 1;
  }
  return { items, truncated };
}

async function readRevenue(get: ReturnType<typeof createClient>, since: number) {
  const { items, truncated } = await list(get, "/v1/charges", [["created[gte]", String(since)], ["expand[]", "data.balance_transaction"]]);
  const groups = new Map<string, { business: "kong" | "blackroom" | "unattributed"; currency: string; charges: number; grossMinor: number; refundedMinor: number; feeMinor: number; netMinor: number; disputed: number }>();
  let livemode: boolean | null = null;
  for (const c of items) {
    if (!c || c.object !== "charge" || typeof c.paid !== "boolean" || typeof c.livemode !== "boolean") invalid();
    livemode = livemode === null ? c.livemode : livemode && c.livemode;
    if (c.status !== "succeeded" || !c.paid) continue;
    const business = classifyStripeBusiness(c), currency = cur(c.currency), key = `${business}:${currency}`;
    const g = groups.get(key) || { business, currency, charges: 0, grossMinor: 0, refundedMinor: 0, feeMinor: 0, netMinor: 0, disputed: 0 };
    const amount = nonNegInt(c.amount), refunded = nonNegInt(c.amount_refunded ?? 0);
    const bt = c.balance_transaction && typeof c.balance_transaction === "object" ? c.balance_transaction : null;
    const fee = bt && bt.currency === currency ? nonNegInt(bt.fee) : 0;
    g.charges += 1; g.grossMinor += amount; g.refundedMinor += refunded; g.feeMinor += fee; g.netMinor += amount - refunded - fee;
    if (c.disputed === true) g.disputed += 1;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => `${a.business}:${a.currency}`.localeCompare(`${b.business}:${b.currency}`))
    .map(g => ({ id: stripeRecordId("revenue", g.business, g.currency), kind: "stripe_business_summary" as const, ...g }));
  return { rows, truncated, livemode };
}

async function readControl(get: ReturnType<typeof createClient>, since: number) {
  const balance = await get("/v1/balance", []);
  if (!balance || balance.object !== "balance" || !Array.isArray(balance.available) || !Array.isArray(balance.pending) || typeof balance.livemode !== "boolean") invalid();
  const bal = new Map<string, { availableMinor: number; pendingMinor: number }>();
  for (const [field, list] of [["availableMinor", balance.available], ["pendingMinor", balance.pending]] as const) {
    for (const b of list) { const c = cur(b?.currency), e = bal.get(c) || { availableMinor: 0, pendingMinor: 0 }; e[field] += int(b.amount); bal.set(c, e); }
  }
  const { items, truncated } = await list(get, "/v1/payouts", [["created[gte]", String(since)]]);
  const pay = new Map<string, { currency: string; status: string; payouts: number; amountMinor: number }>();
  for (const p of items) {
    if (!p || p.object !== "payout" || !PAYOUT_STATUS.has(p.status)) invalid();
    const currency = cur(p.currency), key = `${p.status}:${currency}`, e = pay.get(key) || { currency, status: p.status, payouts: 0, amountMinor: 0 };
    e.payouts += 1; e.amountMinor += int(p.amount); pay.set(key, e);
  }
  const rows: any[] = [...bal.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ id: stripeRecordId("balance", currency), kind: "stripe_balance", currency, ...v }));
  for (const [key, v] of [...pay.entries()].sort(([a], [b]) => a.localeCompare(b))) rows.push({ id: stripeRecordId("payouts", key), kind: "stripe_payout_summary", ...v });
  return { rows, truncated, livemode: balance.livemode as boolean };
}

/** Never throws for Stripe-side problems: returns a blocked snapshot with an explicit code. */
export async function readStripeRoleSnapshot(options: { owner: string; role: StripeAuditRole; key: string | null | undefined; fetch?: Fetch; now?: () => number; requestTimeoutMs?: number }): Promise<RoleSnapshot> {
  const now = options.now || Date.now, owner = options.owner;
  if (!owner.trim() || !STRIPE_AUDIT_ROLES.includes(options.role)) throw new Error("Unsupported audit source");
  const key = (options.key || "").trim();
  let rows: any[] = [], truncated = false, livemode: boolean | null = null, blocked: StripeBlockCode | null = null;
  if (!key) blocked = "STRIPE_KEY_MISSING";
  else if (!RESTRICTED.test(key)) blocked = "STRIPE_KEY_NOT_RESTRICTED";
  else {
    const get = createClient(key, options.fetch || fetch, now() + STRIPE_READ_DEADLINE_MS, now, options.requestTimeoutMs ?? STRIPE_REQUEST_TIMEOUT_MS);
    const since = Math.floor(now() / 1000) - STRIPE_WINDOW_DAYS * 86400;
    try {
      const out = options.role === "revenue" ? await readRevenue(get, since) : await readControl(get, since);
      if (out.rows.length > STRIPE_MAX_ROWS) { out.rows = out.rows.slice(0, STRIPE_MAX_ROWS); out.truncated = true; }
      ({ rows, truncated, livemode } = out);
    } catch (error) {
      blocked = error instanceof StripeReadBlock ? error.code : "STRIPE_RESPONSE_INVALID";
      rows = []; truncated = false; livemode = null;
    }
  }
  const body = { version: 1 as const, role: options.role, ownerKey: sourceDigest(owner), observedAt: new Date(now()).toISOString(), total: rows.length, rows, stripe: { blocked, truncated, windowDays: STRIPE_WINDOW_DAYS as 30, livemode } };
  return validateRoleSnapshot({ ...body, sourceDigest: sourceDigest(body) }, owner, now());
}
