import { hasRealValue } from "./ceo-doctor-cli";

export type AssistantModelRoute = {
  tier: "cheap_scout" | "strong_supervisor";
  provider: "gemini" | "openai";
  reason: string;
};

function normalizeText(value = ""): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function shouldUseCheapScoutForWebChat(input: { message?: string; hasImages?: boolean }): AssistantModelRoute {
  if (process.env.BLACKOPS_WEB_CHEAP_SCOUT_ENABLED === "false") {
    return { tier: "strong_supervisor", provider: "openai", reason: "cheap scout disabled by env" };
  }
  if (!hasRealValue(process.env.AI_INTEGRATIONS_GEMINI_API_KEY)) {
    return { tier: "strong_supervisor", provider: "openai", reason: "cheap scout key not configured" };
  }
  if (input.hasImages) {
    return { tier: "strong_supervisor", provider: "openai", reason: "image analysis uses strong supervisor in web chat" };
  }

  const text = normalizeText(input.message);
  if (!text) {
    return { tier: "strong_supervisor", provider: "openai", reason: "empty text fallback" };
  }

  const strongTerms = [
    "estrategia completa", "analisis profundo", "decision final", "revisalo fuerte", "modelo fuerte",
    "presupuesto", "budget", "spend", "gasto", "dinero", "roi", "roas", "cac", "margen", "profit",
    "legal", "compliance", "seguridad", "security", "vulnerabilidad", "amenaza", "token", "secret",
    "codigo", "code", "bug", "repo", "github", "pull request", "pr", "deploy", "produccion", "production",
    "aprobar", "aprueba", "publica ya", "postea ya", "auto publish", "automatico live", "sin revisar",
    "supplier", "proveedor", "cliente", "customer", "contrato", "refund", "chargeback",
  ];
  if (hasAny(text, strongTerms)) {
    return { tier: "strong_supervisor", provider: "openai", reason: "risk or final-judgment terms detected" };
  }

  const cheapTerms = [
    "caption", "captions", "hook", "hooks", "ideas", "borrador", "draft", "resumen", "resume",
    "clasifica", "organiza", "calendario", "metricas basicas", "duplicados", "hashtags",
    "prepara metricool", "cola metricool", "clips", "post", "posts", "reels", "tiktok",
    "que tengo", "agenda", "tareas", "recordatorio", "calendario",
  ];
  if (hasAny(text, cheapTerms)) {
    return { tier: "cheap_scout", provider: "gemini", reason: "low-risk repetitive assistant work" };
  }

  const maxCheapChars = Number(process.env.BLACKOPS_WEB_CHEAP_SCOUT_MAX_MESSAGE_CHARS || 900);
  if (text.length <= Math.max(200, maxCheapChars)) {
    return { tier: "cheap_scout", provider: "gemini", reason: "short low-risk chat fallback" };
  }

  return { tier: "strong_supervisor", provider: "openai", reason: "long or ambiguous request" };
}
