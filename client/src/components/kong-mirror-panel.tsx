import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ExternalLink, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Verdict = "pass" | "warn" | "fail" | "skip";
type Scalar = string | number | boolean | null;
export type MirrorCardView = {
  key: string; repo: string; prNumber: number; prUrl: string; artifactUrl: string | null; title: string; headSha: string; baseSha: string;
  overall: "pass" | "warn" | "fail"; approvable: boolean; warn: boolean; dataSource: "production-copy" | "sample"; generatedAt: string; statusLabel: string;
  whatChanges: string[];
  whyDoIt: { narrative: string; source: "ai" | "deterministic"; reason: string | null; arguments: string[] };
  agents: Array<{ id: string; name: string; verdict: Verdict; verdictLabel: string; summary: string; details: string[]; devilsAdvocate: boolean }>;
  metrics: Array<{ name: string; before: Scalar; after: Scalar; unit?: string; better?: "higher" | "lower" }>;
  otherMetrics: Array<{ name: string; value: Scalar }>;
  risks: { devilsAdvocate: { name: string; verdict: Verdict; summary: string; details: string[] } | null; items: string[] };
  improveLater: string[]; failReasons: string[];
  images: Array<{ id: string; key: string; url: string; page: string; viewport: string; kind: "before" | "after" | "diff"; caption: string }>;
  videos: Array<{ url: string; caption: string }>;
};
type MirrorReportRow = {
  key: string; status: "received" | "carded" | "merging" | "merged" | "rejected"; pendingStatus: string | null; approvable: boolean; overall: string;
  headSha: string; mergeSha?: string | null; lastRefusal?: { at: string; code: string; message: string }; rejectNote?: string; card: MirrorCardView | null;
};
type ReportsResponse = { reports: MirrorReportRow[]; pendingCount: number };
type DecisionResult = { ok: boolean; message?: string; steps?: string[]; code?: string; commentPosted?: boolean };

const VERDICT_STYLE: Record<Verdict, string> = {
  pass: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  warn: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  fail: "border-rose-400/50 bg-rose-400/10 text-rose-200",
  skip: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};
const KIND_LABEL = { before: "Antes", after: "Después", diff: "Diferencia" } as const;

export function useKongMirrorReports(enabled = true) {
  return useQuery<ReportsResponse>({
    queryKey: ["kong-mirror-reports"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch("/api/kong-mirror/reports", { credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudieron leer las mejoras del Mirror Lab");
      return response.json();
    },
  });
}

async function decide(key: string, decision: "approve" | "reject", body: Record<string, unknown>): Promise<DecisionResult> {
  const response = await fetch(`/api/kong-mirror/${encodeURIComponent(key)}/${decision}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as DecisionResult;
  if (!response.ok) throw new Error(data.message || "No se pudo completar la decisión. No se fusionó nada.");
  return data;
}

function show(value: Scalar) { return value === null || value === undefined ? "-" : String(value); }

/** Full-size viewer with carousel and zoom. */
function ImageViewer({ images, index, onIndex, onClose }: { images: MirrorCardView["images"]; index: number; onIndex: (next: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const image = images[index];
  useEffect(() => { setZoom(1); }, [index]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") onIndex((index + 1) % images.length);
      if (event.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onIndex]);
  if (!image) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[96vh] max-w-[96vw] overflow-hidden p-3 sm:max-w-[96vw]" data-testid="kong-mirror-image-viewer">
        <DialogHeader>
          <DialogTitle className="text-sm">{KIND_LABEL[image.kind]} · {image.page} · {image.viewport}</DialogTitle>
          <DialogDescription>{image.caption || "Captura del Mirror Lab"} · {index + 1} de {images.length}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onIndex((index - 1 + images.length) % images.length)} aria-label="Foto anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => onIndex((index + 1) % images.length)} aria-label="Foto siguiente"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} aria-label="Alejar"><ZoomOut className="h-4 w-4" /></Button>
          <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.min(4, value + 0.5))} aria-label="Acercar"><ZoomIn className="h-4 w-4" /></Button>
          <a href={image.url} target="_blank" rel="noreferrer" className="ml-auto text-xs underline">Abrir original</a>
        </div>
        <div className="max-h-[72vh] overflow-auto rounded border border-white/10 bg-black">
          <img src={image.url} alt={`${KIND_LABEL[image.kind]} ${image.page}`} onClick={() => setZoom((value) => (value >= 3 ? 1 : value + 1))}
            style={{ width: `${zoom * 100}%`, maxWidth: "none", cursor: zoom >= 3 ? "zoom-out" : "zoom-in" }} className="block h-auto" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return <section className="space-y-2" data-testid={testId}><h3 className="text-sm font-semibold">{title}</h3>{children}</section>;
}

export function KongMirrorCard({ row }: { row: MirrorReportRow }) {
  const queryClient = useQueryClient();
  const card = row.card;
  const [viewer, setViewer] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const mutation = useMutation({
    mutationFn: ({ decision, body }: { decision: "approve" | "reject"; body: Record<string, unknown> }) => decide(row.key, decision, body),
    onSuccess: (data) => { setResult(data); setConfirming(false); },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["kong-mirror-reports"] });
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
    },
  });
  if (!card) return <p className="text-sm text-muted-foreground">Reporte recibido; preparando la tarjeta…</p>;
  const open = row.status === "carded" && ["pending", "edited", "snoozed"].includes(row.pendingStatus || "");
  const groups = (["before", "after", "diff"] as const).map((kind) => ({ kind, items: card.images.map((image, index) => ({ image, index })).filter(({ image }) => image.kind === kind) }));
  return (
    <article className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm" data-testid="kong-mirror-card">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{card.title}</h2>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${VERDICT_STYLE[card.overall]}`} data-testid="kong-mirror-status">{card.statusLabel}</span>
          {card.dataSource === "sample" && <span className="rounded-full border border-zinc-500/40 px-2 py-0.5 text-xs">datos de ejemplo</span>}
        </div>
        <p className="text-xs text-muted-foreground">{card.repo} · PR #{card.prNumber} · probado en {card.headSha.slice(0, 7)} · {new Date(card.generatedAt).toLocaleString("es")}</p>
        {card.warn && <p role="alert" className="flex items-center gap-2 rounded border border-amber-400/50 p-2 text-amber-200"><AlertTriangle className="h-4 w-4" />Pasó con AVISOS. Lee los riesgos antes de aprobar.</p>}
      </header>

      {card.failReasons.length > 0 && (
        <Section title="Por qué falló (no se puede aprobar)" testId="kong-mirror-fail">
          <ul className="list-disc space-y-1 pl-5 text-rose-200">{card.failReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </Section>
      )}

      <Section title="Qué cambia"><ul className="list-disc space-y-1 pl-5">{card.whatChanges.map((line) => <li key={line}>{line}</li>)}</ul></Section>

      <Section title="Por qué deberíamos hacerlo" testId="kong-mirror-why">
        <p>{card.whyDoIt.narrative}</p>
        <p className="text-[11px] text-muted-foreground">{card.whyDoIt.source === "ai" ? "Resumen IA barato (solo texto del reporte)" : `Resumen del equipo sin IA${card.whyDoIt.reason ? ` · ${card.whyDoIt.reason}` : ""}`}</p>
        {card.whyDoIt.arguments.length > 0 && <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{card.whyDoIt.arguments.map((line) => <li key={line}>{line}</li>)}</ul>}
      </Section>

      <Section title="El equipo de pruebas" testId="kong-mirror-agents">
        <ul className="grid gap-2 md:grid-cols-2">
          {card.agents.map((agent) => (
            <li key={agent.id} className="rounded-lg border border-white/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1 font-medium"><Users className="h-3.5 w-3.5" />{agent.name}{agent.devilsAdvocate && !/diablo/i.test(agent.name) ? " · abogado del diablo" : ""}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${VERDICT_STYLE[agent.verdict]}`}>{agent.verdictLabel}</span>
              </div>
              <p className="mt-1">{agent.summary}</p>
              {agent.details.length > 0 && <details className="mt-1 text-xs text-muted-foreground"><summary>Detalles ({agent.details.length})</summary><ul className="list-disc pl-4">{agent.details.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></details>}
            </li>
          ))}
        </ul>
      </Section>

      {card.images.length > 0 && (
        <Section title="Cómo se vería (fotos)" testId="kong-mirror-images">
          {groups.filter((group) => group.items.length).map((group) => (
            <div key={group.kind}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{KIND_LABEL[group.kind]}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {group.items.map(({ image, index }) => (
                  <button key={image.key} type="button" onClick={() => setViewer(index)} className="shrink-0 rounded border border-white/10 text-left focus-visible:outline focus-visible:outline-2" aria-label={`Ver ${KIND_LABEL[image.kind]} ${image.page} en grande`}>
                    <img src={image.url} alt="" loading="lazy" className="h-28 w-auto max-w-[220px] rounded-t object-cover object-top" />
                    <span className="block max-w-[220px] truncate px-1 py-0.5 text-[11px]">{image.page} · {image.viewport}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {viewer !== null && <ImageViewer images={card.images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
        </Section>
      )}

      {(card.metrics.length > 0 || card.otherMetrics.length > 0) && (
        <Section title="Métricas antes vs después" testId="kong-mirror-metrics">
          {card.metrics.length > 0 && (
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Métrica</th><th>Antes</th><th>Después</th></tr></thead>
              <tbody>{card.metrics.map((metric) => <tr key={metric.name} className="border-t border-white/5"><td className="py-1">{metric.name}</td><td>{show(metric.before)}{metric.unit ? ` ${metric.unit}` : ""}</td><td className="font-medium">{show(metric.after)}{metric.unit ? ` ${metric.unit}` : ""}</td></tr>)}</tbody>
            </table>
          )}
          {card.otherMetrics.length > 0 && <p className="text-xs text-muted-foreground">{card.otherMetrics.map((metric) => `${metric.name}: ${show(metric.value)}`).join(" · ")}</p>}
        </Section>
      )}

      <Section title="Riesgos (abogado del diablo)" testId="kong-mirror-risks">
        {card.risks.devilsAdvocate ? (
          <div className="rounded border border-amber-400/30 p-2"><p className="font-medium">{card.risks.devilsAdvocate.name}</p><p>{card.risks.devilsAdvocate.summary}</p>
            {card.risks.devilsAdvocate.details.length > 0 && <ul className="list-disc pl-5 text-xs">{card.risks.devilsAdvocate.details.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>}</div>
        ) : <p className="text-muted-foreground">El reporte no trae abogado del diablo.</p>}
        {card.risks.items.length > 0 && <ul className="list-disc pl-5 text-xs">{card.risks.items.map((line) => <li key={line}>{line}</li>)}</ul>}
      </Section>

      <Section title="Qué se podría mejorar después"><ul className="list-disc space-y-1 pl-5">{card.improveLater.map((line) => <li key={line}>{line}</li>)}</ul></Section>

      <div className="flex flex-wrap gap-3 text-xs">
        <a href={card.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Ver PR #{card.prNumber}<ExternalLink className="h-3 w-3" /></a>
        {card.artifactUrl && <a href={card.artifactUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Artefacto del laboratorio<ExternalLink className="h-3 w-3" /></a>}
        {card.videos.map((video, index) => <a key={video.url} href={video.url} target="_blank" rel="noreferrer" className="underline">Video {index + 1}{video.caption ? `: ${video.caption}` : ""}</a>)}
      </div>

      {row.lastRefusal && open && <p role="alert" className="rounded border border-rose-400/40 p-2 text-rose-200">Último intento rechazado: {row.lastRefusal.message}</p>}
      {row.status === "merged" && <p className="rounded border border-emerald-400/40 p-2 text-emerald-200">Merge hecho{row.mergeSha ? ` (${row.mergeSha.slice(0, 7)})` : ""}: falta republicar KONG en Replit.</p>}
      {row.status === "rejected" && <p className="text-muted-foreground">Rechazada{row.rejectNote ? `: ${row.rejectNote}` : "."}</p>}

      {result?.ok && result.steps && (
        <div className="space-y-1 rounded border border-emerald-400/40 p-3" data-testid="kong-mirror-merged"><p className="font-semibold text-emerald-200">{result.message}</p>
          <ol className="space-y-1 text-xs">{result.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      )}
      {result?.ok && result.commentPosted !== undefined && <p className="text-xs text-muted-foreground">Rechazada.{result.commentPosted ? " Tu nota se publicó en el PR." : ""}</p>}
      {mutation.isError && <p role="alert" className="flex items-center gap-2 text-amber-300"><AlertTriangle className="h-4 w-4" />{(mutation.error as Error).message}</p>}

      {open && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {card.approvable && (confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Se volverá a comprobar el SHA y los checks; si todo está igual, se fusiona el PR #{card.prNumber}.</span>
              <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ decision: "approve", body: { confirm: true, headSha: card.headSha } })} data-testid="kong-mirror-confirm"><Check className="mr-1 h-3.5 w-3.5" />Confirmar merge</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)} data-testid="kong-mirror-approve"><Check className="mr-1 h-3.5 w-3.5" />Aprobar y fusionar</Button>
          ))}
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Nota opcional (se publica en el PR si rechazas)" className="min-h-[60px] text-xs" />
          <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ decision: "reject", body: { note } })} data-testid="kong-mirror-reject"><X className="mr-1 h-3.5 w-3.5" />{card.approvable ? "Rechazar" : "Archivar"}</Button>
        </div>
      )}
    </article>
  );
}

/** Agents office notification: one button with the count of improvements waiting for Robert. */
export function KongMirrorPanel({ reportKey, triggerLabel }: { reportKey?: string; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const query = useKongMirrorReports(true);
  const rows = (query.data?.reports || []).filter((row) => !reportKey || row.key === reportKey);
  const pending = query.data?.pendingCount || 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={reportKey ? "sm" : "default"} data-testid="button-kong-mirror">
          {triggerLabel || <>Mejoras KONG{pending > 0 && <span className="ml-1 rounded-full bg-lime-300 px-1.5 text-[11px] font-bold text-slate-950" data-testid="kong-mirror-badge">{pending}</span>}</>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="kong-mirror-dialog">
        <DialogHeader>
          <DialogTitle>Mejoras KONG del Mirror Lab</DialogTitle>
          <DialogDescription>Un equipo de agentes probó cada cambio en una copia de KONG. Si apruebas, se fusiona el PR (sin desplegar); republicar en Replit lo haces tú.</DialogDescription>
        </DialogHeader>
        {query.isError && <p role="alert" className="text-sm text-rose-400">No se pudieron leer las mejoras.</p>}
        {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!query.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay reportes del laboratorio.</p>}
        <div className="space-y-4">{rows.map((row) => <KongMirrorCard key={row.key} row={row} />)}</div>
      </DialogContent>
    </Dialog>
  );
}
