import { createHash } from "node:crypto";
import {
  SELF_HEAL_APP_QA_ROUTE, SELF_HEAL_REPOSITORY, selfHealAppQaRecordId, type SelfHealObservedAudit,
} from "./office-self-heal";

/**
 * App QA -> office self-heal bridge.
 *
 * App QA runs in the Replit web process; the self-heal runner lives in the cloud office worker.
 * The web process persists ONE audit snapshot per complete scan into the council store
 * (AGENT_COUNCIL_STORAGE=postgres, same store the worker reads), and the worker injects it as the
 * `app-qa` role through extraAudits (server/office-worker-assembly.ts).
 *
 * Only code-fixable finding classes on the BlackOps web app (this repo) become findings; the
 * order text is the fixed template in office-self-heal.ts (code + route + evidence id). Detail
 * text, URLs with hosts and queries never leave this module. Setup/config/session findings are
 * owner messages, never orders. KONG and other repos go through Bug Patrol GitHub issues.
 *
 * A scan that did not cover everything (visual scout skipped, GitHub unreadable) is not persisted:
 * a partial scan must never "clear" a finding.
 */

export const APP_QA_ROLE = "app-qa" as const;
export const APP_QA_SELF_HEAL_NAMESPACE = (owner: string) => `app-qa-self-heal:v1:${owner}`;
export const APP_QA_MAX_FINDINGS = 20;
/** Snapshots older than this are ignored by the worker (App QA stopped running). */
export const APP_QA_SNAPSHOT_MAX_AGE_MS = 3 * 86400_000;

/** App names that are this repo's own web app when they carry no repo (synthetic scouts). */
const OWN_SYNTHETIC_APPS = new Set(["visual qa", "asitente", "asistente", "app qa"]);

export type AppQaFindingLike = {
  id: string; appName: string; sourceAgent: string; severity: string; title: string; area?: string; url?: string | null;
};

/** Finding class -> self-heal code. Anything not listed is not code-fixable (owner/setup). */
export function appQaSelfHealCode(finding: Pick<AppQaFindingLike, "sourceAgent" | "title" | "area">): string | null {
  const t = finding.title;
  switch (finding.sourceAgent) {
    case "visual-click-scout": return t === "QA visual fallo" ? "APP_QA_VISUAL_FAILED" : null;
    case "route-scout": return t === "Ruta mal formada" || t === "Ruta sin clasificación única" ? "APP_QA_ROUTE_INVENTORY" : null;
    case "link-click-scout": return t === "Pagina principal no responde bien" ? "APP_QA_PAGE_FAILING" : t === "Pagina lenta" ? "APP_QA_PAGE_SLOW" : null;
    case "api-scout": return t === "Health endpoint sin evidencia valida" ? "APP_QA_HEALTH_FAILING" : null;
    case "error-scout": return finding.area === "Runtime errors" ? "APP_QA_RUNTIME_ERROR" : t === "Health check fallando" ? "APP_QA_HEALTH_FAILING" : null;
    default: return null;
  }
}

/** Path part of the finding url (or the route itself). Null when it is not a safe path. */
export function appQaRoute(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  let path = url;
  if (!url.startsWith("/")) {
    try { path = new URL(url).pathname; } catch { return null; }
  }
  path = path.split(/[?#]/)[0] || "/";
  return SELF_HEAL_APP_QA_ROUTE.test(path) && !/kong/i.test(path) && !path.includes("..") ? path : null;
}

export const appQaSeverityQualifies = (severity: string) => severity === "critical" || severity === "high" || severity === "medium";

/** True when the finding belongs to this repo's web app. */
export function isOwnRepoFinding(finding: Pick<AppQaFindingLike, "appName">, repoByApp: ReadonlyMap<string, string | null>): boolean {
  const key = finding.appName.toLowerCase();
  const repo = repoByApp.get(key);
  if (repo) return repo.toLowerCase() === SELF_HEAL_REPOSITORY;
  return OWN_SYNTHETIC_APPS.has(key);
}

export type AppQaFactoryRoute = { code: string; qaRoute: string; recordId: string };

/** The factory order this finding maps to, or null when it is not one (other repo, setup, low). */
export function appQaFactoryRoute(finding: AppQaFindingLike, repoByApp: ReadonlyMap<string, string | null>): AppQaFactoryRoute | null {
  if (!appQaSeverityQualifies(finding.severity) || /kong/i.test(finding.appName) || !isOwnRepoFinding(finding, repoByApp)) return null;
  const code = appQaSelfHealCode(finding);
  const qaRoute = code ? appQaRoute(finding.url) : null;
  if (!code || !qaRoute) return null;
  return { code, qaRoute, recordId: selfHealAppQaRecordId(code, qaRoute) };
}

/** One observed audit from a complete scan (pure). */
export function buildAppQaSelfHealAudit(findings: readonly AppQaFindingLike[], repoByApp: ReadonlyMap<string, string | null>, completedAt: string): SelfHealObservedAudit {
  const out: SelfHealObservedAudit["findings"] = [];
  const records: SelfHealObservedAudit["records"] = {};
  for (const f of findings) {
    if (out.length >= APP_QA_MAX_FINDINGS) break;
    const r = appQaFactoryRoute(f, repoByApp);
    if (!r || records[r.recordId]) continue;
    out.push({ code: r.code, recordId: r.recordId });
    records[r.recordId] = { repo: SELF_HEAL_REPOSITORY, qaRoute: r.qaRoute };
  }
  const artifactId = createHash("sha256").update(JSON.stringify(out.map(x => `${x.code}:${x.recordId}`).sort())).digest("hex");
  return { role: APP_QA_ROLE, jobId: `app-qa:${completedAt}`, completedAt, status: "completed", completeCoverage: true, artifactId, findings: out, records };
}

/** Strict re-validation of a stored snapshot (the worker never trusts the store blindly). */
export function parseAppQaSelfHealSnapshot(raw: string | null, now: number): SelfHealObservedAudit[] {
  if (!raw) return [];
  let v: any;
  try { v = JSON.parse(raw); } catch { return []; }
  const a = v?.audit;
  if (v?.version !== 1 || !a || a.role !== APP_QA_ROLE || a.status !== "completed" || typeof a.completedAt !== "string") return [];
  const at = Date.parse(a.completedAt);
  if (!Number.isFinite(at) || at > now + 5 * 60_000 || now - at > APP_QA_SNAPSHOT_MAX_AGE_MS) return [];
  if (!Array.isArray(a.findings) || a.findings.length > APP_QA_MAX_FINDINGS || !a.records || typeof a.records !== "object") return [];
  const findings: SelfHealObservedAudit["findings"] = [];
  const records: SelfHealObservedAudit["records"] = {};
  for (const f of a.findings) {
    const rec = f && typeof f.recordId === "string" ? a.records[f.recordId] : undefined;
    if (!rec || rec.repo !== SELF_HEAL_REPOSITORY || typeof f.code !== "string" || typeof rec.qaRoute !== "string") return [];
    if (selfHealAppQaRecordId(f.code, rec.qaRoute) !== f.recordId || appQaRoute(rec.qaRoute) !== rec.qaRoute) return [];
    findings.push({ code: f.code, recordId: f.recordId });
    records[f.recordId] = { repo: SELF_HEAL_REPOSITORY, qaRoute: rec.qaRoute };
  }
  return [{ role: APP_QA_ROLE, jobId: `app-qa:${a.completedAt}`, completedAt: a.completedAt, status: "completed", completeCoverage: true,
    artifactId: typeof a.artifactId === "string" ? a.artifactId.slice(0, 64) : "", findings, records }];
}

type Store = { read(ns: string): Promise<string | null>; transact(ns: string, update: (raw: string | null) => Promise<string>): Promise<string> };
const defaultStore = async (): Promise<Store> => (await import("./agent-council-store")).getCouncilStore();

/** Web process: persist the snapshot of a complete scan. Needs the shared postgres council store. */
export async function persistAppQaSelfHealAudit(owner: string, audit: SelfHealObservedAudit, env: NodeJS.ProcessEnv = process.env, store: () => Promise<Store> = defaultStore): Promise<boolean> {
  if (env.AGENT_COUNCIL_STORAGE !== "postgres" && store === defaultStore) return false;
  const s = await store();
  await s.transact(APP_QA_SELF_HEAL_NAMESPACE(owner), async () => JSON.stringify({ version: 1, audit }));
  return true;
}

/** Cloud office worker: the latest App QA audit, re-validated. */
export async function readAppQaSelfHealAudits(owner: string, now = Date.now(), store: () => Promise<Store> = defaultStore): Promise<SelfHealObservedAudit[]> {
  return parseAppQaSelfHealSnapshot(await (await store()).read(APP_QA_SELF_HEAL_NAMESPACE(owner)), now);
}
