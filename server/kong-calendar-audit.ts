import { assetSchema, dayInNewYork, dayPlus, networks, type Job, type Network } from "./kong-autopilot-core";
import { formatMetricoolMcpDate } from "./blackroom-metricool-bridge";

const brandId = 6475033;
export interface CalendarAuditInput { now: Date; jobs: Job[]; userId: string; token: string; verifiedNetworks: Network[]; }
type Row = Record<string, any>;
export interface CalendarDayNetwork { scheduled: number; scheduledPosts: number; verifiedVideoPosts: number; unverifiedMediaPosts: number;
  missing: number | null; duplicates: number; errors: number; unmatched: number; }
export async function auditKongCalendar(input: CalendarAuditInput, fetcher: typeof fetch = fetch) {
  if (!Number.isFinite(+input.now)) throw Error("invalid_audit_clock");
  const start = dayInNewYork(input.now), end = dayPlus(start, 13);
  const days = Array.from({ length: 14 }, (_, i) => ({ day: dayPlus(start, i), networks: Object.fromEntries(networks.map(n => [n,
    { scheduled: 0, scheduledPosts: 0, verifiedVideoPosts: 0, unverifiedMediaPosts: 0, missing: null, duplicates: 0, errors: 0, unmatched: 0 }])) as Record<Network, CalendarDayNetwork> }));
  const issues: string[] = [], jobResults: { jobId: string; network: Network; status: "matched" | "missing" | "mismatch" | "error" | "unknown"; remoteIds: string[] }[] = [];
  const known = input.jobs.filter(j => networks.includes(j.network) && j.day >= start && j.day <= end && Date.parse(j.at) > +input.now);
  let rows: Row[] = [], complete = true;
  try {
    if (!input.token?.trim() || !input.userId?.trim()) throw Error("calendar_credentials_missing");
    const params = new URLSearchParams({ blogId: String(brandId), userId: input.userId, integrationSource: "MCP", start: `${start}T00:00:00`,
      end: `${end}T23:59:59`, timezone: "America/New_York", extendedRange: "false" });
    const response = await fetcher(`https://app.metricool.com/api/v2/scheduler/posts?${params}`, {
      headers: { "X-Mc-Auth": input.token }, signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok || !response.body) throw Error("calendar_read_failed");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 2_000_000) throw Error("calendar_response_too_large"); chunks.push(value); }
    } catch (e) { await reader.cancel(); throw e; } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (Array.isArray(body)) rows = body;
    else if (body && Array.isArray(body.data)) {
      rows = body.data;
      if (Object.keys(body).some(k => k !== "data")) { complete = false; issues.push("calendar_envelope_completeness_unknown"); }
    } else throw Error("calendar_unrecognized_response");
    if (rows.length > 2000) throw Error("calendar_row_limit_exceeded");
  } catch (error) {
    complete = false;
    const reason = error instanceof Error ? error.message : "";
    issues.push(["calendar_credentials_missing", "calendar_read_failed", "calendar_response_too_large", "calendar_unrecognized_response", "calendar_row_limit_exceeded"].includes(reason)
      ? reason : "calendar_read_or_parse_failed");
    rows = [];
  }
  const records: { row: Row; id: string; network: Network; day: string; error: boolean; duplicate?: boolean }[] = [];
  const seen = new Map<string, string>(), fingerprints = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !["number", "string"].includes(typeof row.id) || !Array.isArray(row.providers)) {
      complete = false; issues.push("calendar_invalid_row"); continue;
    }
    if (row.blogId !== undefined && String(row.blogId) !== String(brandId)) { issues.push("wrong_brand_row_excluded"); continue; }
    if (row.draft !== false) continue;
    const wall = row.publicationDate?.dateTime;
    if (row.publicationDate?.timezone !== "America/New_York" || typeof wall !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall)
      || !Number.isFinite(Date.parse(`${wall}Z`))) { complete = false; issues.push("calendar_unrecognized_publication_time"); continue; }
    if (new Date(`${wall}Z`).toISOString().slice(0, 19) !== wall) { complete = false; issues.push("calendar_invalid_publication_time"); continue; }
    if (Date.parse(formatMetricoolMcpDate(wall, "America/New_York")) <= +input.now) continue;
    const day = wall.slice(0, 10), bucket = days.find(d => d.day === day); if (!bucket) continue;
    for (const network of networks) {
      if (!input.verifiedNetworks.includes(network)) continue;
      const providers = row.providers.filter((p: Row) => p?.network === network); if (!providers.length) continue;
      const id = String(row.id), identity = `${network}:${id}`;
      const serialized = JSON.stringify(row);
      if (seen.has(identity)) {
        if (seen.get(identity) !== serialized) { complete = false; issues.push("calendar_conflicting_duplicate_id"); }
        continue;
      }
      seen.set(identity, serialized);
      const error = providers.some((p: Row) => /error|fail|reject|cancel|deleted/i.test(String(p.status || "")))
        || /error|fail|reject|cancel|deleted/i.test(String(row.status || ""));
      if (!error && (providers.some((p: Row) => !["PENDING", "SCHEDULED"].includes(String(p.status || "").toUpperCase()))
        || (row.status !== undefined && !["PENDING", "SCHEDULED"].includes(String(row.status).toUpperCase())))) {
        complete = false; issues.push("calendar_unknown_schedule_status"); continue;
      }
      const record = { row, id, network, day, error, duplicate: false }; records.push(record);
      if (error) { bucket.networks[network].errors++; continue; }
      const fingerprint = JSON.stringify([network, wall, row.text]);
      if (fingerprints.has(fingerprint)) { bucket.networks[network].duplicates++; record.duplicate = true; }
      else { fingerprints.add(fingerprint); bucket.networks[network].scheduled++; bucket.networks[network].scheduledPosts++; }
    }
  }
  const matchedIds = new Set<string>(), knownVideoIds = new Set<string>();
  for (const job of known) {
    if (!input.verifiedNetworks.includes(job.network)) { jobResults.push({ jobId: job.id, network: job.network, status: "unknown", remoteIds: [] }); continue; }
    const exact = (r: typeof records[number]) => r.row.text === job.asset.caption
      && Date.parse(formatMetricoolMcpDate(r.row.publicationDate.dateTime, "America/New_York")) === Date.parse(job.at)
      && (!Array.isArray(r.row.mediaFiles) || !r.row.mediaFiles.length || r.row.mediaFiles.some((m: Row) => (m.download_url || m.url) === job.asset.mediaUrl));
    const candidates = records.filter(r => r.network === job.network && (job.receipt ? r.id === job.receipt : exact(r)));
    candidates.forEach(r => matchedIds.add(`${r.network}:${r.id}`));
    if (assetSchema.safeParse(job.asset).success) candidates.filter(r => exact(r) && !r.error).forEach(r => knownVideoIds.add(`${r.network}:${r.id}`));
    jobResults.push({ jobId: job.id, network: job.network, remoteIds: candidates.map(r => r.id),
      status: candidates.some(r => r.error) ? "error" : candidates.length ? (candidates.every(exact) ? "matched" : "mismatch") : complete ? "missing" : "unknown" });
  }
  for (const record of records) if (!record.error && !matchedIds.has(`${record.network}:${record.id}`)) days.find(d => d.day === record.day)!.networks[record.network].unmatched++;
  for (const record of records.filter(r => !r.error && !r.duplicate)) {
    const bucket = days.find(d => d.day === record.day)!.networks[record.network], row = record.row;
    const type = String(row.type || row.postType || "").toUpperCase();
    const media = Array.isArray(row.mediaFiles) ? row.mediaFiles : [];
    const explicitVideo = ["VIDEO", "REEL", "REELS"].includes(type)
      || record.network === "facebook" && row.facebookData?.type === "REEL"
      || media.some((m: Row) => String(m?.type).toLowerCase() === "video" && /^video\//.test(String(m?.mimeType || "")));
    const explicitNonVideo = ["TEXT", "IMAGE", "PHOTO", "CAROUSEL"].includes(type);
    if (explicitNonVideo && explicitVideo) bucket.unverifiedMediaPosts++;
    else if (explicitNonVideo) continue;
    else if (knownVideoIds.has(`${record.network}:${record.id}`) || explicitVideo) bucket.verifiedVideoPosts++;
    else bucket.unverifiedMediaPosts++;
  }
  for (const day of days) for (const network of networks) if (complete && input.verifiedNetworks.includes(network) && !day.networks[network].unverifiedMediaPosts)
    day.networks[network].missing = Math.max(0, 5 - day.networks[network].verifiedVideoPosts);
  return { checkedAt: input.now.toISOString(), brandId, start, end, complete, verifiedNetworks: [...new Set(input.verifiedNetworks.filter(n => networks.includes(n)))], issues: [...new Set(issues)], days, jobResults,
    interpretation: "Read-only scheduler coverage, not proof of publication or distribution. Scheduled counts all posts; missing counts the five-video target and is unknown for unverified media or incomplete responses." };
}
export type CalendarAudit = Awaited<ReturnType<typeof auditKongCalendar>>;
