// Read-only view of what is still scheduled in Metricool, so the Social Hub calendar shows everything
// during the migration. Nothing here schedules or changes Metricool posts.
import { METRICOOL_IMPORTED_ACCOUNTS } from "@shared/social-hub-accounts";

export interface MetricoolCalendarItem {
  id: string;
  brand: string;
  publishAt: string; // ISO with offset
  text: string;
  networks: string[];
  statuses: string[];
  media: string[];
}

const API = "https://app.metricool.com";

/** "2026-11-25T11:00:00" in an IANA zone -> ISO instant. */
export function zonedToIso(local: string, timeZone: string): string {
  const asUtc = new Date(`${local}Z`);
  if (Number.isNaN(asUtc.getTime())) return local;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(asUtc).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  const seen = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(asUtc.getTime() - (seen - asUtc.getTime())).toISOString();
}

export function brandsByBlogId(): Map<number, string> {
  const m = new Map<number, string>();
  for (const a of METRICOOL_IMPORTED_ACCOUNTS) if (!m.has(a.metricoolBlogId)) m.set(a.metricoolBlogId, a.brand);
  return m;
}

export function normalize(row: any, brand: string): MetricoolCalendarItem | null {
  const when = row?.publicationDate?.dateTime;
  if (!when) return null;
  const providers: any[] = Array.isArray(row.providers) ? row.providers : [];
  return {
    id: String(row.id ?? row.uuid),
    brand,
    publishAt: zonedToIso(when, row.publicationDate.timezone || "America/New_York"),
    text: String(row.text ?? "").slice(0, 280),
    networks: providers.map((p) => String(p.network)),
    statuses: providers.map((p) => String(p.status ?? "")),
    media: Array.isArray(row.media) ? row.media.slice(0, 4).map(String) : [],
  };
}

let cache: { key: string; at: number; items: MetricoolCalendarItem[] } | null = null;

export async function metricoolScheduled(
  from: Date,
  to: Date,
  opts: { token?: string; userId?: string; fetcher?: typeof fetch; now?: () => number } = {},
): Promise<{ items: MetricoolCalendarItem[]; errors: string[]; configured: boolean }> {
  const token = opts.token ?? process.env.METRICOOL_USER_TOKEN;
  const userId = opts.userId ?? process.env.METRICOOL_USER_ID;
  if (!token || !userId) return { items: [], errors: [], configured: false };
  const f = opts.fetcher ?? fetch;
  const now = (opts.now ?? Date.now)();
  const key = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
  if (cache && cache.key === key && now - cache.at < 5 * 60_000) return { items: cache.items, errors: [], configured: true };

  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const items: MetricoolCalendarItem[] = [];
  const errors: string[] = [];
  for (const [blogId, brand] of Array.from(brandsByBlogId())) {
    try {
      const url = new URL("/api/v2/scheduler/posts", API);
      Object.entries({ blogId, userId, start: fmt(from), end: fmt(to), timezone: "America/New_York", extendedRange: "false" })
        .forEach(([k, v]) => url.searchParams.set(k, String(v)));
      const res = await f(url, { headers: { "X-Mc-Auth": token, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { errors.push(`${brand}: HTTP ${res.status}`); continue; }
      const body: any = await res.json();
      const rows: any[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      for (const r of rows) {
        const st = (Array.isArray(r.providers) ? r.providers : []).map((p: any) => String(p.status ?? "").toUpperCase());
        if (r.draft || (st.length && st.every((s: string) => s === "PUBLISHED" || s === "ERROR"))) continue;
        const it = normalize(r, brand);
        if (it) items.push(it);
      }
    } catch (e) {
      errors.push(`${brand}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  items.sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  if (!errors.length) cache = { key, at: now, items };
  return { items, errors, configured: true };
}
