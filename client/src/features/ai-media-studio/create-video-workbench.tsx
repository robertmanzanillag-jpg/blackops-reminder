import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Clapperboard, Loader2, Play, Sparkles, WandSparkles } from "lucide-react";
import type { MediaSourceType, ScriptVariant } from "@shared/ai-media-studio-scripts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "./feedback";
import { useStudioMutations, useStudioOptions } from "./hooks";
import { generateScriptVariants } from "./script-api";

const sourceTypes: Array<{ value: MediaSourceType; label: string }> = [
  { value: "events", label: "Event" },
  { value: "restaurants", label: "Restaurant" },
  { value: "hotels", label: "Hotel" },
  { value: "nightclubs", label: "Nightclub" },
  { value: "deals", label: "Deal" },
  { value: "travel_packages", label: "Travel package" },
  { value: "beach_clubs", label: "Beach club" },
  { value: "experiences", label: "Experience" },
];

const fieldClass = "mt-2 h-11 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30 disabled:opacity-50";

function idempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `studio-${crypto.randomUUID()}`
    : `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sourceId(title: string) {
  return `manual-${title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "source"}`;
}

function focusField(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export function CreateVideoWorkbench() {
  const optionsQuery = useStudioOptions();
  const { create } = useStudioMutations();
  const scripts = useMutation({ mutationFn: generateScriptVariants });
  const [sourceType, setSourceType] = useState<MediaSourceType>("events");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceSummary, setSourceSummary] = useState("");
  const [sourceDetails, setSourceDetails] = useState("");
  const [sourceLocation, setSourceLocation] = useState("");
  const [influencerId, setInfluencerId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [language, setLanguage] = useState("");
  const [script, setScript] = useState("");
  const [variants, setVariants] = useState<ScriptVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [errorSummary, setErrorSummary] = useState("");

  const options = optionsQuery.data;
  useEffect(() => {
    if (influencerId || !options) return;
    const first = options.influencers.find((item) => item.status === "active" || item.status === "ready") ?? options.influencers[0];
    if (!first) return;
    setInfluencerId(first.id);
    setLanguage(first.language);
    setVoiceId(first.voiceId);
  }, [influencerId, options]);

  if (optionsQuery.isLoading) return <LoadingPanel label="Loading creators and voices" />;
  if (optionsQuery.isError) return <ErrorPanel message={optionsQuery.error.message} onRetry={() => optionsQuery.refetch()} />;
  if (!options || options.influencers.length === 0) return <EmptyPanel title="Create an AI influencer first" description="A ready influencer is required before script and video generation." />;

  const availableVoices = options.voices.filter((voice) => !language || voice.language === language);
  const selectedInfluencer = options.influencers.find((item) => item.id === influencerId);

  const chooseInfluencer = (nextId: string) => {
    const influencer = options.influencers.find((item) => item.id === nextId);
    setInfluencerId(nextId);
    if (influencer) {
      setLanguage(influencer.language);
      setVoiceId(influencer.voiceId);
    }
    setErrorSummary("");
  };

  const generateScripts = () => {
    if (!sourceTitle.trim()) {
      setErrorSummary("Add a source title before generating scripts.");
      focusField("studio-source-title");
      return;
    }
    if (!sourceSummary.trim()) {
      setErrorSummary("Add a factual source summary before generating scripts.");
      focusField("studio-source-summary");
      return;
    }
    if (!language) {
      setErrorSummary("Choose an output language before generating scripts.");
      focusField("studio-language");
      return;
    }
    setErrorSummary("");
    scripts.mutate({
      source: {
        type: sourceType,
        id: sourceId(sourceTitle),
        title: sourceTitle.trim(),
        summary: sourceSummary.trim(),
        language,
        location: sourceLocation.trim() || undefined,
        facts: sourceDetails.split("\n").map((fact) => fact.trim()).filter(Boolean).slice(0, 20),
      },
      influencerId: influencerId || undefined,
      language,
      variantCount: 3,
    }, {
      onSuccess: (result) => {
        setVariants(result.scriptSet.variants);
        setSelectedVariantId("");
        setScript("");
        requestAnimationFrame(() => document.getElementById("studio-variants")?.focus());
      },
    });
  };

  const chooseVariant = (variant: ScriptVariant) => {
    setSelectedVariantId(variant.id);
    setScript(`${variant.hook}\n\n${variant.script}\n\n${variant.cta}`.slice(0, 5_000));
    setErrorSummary("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!influencerId) { setErrorSummary("Choose an influencer."); focusField("studio-influencer"); return; }
    if (!language) { setErrorSummary("Choose a language."); focusField("studio-language"); return; }
    if (!voiceId) { setErrorSummary("Choose a voice."); focusField("studio-voice"); return; }
    if (variants.length > 0 && !selectedVariantId) { setErrorSummary("Select a generated script variant before rendering."); focusField("studio-variants"); return; }
    if (!script.trim()) { setErrorSummary("Select a variant or write a manual script."); focusField("studio-script"); return; }
    setErrorSummary("");
    create.mutate({ influencerId, voiceId, language, script: script.trim(), aspectRatio: "9:16", idempotencyKey: idempotencyKey() });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">1. Source snapshot</CardTitle>
            <p className="text-sm text-zinc-400">Ground the scripts in bounded business facts. Do not include customer or credential data.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div><Label htmlFor="studio-source-type">Source type</Label><select id="studio-source-type" className={fieldClass} value={sourceType} onChange={(event) => setSourceType(event.target.value as MediaSourceType)}>{sourceTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div><Label htmlFor="studio-source-title">Title <span aria-hidden="true">*</span></Label><input id="studio-source-title" className={fieldClass} value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={200} required /></div>
            </div>
            <div><Label htmlFor="studio-source-summary">Description <span aria-hidden="true">*</span></Label><Textarea id="studio-source-summary" className="mt-2 min-h-24 border-white/10 bg-zinc-950 focus-visible:ring-emerald-300" value={sourceSummary} onChange={(event) => setSourceSummary(event.target.value)} maxLength={4_000} required placeholder="Factual description, offer, audience, and what makes it useful…" /></div>
            <div className="grid gap-4 md:grid-cols-2">
              <div><Label htmlFor="studio-source-location">Location</Label><input id="studio-source-location" className={fieldClass} value={sourceLocation} onChange={(event) => setSourceLocation(event.target.value)} maxLength={200} /></div>
              <div><Label htmlFor="studio-source-details">Details, one fact per line</Label><Textarea id="studio-source-details" className="mt-2 min-h-20 border-white/10 bg-zinc-950 focus-visible:ring-emerald-300" value={sourceDetails} onChange={(event) => setSourceDetails(event.target.value)} placeholder="Hours, price, date, key feature…" /></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none">
          <CardHeader><CardTitle className="text-lg">2. Creator and script</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div><Label htmlFor="studio-influencer">AI influencer</Label><select id="studio-influencer" className={fieldClass} value={influencerId} onChange={(event) => chooseInfluencer(event.target.value)}>{options.influencers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div><Label htmlFor="studio-language">Language</Label><select id="studio-language" className={fieldClass} value={language} onChange={(event) => { setLanguage(event.target.value); setVoiceId(""); }}>{options.languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div>
              <div><Label htmlFor="studio-voice">Voice</Label><select id="studio-voice" className={fieldClass} value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>{availableVoices.map((item) => <option key={item.id} value={item.id}>{item.name}{item.accent ? ` · ${item.accent}` : ""}</option>)}</select></div>
            </div>
            <Button type="button" variant="outline" className="border-emerald-300/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20" disabled={scripts.isPending} onClick={generateScripts}>
              {scripts.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <WandSparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
              {scripts.isPending ? "Generating grounded variants…" : "Generate 3 script variants"}
            </Button>
            {scripts.isError && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{scripts.error.message}</p>}
            {scripts.isSuccess && <p role="status" className="text-sm text-emerald-200">{variants.length} grounded variants generated. Select one to continue.</p>}
            {variants.length > 0 && (
              <fieldset id="studio-variants" tabIndex={-1} className="space-y-3 rounded-xl border border-white/10 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                <legend className="px-1 text-sm font-medium text-zinc-200">Select one script before rendering</legend>
                {variants.map((variant) => (
                  <label key={variant.id} className={`block cursor-pointer rounded-lg border p-3 transition-colors ${selectedVariantId === variant.id ? "border-emerald-300/50 bg-emerald-400/10" : "border-white/10 bg-black/20 hover:border-white/20"}`}>
                    <span className="flex items-start gap-3"><input type="radio" name="script-variant" value={variant.id} checked={selectedVariantId === variant.id} onChange={() => chooseVariant(variant)} className="mt-1 accent-emerald-400" /><span><span className="block text-sm font-medium text-white">{variant.title}</span><span className="mt-1 block text-xs uppercase tracking-wide text-emerald-300">{variant.angle}</span><span className="mt-2 block text-sm text-zinc-400">{variant.hook}</span></span></span>
                  </label>
                ))}
              </fieldset>
            )}
            <div><div className="flex justify-between gap-3"><Label htmlFor="studio-script">Selected or manual script</Label><span className="text-xs text-zinc-400">{script.length.toLocaleString()} / 5,000</span></div><Textarea id="studio-script" className="mt-2 min-h-52 border-white/10 bg-zinc-950 focus-visible:ring-emerald-300" value={script} onChange={(event) => { setScript(event.target.value); setErrorSummary(""); }} maxLength={5_000} placeholder="Select a variant above, then refine it here—or write a script manually." /></div>
            {errorSummary && <div id="studio-form-error" tabIndex={-1} role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{errorSummary}</div>}
            <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-zinc-400">Preview request: <span className="font-medium text-zinc-100">9:16 vertical</span></p><Button type="submit" disabled={create.isPending} className="min-h-11 bg-emerald-400 text-zinc-950 hover:bg-emerald-300">{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Clapperboard className="mr-2 h-4 w-4" aria-hidden="true" />}{create.isPending ? "Queuing preview…" : "Queue video preview"}</Button></div>
            <div aria-live="polite" aria-atomic="true">{create.isSuccess && <p role="status" className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">Preview queued. Job {create.data.jobId} is now tracked below.</p>}{create.isError && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{create.error.message}</p>}</div>
          </CardContent>
        </Card>
      </div>

      <aside aria-label="Vertical preview" className="h-fit rounded-2xl border border-white/10 bg-white/[0.035] p-4 xl:sticky xl:top-8">
        <div className="mx-auto aspect-[9/16] max-w-[310px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_50%_20%,rgba(52,211,153,0.18),transparent_34%),linear-gradient(160deg,#151a17,#080a09_70%)]">
          <div className="flex h-full flex-col justify-between p-5"><div className="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-400"><span>Kong preview</span><span>9:16</span></div><div className="flex flex-1 items-center justify-center"><span className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/10 text-emerald-200"><Play className="ml-1 h-6 w-6" aria-hidden="true" /></span></div><div><p className="text-xs font-medium uppercase tracking-[0.15em] text-emerald-300">{selectedInfluencer?.name ?? "Select influencer"}</p><p className="mt-2 line-clamp-4 text-lg font-semibold leading-tight text-white">{script.trim() || sourceTitle.trim() || "Your reviewed story appears here."}</p><div className="mt-4 h-1 w-16 rounded-full bg-emerald-300" aria-hidden="true" /></div></div>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-400">Creative preview only · No publishing action</p>
      </aside>
    </form>
  );
}
