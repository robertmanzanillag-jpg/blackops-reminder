// Telegram Bot Integration for Reminders and Chat

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: "HTML" | "Markdown";
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    caption?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
  };
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      } as TelegramMessage),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("Telegram error:", result.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}

export async function getTelegramUpdates(botToken: string): Promise<any[]> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/getUpdates`);
    const result = await response.json();
    if (result.ok) {
      return result.result;
    }
    return [];
  } catch (error) {
    console.error("Error getting Telegram updates:", error);
    return [];
  }
}

export async function validateTelegramBot(botToken: string): Promise<{ valid: boolean; botName?: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
    const result = await response.json();
    if (result.ok) {
      return { valid: true, botName: result.result.username };
    }
    return { valid: false };
  } catch (error) {
    return { valid: false };
  }
}

export async function setTelegramWebhook(botToken: string, webhookUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const result = await response.json();
    console.log("[Telegram] Webhook set result:", result);
    return result.ok;
  } catch (error) {
    console.error("Error setting Telegram webhook:", error);
    return false;
  }
}

export async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`);
    const result = await response.json();
    return result.ok;
  } catch (error) {
    console.error("Error deleting Telegram webhook:", error);
    return false;
  }
}

export async function getWebhookInfo(botToken: string): Promise<any> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
    const result = await response.json();
    return result.ok ? result.result : null;
  } catch (error) {
    console.error("Error getting webhook info:", error);
    return null;
  }
}

export { TelegramUpdate };
