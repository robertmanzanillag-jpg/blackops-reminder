import { z } from "zod";

export const revenueEnginePlanSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  leadCount: z.coerce.number().int().min(5).max(50).default(20),
});

export type RevenueEnginePlanInput = z.infer<typeof revenueEnginePlanSchema>;

const agentRoster = [
  {
    id: "growth-director",
    name: "Growth Director",
    role: "Decide nicho, oferta, precios y margen",
    status: "active",
    approvalGate: "Cambia estrategia o precio solo con aprobacion",
  },
  {
    id: "lead-scout",
    name: "Lead Scout",
    role: "Encuentra negocios con senales de no tener website",
    status: "approval_required",
    approvalGate: "No guarda contactos sin evidencia revisable",
  },
  {
    id: "business-researcher",
    name: "Business Researcher",
    role: "Resume negocio, servicios, fotos, reviews y datos publicos",
    status: "ready",
    approvalGate: "Marca datos inciertos antes de usarlos",
  },
  {
    id: "mockup-builder",
    name: "Mockup Builder",
    role: "Arma website dinamico, 3D y comparables por industria",
    status: "ready",
    approvalGate: "No publica ni envia preview sin QA",
  },
  {
    id: "automation-architect",
    name: "Automation Architect",
    role: "Convierte pedidos del cliente en automatizaciones vendibles",
    status: "ready",
    approvalGate: "Estima costo mensual antes de prometer entregas",
  },
  {
    id: "closer",
    name: "Closer",
    role: "Prepara mensajes, seguimiento, propuesta y cierre",
    status: "approval_required",
    approvalGate: "Todo contacto externo queda en draft hasta aprobar",
  },
  {
    id: "qa-council",
    name: "QA Council",
    role: "Revisa copy, links, evidencia, margen, legalidad y entrega",
    status: "active",
    approvalGate: "Bloquea envios con datos flojos o gasto fuera de cap",
  },
];

const pipelineStages = [
  { id: "lead_research", name: "Research", count: 0, valueUsd: 0 },
  { id: "qualified", name: "Calificados", count: 0, valueUsd: 0 },
  { id: "mockup", name: "Mockup", count: 0, valueUsd: 0 },
  { id: "outreach", name: "Outreach", count: 0, valueUsd: 0 },
  { id: "proposal", name: "Propuesta", count: 0, valueUsd: 0 },
  { id: "closed", name: "Cerrados", count: 0, valueUsd: 0 },
];

const packages = [
  {
    id: "website-starter",
    name: "Website Starter",
    priceUsd: 1500,
    recurringUsd: 79,
    marginTarget: "80%+",
    delivery: "3-5 dias",
    includes: ["One-page premium", "Copy local", "Formulario", "Hosting handoff"],
  },
  {
    id: "website-3d",
    name: "Website 3D Premium",
    priceUsd: 3500,
    recurringUsd: 149,
    marginTarget: "75%+",
    delivery: "7-10 dias",
    includes: ["Hero 3D", "Galeria dinamica", "SEO local", "Analytics"],
  },
  {
    id: "automation-sprint",
    name: "Automation Sprint",
    priceUsd: 2500,
    recurringUsd: 300,
    marginTarget: "70%+",
    delivery: "7 dias",
    includes: ["Intake", "CRM/simple ops", "Mensajes", "Dashboard"],
  },
  {
    id: "growth-retainer",
    name: "Growth Retainer",
    priceUsd: 1000,
    recurringUsd: 1000,
    marginTarget: "65%+",
    delivery: "mensual",
    includes: ["Mejoras", "A/B tests", "Reportes", "Automations ligeras"],
  },
];

export function getRevenueEngineSnapshot() {
  return {
    metrics: {
      appsSold: 0,
      automationsSold: 0,
      revenueUsd: 0,
      cashCollectedUsd: 0,
      monthlySpendCapUsd: 100,
      estimatedSpendUsd: 0,
      profitUsd: 0,
      approvalQueue: 0,
    },
    costPolicy: {
      monthlyCapUsd: 100,
      stopRule: "Pausar outreach pagado si gasto mensual > ingresos cobrados o si llega a $100.",
      defaultMode: "draft_only",
      allowedWithoutApproval: ["research_plan", "mockup_brief", "qa_checklist", "proposal_draft"],
      requiresApproval: ["contact_business", "buy_data", "send_email", "send_sms", "publish_mockup", "charge_client"],
    },
    agents: agentRoster,
    pipelineStages,
    packages,
  };
}

export function buildRevenueEnginePlan(input: RevenueEnginePlanInput) {
  const budgetUsd = Math.min(input.monthlyBudgetUsd, 100);
  const researchCostUsd = Number((input.leadCount * 0.03).toFixed(2));
  const mockupSlots = Math.min(5, Math.max(1, Math.floor(input.leadCount / 5)));
  const mockupCostUsd = Number((mockupSlots * 0.4).toFixed(2));
  const totalCostUsd = Number((researchCostUsd + mockupCostUsd).toFixed(2));
  const remainingBudgetUsd = Number((budgetUsd - totalCostUsd).toFixed(2));
  const offerLabel =
    input.offerFocus === "both"
      ? "websites premium y automatizaciones"
      : input.offerFocus === "websites"
        ? "websites premium"
        : "automatizaciones";

  return {
    input: { ...input, monthlyBudgetUsd: budgetUsd },
    budget: {
      monthlyCapUsd: budgetUsd,
      estimatedFirstBatchUsd: totalCostUsd,
      remainingBudgetUsd,
      isInsideCap: totalCostUsd <= budgetUsd,
      mode: "low_cost_first",
    },
    target: {
      area: input.area,
      niche: input.niche,
      offer: offerLabel,
      batchSize: input.leadCount,
      qualification: [
        "No website visible en Google/Maps/social bio",
        "Negocio activo con fotos o posts recientes",
        "Tiene telefono, email, DM publico o formulario verificable",
        "Servicio con ticket suficiente para pagar $1.5k+",
        "Dolor claro: reservas, leads, menu, portfolio, pagos o seguimiento",
      ],
    },
    searchQueries: [
      `"${input.niche}" "${input.area}" "Facebook"`,
      `"${input.niche}" "${input.area}" "Instagram" "call"`,
      `"${input.niche}" "${input.area}" "Google Maps"`,
      `"${input.niche}" "${input.area}" "near me"`,
      `"${input.niche}" "${input.area}" "menu" OR "booking" OR "appointments"`,
    ],
    leadSlots: Array.from({ length: Math.min(input.leadCount, 10) }, (_, index) => ({
      id: `lead-slot-${String(index + 1).padStart(2, "0")}`,
      name: `${input.niche} prospect ${index + 1}`,
      area: input.area,
      status: index < 3 ? "research_ready" : "queued",
      evidenceNeeded: ["website check", "contact source", "recent activity", "offer fit"],
      nextAgent: index < 3 ? "business-researcher" : "lead-scout",
    })),
    mockupBrief: {
      style: "premium local brand, fast, mobile-first, optional 3D hero",
      sections: ["hero", "services", "proof", "gallery", "booking/contact", "automation upsell"],
      demoAngles: [
        "Antes/despues: sin website vs presencia premium",
        "Comparacion con 2-3 demos internas",
        "Automatizacion sugerida segun dolor del negocio",
      ],
      qaChecks: ["datos marcados como publicos", "no claims inventados", "links funcionando", "mobile", "margen positivo"],
    },
    outreachDraft: {
      channelPriority: ["email", "contact form", "Instagram DM", "phone follow-up manual"],
      firstMessage:
        `Vi que ${input.niche} en ${input.area} puede ganar mas leads con una presencia web mas fuerte. Prepare un mockup rapido para mostrar como se veria una version premium con ${offerLabel}. Si quieres, te lo mando para revisarlo sin compromiso.`,
      followUps: [
        "Enviar preview comparando website actual/no website contra mockup",
        "Preguntar si quieren leads, reservas, pagos o automatizar seguimiento",
        "Cerrar llamada de 15 minutos con una oferta simple y deposito",
      ],
      approvalStatus: "draft_only",
    },
    deliverySystem: {
      checkpoints: [
        "Discovery y data publica",
        "Mockup website",
        "Subagente QA visual",
        "Subagente QA negocio/margen",
        "Propuesta",
        "Deposito",
        "Build",
        "QA final",
        "Entrega y upsell automatizacion",
      ],
      improvementLoop: [
        "Guardar objeciones",
        "Medir tasa de respuesta",
        "Medir cierres por nicho",
        "Duplicar el nicho con mejor margen",
        "Pausar lo que gasta sin cobrar",
      ],
    },
  };
}
