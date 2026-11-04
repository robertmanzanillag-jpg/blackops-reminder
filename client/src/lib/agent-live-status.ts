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
  // Calendar status calls Zoho when configured, so it is polled gently.
  assistant: { key: "calendar-status", url: "/api/calendar/status", intervalMs: 5 * MINUTE, kind: "calendar" },
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
  // Read-only runs list. /api/automation-manager/summary is avoided on purpose: it seeds defaults and
  // re-activates paused automations on every GET.
  automations: { key: "automation-runs", url: "/api/automation-runs?limit=25", intervalMs: MINUTE, kind: "automations" },
  cybersecurity: {
    key: "dev-health-dashboard",
    url: "/api/developer-health/dashboard",
    intervalMs: 2 * MINUTE,
    kind: "dev-health",
    onDemandNote: "Lee el registro de salud guardado; el escaneo completo de seguridad corre bajo demanda desde su pagina.",
  },
  "app-qa": {
    key: "dev-health-dashboard",
    url: "/api/developer-health/dashboard",
    intervalMs: 2 * MINUTE,
    kind: "dev-health",
    onDemandNote: "Lee el registro de salud guardado; el escaneo completo de QA corre bajo demanda desde su pagina.",
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

export function summarizeProbe(probe: AgentProbe, result: ProbeResult | undefined, now: number = Date.now()): AgentLiveStatus {
  if (!result) return { state: "checking", label: "Verificando..." };
  if ("networkError" in result) {
    return { state: "offline", label: "Servidor sin respuesta", detail: "No se pudo contactar el backend de BlackOps." };
  }
  if (result.status === 401) {
    return { state: "needs-setup", label: "Requiere sesion", detail: "Inicia sesion en BlackOps para ver su estado." };
  }
  if (result.status === 403) {
    return { state: "needs-setup", label: "Sin permiso", detail: "Tu usuario no tiene acceso a este agente." };
  }
  const body = asObject(result.body);
  const bodyError = body ? str(body.error) : null;
  if (!result.ok || bodyError) {
    return { state: "error", label: "Con error", detail: bodyError || `El endpoint respondio ${result.status}.` };
  }
  // A 200 without JSON (SPA fallback, empty body) is never proof of work.
  if (result.body === null || result.body === undefined) {
    return { state: "error", label: "Respuesta no valida", detail: "El endpoint no devolvio JSON." };
  }

  switch (probe.kind) {
    case "calendar": {
      const google = body?.google === true;
      const zoho = body?.zoho === true;
      if (!google && !zoho) return { state: "needs-setup", label: "Calendario sin conectar", detail: "Conecta Google Calendar o Zoho." };
      return { state: "working", label: "Agenda sincronizada", detail: [google && "Google", zoho && "Zoho"].filter(Boolean).join(" + ") };
    }
    case "ready-checks": {
      // CEO readiness: { ready, status: "ready" | "warning" | "blocked", checks: [{ label, status }] }.
      // Revenue readiness: { ready, checks: { name: boolean } }.
      const listed = Array.isArray(body?.checks)
        ? (body!.checks as unknown[]).map(asObject).filter((check): check is Json => Boolean(check) && check!.status !== "ready")
        : null;
      const pending = listed ? listed.map((check) => str(check.label) || str(check.id) || "check").filter(Boolean) as string[] : missingChecks(body?.checks);
      const detail = pending.length ? `Pendiente: ${pending.slice(0, 3).join(", ")}${pending.length > 3 ? "..." : ""}` : undefined;
      if (body?.ready === true) return { state: "working", label: "Operativo" };
      const status = str(body?.status);
      if (status === "warning") return { state: "working", label: "Operativo con avisos", detail };
      if (status === "blocked" || body?.ready === false) return { state: "needs-setup", label: "Falta configuracion", detail };
      return { state: "error", label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
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
      const profitGuardStatus = str(asObject(asObject(body?.snapshot)?.profitGuard)?.status);
      if (status === "blocked_safety") {
        // The server also uses blocked_safety when no product/supplier is reviewed yet; only a spend pause is a real stop.
        return profitGuardStatus === "pause_spend"
          ? { state: "error", label: "Gasto pausado por Profit Guard", detail: summary }
          : { state: "needs-setup", label: "Falta producto o supplier", detail: summary };
      }
      if (status === "blocked_needs_accounts") return { state: "needs-setup", label: "Faltan cuentas", detail: summary };
      if (status === "ready_for_test_order") return { state: "working", label: "Listo para orden de prueba", detail: summary };
      if (status === "pre_account_ready") return { state: "working", label: "Modo pre-cuentas", detail: summary };
      return { state: "error", label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
    }
    case "marketing": {
      const scorecard = asObject(body?.globalScorecard);
      const clients = num(scorecard?.clients);
      const ready = num(scorecard?.readyClients) ?? 0;
      const approvals = num(scorecard?.approvalsNeeded) ?? 0;
      if (clients === null) return { state: "error", label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
      if (clients === 0) return { state: "needs-setup", label: "Sin clientes detectados" };
      return {
        state: "working",
        label: `${ready}/${clients} clientes listos`,
        detail: approvals ? plural(approvals, "aprobacion pendiente", "aprobaciones pendientes") : undefined,
      };
    }
    case "portfolio": {
      if (num(body?.totalValue) === null) return { state: "error", label: "Estado desconocido" };
      if (!Array.isArray(body?.distribution) || body!.distribution.length === 0) return { state: "needs-setup", label: "Sin inversiones cargadas" };
      return { state: "working", label: "Siguiendo inversiones" };
    }
    case "radio": {
      const slots = Array.isArray(result.body) ? result.body.length : null;
      if (slots === null) return { state: "error", label: "Estado desconocido" };
      if (slots === 0) return { state: "offline", label: "En espera", detail: "No hay eventos de radio proximos en el calendario." };
      return { state: "working", label: "Programando radio", detail: plural(slots, "evento proximo", "eventos proximos") };
    }
    case "clippers": {
      // States: running | completed | blocked | stale | never_run. nextAction is { code, message }.
      const status = str(body?.status) || str(body?.state);
      const next = str(asObject(body?.nextAction)?.message) || str(body?.nextAction) || undefined;
      const blockers = Array.isArray(body?.configurationBlockers) ? body!.configurationBlockers.length : 0;
      if (status === "never_run") return { state: "needs-setup", label: "Worker nunca corrio", detail: next };
      if (status === "blocked") return { state: "needs-setup", label: "Worker bloqueado", detail: next };
      if (status === "stale") return { state: "needs-setup", label: "Worker detenido", detail: next };
      if (status === "running") return { state: "working", label: "Procesando clips", detail: next };
      if (status === "completed") {
        return blockers > 0
          ? { state: "needs-setup", label: "Corrio, con bloqueos", detail: next }
          : { state: "working", label: "Ultima corrida OK", detail: next };
      }
      return { state: "error", label: "Estado desconocido", detail: next };
    }
    case "automations": {
      // /api/automation-runs: newest-first list of { status, startedAt }.
      if (!Array.isArray(result.body)) return { state: "error", label: "Estado desconocido" };
      const runs = (result.body as unknown[]).map(asObject).filter(Boolean) as Json[];
      const dayAgo = now - 26 * 60 * 60_000;
      const recent = runs.filter((run) => {
        const started = Date.parse(str(run.startedAt) || "");
        // Skipped runs did no work; pending approvals are counted separately.
        return Number.isFinite(started) && started >= dayAgo && (run.status === "success" || run.status === "failed");
      });
      const failed = recent.filter((run) => run.status === "failed").length;
      const pending = runs.filter((run) => run.status === "pending_approval").length;
      const extra = pending ? plural(pending, "aprobacion pendiente", "aprobaciones pendientes") : undefined;
      if (failed > 0) return { state: "error", label: plural(failed, "corrida fallida", "corridas fallidas"), detail: extra };
      if (recent.length === 0) return { state: "offline", label: "Sin corridas en 24 h", detail: extra };
      return { state: "working", label: `${plural(recent.length, "corrida", "corridas")} en 24 h`, detail: extra };
    }
    case "dev-health": {
      const summary = asObject(body?.summary);
      const apps = num(summary?.totalApps) ?? 0;
      const critical = num(summary?.criticalIncidents) ?? 0;
      const open = num(summary?.openIncidents) ?? 0;
      const down = num(summary?.down) ?? 0;
      const note = probe.onDemandNote;
      const degraded = num(summary?.degraded) ?? 0;
      const unknown = num(summary?.unknown) ?? 0;
      if (!summary) return { state: "error", label: "Estado desconocido", detail: note };
      if (apps === 0) return { state: "needs-setup", label: "Sin apps registradas", detail: note };
      // Findings about the apps need Robert's attention; they don't mean the agent itself is broken.
      if (critical > 0) return { state: "needs-setup", label: plural(critical, "incidente critico", "incidentes criticos"), detail: note };
      if (down > 0) return { state: "needs-setup", label: plural(down, "app caida", "apps caidas"), detail: note };
      if (unknown === apps) return { state: "needs-setup", label: "Apps sin chequeos de salud", detail: note };
      if (degraded > 0) return { state: "needs-setup", label: plural(degraded, "app degradada", "apps degradadas"), detail: note };
      return {
        state: "working",
        label: open > 0 ? `${plural(open, "incidente abierto", "incidentes abiertos")}` : `${plural(apps, "app sana", "apps sanas")}`,
        detail: note,
      };
    }
    case "legal": {
      const summary = asObject(body?.summary);
      const critical = num(summary?.critico) ?? 0;
      const review = num(summary?.revisar) ?? 0;
      const targets = num(body?.totalTargets) ?? 0;
      if (!summary) return { state: "error", label: "Estado desconocido" };
      if (critical > 0) return { state: "needs-setup", label: plural(critical, "riesgo critico", "riesgos criticos"), detail: review ? `${review} por revisar` : undefined };
      if (targets === 0) return { state: "needs-setup", label: "Sin apps que revisar" };
      if (body?.githubConnected === false) return { state: "needs-setup", label: "GitHub sin conectar", detail: `Revisando ${plural(targets, "app", "apps")} sin datos de GitHub` };
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
