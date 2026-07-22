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

export function OneVideoHeldAdmissionDialog({
  open,
  onOpenChange,
  isPending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  const checkboxId = useId();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setAcknowledged(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a held one-video admission?</DialogTitle>
          <DialogDescription className="leading-6 text-zinc-300">
            This creates internal held work and reserves internal budget until the receipt expiry. It does not activate work, contact a provider, generate video, or authorize external spend.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/[0.06] p-4 text-sm leading-6 text-cyan-50">
          <p className="font-semibold">Held-only effects</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Internal budget reservation: created only if the server revalidates every gate.</li>
            <li>Provider contact and external spend: $0.</li>
            <li>Video generation, activation, and publishing: disabled.</li>
          </ul>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-amber-300/25 bg-amber-400/[0.07] p-4">
          <Checkbox
            id={checkboxId}
            checked={acknowledged}
            onCheckedChange={(value) => setAcknowledged(value === true)}
            disabled={isPending}
            aria-describedby={`${checkboxId}-help`}
            className="mt-1 border-amber-200"
          />
          <div>
            <label htmlFor={checkboxId} className="cursor-pointer text-sm font-medium text-amber-100">
              I understand this reserves internal budget for held work only.
            </label>
            <p id={`${checkboxId}-help`} className="mt-1 text-xs leading-5 text-amber-100/80">
              No provider is contacted, no video is generated, and this does not authorize activation or external spend.
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
            disabled={!acknowledged || isPending}
            aria-busy={isPending}
            onClick={onConfirm}
          >
            {isPending ? "Creating held admission…" : "Create held admission — no provider call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
