import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { format, addDays, startOfMonth, endOfMonth, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import type { Task, DjContact } from "@shared/schema";

const MOCK_USER_ID = "mock-user-123";

export interface RadioSlot {
  eventId: string;
  date: Date;
  dateStr: string;
  slot7: string | null;
  slot8: string | null;
  slot9: string | null;
  emptySlots: number[];
}

export interface RadioAnalysis {
  totalEvents: number;
  eventsWithEmptySlots: number;
  slotsToFill: { eventId: string; date: string; slots: number[] }[];
  upcomingEvents: RadioSlot[];
}

function parseRadioDescription(description: string | null): { slot7: string | null; slot8: string | null; slot9: string | null } {
  if (!description) {
    return { slot7: null, slot8: null, slot9: null };
  }

  const cleanDesc = description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');

  const lines = cleanDesc.split('\n');
  let slot7: string | null = null;
  let slot8: string | null = null;
  let slot9: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const slot7Pattern = /^7(?:\s*pm)?[:.]?\s*/i;
    const slot8Pattern = /^8(?:\s*pm)?[:.]?\s*/i;
    const slot9Pattern = /^9(?:\s*pm)?[:.]?\s*/i;
    
    if (trimmed.match(slot7Pattern)) {
      const djName = trimmed.replace(slot7Pattern, '').trim();
      slot7 = djName.length > 0 ? djName : null;
    } else if (trimmed.match(slot8Pattern)) {
      const djName = trimmed.replace(slot8Pattern, '').trim();
      slot8 = djName.length > 0 ? djName : null;
    } else if (trimmed.match(slot9Pattern)) {
      const djName = trimmed.replace(slot9Pattern, '').trim();
      slot9 = djName.length > 0 ? djName : null;
    }
  }

  return { slot7, slot8, slot9 };
}

export async function analyzeRadioEvents(): Promise<RadioAnalysis> {
  const tasks = await storage.getTasks(MOCK_USER_ID);
  const now = new Date();
  const monthEnd = endOfMonth(addDays(now, 60));

  const radioEvents = tasks
    .filter(t => t.title === "Radio" && t.externalSource === "google" && isAfter(new Date(t.date), now))
    .filter(t => isAfter(monthEnd, new Date(t.date)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const upcomingEvents: RadioSlot[] = [];
  const slotsToFill: { eventId: string; date: string; slots: number[] }[] = [];

  for (const event of radioEvents) {
    const { slot7, slot8, slot9 } = parseRadioDescription(event.description);
    const emptySlots: number[] = [];
    
    if (!slot7) emptySlots.push(7);
    if (!slot8) emptySlots.push(8);
    if (!slot9) emptySlots.push(9);

    const dateStr = format(new Date(event.date), "EEEE d 'de' MMMM", { locale: es });
    
    upcomingEvents.push({
      eventId: event.externalId || "",
      date: new Date(event.date),
      dateStr,
      slot7,
      slot8,
      slot9,
      emptySlots,
    });

    if (emptySlots.length > 0 && event.externalId) {
      slotsToFill.push({
        eventId: event.externalId,
        date: dateStr,
        slots: emptySlots,
      });
    }
  }

  return {
    totalEvents: radioEvents.length,
    eventsWithEmptySlots: slotsToFill.length,
    slotsToFill,
    upcomingEvents,
  };
}

export async function generateDjSuggestions(slotsNeeded: number): Promise<DjContact[]> {
  const availableDjs = await storage.getAvailableDjContacts(MOCK_USER_ID);
  
  const sortedDjs = availableDjs.sort((a, b) => {
    const aScore = (a.rating || 3) + (a.lastContacted ? -1 : 1);
    const bScore = (b.rating || 3) + (b.lastContacted ? -1 : 1);
    return bScore - aScore;
  });

  return sortedDjs.slice(0, slotsNeeded);
}

export async function generateDjMessage(dj: DjContact, eventDate: string, slot: number): Promise<string> {
  const template = await storage.getDefaultDjMessageTemplate(MOCK_USER_ID);
  
  const defaultTemplate = `Hola {{nombre}}! 👋

Te escribo de Black Room Radio. Tenemos un espacio disponible el {{fecha}} a las {{hora}}pm.

¿Te gustaría participar con un set? Sería genial tenerte.

Avísame si te interesa!`;

  const templateText = template?.template || defaultTemplate;
  
  return templateText
    .replace(/\{\{nombre\}\}/g, dj.name)
    .replace(/\{\{fecha\}\}/g, eventDate)
    .replace(/\{\{hora\}\}/g, String(slot))
    .replace(/\{\{instagram\}\}/g, dj.instagramHandle || "");
}

export async function createVideoEditTask(eventDate: Date): Promise<void> {
  const dayAfter = addDays(eventDate, 1);
  dayAfter.setHours(10, 0, 0, 0);
  
  const dateStr = format(eventDate, "d 'de' MMMM", { locale: es });
  
  await storage.createTask(MOCK_USER_ID, {
    title: `Editar videos Radio ${dateStr}`,
    date: dayAfter,
    priority: "high",
    type: "task",
    completed: false,
  });
}

export async function sendRadioSlotsSummary(): Promise<{ sent: boolean; message: string }> {
  const config = await storage.getTelegramConfig(MOCK_USER_ID);
  if (!config || !config.enabled) {
    return { sent: false, message: "Telegram not configured" };
  }

  const analysis = await analyzeRadioEvents();
  
  if (analysis.eventsWithEmptySlots === 0) {
    return { sent: false, message: "No empty slots found" };
  }

  let message = `📻 *RADIO - SLOTS VACÍOS*\n\n`;
  message += `Tienes ${analysis.eventsWithEmptySlots} eventos con slots por llenar:\n\n`;

  for (const event of analysis.slotsToFill.slice(0, 5)) {
    const slotsStr = event.slots.map(s => `${s}pm`).join(", ");
    message += `📅 *${event.date}*\n`;
    message += `   Slots vacíos: ${slotsStr}\n\n`;
  }

  const suggestedDjs = await generateDjSuggestions(3);
  if (suggestedDjs.length > 0) {
    message += `\n🎧 *DJs disponibles para contactar:*\n`;
    for (const dj of suggestedDjs) {
      const instagram = dj.instagramHandle ? ` (@${dj.instagramHandle})` : "";
      const rating = dj.rating ? ` ⭐${dj.rating}` : "";
      message += `• ${dj.name}${instagram}${rating}\n`;
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { sent: false, message: "No bot token" };
  }

  await sendTelegramMessage(botToken, config.chatId, message);
  return { sent: true, message: `Sent summary with ${analysis.eventsWithEmptySlots} events with empty slots` };
}

export async function getRadioSlotsForMonth(): Promise<RadioSlot[]> {
  const analysis = await analyzeRadioEvents();
  return analysis.upcomingEvents;
}

export async function extractDjsFromRadioEvents(): Promise<{ name: string; instagram?: string }[]> {
  const tasks = await storage.getTasks(MOCK_USER_ID);
  const radioEvents = tasks.filter(t => t.title === "Radio" && t.externalSource === "google");
  
  const djSet = new Map<string, { name: string; instagram?: string }>();

  for (const event of radioEvents) {
    if (!event.description) continue;
    
    const cleanDesc = event.description
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    const lines = cleanDesc.split('\n');
    
    for (const line of lines) {
      const match = line.match(/^[789][:.]?\s*(.+)/i);
      if (match) {
        let djInfo = match[1].trim();
        if (djInfo.length === 0) continue;
        
        const instagramMatch = djInfo.match(/@(\w+)/);
        const instagram = instagramMatch ? instagramMatch[1] : undefined;
        
        const name = djInfo
          .replace(/@\w+/g, '')
          .replace(/https?:\/\/[^\s]+/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (name.length > 0) {
          const key = name.toLowerCase();
          if (!djSet.has(key)) {
            djSet.set(key, { name, instagram });
          }
        }
      }
    }
  }

  return Array.from(djSet.values());
}

export async function importDjsFromRadioHistory(): Promise<{ imported: number; skipped: number }> {
  const extractedDjs = await extractDjsFromRadioEvents();
  const existingDjs = await storage.getDjContacts(MOCK_USER_ID);
  const existingNames = new Set(existingDjs.map(d => d.name.toLowerCase()));

  let imported = 0;
  let skipped = 0;

  for (const dj of extractedDjs) {
    if (existingNames.has(dj.name.toLowerCase())) {
      skipped++;
      continue;
    }

    await storage.createDjContact(MOCK_USER_ID, {
      name: dj.name,
      instagramHandle: dj.instagram || null,
      status: "available",
    });
    imported++;
  }

  return { imported, skipped };
}
