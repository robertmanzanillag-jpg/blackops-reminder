import { useState, type FormEvent } from "react";
import { Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Influencer } from "../core/types";
import { useInfluencerGovernance, useInfluencerGovernanceMutations } from "./hooks";
import { allowedUses, commaSeparated, consentBases, idempotencyKey, isSha256Digest, rightsBases, type AllowedUse, type ConsentBasis, type CreateInfluencerGovernanceProfile, type RightsBasis } from "./types";

const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30";
const labels: Record<AllowedUse, string> = { internal_preview: "Internal previews", organic_social: "Organic social", paid_ads: "Paid ads", commercial: "Commercial use" };

function profileDisplay(profile: NonNullable<ReturnType<typeof useInfluencerGovernance>["data"]>, now = Date.now()) {
  if (profile.revokedAt) return { label: "Revoked governance profile", active: false };
  if (Date.parse(profile.validFrom) > now) return { label: "Scheduled governance profile", active: false };
  if (Date.parse(profile.expiresAt) <= now) return { label: "Expired governance profile", active: false };
  return { label: "Current governance profile", active: true };
}

function ProfileDialog({ influencer }: { influencer: Influencer }) {
  const [open, setOpen] = useState(false);
  const query = useInfluencerGovernance(influencer.id, open);
  const mutations = useInfluencerGovernanceMutations(influencer.id);
  const [consentBasis, setConsentBasis] = useState<ConsentBasis>("synthetic_not_applicable");
  const [rightsBasis, setRightsBasis] = useState<RightsBasis>("owned");
  const [uses, setUses] = useState<AllowedUse[]>(["internal_preview"]);
  const [territories, setTerritories] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [policyVersion, setPolicyVersion] = useState("v1");
  const [proofDigest, setProofDigest] = useState("");
  const [requiredTerms, setRequiredTerms] = useState("");
  const [prohibitedTerms, setProhibitedTerms] = useState("");
  const [error, setError] = useState("");
  const [showProfileForm, setShowProfileForm] = useState(false);
  const profile = query.data;
  const display = profile ? profileDisplay(profile) : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!influencer.avatarResourceId || !influencer.voiceResourceId) { setError("Assign a ready avatar and voice before creating governance evidence."); return; }
    if (uses.length === 0) { setError("Select at least one allowed use."); return; }
    if (commaSeparated(territories).length === 0) { setError("Enter at least one territory."); return; }
    if (!validFrom) { setError("Choose when this authorization starts."); return; }
    if (!expiresAt || Date.parse(expiresAt) <= Date.parse(validFrom)) { setError("Choose an expiry after the authorization start."); return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(policyVersion.trim())) { setError("Enter a valid policy version using letters, numbers, dots, underscores, colons, or hyphens."); return; }
    if (!isSha256Digest(proofDigest)) { setError("Enter an opaque digest as sha256: followed by 64 hexadecimal characters. Do not paste a URL, secret, or document."); return; }
    const input: CreateInfluencerGovernanceProfile = {
      consentBasis,
      rightsBasis,
      allowedUses: uses,
      territories: commaSeparated(territories).map((territory) => territory.toUpperCase()),
      validFrom: new Date(validFrom).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      policyVersion: policyVersion.trim(),
      proofDigest: proofDigest.trim().toLowerCase(),
      brandPolicy: { requiredTerms: commaSeparated(requiredTerms), prohibitedTerms: commaSeparated(prohibitedTerms) },
      idempotencyKey: idempotencyKey("governance-profile"),
    };
    setError("");
    mutations.create.mutate({ influencerId: influencer.id, input }, { onSuccess: () => setOpen(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutations.create.isPending) { setOpen(next); setError(""); if (next) { setShowProfileForm(false); mutations.create.reset(); } } }}>
      <DialogTrigger asChild><Button type="button" variant="outline" className="flex-1 border-emerald-300/25 bg-emerald-400/5 text-emerald-100"><ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Governance</Button></DialogTrigger>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto border-white/10 bg-zinc-950 text-white">
        <DialogHeader><DialogTitle>Governance profile for {influencer.name}</DialogTitle><DialogDescription className="text-zinc-400">Record bounded consent and rights metadata. Never enter evidence URLs, credentials, provider IDs, personal data, or secrets.</DialogDescription></DialogHeader>
        {query.isLoading ? <p role="status" className="py-8 text-sm text-zinc-400">Loading current governance profile…</p> : query.isError ? <div role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100"><p>{query.error.message}</p><Button type="button" size="sm" variant="outline" className="mt-3 border-red-300/20" onClick={() => void query.refetch()}>Retry</Button></div> : profile && !profile.revokedAt && !showProfileForm ? <div role="status" className={`space-y-4 rounded-xl border p-4 text-sm ${display?.active ? "border-emerald-300/20 bg-emerald-400/5" : "border-amber-300/20 bg-amber-400/5"}`}><p className={`font-medium ${display?.active ? "text-emerald-100" : "text-amber-100"}`}>{display?.label}</p>{!display?.active && <p className="text-amber-100">Rendering and publishing remain blocked until the authorization is within its validity window.</p>}<dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-zinc-400">Consent basis</dt><dd>{profile.consentBasis.replaceAll("_", " ")}</dd></div><div><dt className="text-zinc-400">Rights basis</dt><dd>{profile.rightsBasis}</dd></div><div><dt className="text-zinc-400">Allowed uses</dt><dd>{profile.allowedUses.map((item) => labels[item]).join(", ")}</dd></div><div><dt className="text-zinc-400">Territories</dt><dd>{profile.territories.join(", ")}</dd></div><div><dt className="text-zinc-400">Valid from</dt><dd>{new Date(profile.validFrom).toLocaleDateString()}</dd></div><div><dt className="text-zinc-400">Expires</dt><dd>{new Date(profile.expiresAt).toLocaleDateString()}</dd></div><div><dt className="text-zinc-400">Policy version</dt><dd>{profile.policyVersion}</dd></div></dl><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" className="border-amber-300/20 bg-amber-400/5 text-amber-100" onClick={() => setShowProfileForm(true)}>{display?.active ? "Create new version" : "Create replacement"}</Button><RevokeProfile influencerId={influencer.id} /></div></div> : <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`consent-${influencer.id}`}>Consent basis</Label><select id={`consent-${influencer.id}`} className={inputClass} value={consentBasis} onChange={(e) => setConsentBasis(e.target.value as ConsentBasis)}>{consentBases.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></div><div><Label htmlFor={`rights-${influencer.id}`}>Rights basis</Label><select id={`rights-${influencer.id}`} className={inputClass} value={rightsBasis} onChange={(e) => setRightsBasis(e.target.value as RightsBasis)}>{rightsBases.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
          <fieldset className="rounded-lg border border-white/10 p-4"><legend className="px-1 text-sm font-medium">Allowed uses</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{allowedUses.map((item) => <label key={item} className="flex min-h-11 items-center gap-3 rounded-lg border border-white/10 px-3 text-sm"><input type="checkbox" checked={uses.includes(item)} onChange={(e) => setUses((current) => e.target.checked ? [...current, item] : current.filter((value) => value !== item))} className="accent-emerald-400" /> {labels[item]}</label>)}</div></fieldset>
          <div><Label htmlFor={`territories-${influencer.id}`}>Territories</Label><input id={`territories-${influencer.id}`} className={inputClass} value={territories} onChange={(e) => setTerritories(e.target.value)} placeholder="US, CA, MX" /><p className="mt-1 text-xs text-zinc-400">Comma-separated territory codes.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`valid-${influencer.id}`}>Valid from</Label><input id={`valid-${influencer.id}`} type="datetime-local" className={inputClass} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div><div><Label htmlFor={`expiry-${influencer.id}`}>Expiry</Label><input id={`expiry-${influencer.id}`} type="datetime-local" className={inputClass} value={expiresAt} min={validFrom} onChange={(e) => setExpiresAt(e.target.value)} /></div></div>
          <div><Label htmlFor={`policy-${influencer.id}`}>Policy version</Label><input id={`policy-${influencer.id}`} className={inputClass} value={policyVersion} onChange={(e) => setPolicyVersion(e.target.value)} maxLength={64} /></div>
          <div><Label htmlFor={`digest-${influencer.id}`}>Opaque proof digest</Label><input id={`digest-${influencer.id}`} className={`${inputClass} font-mono`} value={proofDigest} onChange={(e) => setProofDigest(e.target.value)} autoComplete="off" spellCheck={false} placeholder="sha256:64 hexadecimal characters" /><p className="mt-1 text-xs text-zinc-400">A one-way SHA-256 reference only. The evidence itself stays outside this app.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`required-${influencer.id}`}>Required brand terms</Label><Textarea id={`required-${influencer.id}`} className="mt-2 border-white/15 bg-zinc-950" value={requiredTerms} onChange={(e) => setRequiredTerms(e.target.value)} placeholder="Comma-separated terms" /></div><div><Label htmlFor={`prohibited-${influencer.id}`}>Prohibited brand terms</Label><Textarea id={`prohibited-${influencer.id}`} className="mt-2 border-white/15 bg-zinc-950" value={prohibitedTerms} onChange={(e) => setProhibitedTerms(e.target.value)} placeholder="Comma-separated terms" /></div></div>
          {(error || mutations.create.isError) && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{error || mutations.create.error?.message}</p>}
          <div className="flex justify-end gap-3">{profile && !profile.revokedAt && <Button type="button" variant="outline" disabled={mutations.create.isPending} onClick={() => { setShowProfileForm(false); setError(""); }}>Cancel replacement</Button>}<Button type="submit" disabled={mutations.create.isPending} className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300">{mutations.create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{mutations.create.isPending ? "Saving…" : "Create governance profile"}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
  );
}

function RevokeProfile({ influencerId }: { influencerId: string }) {
  const mutations = useInfluencerGovernanceMutations(influencerId);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  return <AlertDialog open={open} onOpenChange={(next) => { if (!mutations.revoke.isPending) { setOpen(next); if (next) { setReason(""); mutations.revoke.reset(); } } }}><AlertDialogTrigger asChild><Button type="button" variant="outline" className="border-red-300/20 bg-red-400/5 text-red-100"><ShieldX className="mr-2 h-4 w-4" aria-hidden="true" /> Revoke profile</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-zinc-950 text-white"><AlertDialogHeader><AlertDialogTitle>Revoke governance profile?</AlertDialogTitle><AlertDialogDescription className="text-zinc-400">Generation and publishing will be blocked. Existing audit records remain intact.</AlertDialogDescription></AlertDialogHeader><div><Label htmlFor={`revoke-${influencerId}`}>Reason</Label><Textarea id={`revoke-${influencerId}`} className="mt-2 border-white/15 bg-zinc-950" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>{mutations.revoke.isError && <p role="alert" className="text-sm text-red-200">{mutations.revoke.error.message}</p>}<AlertDialogFooter><AlertDialogCancel disabled={mutations.revoke.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={mutations.revoke.isPending || !reason.trim()} className="bg-red-500 text-white" onClick={(e) => { e.preventDefault(); mutations.revoke.mutate({ influencerId, reason: reason.trim(), idempotencyKey: idempotencyKey("governance-revoke") }, { onSuccess: () => setOpen(false) }); }}>{mutations.revoke.isPending ? "Revoking…" : "Revoke"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

export function InfluencerGovernanceControl({ influencer }: { influencer: Influencer }) {
  return <div className="mt-4 border-t border-white/10 pt-4"><p className="mb-3 text-xs text-zinc-400">Governance status is checked when opened.</p><ProfileDialog influencer={influencer} /></div>;
}
