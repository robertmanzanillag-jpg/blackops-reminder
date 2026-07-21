import { randomUUID } from "node:crypto";

export type BlackRoomRemoteCommand =
  | { id: string; type: "daily_target"; posts: number; createdAt: string }
  | { id: string; type: "extra_posts"; posts: number; targetDate: string; createdAt: string }
  | { id: string; type: "priority_source"; url: string; createdAt: string };

export interface BlackRoomChatResult {
  reply: string;
  command: BlackRoomRemoteCommand | null;
  control?: { enabled: boolean; weeks?: number };
  statusRequested?: boolean;
}

function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function remainingNinetyMinuteSlots(now: Date, timezone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const first = Math.ceil((current + 15) / 15) * 15;
  return first >= 1440 ? 0 : Math.floor((1439 - first) / 90) + 1;
}

function normalized(message: string): string {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function looksLikeBlackRoomAssistantRequest(message: string): boolean {
  const text = normalized(String(message || ""));
  if (!text) return false;
  const namesBlackRoom = /\bblack\s*room\b/.test(text);
  if (/\bradio\b/.test(text)) return false;
  if (namesBlackRoom && /\b(website|web|pagina|builder|links?|bio)\b/.test(text)) return false;
  if (namesBlackRoom && /\b(estado|status|como va|cola)\b/.test(text)) return true;
  if (namesBlackRoom && /\b(agente|videos?|posts?|publicaciones?|tiktok|metricool|djs?|contenido|analytics|analitica|clips?|cortes?)\b/.test(text)) return true;
  if (namesBlackRoom && youtubeUrl(message) && /\b(clips?|cortes?|djs?|tiktok|metricool|videos?)\b/.test(text)) return true;
  if (/\b(sube|publica|agenda|agrega)\b.*\b(videos?|posts?|publicaciones?)\b.*\b(mas|extra|hoy|por dia|al dia|x dia|diarios?|cada dia)\b/.test(text)) return true;
  if (/\b(sube|publica|agenda|agrega)\s+\d{1,2}\b.*\b(hoy|por dia|al dia|x dia|diarios?|cada dia)\b/.test(text)) return true;
  if (/\b(videos?|posts?|publicaciones?)\b.*\b(mas hoy|extra hoy|por dia|diarios?|cada dia)\b/.test(text)) return true;
  if (/\b(play|inicia|activa|empieza|pausa|deten|para)\b.*\b(agente|videos?|contenido|tiktok|metricool)\b/.test(text)) return true;
  return /\b(analytics|analitica|recomienda|conviene)\b/.test(text)
    && /\b(videos?|posts?|tiktok|djs?|contenido)\b/.test(text);
}

function youtubeUrl(message: string): string | null {
  const match = message.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/)|youtu\.be\/)[^\s&?]+[^\s]*/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return ["youtube.com", "www.youtube.com", "youtu.be", "www.youtu.be"].includes(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch { return null; }
}

export function parseBlackRoomChatCommand(
  message: string,
  options: { now?: Date; timezone?: string; analyticsSamples?: number; currentPostsPerDay?: number } = {},
): BlackRoomChatResult {
  const raw = String(message || "").trim();
  if (!raw) return { reply: "Escribe una orden, por ejemplo: “sube 3 videos más hoy”.", command: null };
  const now = options.now || new Date();
  const timezone = options.timezone || "America/New_York";
  const text = normalized(raw);
  const sourceUrl = youtubeUrl(raw);
  if (sourceUrl) {
    return {
      reply: "Listo. Pondré ese video de YouTube primero, verificaré que pertenezca a BlackRoom y sacaré un corte nuevo sin repetir segmentos.",
      command: { id: randomUUID(), type: "priority_source", url: sourceUrl, createdAt: now.toISOString() },
    };
  }
  if (/\b(estado|status|como va|cuantos? hay)\b/.test(text) && /\b(black\s*room|agente|videos?|cola)\b/.test(text)) {
    return { reply: "Estoy consultando el estado actual de BlackRoom.", command: null, statusRequested: true };
  }
  const weeks = Number(text.match(/\b([1-4])\s*semanas?\b/)?.[1]);
  const wantsPause = /\b(pausa|pausar|deten|detener)\b/.test(text)
    || /\bpara (?:el )?(?:agente|contenido|videos?)\b/.test(text);
  if (wantsPause && /\b(black\s*room|agente|videos?|contenido|tiktok|metricool)\b/.test(text)) {
    return {
      reply: "Listo. Pausaré el agente de BlackRoom de forma segura. La cola y el historial quedan guardados para continuar después.",
      command: null,
      control: { enabled: false },
    };
  }
  if (/\b(play|inicia|iniciar|activa|activar|empieza|comienza)\b/.test(text) && /\b(black\s*room|agente|videos?|contenido|tiktok|metricool)\b/.test(text)) {
    return {
      reply: `Listo. Activaré el agente de BlackRoom${Number.isFinite(weeks) ? ` para mantener ${weeks} semana${weeks === 1 ? "" : "s"} de contenido en cola` : ""}.`,
      command: null,
      control: { enabled: true, ...(Number.isFinite(weeks) ? { weeks } : {}) },
    };
  }
  const number = Number(text.match(/\b(\d{1,2})\b/)?.[1]);
  if (Number.isFinite(number) && (number < 1 || number > 20)) {
    return { reply: "La cantidad debe estar entre 1 y 20 videos para mantener una cadencia segura.", command: null };
  }
  if (Number.isFinite(number) && /\b(mas|extra|adicional)/.test(text) && /\bhoy\b/.test(text)) {
    const available = remainingNinetyMinuteSlots(now, timezone);
    if (number > available) {
      return { reply: `Hoy solo ${available === 1 ? "cabe" : "caben"} ${available} video${available === 1 ? "" : "s"} adicional${available === 1 ? "" : "es"} manteniendo 90 minutos entre publicaciones. Puedes pedir ${number} para mañana o reducir la cantidad.`, command: null };
    }
    return {
      reply: `Listo. Agregaré ${number} video${number === 1 ? "" : "s"} extra${number === 1 ? "" : "s"} a la cola de hoy, separados de los demás horarios.`,
      command: { id: randomUUID(), type: "extra_posts", posts: number, targetDate: localDate(now, timezone), createdAt: now.toISOString() },
    };
  }
  if (Number.isFinite(number) && /(por dia|al dia|x dia|diarios?|cada dia)/.test(text)) {
    return {
      reply: `Entendido. El objetivo automático será ${number} video${number === 1 ? "" : "s"} por día. Si los analytics no respaldan esa frecuencia, te lo señalaré sin ignorar tu orden.`,
      command: { id: randomUUID(), type: "daily_target", posts: number, createdAt: now.toISOString() },
    };
  }
  if (/analytics|analitica|recomienda|conviene|deberia|mejor cantidad/.test(text)) {
    const samples = Math.max(0, Number(options.analyticsSamples || 0));
    const current = Math.max(1, Number(options.currentPostsPerDay || 10));
    return samples < 20
      ? { reply: `Todavía no hay suficientes posts con analytics comparables (${samples}/20). Mantendría ${current} diarios por ahora y no subiría la frecuencia basándome en datos incompletos.`, command: null }
      : { reply: `Ya hay ${samples} posts comparables. Mantendría ${current} diarios hasta que retención, finalización y seguidores por publicación indiquen una diferencia estable.`, command: null };
  }
  return {
    reply: "Puedo cambiar la cantidad diaria, agregar videos extra hoy, priorizar una URL de YouTube o explicarte qué recomiendan los analytics.",
    command: null,
  };
}
