import { useState, useEffect } from "react";
import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NotificationStatus = "loading" | "unsupported" | "denied" | "subscribed" | "unsubscribed";

export function NotificationSettings() {
  const [status, setStatus] = useState<NotificationStatus>("loading");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  async function checkNotificationStatus() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus("denied");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setStatus(subscription ? "subscribed" : "unsubscribed");
    } catch {
      setStatus("unsubscribed");
    }
  }

  async function subscribe() {
    setIsProcessing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      // Register service worker
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Get VAPID key
      const res = await fetch("/api/push/vapid-key");
      const { publicKey } = await res.json();

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to backend
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setStatus("subscribed");

      // Send test notification
      await fetch("/api/push/test", { method: "POST" });
    } catch (err) {
      console.error("Failed to subscribe:", err);
    } finally {
      setIsProcessing(false);
    }
  }

  async function unsubscribe() {
    setIsProcessing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      
      setStatus("unsubscribed");
    } catch (err) {
      console.error("Failed to unsubscribe:", err);
    } finally {
      setIsProcessing(false);
    }
  }

  if (status === "loading") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-zinc-500 h-7 w-7 md:h-10 md:w-10">
        <Loader2 className="w-4 h-4 md:w-6 md:h-6 animate-spin" />
      </Button>
    );
  }

  if (status === "unsupported") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-zinc-500 h-7 w-7 md:h-10 md:w-10" title="Tu navegador no soporta notificaciones">
        <BellOff className="w-4 h-4 md:w-6 md:h-6" />
      </Button>
    );
  }

  if (status === "denied") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-red-500 h-7 w-7 md:h-10 md:w-10" title="Notificaciones bloqueadas. Actívalas en configuración del navegador.">
        <BellOff className="w-4 h-4 md:w-6 md:h-6" />
      </Button>
    );
  }

  if (status === "subscribed") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={unsubscribe}
        disabled={isProcessing}
        className="text-green-500 hover:text-green-400 h-7 w-7 md:h-10 md:w-10 relative"
        title="Notificaciones activadas. Clic para desactivar."
        data-testid="button-notifications-active"
      >
        {isProcessing ? <Loader2 className="w-4 h-4 md:w-6 md:h-6 animate-spin" /> : <Bell className="w-4 h-4 md:w-6 md:h-6" />}
        <Check className="w-2 h-2 md:w-3 md:h-3 absolute bottom-0.5 right-0.5" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={subscribe}
      disabled={isProcessing}
      className="text-zinc-400 hover:text-white h-7 w-7 md:h-10 md:w-10"
      title="Activar notificaciones"
      data-testid="button-enable-notifications"
    >
      {isProcessing ? <Loader2 className="w-4 h-4 md:w-6 md:h-6 animate-spin" /> : <Bell className="w-4 h-4 md:w-6 md:h-6" />}
    </Button>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
