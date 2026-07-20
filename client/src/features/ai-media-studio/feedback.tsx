import { Inbox, Loader2, RefreshCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadingPanel({ label = "Loading studio data" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.025]" role="status" aria-live="polite">
      <div className="text-center text-sm text-zinc-400">
        <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-6 text-center" role="alert">
      <TriangleAlert className="mb-3 h-6 w-6 text-red-300" aria-hidden="true" />
      <p className="font-medium text-white">Studio data is unavailable</p>
      <p className="mt-1 max-w-md text-sm text-zinc-400">{message}</p>
      <Button type="button" variant="outline" className="mt-4 border-white/10 bg-white/5" onClick={onRetry}>
        <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry
      </Button>
    </div>
  );
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-white/15 p-6 text-center">
      <Inbox className="mb-3 h-6 w-6 text-zinc-500" aria-hidden="true" />
      <p className="font-medium text-zinc-200">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-zinc-400">{description}</p>
    </div>
  );
}
