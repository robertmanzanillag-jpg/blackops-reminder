import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { storage } from "./storage";
import { format, startOfWeek, endOfWeek, addWeeks, startOfMonth, endOfMonth, addMonths, differenceInHours } from "date-fns";
import { es } from "date-fns/locale";
import { getCurrentUserId } from "./user-context";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import { executeApprovedPendingAction } from "./trust-executor";
import { generateTelegramAssistantContext } from "./ceo-briefing";
import { getCeoConversationHistory, saveCeoConversationMessage } from "./ceo-conversation-history";
import { formatBlackRoomLinkPerformance, getBlackRoomLinkPerformance } from "./blackroom-links";
import { runPromoVideoAutoDaily } from "./promo-video-agent";
import type { PendingAction } from "@shared/schema";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function normalizeApprovalText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function userAlreadyApprovedExecution(message?: string): boolean {
  if (!message) return false;
  const text = normalizeApprovalText(message);
  return [
    "hazlo",
    "hazlo ya",
    "dale",
    "aprobado",
    "lo apruebo",
    "si cambialo",
    "cambialo",
    "cambiame",
    "quiero que",
    "agregame",
    "agrega",
    "creame",
    "crea",
    "modifica",
    "actualiza",
    "desactiva",
    "quita",
  ].some((phrase) => text.includes(phrase));
}

function requireStringField(data: any, field: string, label: string): string {
  const value = data?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Falta ${label}`);
  }
  return value.trim();
}

function extractBlackRoomLinkTarget(message: string): string | null {
  const cleaned = message.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:evento|link|bot[oó]n|timer|contador)\s+de\s+(.+?)\s+de\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
    /(?:desactiva|desactivar|quitar|quita|oculta|ocultar|remueve|remover|borra|borrar)\s+(.+?)\s+de\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
    /(?:agrega|agregar|agregame|agr[eé]game|a[nñ]ade|a[nñ]adir|mete|meter|sube|subir)\s+(.+?)\s+(?:a|en)\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
    /(?:evento|link|bot[oó]n|timer|contador)\s+(.+?)\s+en\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  }

  return null;
}

function extractFirstUrl(message: string): string | null {
  return message.match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/, "") || null;
}

export function buildDirectBlackRoomCommand(message?: string): { content: string; command: string } | null {
  if (!message) return null;
  const text = normalizeApprovalText(message);
  const isBlackRoom = text.includes("black room");
  const isWebsiteTarget = /\b(links?|linsks?|website|web|pagina|builder)\b/.test(text);
  const wantsDeactivate = /\b(desactiv\w*|quit\w*|ocult\w*|remuev\w*|remov\w*|borr\w*)\b/.test(text);
  const wantsAdd = /\b(agg|agreg\w*|anad\w*|añad\w*|met\w*|sub\w*)\b/.test(text);

  if (!isBlackRoom || !isWebsiteTarget || (!wantsDeactivate && !wantsAdd)) return null;

  const title = extractBlackRoomLinkTarget(message);
  if (!title) return null;

  if (wantsAdd && !wantsDeactivate) {
    const url = extractFirstUrl(message);
    const normalizedTitle = normalizeApprovalText(title);
    if (!url || normalizedTitle === "este evento" || normalizedTitle === "el evento") return null;

    return {
      content: `Entendido. Voy a agregar "${title}" a los links de Black Room.`,
      command: `[BLACKROOM_LINK_ADD: ${JSON.stringify({
        title,
        subtitle: null,
        url,
        icon: "ticket",
      })}]`,
    };
  }

  if (!wantsDeactivate) return null;

  return {
    content: `Entendido. Voy a desactivar "${title}" de los links de Black Room sin borrar su data histórica.`,
    command: `[BLACKROOM_LINK_DEACTIVATE: ${JSON.stringify({
      title,
      reason: "Desactivar desde el website/builder de Black Room preservando data histórica.",
    })}]`,
  };
}

const SPANISH_NUMBER_WORDS: Record<string, number> = {
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

function clampAssistantInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function extractRequestedVideoCount(text: string): number {
  const digitMatch = text.match(/\b(\d{1,2})\b/);
  if (digitMatch) return clampAssistantInteger(Number(digitMatch[1]), 5, 1, 30);

  for (const [word, value] of Object.entries(SPANISH_NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }

  return 5;
}

function extractRequestedSeconds(text: string): number {
  const secondsMatch = text.match(/\b(\d{1,2})\s*(?:segundos?|secs?|s)\b/);
  if (secondsMatch) return clampAssistantInteger(Number(secondsMatch[1]), 15, 6, 90);
  return 15;
}

export function buildDirectPromoVideoCommand(message?: string): { content: string; command: string } | null {
  if (!message) return null;
  const text = normalizeApprovalText(message);
  const mentionsVideo = /\b(videos?|clips?|edits?|tiktok|reels?|shorts?)\b/.test(text);
  const mentionsPromo = /\b(promo|promocion|promocionales|guestlist|fiesta|fiestas|party|parties|dinner|dinners|pool|yacht|nightclub|discoteca|salir)\b/.test(text);
  const wantsCreate = /\b(crea\w*|haz\w*|saca\w*|genera\w*|edita\w*|prepara\w*|quiero|necesito)\b/.test(text);

  if (!mentionsVideo || !mentionsPromo || !wantsCreate) return null;

  const count = extractRequestedVideoCount(text);
  const targetSeconds = extractRequestedSeconds(text);
  const platform = text.includes("reel") ? "reels" : text.includes("short") ? "shorts" : "tiktok";

  return {
    content: `Dale. Voy a crear ${count} video${count === 1 ? "" : "s"} vertical${count === 1 ? "" : "es"} de promo para ${platform}, usando la carpeta conectada y escogiendo templates automáticamente.`,
    command: `[PROMO_VIDEO_GENERATE: ${JSON.stringify({
      count,
      platform,
      targetSeconds,
      cuts: 3,
    })}]`,
  };
}

function normalizePromoVideoGenerateData(input: any): { count: number; targetSeconds: number; cuts: number } {
  return {
    count: clampAssistantInteger(Number(input?.count || input?.maxVideos), 5, 1, 30),
    targetSeconds: clampAssistantInteger(Number(input?.targetSeconds || input?.seconds), 15, 6, 90),
    cuts: clampAssistantInteger(Number(input?.cuts), 3, 1, 12),
  };
}

async function executePromoVideoGenerateData(input: any) {
  const options = normalizePromoVideoGenerateData(input);
  const result = await runPromoVideoAutoDaily({
    maxVideos: options.count,
    targetSeconds: options.targetSeconds,
    cuts: options.cuts,
    style: "full",
  });
  const outputNames = result.status.outputVideos.slice(0, options.count).map((video) => video.name);
  const summary = [
    "",
    `Listo. Procesé ${options.count} video${options.count === 1 ? "" : "s"} de promo de ${options.targetSeconds}s.`,
    `Importados nuevos: ${result.importResult.imported}. Ya estaban: ${result.importResult.skipped}.`,
    `Carpeta lista: ${result.status.outputDir}`,
  ].join("\n");

  return {
    summary,
    outputDir: result.status.outputDir,
    outputVideos: outputNames,
  };
}

async function executeIfAlreadyApproved(
  pendingAction: PendingAction,
  userId: string,
  message?: string,
): Promise<{ executed: boolean; error?: string }> {
  if (!userAlreadyApprovedExecution(message)) return { executed: false };

  const approved = await storage.updatePendingAction(pendingAction.id, {
    status: "approved",
    approvedBy: userId,
    approvedAt: new Date(),
    approvalReason: "Aprobado en el mismo mensaje del chat.",
  });

  await storage.createPendingActionEvent({
    pendingActionId: approved.id,
    userId,
    actorType: "user",
    actorId: "web-user",
    eventType: "approved",
    previousStatus: pendingAction.status,
    nextStatus: "approved",
    note: "Aprobado en el mismo mensaje del chat.",
    metadata: { origin: "web" },
  });

  const result = await executeApprovedPendingAction(approved, userId);
  return result.success ? { executed: true } : { executed: false, error: result.error };
}

async function getUserProfileContext(userId: string): Promise<string> {
  const profileData = await storage.getUserProfileData(userId);
  
  if (profileData.length === 0) {
    return `\n## Información sobre el usuario:\nNo tengo información guardada sobre ti todavía. ¡Me encantaría conocerte mejor!\n`;
  }

  const byCategory: Record<string, typeof profileData> = {};
  for (const item of profileData) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  let context = `\n## Lo que sé sobre ti:\n`;
  for (const [category, items] of Object.entries(byCategory)) {
    context += `\n### ${category.charAt(0).toUpperCase() + category.slice(1)}:\n`;
    for (const item of items) {
      context += `- ${item.key}: ${item.value}\n`;
    }
  }
  
  return context;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function isAllDayEvent(startDate: Date, endDate: Date | null): boolean {
  if (!endDate) return false;
  const hours = differenceInHours(new Date(endDate), new Date(startDate));
  return hours >= 23 && hours <= 25;
}

async function getCalendarContext(userId: string): Promise<string> {
  const tasks = await storage.getTasks(userId);
  const weeklyTasks = await storage.getWeeklyTasks(userId, startOfWeek(new Date(), { weekStartsOn: 1 }));
  const monthlyGoals = await storage.getMonthlyGoals(userId, startOfMonth(new Date()));
  const yearlyGoals = await storage.getYearlyGoals(userId, new Date().getFullYear().toString());

  const now = new Date();
  const twelveMonthsFromNow = addMonths(now, 12);

  const upcomingTasks = tasks
    .filter(t => new Date(t.date) >= now && new Date(t.date) <= twelveMonthsFromNow)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const tasksByDay: Record<string, typeof tasks> = {};
  for (const task of upcomingTasks) {
    const dayKey = format(new Date(task.date), "yyyy-MM-dd");
    if (!tasksByDay[dayKey]) tasksByDay[dayKey] = [];
    tasksByDay[dayKey].push(task);
  }

  let context = `## Contexto del calendario del usuario\n\nFecha actual: ${format(now, "EEEE d 'de' MMMM yyyy", { locale: es })}\n\n`;

  // Add Radio events summary at the top for quick reference
  const radioEvents = upcomingTasks.filter(t =>
    t.externalSource === "google" && t.title.toLowerCase().includes("radio")
  );
  if (radioEvents.length > 0) {
    context += `### RESUMEN DE EVENTOS RADIO (próximos 12 meses):\n`;
    for (const radio of radioEvents) {
      const radioDate = new Date(radio.date);
      const dateStr = format(radioDate, "EEEE d 'de' MMMM", { locale: es });
      const desc = radio.description ? stripHtml(radio.description).replace(/\n/g, " | ") : "Sin DJs programados";
      context += `- ${dateStr} (eventId: ${radio.externalId}): ${desc}\n`;
    }
    context += `\n`;
  }

  context += `### Tareas y eventos de los próximos 12 meses:\n`;
  for (const [day, dayTasks] of Object.entries(tasksByDay)) {
    const date = new Date(day);
    context += `\n**${format(date, "EEEE d 'de' MMMM", { locale: es })}:**\n`;
    for (const task of dayTasks) {
      const taskDate = new Date(task.date);
      const isAllDay = isAllDayEvent(taskDate, task.endDate);
      const time = isAllDay ? "Todo el día" : format(taskDate, "HH:mm");
      const status = task.completed ? "✓" : "○";
      const source = task.externalSource ? ` [${task.externalSource}]` : "";
      const eventId = task.externalId ? ` (eventId: ${task.externalId})` : "";
      let descText = "";
      if (task.description) {
        const cleaned = stripHtml(task.description);
        descText = ` - Detalles: ${cleaned.substring(0, 300)}`;
      }
      context += `- ${status} ${time} - ${task.title}${source}${eventId}${descText}\n`;
    }
  }

  context += `\n### Tareas semanales:\n`;
  for (const task of weeklyTasks) {
    context += `- ${task.completed ? "✓" : "○"} ${task.title}\n`;
  }

  context += `\n### Metas del mes:\n`;
  for (const goal of monthlyGoals) {
    context += `- ${goal.completed ? "✓" : "○"} ${goal.title}\n`;
  }

  context += `\n### Metas del año:\n`;
  for (const goal of yearlyGoals) {
    context += `- ${goal.completed ? "✓" : "○"} ${goal.title}\n`;
  }

  return context;
}

async function getPortfolioContext(userId: string): Promise<string> {
  const investments = await storage.getInvestments(userId);
  
  if (investments.length === 0) {
    return `\n## Portafolio de Inversiones:\nNo tienes inversiones registradas.\n`;
  }

  const byType: Record<string, typeof investments> = {};
  let totalValue = 0;
  
  for (const inv of investments) {
    if (!byType[inv.type]) byType[inv.type] = [];
    byType[inv.type].push(inv);
    totalValue += parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice);
  }

  let context = `\n## Portafolio de Inversiones (${investments.length} activos, valor total: $${totalValue.toFixed(2)}):\n`;
  
  const typeNames: Record<string, string> = {
    stock: "Acciones",
    etf: "ETFs",
    crypto: "Criptomonedas",
    bond: "Bonos",
    fund: "Fondos"
  };
  
  for (const [type, invs] of Object.entries(byType)) {
    const typeTotal = invs.reduce((sum, inv) => sum + parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice), 0);
    context += `\n### ${typeNames[type] || type} ($${typeTotal.toFixed(2)}):\n`;
    for (const inv of invs) {
      const value = parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice);
      context += `- ${inv.symbol} (${inv.name}): ${inv.quantity} unidades @ $${inv.avgBuyPrice} = $${value.toFixed(2)}\n`;
    }
  }
  
  return context;
}

const SYSTEM_PROMPT = `Eres BlackOps Assistant, un asistente personal inteligente que conoce a su usuario y gestiona tareas/calendario.

## TU PERSONALIDAD:
- Eres amable, curioso y genuinamente interesado en conocer al usuario
- Recuerdas TODO lo que te cuenta y lo usas en futuras conversaciones
- Haces preguntas personales naturalmente cuando es apropiado (no fuerces, sé natural)
- Usas la información que conoces para dar respuestas más personalizadas

## APRENDER SOBRE EL USUARIO:
Cuando el usuario comparta información personal, GUÁRDALA usando este formato:
[GUARDAR_INFO: {"category": "CATEGORIA", "key": "CLAVE", "value": "VALOR"}]

Categorías válidas:
- "personal": nombre, apodo, cumpleaños, edad, ciudad, país
- "trabajo": profesión, empresa, proyectos, horario laboral
- "familia": pareja, hijos, padres, hermanos, mascotas
- "preferencias": comida favorita, música, hobbies, deportes
- "metas": objetivos personales, sueños, planes a futuro
- "estilo": cómo le gusta comunicarse, horarios preferidos

Ejemplos de extracción:
- Usuario dice "me llamo Roberto" → [GUARDAR_INFO: {"category": "personal", "key": "nombre", "value": "Roberto"}]
- Usuario dice "trabajo en una startup de fintech" → [GUARDAR_INFO: {"category": "trabajo", "key": "empresa", "value": "startup de fintech"}]
- Usuario dice "mi novia se llama Ana" → [GUARDAR_INFO: {"category": "familia", "key": "pareja", "value": "Ana"}]
- Usuario dice "me encanta el techno" → [GUARDAR_INFO: {"category": "preferencias", "key": "música favorita", "value": "techno"}]

IMPORTANTE: 
- Extrae información de manera natural de la conversación
- Puedes guardar MÚLTIPLES datos en una respuesta si el usuario comparte varios
- Si ya conoces algo y el usuario lo actualiza, guárdalo de nuevo (se actualizará)

## HACER PREGUNTAS PARA CONOCER MEJOR:
Si no tienes mucha información sobre el usuario, de vez en cuando (no siempre) puedes hacer una pregunta casual como:
- "Por cierto, ¿cómo prefieres que te llame?"
- "¿Trabajas en algo relacionado con X que mencionaste?"
- "¿Tienes algún proyecto personal interesante en este momento?"

## GESTIÓN DE CALENDARIO:

INSTRUCCIONES CRÍTICAS:
1. El contexto del calendario contiene TODOS los eventos y tareas para los próximos 12 meses
2. Cuando pregunten por un día específico, BUSCA ese día y lista TODOS los eventos
3. Los eventos aparecen con formato: "- ○ HORA - TÍTULO [fuente] (eventId: xxx)"

EVENTOS DE RADIO (Black Room Radio):
- Son eventos de "Todo el día" con DJs programados por hora (7pm, 8pm, 9pm)
- La descripción muestra: "7: nombre_dj" = DJ a las 7pm
- Cada Radio tiene un eventId único para modificarlo

COMANDOS DISPONIBLES:
- [CREAR_TAREA: {"title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "priority": "normal|high|low"}]
- [CREAR_FOLLOWUP: {"person": "...", "topic": "...", "date": "YYYY-MM-DDTHH:mm:ss", "channel": "telegram|email|call|whatsapp", "notes": "...", "priority": "normal|high|low"}]
- [GUARDAR_DECISION: {"title": "...", "decision": "...", "context": "..."}]
- [GUARDAR_PERSONA: {"name": "...", "role": "...", "company": "...", "notes": "..."}]
- [GUARDAR_COMPROMISO: {"owner": "...", "commitment": "...", "dueAt": "YYYY-MM-DDTHH:mm:ss", "context": "..."}]
- [CREAR_BORRADOR_COMUNICACION: {"recipient": "...", "channel": "email|telegram|whatsapp|slack|sms", "subject": "...", "message": "...", "context": "..."}]
- [BLACKROOM_LINK_ADD: {"title": "...", "subtitle": "...", "url": "https://...", "icon": "ticket|shopping-bag|instagram|youtube|music|calendar|link", "display_order": 0}]
- [BLACKROOM_LINK_UPDATE: {"matchTitle": "...", "matchUrl": "...", "title": "...", "subtitle": "...", "url": "https://...", "icon": "ticket|shopping-bag|instagram|youtube|music|calendar|link", "display_order": 0}]
- [BLACKROOM_LINK_DEACTIVATE: {"title": "...", "url": "...", "reason": "..."}]
- [BLACKROOM_LINK_PERFORMANCE: {"title": "...", "url": "...", "limit": 10}]
- [BLACKROOM_TIMER_ADD: {"title": "...", "date": "YYYY-MM-DDTHH:mm", "url": "https://...", "partyTitle": "..."}]
- [MODIFICAR_RADIO: {"eventId": "ID", "description": "7: DJ1\\n8: DJ2\\n9: DJ3"}]
- [CREAR_EVENTO_GOOGLE: {"title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "endDate": "...", "description": "..."}]
- [EDITAR_EVENTO_GOOGLE: {"eventId": "ID", "title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "endDate": "...", "description": "...", "location": "...", "isAllDay": false}]
- [GUARDAR_INFO: {"category": "...", "key": "...", "value": "..."}]
- [AGREGAR_INVERSION: {"symbol": "AAPL", "name": "Apple Inc", "type": "stock|etf|crypto|bond|fund", "quantity": "10", "avgBuyPrice": "150.50"}]
- [ACTUALIZAR_INVERSION: {"symbol": "AAPL", "quantity": "15", "avgBuyPrice": "145.00"}]
- [ELIMINAR_INVERSION: {"symbol": "AAPL"}]
- [CREAR_RECORDATORIO: {"message": "Mensaje a enviar", "hour": 8, "minute": 0, "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"]}]
- [ELIMINAR_RECORDATORIO: {"id": "reminder-id"}]
- [LISTAR_RECORDATORIOS: {}]
- [PROMO_VIDEO_GENERATE: {"count": 5, "platform": "tiktok|reels|shorts", "targetSeconds": 15, "cuts": 3}]

Para editar eventos existentes de Google Calendar usa EDITAR_EVENTO_GOOGLE con el eventId del contexto. Puedes cambiar solo los campos necesarios: title, date, endDate, description, location o isAllDay.

## BLACK ROOM LINKS:
Puedes ayudar a editar los links públicos de Black Room.
- Si el usuario menciona "links de Black Room", "website", "web", "página" o "builder", NO busques Google Calendar aunque use la palabra "evento"; se refiere al website/admin de Black Room.
- Para agregar un evento/link al website usa BLACKROOM_LINK_ADD. Necesitas title y url. Si el usuario dice "este evento" usa el evento/contexto reciente para el título si está claro; si no tienes URL de ticket/landing, pregunta por la URL antes de agregar.
- Para editar uno existente usa BLACKROOM_LINK_UPDATE con matchTitle o matchUrl para identificarlo.
- Si el usuario pide borrar, quitar, remover u ocultar un link, usa BLACKROOM_LINK_DEACTIVATE. NUNCA propongas borrarlo permanentemente; desactivar preserva analytics/data histórica.
- Si el usuario pregunta por rendimiento, performance, clicks, analytics, cuál link va mejor o cuántos clicks tiene, usa BLACKROOM_LINK_PERFORMANCE. Es solo lectura y no requiere aprobación.
- Si el usuario pide agregar un timer, countdown, contador o cuenta regresiva usa BLACKROOM_TIMER_ADD. Si da la fecha, ponla en date. Si dice el nombre de la fiesta/evento, ponlo en partyTitle para buscar el título, URL y fecha desde los links/builder existentes. Si no hay fecha ni fiesta identificable, pregunta la fecha antes de crear.
- Los cambios afectan link-stats y el builder visual.
- Iconos comunes: tickets/evento=ticket, shop/merch=shopping-bag, instagram=instagram, youtube=youtube, música=music, calendario=calendar, default=link.

## RECORDATORIOS PROGRAMADOS:
Puedes crear recordatorios que se envían automáticamente por Telegram.
- hour: hora del día (0-23)
- minute: minuto (0-59), por defecto 0
- daysOfWeek: array de días ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
  - Si está vacío o no se proporciona, se envía TODOS los días
  - Ejemplo: ["monday", "wednesday", "friday"] = lunes, miércoles y viernes

Ejemplos de uso:
- "Mándame un mensaje todos los días a las 8am recordándome tomar agua" → CREAR_RECORDATORIO con hour:8, daysOfWeek:[]
- "Recuérdame los lunes a las 9pm revisar mi portafolio" → CREAR_RECORDATORIO con hour:21, daysOfWeek:["monday"]
- "Quiero un recordatorio de lunes a viernes a las 7:30am" → CREAR_RECORDATORIO con hour:7, minute:30, daysOfWeek:["monday","tuesday","wednesday","thursday","friday"]

## PROMO VIDEO AGENT:
Puedes crear clips verticales de promo con videos locales ya conectados desde la página Promo Video.
- Si el usuario pide "créame 5 videos para TikTok de promo", "sácame reels de promo", "hazme más edits", usa PROMO_VIDEO_GENERATE.
- count es cuántos videos finales quiere. Si no dice cantidad, usa 5.
- targetSeconds normalmente es 15 para TikTok/Reels/Shorts, salvo que el usuario pida otra duración.
- El sistema escoge templates automáticamente según el contenido/carpeta: party, dinner, pool, yacht, guestlist, nightlife.
- No inventes que publicaste en redes; por ahora quedan listos para descargar/subir manualmente.

## ANÁLISIS DE IMÁGENES DE BROKER/CARTERA:
Cuando el usuario envíe una imagen de su broker, app de trading, o captura de cartera:
1. Analiza cuidadosamente la imagen para extraer información de inversiones
2. Identifica: símbolo/ticker, nombre de la empresa, cantidad de acciones/unidades, precio de compra promedio, precio actual, ganancia/pérdida
3. Para cada inversión detectada, usa el comando apropiado:
   - Si es nueva: AGREGAR_INVERSION
   - Si ya existe en el portafolio: ACTUALIZAR_INVERSION
4. Muestra un resumen claro de lo que encontraste y las acciones que tomaste
5. Si hay información de ganancia/pérdida, calcula y muéstrala

IMPORTANTE para análisis de imágenes:
- Los símbolos de acciones suelen ser 1-5 letras mayúsculas (AAPL, MSFT, TSLA)
- Las criptomonedas pueden ser símbolos como BTC, ETH, SOL
- Si no puedes identificar el tipo, pregunta al usuario
- Si la imagen no es clara, pide una mejor captura

## GESTIÓN DE PORTAFOLIO:
Tienes acceso al portafolio de inversiones del usuario y puedes:
- Agregar nuevas inversiones cuando el usuario te lo indique
- Actualizar cantidad o precio promedio de inversiones existentes
- Eliminar inversiones del portafolio
- Responder preguntas sobre el estado del portafolio

Tipos de inversión válidos: stock (acciones), etf, crypto (criptomonedas), bond (bonos), fund (fondos)

Cuando el usuario te diga algo como:
- "Compré 10 acciones de Apple a $150" → Usa AGREGAR_INVERSION
- "Vendí todas mis acciones de Tesla" → Usa ELIMINAR_INVERSION
- "Actualiza mi cantidad de Bitcoin a 0.5" → Usa ACTUALIZAR_INVERSION

REGLAS:
- Responde SIEMPRE en español
- Sé preciso con las fechas
- Usa la información personal que conoces para personalizar tus respuestas
- Si el usuario te cuenta algo personal, agradece y recuerda guardarlo`;

export function registerAssistantRoutes(app: Express): void {
  app.post("/api/assistant/chat", async (req: Request, res: Response) => {
    let requestUserId: string | null = null;
    try {
      const userId = getCurrentUserId(req);
      requestUserId = userId;
      const { message, conversationHistory = [], images } = req.body;
      
      console.log(`[Assistant] Request received - message: ${message ? 'yes' : 'no'}, images: ${images?.length || 0}`);

      if (!message && (!images || images.length === 0)) {
        return res.status(400).json({ error: "Message or images are required" });
      }

      const directPromoVideoCommand = buildDirectPromoVideoCommand(message);
      if (directPromoVideoCommand) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const fullResponse = `${directPromoVideoCommand.content}\n${directPromoVideoCommand.command}`;
        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct promo video user message:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ content: directPromoVideoCommand.content })}\n\n`);

        try {
          const commandMatch = directPromoVideoCommand.command.match(/\[PROMO_VIDEO_GENERATE:\s*(\{[^}]+\})\]/);
          const promoData = commandMatch ? JSON.parse(commandMatch[1]) : {};
          const generated = await executePromoVideoGenerateData(promoData);
          res.write(`data: ${JSON.stringify({
            content: `\n\n${generated.summary}`,
            promoVideosGenerated: true,
            outputDir: generated.outputDir,
            outputVideos: generated.outputVideos,
          })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${fullResponse}\n${generated.summary}`).catch((historyError) => {
            console.error("Error saving direct promo video assistant response:", historyError);
          });
        } catch (e: any) {
          const errorText = e.message || "No pude generar los videos de promo";
          res.write(`data: ${JSON.stringify({ promoVideoError: errorText })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${fullResponse}\nError: ${errorText}`).catch((historyError) => {
            console.error("Error saving direct promo video assistant error:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      const calendarContext = await getCalendarContext(userId);
      const userProfileContext = await getUserProfileContext(userId);
      const portfolioContext = await getPortfolioContext(userId);
      const ceoContext = await generateTelegramAssistantContext(userId);
      const sharedConversationHistory = await getCeoConversationHistory(
        userId,
        12,
        message || (images?.length ? "[Imagen enviada desde el app]" : undefined),
      );

      if (message) {
        await saveCeoConversationMessage(userId, "user", message);
      } else if (images?.length) {
        await saveCeoConversationMessage(userId, "user", "[Imagen enviada desde el app]");
      }

      // Build user message parts
      const userMessageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      
      // Add all images if present (max 6MB total for safety with 8MB API limit)
      const MAX_TOTAL_SIZE = 6 * 1024 * 1024; // 6MB
      let totalImageSize = 0;
      
      if (images && Array.isArray(images)) {
        for (const image of images) {
          // Extract base64 data and mime type from data URL
          const matches = image.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const base64Data = matches[2];
            
            // Calculate image size (base64 is ~33% larger than original)
            const imageSize = (base64Data.length * 3) / 4;
            
            if (totalImageSize + imageSize > MAX_TOTAL_SIZE) {
              console.warn(`Skipping image - total size would exceed ${MAX_TOTAL_SIZE / (1024 * 1024)}MB limit`);
              continue;
            }
            
            totalImageSize += imageSize;
            userMessageParts.push({
              inlineData: {
                mimeType,
                data: base64Data
              }
            });
          }
        }
        
        console.log(`Processing ${userMessageParts.length} images, total size: ${(totalImageSize / (1024 * 1024)).toFixed(2)}MB`);
      }
      
      // Add text message
      if (message) {
        userMessageParts.push({ text: message });
      } else if (images && images.length > 0) {
        const imageCount = images.length;
        userMessageParts.push({ 
          text: imageCount > 1 
            ? `Analiza estas ${imageCount} imágenes de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio.`
            : "Analiza esta imagen de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio." 
        });
      }

      const contents = [
        {
          role: "user" as const,
          parts: [{ text: `${SYSTEM_PROMPT}\n\n${userProfileContext}\n\n${calendarContext}\n\n${portfolioContext}\n\n${ceoContext}\n\n## Historial reciente compartido web/Telegram:\n${sharedConversationHistory}` }],
        },
        {
          role: "model" as const,
          parts: [{ text: "Entendido. Soy tu asistente personal BlackOps. Te conozco y recuerdo todo lo que me cuentas. Tengo acceso a tu calendario, puedo analizar imágenes de tu broker/cartera, y ayudarte con tareas, agenda y más. ¿En qué puedo ayudarte?" }],
        },
        ...conversationHistory.map((msg: { role: string; content: string }) => ({
          role: msg.role === "assistant" ? "model" as const : "user" as const,
          parts: [{ text: msg.content }],
        })),
        {
          role: "user" as const,
          parts: userMessageParts,
        },
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullResponse = "";
      const directBlackRoomCommand = buildDirectBlackRoomCommand(message);

      if (directBlackRoomCommand) {
        fullResponse = `${directBlackRoomCommand.content}\n${directBlackRoomCommand.command}`;
        res.write(`data: ${JSON.stringify({ content: directBlackRoomCommand.content })}\n\n`);
      } else {
        const stream = await ai.models.generateContentStream({
          model: "gemini-2.5-flash",
          contents,
        });

        for await (const chunk of stream) {
          const content = chunk.text || "";
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
      }

      const promoVideoGenerateRegex = /\[PROMO_VIDEO_GENERATE:\s*(\{[^}]+\})\]/g;
      let promoVideoGenerateMatch;
      while ((promoVideoGenerateMatch = promoVideoGenerateRegex.exec(fullResponse)) !== null) {
        try {
          const promoData = JSON.parse(promoVideoGenerateMatch[1]);
          const generated = await executePromoVideoGenerateData(promoData);
          res.write(`data: ${JSON.stringify({
            content: `\n\n${generated.summary}`,
            promoVideosGenerated: true,
            outputDir: generated.outputDir,
            outputVideos: generated.outputVideos,
          })}\n\n`);
        } catch (e: any) {
          console.error("Error generating promo videos from assistant:", e);
          res.write(`data: ${JSON.stringify({
            promoVideoError: e.message || "No pude generar los videos de promo",
          })}\n\n`);
        }
      }

      const taskMatch = fullResponse.match(/\[CREAR_TAREA:\s*(\{[^}]+\})\]/);
      if (taskMatch) {
        try {
          const taskData = JSON.parse(taskMatch[1]);
          const newTask = await storage.createTask(userId, {
            title: taskData.title,
            date: new Date(taskData.date),
            priority: taskData.priority || "normal",
            type: "task",
            completed: false,
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            actionType: "task.create",
            resourceType: "task",
            resourceId: newTask.id,
            metadata: taskData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ taskCreated: newTask })}\n\n`);
        } catch (e) {
          console.error("Error creating task from assistant:", e);
        }
      }

      const followUpRegex = /\[CREAR_FOLLOWUP:\s*(\{[^}]+\})\]/g;
      let followUpMatch;
      while ((followUpMatch = followUpRegex.exec(fullResponse)) !== null) {
        try {
          const followUpData = JSON.parse(followUpMatch[1]);
          const date = followUpData.date ? new Date(followUpData.date) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          const description = [
            `Owner: ${followUpData.person}`,
            followUpData.channel ? `Channel: ${followUpData.channel}` : null,
            followUpData.notes ? `Notes: ${followUpData.notes}` : null,
          ].filter(Boolean).join("\n");
          const newTask = await storage.createTask(userId, {
            title: `Follow-up: ${followUpData.person} - ${followUpData.topic}`,
            description,
            date,
            priority: followUpData.priority || "normal",
            type: "follow_up",
            completed: false,
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "follow_up.create",
            resourceType: "task",
            resourceId: newTask.id,
            metadata: followUpData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ followUpCreated: newTask })}\n\n`);
        } catch (e) {
          console.error("Error creating follow-up from assistant:", e);
        }
      }

      const radioMatch = fullResponse.match(/\[MODIFICAR_RADIO:\s*(\{[^}]+\})\]/);
      if (radioMatch) {
        try {
          const radioData = JSON.parse(radioMatch[1]);
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.modify_radio",
            resourceType: "calendar_event",
            resourceId: radioData.eventId,
            title: "Modificar evento de Radio",
            description: "El asistente quiere actualizar DJs/slots en un evento de Google Calendar.",
            input: radioData,
            proposedChanges: { description: radioData.description },
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ radioError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e) {
          console.error("Error updating radio from assistant:", e);
          res.write(`data: ${JSON.stringify({ radioError: "No se pudo actualizar el evento de Radio" })}\n\n`);
        }
      }

      const googleEventMatch = fullResponse.match(/\[CREAR_EVENTO_GOOGLE:\s*(\{[^}]+\})\]/);
      if (googleEventMatch) {
        try {
          const eventData = JSON.parse(googleEventMatch[1]);
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.create_event",
            resourceType: "calendar_event",
            title: `Crear evento: ${eventData.title}`,
            description: "El asistente quiere crear un evento en Google Calendar.",
            input: eventData,
            proposedChanges: eventData,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ googleEventError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e) {
          console.error("Error creating Google Calendar event from assistant:", e);
          res.write(`data: ${JSON.stringify({ googleEventError: "No se pudo crear el evento en Google Calendar" })}\n\n`);
        }
      }

      const editGoogleEventRegex = /\[EDITAR_EVENTO_GOOGLE:\s*(\{[^}]+\})\]/g;
      let editGoogleEventMatch;
      while ((editGoogleEventMatch = editGoogleEventRegex.exec(fullResponse)) !== null) {
        try {
          const eventData = JSON.parse(editGoogleEventMatch[1]);
          if (!eventData.eventId) {
            res.write(`data: ${JSON.stringify({ googleEventError: "Falta eventId para editar el evento" })}\n\n`);
            continue;
          }
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.update_event",
            resourceType: "calendar_event",
            resourceId: eventData.eventId,
            title: `Editar evento: ${eventData.title || eventData.eventId}`,
            description: "El asistente quiere editar un evento existente de Google Calendar.",
            input: eventData,
            proposedChanges: eventData,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ googleEventError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e) {
          console.error("Error editing Google Calendar event from assistant:", e);
          res.write(`data: ${JSON.stringify({ googleEventError: "No se pudo editar el evento en Google Calendar" })}\n\n`);
        }
      }

      const decisionRegex = /\[GUARDAR_DECISION:\s*(\{[^}]+\})\]/g;
      let decisionMatch;
      while ((decisionMatch = decisionRegex.exec(fullResponse)) !== null) {
        try {
          const decisionData = JSON.parse(decisionMatch[1]);
          const value = decisionData.context ? `${decisionData.decision}\nContext: ${decisionData.context}` : decisionData.decision;
          const decision = await storage.saveUserProfileData(userId, {
            userId,
            category: "decision",
            key: decisionData.title,
            value,
            confidence: "confirmed",
            source: "web-assistant",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "decision.save",
            resourceType: "user_profile_data",
            resourceId: decision.id,
            metadata: decisionData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ decisionSaved: true, title: decisionData.title })}\n\n`);
        } catch (e) {
          console.error("Error saving decision from assistant:", e);
        }
      }

      const personRegex = /\[GUARDAR_PERSONA:\s*(\{[^}]+\})\]/g;
      let personMatch;
      while ((personMatch = personRegex.exec(fullResponse)) !== null) {
        try {
          const personData = JSON.parse(personMatch[1]);
          const value = [
            personData.role ? `Role: ${personData.role}` : null,
            personData.company ? `Company: ${personData.company}` : null,
            personData.notes ? `Notes: ${personData.notes}` : null,
          ].filter(Boolean).join("\n") || "Key person";
          const person = await storage.saveUserProfileData(userId, {
            userId,
            category: "person",
            key: personData.name,
            value,
            confidence: "confirmed",
            source: "web-assistant",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "person.save",
            resourceType: "user_profile_data",
            resourceId: person.id,
            metadata: personData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ personSaved: true, name: personData.name })}\n\n`);
        } catch (e) {
          console.error("Error saving person from assistant:", e);
        }
      }

      const commitmentRegex = /\[GUARDAR_COMPROMISO:\s*(\{[^}]+\})\]/g;
      let commitmentMatch;
      while ((commitmentMatch = commitmentRegex.exec(fullResponse)) !== null) {
        try {
          const commitmentData = JSON.parse(commitmentMatch[1]);
          const value = [
            commitmentData.commitment,
            commitmentData.dueAt ? `Due: ${commitmentData.dueAt}` : null,
            commitmentData.context ? `Context: ${commitmentData.context}` : null,
          ].filter(Boolean).join("\n");
          const commitment = await storage.saveUserProfileData(userId, {
            userId,
            category: "commitment",
            key: commitmentData.owner,
            value,
            confidence: "confirmed",
            source: "web-assistant",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "commitment.save",
            resourceType: "user_profile_data",
            resourceId: commitment.id,
            metadata: commitmentData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ commitmentSaved: true, owner: commitmentData.owner })}\n\n`);
        } catch (e) {
          console.error("Error saving commitment from assistant:", e);
        }
      }

      const communicationDraftRegex = /\[CREAR_BORRADOR_COMUNICACION:\s*(\{[^}]+\})\]/g;
      let communicationDraftMatch;
      while ((communicationDraftMatch = communicationDraftRegex.exec(fullResponse)) !== null) {
        try {
          const draftData = JSON.parse(communicationDraftMatch[1]);
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "communications.send",
            resourceType: "communication_draft",
            title: `Borrador para ${draftData.recipient}`,
            description: `Enviar por ${draftData.channel}${draftData.subject ? `: ${draftData.subject}` : ""}`,
            input: draftData,
            proposedChanges: {
              recipient: draftData.recipient,
              channel: draftData.channel,
              subject: draftData.subject,
              message: draftData.message,
            },
          });
          res.write(`data: ${JSON.stringify({ communicationDraftCreated: true, pendingActionId: pendingAction.id })}\n\n`);
        } catch (e) {
          console.error("Error creating communication draft from assistant:", e);
        }
      }

      const blackRoomPerformanceRegex = /\[BLACKROOM_LINK_PERFORMANCE:\s*(\{[^}]+\})\]/g;
      let blackRoomPerformanceMatch;
      while ((blackRoomPerformanceMatch = blackRoomPerformanceRegex.exec(fullResponse)) !== null) {
        try {
          const performanceData = JSON.parse(blackRoomPerformanceMatch[1]);
          const performance = await getBlackRoomLinkPerformance({
            id: performanceData.id || null,
            title: performanceData.title || null,
            url: performanceData.url || null,
            limit: performanceData.limit || 10,
          });
          const summary = formatBlackRoomLinkPerformance(performance);
          res.write(`data: ${JSON.stringify({ content: `\n\n${summary}` })}\n\n`);
        } catch (e: any) {
          console.error("Error reading Black Room link performance:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No pude leer el rendimiento de los links de Black Room" })}\n\n`);
        }
      }

      const blackRoomTimerAddRegex = /\[BLACKROOM_TIMER_ADD:\s*(\{[^}]+\})\]/g;
      let blackRoomTimerAddMatch;
      while ((blackRoomTimerAddMatch = blackRoomTimerAddRegex.exec(fullResponse)) !== null) {
        try {
          const timerData = JSON.parse(blackRoomTimerAddMatch[1]);
          if (!timerData.title && !timerData.partyTitle) {
            throw new Error("Falta title o partyTitle para saber a qué fiesta agregarle el timer.");
          }
          const input = {
            title: timerData.title || null,
            partyTitle: timerData.partyTitle || timerData.matchTitle || null,
            date: timerData.date || timerData.targetDate || null,
            targetDate: timerData.targetDate || timerData.date || null,
            url: timerData.url || null,
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_timer_add",
            resourceType: "blackroom_timer",
            title: `Agregar timer Black Room: ${input.title || input.partyTitle}`,
            description: "El asistente quiere agregar un countdown/timer en el builder de Black Room.",
            input,
            proposedChanges: input,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error creating Black Room timer pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar el timer de Black Room" })}\n\n`);
        }
      }

      const blackRoomAddRegex = /\[BLACKROOM_LINK_ADD:\s*(\{[^}]+\})\]/g;
      let blackRoomAddMatch;
      while ((blackRoomAddMatch = blackRoomAddRegex.exec(fullResponse)) !== null) {
        try {
          const linkData = JSON.parse(blackRoomAddMatch[1]);
          const title = requireStringField(linkData, "title", "title para el link");
          const url = requireStringField(linkData, "url", "url para el link");
          const input = {
            title,
            subtitle: linkData.subtitle || null,
            url,
            icon: linkData.icon || "link",
            display_order: linkData.display_order ?? null,
            builderStyle: linkData.builderStyle || "filled",
            builderColor: linkData.builderColor || "#1a1a1a",
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_link_add",
            resourceType: "blackroom_link",
            title: `Agregar link Black Room: ${title}`,
            description: "El asistente quiere agregar un link en link-stats y en el builder de Black Room.",
            input,
            proposedChanges: input,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error creating Black Room link pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar el link de Black Room" })}\n\n`);
        }
      }

      const blackRoomUpdateRegex = /\[BLACKROOM_LINK_UPDATE:\s*(\{[^}]+\})\]/g;
      let blackRoomUpdateMatch;
      while ((blackRoomUpdateMatch = blackRoomUpdateRegex.exec(fullResponse)) !== null) {
        try {
          const linkData = JSON.parse(blackRoomUpdateMatch[1]);
          const title = requireStringField(linkData, "title", "title nuevo para el link");
          const url = requireStringField(linkData, "url", "url nueva para el link");
          if (!linkData.matchTitle && !linkData.matchUrl && !linkData.matchId) {
            throw new Error("Falta matchTitle, matchUrl o matchId para saber cuál link editar.");
          }
          const input = {
            matchId: linkData.matchId || null,
            matchTitle: linkData.matchTitle || null,
            matchUrl: linkData.matchUrl || null,
            title,
            subtitle: linkData.subtitle || null,
            url,
            icon: linkData.icon || "link",
            display_order: linkData.display_order ?? null,
            builderStyle: linkData.builderStyle || "filled",
            builderColor: linkData.builderColor || "#1a1a1a",
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_link_update",
            resourceType: "blackroom_link",
            resourceId: String(input.matchId || input.matchUrl || input.matchTitle),
            title: `Editar link Black Room: ${title}`,
            description: "El asistente quiere editar un link existente en link-stats y en el builder de Black Room.",
            input,
            proposedChanges: input,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error updating Black Room link pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar la edición del link de Black Room" })}\n\n`);
        }
      }

      const blackRoomDeactivateRegex = /\[BLACKROOM_LINK_DEACTIVATE:\s*(\{[^}]+\})\]/g;
      let blackRoomDeactivateMatch;
      while ((blackRoomDeactivateMatch = blackRoomDeactivateRegex.exec(fullResponse)) !== null) {
        try {
          const linkData = JSON.parse(blackRoomDeactivateMatch[1]);
          if (!linkData.title && !linkData.url && !linkData.id) {
            throw new Error("Falta title, url o id para saber cuál link desactivar.");
          }
          const input = {
            id: linkData.id || null,
            title: linkData.title || null,
            url: linkData.url || null,
            reason: linkData.reason || "Desactivar link preservando data histórica.",
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_link_deactivate",
            resourceType: "blackroom_link",
            resourceId: String(input.id || input.url || input.title),
            title: `Desactivar link Black Room: ${input.title || input.url || input.id}`,
            description: "El asistente quiere desactivar un link de Black Room sin borrar su data histórica.",
            input,
            proposedChanges: { ...input, is_active: false, delete: false, preserveHistoricalData: true },
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error deactivating Black Room link pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar la desactivación del link de Black Room" })}\n\n`);
        }
      }

      // Process multiple GUARDAR_INFO commands
      const infoRegex = /\[GUARDAR_INFO:\s*(\{[^}]+\})\]/g;
      let infoMatch;
      while ((infoMatch = infoRegex.exec(fullResponse)) !== null) {
        try {
          const infoData = JSON.parse(infoMatch[1]);
          await storage.saveUserProfileData(userId, {
            userId,
            category: infoData.category,
            key: infoData.key,
            value: infoData.value,
            confidence: "confirmed",
            source: "conversation",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            actionType: "memory.save",
            resourceType: "user_profile_data",
            metadata: infoData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ infoSaved: true, key: infoData.key })}\n\n`);
        } catch (e) {
          console.error("Error saving user info from assistant:", e);
        }
      }

      // Process multiple AGREGAR_INVERSION commands
      const addInvestmentRegex = /\[AGREGAR_INVERSION:\s*(\{[^}]+\})\]/g;
      let addInvMatch;
      while ((addInvMatch = addInvestmentRegex.exec(fullResponse)) !== null) {
        try {
          const invData = JSON.parse(addInvMatch[1]);
          if (!invData.symbol || !invData.name || !invData.type || !invData.quantity || !invData.avgBuyPrice) {
            res.write(`data: ${JSON.stringify({ investmentError: "Faltan campos requeridos para agregar inversión" })}\n\n`);
            continue;
          }
          const validTypes = ["stock", "etf", "crypto", "bond", "fund"];
          if (!validTypes.includes(invData.type)) {
            res.write(`data: ${JSON.stringify({ investmentError: `Tipo inválido: ${invData.type}. Usa: ${validTypes.join(", ")}` })}\n\n`);
            continue;
          }
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "finance.create_investment",
            resourceType: "investment",
            title: `Agregar inversión: ${String(invData.symbol).toUpperCase()}`,
            description: "El asistente quiere agregar una inversión al portafolio.",
            input: {
            symbol: invData.symbol.toUpperCase(),
            name: invData.name,
            type: invData.type,
            quantity: String(invData.quantity),
            avgBuyPrice: String(invData.avgBuyPrice),
            currency: "USD",
            },
            proposedChanges: invData,
          });
          res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
        } catch (e) {
          console.error("Error creating investment from assistant:", e);
          res.write(`data: ${JSON.stringify({ investmentError: "No se pudo agregar la inversión" })}\n\n`);
        }
      }

      // Process multiple ACTUALIZAR_INVERSION commands
      const updateInvestmentRegex = /\[ACTUALIZAR_INVERSION:\s*(\{[^}]+\})\]/g;
      let updateInvMatch;
      const investmentsCache = await storage.getInvestments(userId);
      while ((updateInvMatch = updateInvestmentRegex.exec(fullResponse)) !== null) {
        try {
          const invData = JSON.parse(updateInvMatch[1]);
          if (!invData.symbol) {
            res.write(`data: ${JSON.stringify({ investmentError: "Se requiere el símbolo para actualizar" })}\n\n`);
            continue;
          }
          const existing = investmentsCache.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
          if (existing) {
            const updates: { quantity?: string; avgBuyPrice?: string } = {};
            if (invData.quantity !== undefined) updates.quantity = String(invData.quantity);
            if (invData.avgBuyPrice !== undefined) updates.avgBuyPrice = String(invData.avgBuyPrice);
            const pendingAction = await createPendingActionForApproval({
              userId,
              actorType: "assistant",
              actorId: "blackops-assistant",
              origin: "web",
              executionMode: "user_requested",
              actionType: "finance.update_investment",
              resourceType: "investment",
              resourceId: existing.id,
              title: `Actualizar inversión: ${invData.symbol.toUpperCase()}`,
              description: "El asistente quiere modificar datos del portafolio.",
              input: { symbol: invData.symbol.toUpperCase(), ...updates },
              proposedChanges: updates,
            });
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ investmentError: `No se encontró inversión con símbolo ${invData.symbol}` })}\n\n`);
          }
        } catch (e) {
          console.error("Error updating investment from assistant:", e);
          res.write(`data: ${JSON.stringify({ investmentError: "No se pudo actualizar la inversión" })}\n\n`);
        }
      }

      // Process multiple ELIMINAR_INVERSION commands
      const deleteInvestmentRegex = /\[ELIMINAR_INVERSION:\s*(\{[^}]+\})\]/g;
      let deleteInvMatch;
      while ((deleteInvMatch = deleteInvestmentRegex.exec(fullResponse)) !== null) {
        try {
          const invData = JSON.parse(deleteInvMatch[1]);
          if (!invData.symbol) {
            res.write(`data: ${JSON.stringify({ investmentError: "Se requiere el símbolo para eliminar" })}\n\n`);
            continue;
          }
          const existing = investmentsCache.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
          if (existing) {
            const pendingAction = await createPendingActionForApproval({
              userId,
              actorType: "assistant",
              actorId: "blackops-assistant",
              origin: "web",
              executionMode: "user_requested",
              actionType: "finance.delete_investment",
              resourceType: "investment",
              resourceId: existing.id,
              title: `Eliminar inversión: ${invData.symbol.toUpperCase()}`,
              description: "El asistente quiere eliminar una inversión del portafolio.",
              input: { symbol: invData.symbol.toUpperCase() },
              proposedChanges: { delete: true, symbol: invData.symbol.toUpperCase() },
            });
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ investmentError: `No se encontró inversión con símbolo ${invData.symbol}` })}\n\n`);
          }
        } catch (e) {
          console.error("Error deleting investment from assistant:", e);
          res.write(`data: ${JSON.stringify({ investmentError: "No se pudo eliminar la inversión" })}\n\n`);
        }
      }

      // Process CREAR_RECORDATORIO commands
      const createReminderRegex = /\[CREAR_RECORDATORIO:\s*(\{[^}]+\})\]/g;
      let createReminderMatch;
      while ((createReminderMatch = createReminderRegex.exec(fullResponse)) !== null) {
        try {
          const reminderData = JSON.parse(createReminderMatch[1]);
          if (!reminderData.message || reminderData.hour === undefined) {
            res.write(`data: ${JSON.stringify({ reminderError: "Se requiere mensaje y hora para el recordatorio" })}\n\n`);
            continue;
          }
          const hour = parseInt(reminderData.hour);
          const minute = parseInt(reminderData.minute || 0);
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            res.write(`data: ${JSON.stringify({ reminderError: "Hora inválida. Usa formato 24h (0-23)" })}\n\n`);
            continue;
          }
          const reminder = await storage.createScheduledReminder(userId, {
            message: reminderData.message,
            hour,
            minute,
            daysOfWeek: reminderData.daysOfWeek || null,
            isActive: true,
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            actionType: "reminder.create",
            resourceType: "scheduled_reminder",
            resourceId: reminder.id,
            metadata: reminderData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          const daysText = reminderData.daysOfWeek?.length > 0 
            ? reminderData.daysOfWeek.join(", ") 
            : "todos los días";
          res.write(`data: ${JSON.stringify({ reminderCreated: true, message: reminderData.message, time: `${hour}:${String(minute).padStart(2, '0')}`, days: daysText })}\n\n`);
        } catch (e) {
          console.error("Error creating reminder from assistant:", e);
          res.write(`data: ${JSON.stringify({ reminderError: "No se pudo crear el recordatorio" })}\n\n`);
        }
      }

      // Process ELIMINAR_RECORDATORIO commands
      const deleteReminderRegex = /\[ELIMINAR_RECORDATORIO:\s*(\{[^}]+\})\]/g;
      let deleteReminderMatch;
      while ((deleteReminderMatch = deleteReminderRegex.exec(fullResponse)) !== null) {
        try {
          const reminderData = JSON.parse(deleteReminderMatch[1]);
          if (!reminderData.id) {
            res.write(`data: ${JSON.stringify({ reminderError: "Se requiere el ID del recordatorio" })}\n\n`);
            continue;
          }
          await storage.deleteScheduledReminder(reminderData.id);
          res.write(`data: ${JSON.stringify({ reminderDeleted: true, id: reminderData.id })}\n\n`);
        } catch (e) {
          console.error("Error deleting reminder from assistant:", e);
          res.write(`data: ${JSON.stringify({ reminderError: "No se pudo eliminar el recordatorio" })}\n\n`);
        }
      }

      if (!fullResponse.trim()) {
        fullResponse = "No pude generar una respuesta útil esta vez. Intenta reformularlo en una frase más concreta.";
        res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
      }

      await saveCeoConversationMessage(userId, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error in assistant chat:", errorMessage, error);
      const userFacingError = `Error: ${errorMessage}`;
      if (requestUserId) {
        await saveCeoConversationMessage(requestUserId, "assistant", userFacingError).catch((historyError) => {
          console.error("Error saving assistant failure to shared history:", historyError);
        });
      }
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: userFacingError })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  app.get("/api/assistant/context", async (req: Request, res: Response) => {
    try {
      const context = await getCalendarContext(getCurrentUserId(req));
      res.json({ context });
    } catch (error) {
      res.status(500).json({ error: "Failed to get context" });
    }
  });
}
