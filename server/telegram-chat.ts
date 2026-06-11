import { GoogleGenAI, Content, Part } from "@google/genai";
import { storage } from "./storage";
import { sendTelegramMessage, TelegramUpdate, setTelegramWebhook, getWebhookInfo } from "./telegram";
import { getCalendarEvents, isGoogleCalendarConnected, updateCalendarEventDescription, createCalendarEvent } from "./google-calendar";
import { format, addMonths, startOfMonth, parseISO, startOfWeek, endOfWeek, addDays } from "date-fns";
import { es } from "date-fns/locale";

async function downloadTelegramPhoto(botToken: string, fileId: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      console.error("[Telegram] Failed to get file path:", fileData);
      return null;
    }
    
    const filePath = fileData.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    
    const imageResponse = await fetch(fileUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    
    const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
    
    console.log("[Telegram] Downloaded image:", { filePath, size: arrayBuffer.byteLength, mimeType });
    return { base64, mimeType };
  } catch (error) {
    console.error("[Telegram] Error downloading photo:", error);
    return null;
  }
}

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const MOCK_USER_ID = "mock-user-123";

async function getCalendarContext(): Promise<string> {
  try {
    const isConnected = await isGoogleCalendarConnected();
    if (!isConnected) {
      return "Google Calendar no está conectado.";
    }
    const startDate = new Date();
    const endDate = addMonths(startDate, 12);
    const events = await getCalendarEvents(startDate, endDate);
    if (!events || events.length === 0) {
      return "No hay eventos en el calendario para los próximos 12 meses.";
    }
    
    // Separar eventos de Radio (usar title, no summary)
    const radioEvents = events.filter((e: any) => 
      e.title?.toLowerCase().includes("radio")
    );
    const otherEvents = events.filter((e: any) => 
      !e.title?.toLowerCase().includes("radio")
    ).slice(0, 15);
    
    let context = "📅 CALENDARIO DE GOOGLE:\n";
    
    if (radioEvents.length > 0) {
      context += "\n🎵 EVENTOS DE RADIO (con eventId para modificar):\n";
      radioEvents.forEach((e: any) => {
        // e.date is already a Date object from getCalendarEvents
        const dateStr = e.date ? format(e.date, "EEEE d 'de' MMMM yyyy", { locale: es }) : "Sin fecha";
        context += `\n📻 ${dateStr}\n`;
        context += `   eventId: ${e.id}\n`;
        // Limpiar HTML de la descripción
        const cleanDesc = e.description 
          ? e.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
          : "Sin DJs asignados";
        context += `   DJs: ${cleanDesc.substring(0, 150)}\n`;
      });
    }
    
    if (otherEvents.length > 0) {
      context += "\n📌 OTROS EVENTOS:\n";
      otherEvents.forEach((e: any) => {
        const dateStr = e.date ? format(e.date, "EEE d MMM", { locale: es }) : "?";
        context += `- ${dateStr}: ${e.title || "Sin título"}\n`;
      });
    }
    
    return context;
  } catch (error) {
    console.error("Error getting calendar context:", error);
    return "Error al obtener eventos del calendario.";
  }
}

async function getUserProfileContext(): Promise<string> {
  try {
    const profileData = await storage.getUserProfileData(MOCK_USER_ID);
    if (!profileData || profileData.length === 0) {
      return "";
    }
    const grouped: Record<string, string[]> = {};
    for (const item of profileData) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(`${item.key}: ${item.value}`);
    }
    let context = "Información personal del usuario:\n";
    for (const [category, items] of Object.entries(grouped)) {
      context += `\n${category}:\n${items.map(i => `  - ${i}`).join("\n")}`;
    }
    return context;
  } catch (error) {
    return "";
  }
}

async function getPortfolioContext(): Promise<string> {
  try {
    const investments = await storage.getInvestments(MOCK_USER_ID);
    if (!investments || investments.length === 0) {
      return "El usuario no tiene inversiones registradas.";
    }
    const invList = investments.map(i => 
      `- ${i.symbol} (${i.name}): ${i.quantity} unidades a $${i.avgBuyPrice} promedio`
    ).join("\n");
    return `Portafolio de inversiones:\n${invList}`;
  } catch (error) {
    return "";
  }
}

async function getTasksContext(): Promise<string> {
  try {
    const tasks = await storage.getTasks(MOCK_USER_ID);
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    
    const todayTasks = tasks.filter(t => {
      const taskDate = new Date(t.date);
      return taskDate.toDateString() === today.toDateString();
    });
    
    const weekTasks = tasks.filter(t => {
      const taskDate = new Date(t.date);
      return taskDate >= weekStart && taskDate <= weekEnd;
    });
    
    const radioEvents = tasks.filter(t => 
      t.type === "event" && t.title.toLowerCase().includes("radio")
    ).slice(0, 10);
    
    let context = "";
    
    if (todayTasks.length > 0) {
      const list = todayTasks.map(t => 
        `- ${t.completed ? "✅" : "⏳"} ${t.title}${t.priority === "high" ? " (ALTA PRIORIDAD)" : ""}`
      ).join("\n");
      context += `\n📅 TAREAS DE HOY (${format(today, "EEEE d MMMM", { locale: es })}):\n${list}`;
    } else {
      context += `\n📅 No hay tareas para hoy.`;
    }
    
    if (radioEvents.length > 0) {
      const radioList = radioEvents.map(e => {
        const date = format(new Date(e.date), "EEE d MMM", { locale: es });
        return `- ${date}: ${e.title}\n  ${e.description || "Sin DJs asignados"}`;
      }).join("\n");
      context += `\n\n🎵 PRÓXIMOS EVENTOS DE RADIO:\n${radioList}`;
    }
    
    return context;
  } catch (error) {
    console.error("Error getting tasks context:", error);
    return "";
  }
}

function getTelegramSystemPrompt(): string {
  const now = new Date();
  const dateStr = format(now, "EEEE d 'de' MMMM yyyy, HH:mm", { locale: es });
  
  return `Eres un asistente personal inteligente que responde por Telegram.
Tu nombre es BlackOps Assistant y ayudas con:
- Gestión de tareas y recordatorios
- Calendario y eventos (especialmente eventos de Radio los miércoles)
- Portafolio de inversiones
- Información personal guardada

FECHA Y HORA ACTUAL: ${dateStr} (zona horaria: Los Angeles/Pacific)

REGLAS IMPORTANTES:
- Responde SIEMPRE en español
- Sé conciso pero informativo (máximo 3-4 párrafos)
- No uses formato HTML ni markdown complejo, solo texto plano con emojis
- Puedes usar emojis para hacer las respuestas más amigables
- PUEDES ejecutar acciones directamente, no necesitas que el usuario vaya a la app web

COMANDOS DISPONIBLES (úsalos cuando sea apropiado):
- [CREAR_TAREA: {"title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "priority": "normal|high|low"}]
- [GUARDAR_INFO: {"category": "...", "key": "...", "value": "..."}]
- [CREAR_RECORDATORIO: {"message": "...", "hour": 8, "minute": 0, "daysOfWeek": ["monday", "tuesday"]}]
- [MODIFICAR_RADIO: {"eventId": "ID_DEL_EVENTO", "description": "7: DJ1\\n8: DJ2\\n9: DJ3"}]
- [AGREGAR_INVERSION: {"symbol": "AAPL", "name": "Apple Inc", "type": "stock", "quantity": "10", "avgBuyPrice": "150.50"}]
- [ACTUALIZAR_INVERSION: {"symbol": "AAPL", "quantity": "15", "avgBuyPrice": "145.00"}]
- [ELIMINAR_INVERSION: {"symbol": "AAPL"}]

INFORMACIÓN SOBRE RADIO:
- Los eventos de Radio son los MIÉRCOLES
- La descripción del evento tiene el formato: "7: nombre_dj\\n8: nombre_dj\\n9: nombre_dj"
- 7, 8, 9 representan las horas (7pm, 8pm, 9pm Pacific)
- Cada Radio tiene un eventId (externalId) único que necesitas para modificarlo
- Si un slot está vacío, aparece como "7:" o "7: " (sin nombre)

TIPOS DE INVERSIÓN: stock, etf, crypto, bond, fund`;
}

async function processAssistantResponse(response: string): Promise<string[]> {
  const actions: string[] = [];
  
  const createTaskRegex = /\[CREAR_TAREA:\s*(\{[^}]+\})\]/g;
  let taskMatch;
  while ((taskMatch = createTaskRegex.exec(response)) !== null) {
    try {
      const taskData = JSON.parse(taskMatch[1]);
      await storage.createTask(MOCK_USER_ID, {
        title: taskData.title,
        date: new Date(taskData.date),
        priority: taskData.priority || "normal",
        completed: false,
        type: "regular",
      });
      actions.push(`✅ Tarea creada: ${taskData.title}`);
    } catch (e) {
      console.error("Error creating task from Telegram:", e);
    }
  }

  const saveInfoRegex = /\[GUARDAR_INFO:\s*(\{[^}]+\})\]/g;
  let infoMatch;
  while ((infoMatch = saveInfoRegex.exec(response)) !== null) {
    try {
      const infoData = JSON.parse(infoMatch[1]);
      await storage.saveUserProfileData(MOCK_USER_ID, {
        userId: MOCK_USER_ID,
        category: infoData.category,
        key: infoData.key,
        value: infoData.value,
      });
      actions.push(`💾 Info guardada: ${infoData.key}`);
    } catch (e) {
      console.error("Error saving info from Telegram:", e);
    }
  }

  const reminderRegex = /\[CREAR_RECORDATORIO:\s*(\{[^}]+\})\]/g;
  let reminderMatch;
  while ((reminderMatch = reminderRegex.exec(response)) !== null) {
    try {
      const reminderData = JSON.parse(reminderMatch[1]);
      await storage.createScheduledReminder(MOCK_USER_ID, {
        message: reminderData.message,
        hour: parseInt(reminderData.hour),
        minute: parseInt(reminderData.minute || 0),
        daysOfWeek: reminderData.daysOfWeek || null,
        isActive: true,
      });
      actions.push(`⏰ Recordatorio creado: ${reminderData.message}`);
    } catch (e) {
      console.error("Error creating reminder from Telegram:", e);
    }
  }

  // Process MODIFICAR_RADIO commands
  const modifyRadioRegex = /\[MODIFICAR_RADIO:\s*(\{[^}]+\})\]/g;
  let radioMatch;
  while ((radioMatch = modifyRadioRegex.exec(response)) !== null) {
    try {
      const radioData = JSON.parse(radioMatch[1]);
      if (radioData.eventId && radioData.description) {
        await updateCalendarEventDescription(radioData.eventId, radioData.description);
        actions.push(`🎵 Radio actualizado`);
      }
    } catch (e) {
      console.error("Error modifying radio from Telegram:", e);
    }
  }

  // Process AGREGAR_INVERSION commands
  const addInvestmentRegex = /\[AGREGAR_INVERSION:\s*(\{[^}]+\})\]/g;
  let addInvMatch;
  while ((addInvMatch = addInvestmentRegex.exec(response)) !== null) {
    try {
      const invData = JSON.parse(addInvMatch[1]);
      const validTypes = ["stock", "etf", "crypto", "bond", "fund"];
      const type = validTypes.includes(invData.type) ? invData.type : "stock";
      await storage.createInvestment(MOCK_USER_ID, {
        symbol: invData.symbol.toUpperCase(),
        name: invData.name,
        type,
        quantity: String(invData.quantity),
        avgBuyPrice: String(invData.avgBuyPrice),
      });
      actions.push(`📈 Inversión agregada: ${invData.symbol.toUpperCase()}`);
    } catch (e) {
      console.error("Error adding investment from Telegram:", e);
    }
  }

  // Process ACTUALIZAR_INVERSION commands
  const updateInvestmentRegex = /\[ACTUALIZAR_INVERSION:\s*(\{[^}]+\})\]/g;
  let updateInvMatch;
  const investments = await storage.getInvestments(MOCK_USER_ID);
  while ((updateInvMatch = updateInvestmentRegex.exec(response)) !== null) {
    try {
      const invData = JSON.parse(updateInvMatch[1]);
      const existing = investments.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
      if (existing) {
        const updates: any = {};
        if (invData.quantity) updates.quantity = String(invData.quantity);
        if (invData.avgBuyPrice) updates.avgBuyPrice = String(invData.avgBuyPrice);
        await storage.updateInvestment(existing.id, updates);
        actions.push(`📊 Inversión actualizada: ${invData.symbol.toUpperCase()}`);
      }
    } catch (e) {
      console.error("Error updating investment from Telegram:", e);
    }
  }

  // Process ELIMINAR_INVERSION commands
  const deleteInvestmentRegex = /\[ELIMINAR_INVERSION:\s*(\{[^}]+\})\]/g;
  let deleteInvMatch;
  while ((deleteInvMatch = deleteInvestmentRegex.exec(response)) !== null) {
    try {
      const invData = JSON.parse(deleteInvMatch[1]);
      const existing = investments.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
      if (existing) {
        await storage.deleteInvestment(existing.id);
        actions.push(`🗑️ Inversión eliminada: ${invData.symbol.toUpperCase()}`);
      }
    } catch (e) {
      console.error("Error deleting investment from Telegram:", e);
    }
  }

  return actions;
}

function cleanResponseForTelegram(response: string): string {
  let clean = response
    .replace(/\[CREAR_TAREA:[^\]]+\]/g, "")
    .replace(/\[GUARDAR_INFO:[^\]]+\]/g, "")
    .replace(/\[CREAR_RECORDATORIO:[^\]]+\]/g, "")
    .replace(/\[MODIFICAR_RADIO:[^\]]+\]/g, "")
    .replace(/\[CREAR_EVENTO_GOOGLE:[^\]]+\]/g, "")
    .replace(/\[AGREGAR_INVERSION:[^\]]+\]/g, "")
    .replace(/\[ACTUALIZAR_INVERSION:[^\]]+\]/g, "")
    .replace(/\[ELIMINAR_INVERSION:[^\]]+\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean;
}

export async function handleTelegramMessage(update: TelegramUpdate): Promise<void> {
  const hasText = !!update.message?.text;
  const hasPhoto = !!update.message?.photo && update.message.photo.length > 0;
  const hasCaption = !!update.message?.caption;
  
  if (!hasText && !hasPhoto) return;
  
  const chatId = update.message!.chat.id.toString();
  const userMessage = update.message?.text || update.message?.caption || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error("[Telegram Chat] No bot token configured");
    return;
  }

  const config = await storage.getTelegramConfig(MOCK_USER_ID);
  if (!config || config.chatId !== chatId) {
    await sendTelegramMessage(botToken, chatId, 
      "⚠️ Este chat no está configurado. Por favor configura el bot desde la aplicación web primero.");
    return;
  }

  try {
    if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      await sendTelegramMessage(botToken, chatId, "❌ Error: API de IA no configurada.");
      return;
    }

    await sendTelegramMessage(botToken, chatId, hasPhoto ? "📷 Analizando imagen..." : "💭 Pensando...");

    // Download photo if present
    let imageData: { base64: string; mimeType: string } | null = null;
    if (hasPhoto && update.message?.photo) {
      const photos = update.message.photo;
      const largestPhoto = photos[photos.length - 1]; // Get highest resolution
      imageData = await downloadTelegramPhoto(botToken, largestPhoto.file_id);
    }

    const [calendarContext, userProfile, portfolioContext, tasksContext] = await Promise.all([
      getCalendarContext(),
      getUserProfileContext(),
      getPortfolioContext(),
      getTasksContext(),
    ]);

    console.log("[Telegram Chat] Calendar context length:", calendarContext.length);
    console.log("[Telegram Chat] Tasks context length:", tasksContext.length);
    console.log("[Telegram Chat] Has image:", !!imageData);

    const systemPrompt = getTelegramSystemPrompt();
    const contextPrompt = `${systemPrompt}

=== DATOS DEL USUARIO ===

${calendarContext}

${tasksContext}

${userProfile}

${portfolioContext}

=== FIN DE DATOS ===`;

    // Build content parts for Gemini
    const parts: Part[] = [];
    
    // Add image if present
    if (imageData) {
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.base64,
        },
      });
      
      // Add default message if no text was provided with the image
      const imageMessage = userMessage || "Analiza esta imagen de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio.";
      parts.push({ text: `${contextPrompt}\n\nUsuario dice: ${imageMessage}` });
    } else {
      parts.push({ text: `${contextPrompt}\n\nUsuario dice: ${userMessage}` });
    }

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
    });
    const responseText = result.text || "";

    const actions = await processAssistantResponse(responseText);
    let cleanResponse = cleanResponseForTelegram(responseText);
    
    if (actions.length > 0) {
      cleanResponse += "\n\n" + actions.join("\n");
    }

    if (cleanResponse.length > 4000) {
      cleanResponse = cleanResponse.substring(0, 3997) + "...";
    }

    await sendTelegramMessage(botToken, chatId, cleanResponse);
  } catch (error) {
    console.error("[Telegram Chat] Error processing message:", error);
    await sendTelegramMessage(botToken, chatId, "❌ Error al procesar el mensaje. Intenta de nuevo.");
  }
}

export async function setupTelegramWebhook(): Promise<{ success: boolean; message: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { success: false, message: "No bot token configured" };
  }

  const webhookUrl = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/telegram/webhook`
    : process.env.REPL_SLUG 
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/api/telegram/webhook`
      : null;

  if (!webhookUrl) {
    return { success: false, message: "Could not determine webhook URL" };
  }

  const success = await setTelegramWebhook(botToken, webhookUrl);
  return { 
    success, 
    message: success ? `Webhook configured: ${webhookUrl}` : "Failed to set webhook" 
  };
}

export async function getTelegramWebhookStatus(): Promise<any> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return null;
  return await getWebhookInfo(botToken);
}
