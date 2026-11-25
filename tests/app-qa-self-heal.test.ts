import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyOrder } from "../shared/agent-company";
import { emptyCompanyState } from "../shared/agent-company";
import {
  appQaFactoryRoute, appQaRoute, appQaSelfHealCode, buildAppQaSelfHealAudit, parseAppQaSelfHealSnapshot,
  persistAppQaSelfHealAudit, readAppQaSelfHealAudits,
} from "../server/app-qa-self-heal";
import { SELF_HEAL_REPOSITORY, isValidSelfHealOrder, planSelfHeal, selfHealAppQaRecordId } from "../server/office-self-heal";
import { companyOrderJob } from "../server/software-factory-company";
import { emptyCeoAlertLedger, planCeoAlerts, selfHealToCeoView } from "../server/ceo-alert-gate";
import { appQaCeoProblems, appQaCeoScope, parseBugPatrolLedger, runBugPatrolHandoffs, type BugPatrolLedger } from "../server/app-qa-agent";

const T0 = Date.parse("2026-11-25T10:00:00Z");
const iso = (t: number) => new Date(t).toISOString();
const own = new Map<string, string | null>([["blackops", SELF_HEAL_REPOSITORY], ["kong", "robertmanzanillag-jpg/kong-nightlife"]]);
const f = (over: Record<string, unknown>) => ({ id: "x", appName: "Visual QA", sourceAgent: "visual-click-scout", severity: "high", title: "QA visual fallo", area: "Home", url: "https://example.test/dashboard?x=1", ...over }) as any;

test("classification: only code-fixable classes on this repo become factory routes; setup, KONG and low never do", () => {
  assert.equal(appQaSelfHealCode(f({})), "APP_QA_VISUAL_FAILED");
  assert.equal(appQaSelfHealCode(f({ title: "APP_QA_BASE_URL no configurado" })), null);
  assert.equal(appQaSelfHealCode(f({ title: "Verificación visual pendiente de sesión" })), null);
  assert.equal(appQaRoute("https://h.test/a/b?q=1#z"), "/a/b");
  assert.equal(appQaRoute("/kong/x"), null);
  assert.equal(appQaRoute("not a url"), null);
  const r = appQaFactoryRoute(f({}), own)!;
  assert.deepEqual(r, { code: "APP_QA_VISUAL_FAILED", qaRoute: "/dashboard", recordId: selfHealAppQaRecordId("APP_QA_VISUAL_FAILED", "/dashboard") });
  assert.equal(appQaFactoryRoute(f({ severity: "low" }), own), null);
  assert.equal(appQaFactoryRoute(f({ appName: "kong", sourceAgent: "link-click-scout", title: "Pagina principal no responde bien" }), own), null);
  assert.ok(appQaFactoryRoute(f({ appName: "blackops", sourceAgent: "api-scout", title: "Health endpoint sin evidencia valida", severity: "critical", url: "https://b.test/api/health" }), own));
});

const admitted = (order: CompanyOrder) => {
  assert.ok(isValidSelfHealOrder(order));
  assert.doesNotThrow(() => companyOrderJob(order, { id: "asistente", repo: SELF_HEAL_REPOSITORY } as any, 1));
};

test("App QA finding becomes ONE admitted factory order with code + route + evidence; idempotent; cleared by next complete scan", () => {
  const findings = [f({}), f({ id: "dup" }), f({ title: "APP_QA_BASE_URL no configurado" })];
  const audit = buildAppQaSelfHealAudit(findings, own, iso(T0));
  assert.equal(audit.findings.length, 1);
  const out = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: "o", now: T0 + 1000, maxPerDay: 5, extraAudits: [audit] });
  assert.equal(out.created.length, 1);
  const o = out.created[0];
  assert.equal(o.selfHeal!.role, "app-qa"); assert.equal(o.selfHeal!.qaRoute, "/dashboard");
  assert.ok(o.text.includes("APP_QA_VISUAL_FAILED") && o.text.includes("/dashboard") && o.text.includes(audit.findings[0].recordId!.slice(0, 16)));
  admitted(o);
  assert.equal(isValidSelfHealOrder({ ...o, selfHeal: { ...o.selfHeal!, qaRoute: "/other" } }), false);
  const { qaRoute: _r, ...noRoute } = o.selfHeal!;
  assert.equal(isValidSelfHealOrder({ ...o, selfHeal: noRoute }), false);
  const again = planSelfHeal({ state: out.state, company: out.company, journal: { jobs: [] }, owner: "o", now: T0 + 2000, maxPerDay: 5, extraAudits: [audit] });
  assert.equal(again.created.length, 0);
  const fixed = buildAppQaSelfHealAudit([], own, iso(T0 + 3600_000));
  const later = planSelfHeal({ state: again.state, company: again.company, journal: { jobs: [] }, owner: "o", now: T0 + 3601_000, maxPerDay: 5, extraAudits: [fixed] });
  assert.equal(later.state.entries[0].status, "cleared");
  // The self-heal CEO view leaves app-qa factory work and its resolution to the App QA gate (no duplicate messages).
  assert.equal(selfHealToCeoView(again.state.entries).problems.length, 0);
  assert.equal(selfHealToCeoView(later.state.entries).resolved.size, 0);
});

test("snapshot: persisted by the web process, re-validated and age-limited by the worker; tampering fails closed", async () => {
  let raw: string | null = null;
  const store = async () => ({ read: async () => raw, transact: async (_ns: string, u: (r: string | null) => Promise<string>) => (raw = await u(raw)) });
  const audit = buildAppQaSelfHealAudit([f({})], own, iso(T0));
  assert.equal(await persistAppQaSelfHealAudit("o", audit, {}, store), true);
  assert.equal((await readAppQaSelfHealAudits("o", T0 + 1000, store))[0].findings.length, 1);
  assert.deepEqual(await readAppQaSelfHealAudits("o", T0 + 4 * 86400_000, store), []);
  const bad = JSON.parse(raw!); bad.audit.records[audit.findings[0].recordId!].qaRoute = "/elsewhere";
  assert.deepEqual(parseAppQaSelfHealSnapshot(JSON.stringify(bad), T0 + 1000), []);
  assert.deepEqual(parseAppQaSelfHealSnapshot("nope", T0), []);
});

test("CEO message says where it is worked on; partial scans never resolve; one Resuelto after a complete scan", () => {
  const kongFinding = f({ id: "k", appName: "kong", sourceAgent: "link-click-scout", title: "Pagina principal no responde bien", severity: "high" });
  const bugPatrol = { handoffs: [{ findingId: "k", appName: "kong", severity: "high", title: kongFinding.title, repoFullName: "robertmanzanillag-jpg/kong-nightlife", status: "created", issueUrl: "https://github.com/robertmanzanillag-jpg/kong-nightlife/issues/9" }] } as any;
  const problems = appQaCeoProblems({ findings: [f({}), kongFinding], bugPatrol }, own);
  assert.match(problems[0].where!, /app-qa:APP_QA_VISUAL_FAILED.*\/dashboard/);
  assert.match(problems[1].where!, /kong-nightlife.*@codex fix.*issues\/9/);
  const first = planCeoAlerts({ ledger: emptyCeoAlertLedger(), problems, scope: appQaCeoScope(true), now: T0 });
  assert.equal(first.messages.length, 2);
  assert.match(first.messages[0].text, /Se está trabajando en: fábrica/);
  const partial = planCeoAlerts({ ledger: first.ledger, problems: [], scope: appQaCeoScope(false), now: T0 + 1000 });
  assert.equal(partial.messages.length, 0);
  const complete = planCeoAlerts({ ledger: first.ledger, problems: [], scope: appQaCeoScope(true), now: T0 + 2000 });
  assert.equal(complete.messages.filter(m => m.text.startsWith("✅ Resuelto")).length, 2);
});

test("Bug Patrol: one issue per finding across restarts; this repo's factory findings skipped; dropped when gone", async () => {
  let ledger: BugPatrolLedger = parseBugPatrolLedger(null);
  const ledgerStore = { load: async () => JSON.parse(JSON.stringify(ledger)), save: async (l: BugPatrolLedger) => { ledger = l; } };
  let created = 0;
  const createHandoff = async () => ({ status: "created", issueUrl: `https://github.com/robertmanzanillag-jpg/kong-nightlife/issues/${++created}`, issueNumber: created });
  const apps = [{ name: "kong", githubRepo: "robertmanzanillag-jpg/kong-nightlife" }, { name: "blackops", githubRepo: SELF_HEAL_REPOSITORY }] as any;
  const kong = f({ id: "k", appName: "kong", sourceAgent: "link-click-scout", title: "Pagina principal no responde bien" });
  const mine = f({ id: "m", appName: "blackops", sourceAgent: "link-click-scout", title: "Pagina principal no responde bien" });
  const r1 = await runBugPatrolHandoffs("u1", apps, [kong, mine], { skipFindingIds: new Set(["m"]), ledgerStore, createHandoff, completeScan: true });
  assert.equal(created, 1); assert.equal(r1.handoffs.length, 1);
  // A fresh process (different user map) still reuses the same issue.
  const r2 = await runBugPatrolHandoffs("u2", apps, [kong], { ledgerStore, createHandoff, completeScan: true });
  assert.equal(created, 1); assert.equal(r2.handoffs[0].issueUrl, "https://github.com/robertmanzanillag-jpg/kong-nightlife/issues/1");
  await runBugPatrolHandoffs("u3", apps, [], { ledgerStore, createHandoff, completeScan: true });
  assert.deepEqual(ledger.issues, {});
});
