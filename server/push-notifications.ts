import webpush from "web-push";
import { storage } from "./storage";

// Configure web-push with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:blackops@reminder.app";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  taskId?: string;
}

export async function sendPushNotification(
  userId: string,
  payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
  const subscriptions = await storage.getPushSubscriptions(userId);
  
  let success = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
      success++;
    } catch (error: any) {
      failed++;
      // Remove invalid subscriptions (410 Gone or 404 Not Found)
      if (error.statusCode === 410 || error.statusCode === 404) {
        await storage.deletePushSubscription(sub.endpoint);
      }
    }
  }

  return { success, failed };
}

export async function sendNotificationToAll(
  payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
  const subscriptions = await storage.getAllPushSubscriptions();
  
  let success = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
      success++;
    } catch (error: any) {
      failed++;
      if (error.statusCode === 410 || error.statusCode === 404) {
        await storage.deletePushSubscription(sub.endpoint);
      }
    }
  }

  return { success, failed };
}
