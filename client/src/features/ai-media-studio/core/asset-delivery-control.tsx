import { useId, useRef, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { completeAssetDelivery } from "./asset-delivery";
import { useAssetDelivery } from "./hooks";

export function AssetDeliveryControl({
  assetId,
  available,
  label = "Open asset",
  unavailableLabel,
  compact = false,
}: {
  assetId: string;
  available: boolean;
  label?: string;
  unavailableLabel: string;
  compact?: boolean;
}) {
  const delivery = useAssetDelivery();
  const descriptionId = useId();
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const requestDelivery = async () => {
    if (!available || inFlight.current) return;
    const pendingWindow = window.open("about:blank", "_blank");
    if (!pendingWindow) {
      setError("The browser blocked the secure link window. Allow pop-ups and retry.");
      return;
    }
    pendingWindow.opener = null;
    inFlight.current = true;
    setError("");
    setExpiresAt("");
    try {
      const result = await completeAssetDelivery({
        request: () => delivery.mutateAsync(assetId),
        pendingWindow,
        origin: window.location.origin,
      });
      setExpiresAt(result.expiresAt);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "A secure link could not be created.");
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className={compact ? "min-w-40" : undefined}>
      <Button
        type="button"
        size={compact ? "sm" : "default"}
        variant="outline"
        className={cn(compact ? "w-full" : "mt-4 min-h-11 w-full", "border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10 disabled:border-dashed disabled:text-zinc-500")}
        disabled={!available || delivery.isPending}
        aria-busy={delivery.isPending}
        aria-describedby={descriptionId}
        onClick={requestDelivery}
      >
        {delivery.isPending ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Creating secure link…</> : available ? <>{error ? `Retry ${label.toLowerCase()}` : label}<ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" /><span className="sr-only"> in a new tab</span></> : unavailableLabel}
      </Button>
      <div id={descriptionId} aria-live="polite" className={cn("min-h-5 text-xs", compact ? "mt-1 max-w-52" : "mt-2")}>
        {error ? <p role="alert" className="text-rose-300">{error}</p> : expiresAt ? <p className="text-zinc-400">Secure link opened. It expires at {new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; request another link to reopen it.</p> : available && !compact ? <p className="text-zinc-500">A short-lived link will be created on demand.</p> : null}
      </div>
    </div>
  );
}
