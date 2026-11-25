import type { Express } from "express";
import { readFile } from "node:fs/promises";
import { getAuthenticatedCurrentUserId, getSystemUserId } from "./user-context";
import { configuredSoftwareFactoryStore } from "./software-factory-store-provider";
import { readFactoryOrderProposals, readFactoryRecoveredBuild } from "./software-factory-order-evidence";
import { summarizeOwnerOrderAdmission } from "./software-factory-company";
import { selfHealOfficeView } from "./office-self-heal";
import { admissionsToday, apiReadinessLabel, deriveFactoryAgents, orderShortLabel, ORDER_REASON_LABEL, type FactoryAgentsView, type FactoryAgentOrder } from "../shared/software-factory-agents";

type Store = Pick<typeof configuredSoftwareFactoryStore, "status" | "list" | "projects"> & Partial<Pick<typeof configuredSoftwareFactoryStore, "apiBudgetStatus" | "getCompletedJob">>;

async function readAutoAdmit(): Promise<{ enabled: boolean; since?: string; mappedIds?: string[]; maxPerDay: number | null } | undefined> {
  const path = process.env.SOFTWARE_FACTORY_OPERATOR_CONFIG;
  if (!path) return undefined;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return { enabled: raw?.autoAdmit?.enabled === true, since: typeof raw?.autoAdmit?.since === "string" ? raw.autoAdmit.since : undefined,
      mappedIds: Array.isArray(raw?.orders) ? raw.orders.map((o: { id?: unknown }) => String(o?.id)) : [],
      maxPerDay: Number.isSafeInteger(raw?.autoAdmit?.maxPerDay) ? raw.autoAdmit.maxPerDay : null };
  } catch { return undefined; }
}

/** Read-only owner board: every factory agent with a status derived from persisted state. No AI calls. */
export function registerSoftwareFactoryAgentsRoutes(app: Express, options: { store?: Store; readCouncil?: (owner: string) => Promise<any>; readConfig?: typeof readAutoAdmit; now?: () => Date; readCooldownRaw?: (owner: string) => Promise<string | null> } = {}) {
  const store = options.store ?? configuredSoftwareFactoryStore;
  const now = options.now ?? (() => new Date());
  const readCouncil = options.readCouncil ?? (async (owner: string) => { const raw = await (await (await import("./agent-council-store")).getCouncilStore()).read(owner); return raw ? JSON.parse(raw) : undefined; });
  const readConfig = options.readConfig ?? readAutoAdmit;
  app.get("/api/software-factory/agents", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const owner = getAuthenticatedCurrentUserId(req);
    if (!owner) return res.status(401).json({ error: "Inicia sesión para consultar la fábrica." });
    if (owner !== getSystemUserId()) return res.status(403).json({ error: "La fábrica pertenece al propietario configurado." });
    try {
      const at = now();
      const [state, jobs, projects] = await Promise.all([store.status(owner), store.list(owner), store.projects(owner)]);
      const [council, config, api] = await Promise.all([
        readCouncil(owner).catch(() => undefined), readConfig().catch(() => undefined),
        store.apiBudgetStatus ? store.apiBudgetStatus(owner).catch(() => undefined) : Promise.resolve(undefined)]);
      const { readProviderCooldowns, describeActiveProvider, AI_PROVIDER_COOLDOWN_OWNER } = await import("./ai-provider-credit-cooldown");
      const readRaw = options.readCooldownRaw ?? (async (key: string) => (await (await import("./agent-council-store")).getCouncilStore()).read(key));
      const cooldowns = await readProviderCooldowns({ read: () => readRaw(AI_PROVIDER_COOLDOWN_OWNER) }, at);
      // The web process may not hold the factory's Anthropic key: "configured" means the key or the flag is visible here.
      const claudeVisible = !!process.env.ANTHROPIC_API_KEY?.trim() || process.env.FACTORY_ANTHROPIC_FALLBACK_ENABLED?.trim().toLowerCase() === "true";
      const provider = { readable: cooldowns.readable, ...describeActiveProvider({ active: cooldowns.active, openAiConfigured: true, anthropicConfigured: claudeVisible }) };
      const orders: FactoryAgentOrder[] | undefined = Array.isArray(council?.company?.orders) ? council.company.orders : undefined;
      const summary = summarizeOwnerOrderAdmission(orders as any, config, at);
      const proposals = store.getCompletedJob ? await readFactoryOrderProposals({ owner, jobs, projects, getCompletedJob: (k, id) => store.getCompletedJob!(k, id), getRecoveredBuild: options.store ? undefined : readFactoryRecoveredBuild, now: at.getTime() }).catch(() => ({ proposals: [] })) : { proposals: [] };
      const orderText = new Map((orders ?? []).map(o => [o.id, o.text]));
      const usedCents = state.fixedCents + state.spentCents + state.reservedCents;
      const apiAny = api as { reason?: unknown; paidAdmissionReady?: unknown; remainingMicroUsd?: unknown } | undefined;
      const view: FactoryAgentsView = {
        checkedAt: at.toISOString(), paused: state.paused,
        api: { ...apiReadinessLabel(apiAny?.reason, apiAny?.paidAdmissionReady), remainingMicroUsd: typeof apiAny?.remainingMicroUsd === "number" ? apiAny.remainingMicroUsd : null },
        provider,
        budget: { month: state.month, limitCents: state.limitCents, usedCents, remainingCents: Math.max(0, state.limitCents - usedCents), configured: state.configured },
        admissions: { today: admissionsToday(jobs, at.getTime()), cap: config?.maxPerDay ?? null },
        openOrders: summary.ordersReadable ? { readable: true, total: summary.openOwnerOrders, reasons: Object.entries(summary.reasons).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, label: ORDER_REASON_LABEL[code] ?? code, count })) } : { readable: false, total: 0, reasons: [] },
        pullRequests: proposals.proposals.slice().sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 5)
          .filter(p => /^https:\/\/github\.com\//.test(p.prUrl)).map(p => ({ url: p.prUrl, orderLabel: orderShortLabel(orderText.get(p.orderId)), completedAt: p.completedAt })),
        agents: deriveFactoryAgents({ jobs, orders, now: at.getTime(), selfHeal: selfHealOfficeView(council?.officeExecution?.selfHeal, council?.officeExecution?.roleWork, at.getTime(), process.env.OFFICE_SELF_HEAL_ENABLED === "true" || council?.officeExecution?.selfHeal !== undefined) }),
        jobsListComplete: jobs.length < 100,
      };
      res.json(view);
    } catch { res.status(503).json({ error: "No se pudo leer el registro persistente de la fábrica. No se confirma actividad." }); }
  });
}
