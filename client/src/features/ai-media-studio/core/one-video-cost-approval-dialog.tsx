import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ExactQuoteForApproval {
  quoteKey: string;
  amountLabel: string;
  currency: "USD";
  expiresAt: string;
  renderSpecKey: string;
}

export function OneVideoCostApprovalDialog({
  open,
  onOpenChange,
  quote,
  isPending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: ExactQuoteForApproval;
  isPending: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  const checkboxId = useId();
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setConfirmed(false);
  }, [open, quote.quoteKey, quote.renderSpecKey]);

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Approve this exact one-video quote?</DialogTitle>
          <DialogDescription className="leading-6 text-zinc-300">
            This records only your cost decision. It does not generate a video, call HeyGen, reserve credits, or authorize spend.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-3 rounded-lg border border-white/10 bg-black/20 p-4 text-sm">
          <div><dt className="text-zinc-400">Maximum amount</dt><dd className="mt-1 font-semibold text-white">{quote.amountLabel} {quote.currency}</dd></div>
          <div><dt className="text-zinc-400">Absolute expiry</dt><dd className="mt-1 break-all font-medium text-white"><time dateTime={quote.expiresAt}>{quote.expiresAt}</time></dd></div>
          <div><dt className="text-zinc-400">Quote key</dt><dd className="mt-1 break-all font-mono text-xs text-fuchsia-100">{quote.quoteKey}</dd></div>
          <div><dt className="text-zinc-400">Render specification key</dt><dd className="mt-1 break-all font-mono text-xs text-fuchsia-100">{quote.renderSpecKey}</dd></div>
        </dl>

        <div className="flex items-start gap-3 rounded-lg border border-amber-300/25 bg-amber-400/[0.07] p-4">
          <Checkbox
            id={checkboxId}
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(value === true)}
            disabled={isPending}
            aria-describedby={`${checkboxId}-help`}
            className="mt-1 border-amber-200"
          />
          <div>
            <label htmlFor={checkboxId} className="cursor-pointer text-sm font-medium text-amber-100">
              I approve this exact quote and render specification only.
            </label>
            <p id={`${checkboxId}-help`} className="mt-1 text-xs leading-5 text-amber-100/80">
              A changed quote or render specification requires a new confirmation.
            </p>
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-red-200">{error}</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!confirmed || isPending}
            aria-busy={isPending}
            onClick={onConfirm}
          >
            {isPending ? "Recording exact approval…" : "Approve exact quote — no generation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
