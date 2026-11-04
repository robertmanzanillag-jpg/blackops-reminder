// Live status for the agents building.
//
// Every agent maps to a cheap, read-only GET endpoint that already exists on the
// server. Endpoints that run full scans on GET (App QA, Cybersecurity) are NOT
// polled here; those agents read the stored developer-health dashboard instead
// and keep their full scan on demand from their own page.
//
// This module is pure (no React, no fetch) so it can be unit tested with node.

export type AgentLiveState = "working" | "needs-setup" | "error" | "offline" | "checking";

export type AgentLiveStatus = {
  state: AgentLiveState;
  label: string;
  detail?: string;
};

export type AgentProbe = {
  key: string;
  url: string;
  intervalMs: number;
  kind:
    | "calendar"
    | "ready-checks"
    | "github"
    | "dropshipping"
    | "marketing"
    | "portfolio"
    | "radio"
    | "clippers"
    | "automations"
    | "dev-health"
    | "legal";
  onDemandNote?: string;
};

const MINUTE = 60_000;

export const agentProbes: Record<string, AgentProbe> = {
  assistant: { key: "calendar-status", url: "/api/calendar/status", intervalMs: MINUTE, kind: "calendar" },
  ceo: { key: "ceo-readiness", url: "/api/ceo/readiness", intervalMs: 2 * MINUTE, kind: "ready-checks" },
  revenue: { key: "revenue-readiness", url: "/api/stripe/revenue-readiness", intervalMs: 2 * MINUTE, kind: "ready-checks" },
  dropshipping: { key: "dropshipping-readiness", url: "/api/dropshipping-ceo/launch-readiness", intervalMs: 2 * MINUTE, kind: "dropshipping" },
  "marketing-cmo": { key: "marketing-snapshot", url: "/api/marketing-command-center", intervalMs: 2 * MINUTE, kind: "marketing" },
  code: { key: "github-status", url: "/api/github/status", intervalMs: 2 * MINUTE, kind: "github" },
  github: { key: "github-status", url: "/api/github/status", intervalMs: 2 * MINUTE, kind: "github" },
  "claude-reviewer": { key: "github-status", url: "/api/github/status", intervalMs: 2 * MINUTE, kind: "github" },
  portfolio: { key: "portfolio-summary", url: "/api/portfolio/summary", intervalMs: 2 * MINUTE, kind: "portfolio" },
  radio: { key: "radio-slots", url: "/api/radio/slots", intervalMs: 2 * MINUTE, kind: "radio" },
  clippers: { key: "clippers-runtime", url: "/api/clippers/runtime-status", intervalMs: MINUTE, kind: "clippers" },
  automations: { key: "automation-summary", url: "/api/automation-manager/summary", intervalMs: MINUTE, kind: "automations" },
  cybersecurity: {
    key: "dev-health-dashboard",
    url: "/api/developer-health/dashboard",
    intervalMs: 2 * MINUTE,
    kind: "dev-health",
    onDemandNote: "El escaneo completo de seguridad corre bajo demanda desde su pagina.",
  },
  "app-qa": {
    key: "dev-health-dashboard",
    url: "/api/developer-health/dashboard",
    intervalMs: 2 * MINUTE,
    kind: "dev-health",
    onDemandNote: "El escaneo completo de QA corre bajo demanda desde su pagina.",
  },
  control: { key: "dev-health-dashboard", url: "/api/developer-health/dashboard", intervalMs: 2 * MINUTE, kind: "dev-health" },
  // Not fetched by the building: it reuses the legal query the office page already runs.
  legal: { key: "legal-compliance-reports", url: "/api/legal-compliance/reports", intervalMs: MINUTE, kind: "legal" },
};

export type ProbeResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; body: unknown }
  | { ok: false; status: 0; body: null; networkError: true };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function missingChecks(checks: unknown): string[] {
  const obj = asObject(checks);
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, value]) => value === false || (asObject(value) && asObject(value)!.ok === false))
    .map(([name]) => name);
}

export function summarizeProbe(probe: AgentProbe, result: ProbeResult | undefined): AgentLiveStatus {
  if (!result) return { state: "checking", label: "Verificando..." };
  if ("networkError" in result) {
    return { state: "offline", label: "Servidor sin respuesta", detail: "No se pudo contactar el backend de BlackOps." };
  }
  if (result.status === 401 || result.status === 403) {
    return { state: "needs-setup", label: "Requiere sesion", detail: "Inicia sesion en BlackOps para ver su estado." };
  }
  const body = asObject(result.body);
  const bodyError = body ? str(body.error) : null;
  if (!result.ok || bodyError) {
    return { state: "error", label: "Con error", detail: bodyError || `El endpoint respondio ${result.status}.` };
  }

  switch (probe.kind) {
    case "calendar": {
      const google = body?.google === true;
      const zoho = body?.zoho === true;
      if (!google && !zoho) return { state: "needs-setup", label: "Calendario sin conectar", detail: "Conecta Google Calendar o Zoho." };
      return { state: "working", label: "Agenda sincronizada", detail: [google && "Google", zoho && "Zoho"].filter(Boolean).join(" + ") };
    }
    case "ready-checks": {
      if (body?.ready === true) return { state: "working", label: "Operativo" };
      const missing = missingChecks(body?.checks);
      return {
        state: "needs-setup",
        label: "Falta configuracion",
        detail: missing.length ? `Pendiente: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}` : undefined,
      };
    }
    case "github": {
      if (body?.connected !== true) return { state: "needs-setup", label: "GitHub sin conectar" };
      const login = str(asObject(body.user)?.login);
      return { state: "working", label: "Conectado a GitHub", detail: login ? `@${login}` : undefined };
    }
    case "dropshipping": {
      const readiness = asObject(body?.launchReadiness);
      const status = str(readiness?.status);
      const summary = str(readiness?.summary) || undefined;
      if (status === "blocked_safety") return { state: "error", label: "Bloqueado por seguridad", detail: summary };
      if (status === "blocked_needs_accounts") return { state: "needs-setup", label: "Faltan cuentas", detail: summary };
      if (status === "ready_for_test_order") return { state: "working", label: "Listo para orden de prueba", detail: summary };
      return { state: "working", label: "Modo pre-cuentas", detail: summary };
    }
    case "marketing": {
      const clients = num(asObject(body?.capacity)?.activeClients);
      return { state: "working", label: "Marketing al dia", detail: clients !== null ? plural(clients, "cliente", "clientes") : undefined };
    }
    case "portfolio": {
      if (num(body?.totalValue) === null) return { state: "needs-setup", label: "Sin datos de portafolio" };
      return { state: "working", label: "Portafolio al dia" };
    }
    case "radio": {
      const slots = Array.isArray(result.body) ? result.body.length : null;
      if (slots === null) return { state: "working", label: "Respondiendo" };
      if (slots === 0) return { state: "needs-setup", label: "Sin eventos de radio", detail: "No hay eventos proximos en el calendario." };
      return { state: "working", label: "Programando radio", detail: plural(slots, "evento proximo", "eventos proximos") };
    }
    case "clippers": {
      const status = str(body?.status) || str(body?.state);
      const next = str(body?.nextAction) || undefined;
      if (status === "blocked" || status === "stale") return { state: "needs-setup", label: `Worker ${status === "blocked" ? "bloqueado" : "detenido"}`, detail: next };
      if (status === "failed" || status === "error") return { state: "error", label: "Worker con error", detail: next };
      return { state: "working", label: status ? `Worker: ${status}` : "Worker activo", detail: next };
    }
    case "automations": {
      const active = num(body?.active) ?? 0;
      const failed = num(body?.failed) ?? 0;
      const pending = num(body?.pendingApproval) ?? 0;
      const extra = pending ? `${plural(pending, "aprobacion pendiente", "aprobaciones pendientes")}` : undefined;
      if (failed > 0) return { state: "error", label: plural(failed, "automatizacion fallida", "automatizaciones fallidas"), detail: extra };
      if (active === 0) return { state: "needs-setup", label: "Sin automatizaciones activas", detail: extra };
      return { state: "working", label: plural(active, "activa", "activas"), detail: extra };
    }
    case "dev-health": {
      const summary = asObject(body?.summary);
      const apps = num(summary?.totalApps) ?? 0;
      const critical = num(summary?.criticalIncidents) ?? 0;
      const open = num(summary?.openIncidents) ?? 0;
      const down = num(summary?.down) ?? 0;
      const note = probe.onDemandNote;
      if (apps === 0) return { state: "needs-setup", label: "Sin apps registradas", detail: note };
      if (critical > 0 || down > 0) {
        return {
          state: "error",
          label: critical > 0 ? plural(critical, "incidente critico", "incidentes criticos") : plural(down, "app caida", "apps caidas"),
          detail: note,
        };
      }
      return {
        state: "working",
        label: open > 0 ? `Vigilando ${plural(open, "incidente", "incidentes")}` : `Vigilando ${plural(apps, "app", "apps")}`,
        detail: note,
      };
    }
    case "legal": {
      const summary = asObject(body?.summary);
      const critical = num(summary?.critico) ?? 0;
      const review = num(summary?.revisar) ?? 0;
      const targets = num(body?.totalTargets) ?? 0;
      if (critical > 0) return { state: "error", label: plural(critical, "riesgo critico", "riesgos criticos"), detail: review ? `${review} por revisar` : undefined };
      if (targets === 0) return { state: "needs-setup", label: "Sin apps que revisar" };
      return { state: "working", label: `Revisando ${plural(targets, "app", "apps")}`, detail: review ? `${review} por revisar` : undefined };
    }
  }
}

export async function runProbe(url: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return response.ok ? { ok: true, status: response.status, body } : { ok: false, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null, networkError: true };
  }
}
