import { RefreshCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OperationsPageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-300/20 bg-red-400/[0.06] p-5 text-red-100">
      <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><div><p className="font-medium">Operations data is unavailable</p><p className="mt-1 text-sm text-red-100/80">{message}</p></div></div>
      <Button type="button" size="sm" variant="outline" className="mt-4 border-red-200/20 bg-red-200/5 text-red-50" onClick={onRetry}><RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry</Button>
    </div>
  );
}

export function LoadMoreError({ message, pending, onRetry }: { message: string; pending: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-col gap-3 rounded-lg border border-red-300/20 bg-red-400/[0.06] p-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span><Button type="button" size="sm" variant="outline" className="border-red-200/20 bg-red-200/5 text-red-50" disabled={pending} onClick={onRetry}>{pending ? "Retrying…" : "Retry loading more"}</Button>
    </div>
  );
}
