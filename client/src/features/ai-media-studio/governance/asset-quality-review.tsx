import { useEffect, useState, type FormEvent } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAssetQualityReview, useAssetQualityReviewMutation } from "./hooks";
import { idempotencyKey, qualityScoreKeys, type QualityScoreKey, type QualityScores } from "./types";

const criterionLabels: Record<QualityScoreKey, string> = {
  naturalMovement: "Natural movement",
  eyeContact: "Eye contact",
  speechQuality: "Speech quality",
  lighting: "Lighting",
  realism: "Realism",
  brandConsistency: "Brand consistency",
  verticalQuality: "Vertical-video quality",
};
const initialScores: QualityScores = { naturalMovement: 3, eyeContact: 3, speechQuality: 3, lighting: 3, realism: 3, brandConsistency: 3, verticalQuality: 3 };
const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30";

export function AssetQualityReviewControl({ assetId }: { assetId: string }) {
  const [open, setOpen] = useState(false);
  const query = useAssetQualityReview(assetId, open);
  const mutation = useAssetQualityReviewMutation(assetId);
  const [scores, setScores] = useState<QualityScores>(initialScores);
  const [notes, setNotes] = useState("");
  const review = query.data;

  useEffect(() => {
    if (!review) return;
    setScores(review.criteria);
    setNotes(review.notes ?? "");
  }, [review]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ assetId, input: { criteria: scores, ...(notes.trim() ? { notes: notes.trim() } : {}), idempotencyKey: idempotencyKey("quality-review") } }, { onSuccess: () => setOpen(false) });
  };
  const decision = review?.status ?? (open ? "not reviewed" : "open to check");
  const tone = decision === "approved" ? "text-emerald-200" : decision === "rejected" ? "text-red-200" : "text-amber-200";

  return <div className="mt-3"><div role="status" className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="text-zinc-400">Quality decision</span><span className={`capitalize ${tone}`}>{decision.replaceAll("_", " ")}</span></div><Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next); }}><DialogTrigger asChild><Button type="button" variant="outline" className="w-full border-white/15 bg-white/5 text-zinc-100"><ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Review quality</Button></DialogTrigger><DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto border-white/10 bg-zinc-950 text-white"><DialogHeader><DialogTitle>Video quality review</DialogTitle><DialogDescription className="text-zinc-400">Score every criterion from 1 (unacceptable) to 5 (excellent). The server derives the decision; the browser does not choose approval.</DialogDescription></DialogHeader>{query.isLoading ? <p role="status" className="py-6 text-sm text-zinc-400">Loading current quality review…</p> : query.isError ? <div role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100"><p>{query.error.message}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void query.refetch()}>Retry</Button></div> : <form onSubmit={submit} className="space-y-5"><div role="status" className="rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm"><span className="text-zinc-400">Current server decision: </span><strong className={`capitalize ${tone}`}>{decision.replaceAll("_", " ")}</strong></div><fieldset className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Seven video quality scores</legend>{qualityScoreKeys.map((key) => <div key={key}><Label htmlFor={`quality-${assetId}-${key}`}>{criterionLabels[key]}</Label><select id={`quality-${assetId}-${key}`} className={inputClass} value={scores[key]} onChange={(e) => setScores((current) => ({ ...current, [key]: Number(e.target.value) }))}>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}</select></div>)}</fieldset><div><Label htmlFor={`quality-notes-${assetId}`}>Review notes (optional)</Label><Textarea id={`quality-notes-${assetId}`} className="mt-2 min-h-28 border-white/15 bg-zinc-950" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2_000} placeholder="Document observable issues or strengths. Do not include customer data or secrets." /></div>{mutation.isError && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{mutation.error.message}</p>}<div className="flex justify-end"><Button type="submit" disabled={mutation.isPending} className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300">{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{mutation.isPending ? "Submitting…" : "Submit scores"}</Button></div></form>}</DialogContent></Dialog></div>;
}
