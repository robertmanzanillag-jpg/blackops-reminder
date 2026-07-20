import { RefreshCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PaginationError({ label, message, pending, onRetry }: { label: string; message: string; pending?: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-col gap-3 rounded-lg border border-red-300/20 bg-red-400/[0.07] p-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span><span className="font-medium">{label}</span><span className="block text-xs text-red-100/80">{message}</span></span></p>
      <Button type="button" size="sm" variant="outline" className="shrink-0 border-red-200/20 bg-red-200/5 text-red-50" disabled={pending} onClick={onRetry}>
        <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        {pending ? "Retrying…" : "Retry loading more"}
      </Button>
    </div>
  );
}
