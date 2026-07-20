import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type OutreachOutcome = "contacted" | "reply" | "call_booked" | "deposit_collected" | "lost";

type OutreachDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  channel: "email" | "gmail" | "mailto" | "instagram" | "contact_form";
  recipientEmail: string;
  contactName: string;
  businessName: string;
  businessSummary: string;
  sourceUrl?: string;
  status: "draft" | "approved" | "blocked";
  subject: string;
  body: string;
  pricing: {
    totalSetupUsd: number;
    depositUsd: number;
    monthlyRetainerUsd: number;
    grossMarginPercent: number;
  };
  delivery: {
    sendStatus: string;
    reason: string;
    sentAt?: string;
    outcome?: OutreachOutcome;
    outcomeAt?: string;
  };
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
  nextAction: string;
};

type RevenueSnapshot = {
  metrics: {
    cashCollectedUsd: number;
  };
  pipelineStages: Array<{ id: string; name: string; count: number; valueUsd: number }>;
  recentOutreach: OutreachDraft[];
  emailProvider: {
    configured: boolean;
    fromEmail: string;
  };
};

type ViewId = "pending" | "approved" | "sent" | "replies" | "sales" | "closed";

const views: Array<{ id: ViewId; label: string; icon: typeof Inbox }> = [
  { id: "pending", label: "Por aprobar", icon: Inbox },
  { id: "approved", label: "Aprobados", icon: CheckCircle2 },
  { id: "sent", label: "Enviados", icon: Send },
  { id: "replies", label: "Respuestas", icon: MessageCircle },
  { id: "sales", label: "Ventas", icon: CircleDollarSign },
  { id: "closed", label: "Cerrados", icon: ShieldCheck },
];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "La acción no pudo completarse");
  return data;
}

function matchesView(draft: OutreachDraft, view: ViewId) {
  const sent = draft.delivery.sendStatus === "sent";
  const outcome = draft.delivery.outcome;
  if (view === "pending") return !sent && (draft.status === "draft" || draft.status === "blocked");
  if (view === "approved") return !sent && draft.status === "approved";
  if (view === "sent") return sent && (!outcome || outcome === "contacted");
  if (view === "replies") return outcome === "reply" || outcome === "call_booked";
  if (view === "sales") return outcome === "deposit_collected";
  return outcome === "lost";
}

function outcomeLabel(draft: OutreachDraft) {
  if (draft.delivery.sendStatus !== "sent") {
    if (draft.status === "approved") return "Listo para enviar";
    if (draft.status === "blocked") return "Necesita corrección";
    return "Pendiente de aprobación";
  }
  const outcome = draft.delivery.outcome;
  if (outcome === "reply") return "Respondió";
  if (outcome === "call_booked") return "Llamada agendada";
  if (outcome === "deposit_collected") return "Depósito cobrado";
  if (outcome === "lost") return "Perdido";
  return "Enviado";
}

export default function RevenueEngineSimplePage() {
  const [view, setView] = useState<ViewId>("pending");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [closing, setClosing] = useState<"deposit_collected" | "lost" | null>(null);
  const [cashCollectedUsd, setCashCollectedUsd] = useState("");
  const [paymentConfirmation, setPaymentConfirmation] = useState("");

  const snapshotQuery = useQuery<RevenueSnapshot>({
    queryKey: ["revenue-engine"],
    queryFn: async () => {
      const response = await fetch("/api/revenue-engine");
      if (!response.ok) throw new Error("No se pudo cargar Revenue Engine");
      return response.json();
    },
  });

  const drafts = snapshotQuery.data?.recentOutreach || [];
  const filteredDrafts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return drafts.filter((draft) => matchesView(draft, view)).filter((draft) =>
      !normalized || `${draft.businessName} ${draft.subject} ${draft.recipientEmail}`.toLowerCase().includes(normalized),
    );
  }, [drafts, query, view]);

  const selected = filteredDrafts.find((draft) => draft.id === selectedId) || filteredDrafts[0] || null;

  useEffect(() => {
    setSelectedId((current) => filteredDrafts.some((draft) => draft.id === current) ? current : filteredDrafts[0]?.id || "");
  }, [filteredDrafts]);

  useEffect(() => {
    if (!selected || editing) return;
    setSubject(selected.subject);
    setBody(selected.body);
  }, [editing, selected]);

  const refresh = async () => {
    await snapshotQuery.refetch();
  };

  const updateMutation = useMutation({
    mutationFn: () => postJson<{ status: string; reason: string }>("/api/revenue-engine/outreach-drafts/update", {
      draftId: selected?.id,
      subject,
      body,
    }),
    onSuccess: async (result) => {
      setEditing(false);
      setNotice({ tone: "success", text: result.reason });
      setView("pending");
      await refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const approveMutation = useMutation({
    mutationFn: () => postJson<{ status: string; reason: string }>("/api/revenue-engine/outreach-drafts/approve", {
      draftId: selected?.id,
      approvedByRobert: true,
      notes: "Aprobado explícitamente por Robert desde la bandeja simplificada.",
    }),
    onSuccess: async (result) => {
      if (result.status !== "approved") throw new Error(result.reason);
      setNotice({ tone: "success", text: "Correo aprobado. Ya está listo para enviar." });
      setView("approved");
      await refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecciona un correo");
      const confirmed = window.confirm(`¿Enviar ahora este correo a ${selected.recipientEmail}?`);
      if (!confirmed) throw new Error("Envío cancelado. No se mandó ningún correo.");
      return postJson<{ status: string; reason?: string; draft?: OutreachDraft }>("/api/revenue-engine/outreach-send", {
        draftId: selected.id,
        approvalToSend: true,
      });
    },
    onSuccess: async (result) => {
      if (result.status !== "sent") throw new Error(result.reason || "El proveedor bloqueó el envío");
      setNotice({ tone: "success", text: "Correo enviado y registrado correctamente." });
      setView("sent");
      await refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const outcomeMutation = useMutation({
    mutationFn: (outcome: OutreachOutcome) => postJson<{ status: string; reason: string }>("/api/revenue-engine/outreach-outcome", {
      draftId: selected?.id,
      outcome,
      outcomeRecordedByRobert: true,
      cashCollectedUsd: outcome === "deposit_collected" ? Number(cashCollectedUsd) : 0,
      paymentConfirmation: outcome === "deposit_collected" ? paymentConfirmation : "",
      notes: `Resultado registrado por Robert desde la bandeja simplificada: ${outcome}.`,
    }),
    onSuccess: async (result, outcome) => {
      setNotice({ tone: "success", text: result.reason });
      setClosing(null);
      setCashCollectedUsd("");
      setPaymentConfirmation("");
      setView(outcome === "deposit_collected" ? "sales" : outcome === "lost" ? "closed" : outcome === "reply" || outcome === "call_booked" ? "replies" : "sent");
      await refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const counts = useMemo(() => Object.fromEntries(views.map((item) => [item.id, drafts.filter((draft) => matchesView(draft, item.id)).length])) as Record<ViewId, number>, [drafts]);
  const pipelineEstimated = snapshotQuery.data?.pipelineStages.reduce((sum, stage) => sum + stage.valueUsd, 0) || 0;
  const replies = drafts.filter((draft) => draft.delivery.outcome === "reply").length;
  const calls = drafts.filter((draft) => draft.delivery.outcome === "call_booked").length;
  const busy = updateMutation.isPending || approveMutation.isPending || sendMutation.isPending || outcomeMutation.isPending;
  const approvalReady = Boolean(selected && selected.status !== "blocked" && selected.qaGates.filter((gate) => gate.gate !== "approval").every((gate) => gate.passed));

  return (
    <main className="min-h-screen bg-[#050708] text-zinc-100">
      <header className="border-b border-white/10 px-5 py-4 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 pr-36">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" aria-label="Volver al dashboard" className="text-zinc-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">Revenue Engine</h1>
              <p className="mt-1 text-sm text-zinc-500">{counts.pending} correos necesitan tu aprobación</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
            <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" />20 de julio de 2026</span>
            <Link href="/revenue-engine/advanced">
              <Button variant="outline" className="border-white/15 text-zinc-200">
                <Settings2 className="mr-2 h-4 w-4" />Herramientas avanzadas
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <nav className="border-b border-white/10" aria-label="Estados de los correos">
        <div className="mx-auto grid max-w-[1500px] grid-cols-2 px-4 sm:grid-cols-3 lg:grid-cols-6 lg:px-8">
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setView(id); setNotice(null); setEditing(false); }}
              className={`flex min-h-16 items-center justify-center gap-2 border-b-2 px-3 text-sm transition ${view === id ? "border-emerald-400 text-emerald-300" : "border-transparent text-zinc-400 hover:text-white"}`}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {label}
              {counts[id] > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{counts[id]}</span>}
            </button>
          ))}
        </div>
      </nav>

      {notice && (
        <div className={`mx-auto mt-4 max-w-[1450px] border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-red-500/30 bg-red-500/10 text-red-100"}`} role="status">
          {notice.text}
        </div>
      )}

      <section className="mx-auto grid min-h-[690px] max-w-[1500px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-r border-white/10 px-4 py-5 lg:px-6">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar prospectos" className="border-white/10 bg-transparent pl-10" />
          </label>
          <div className="mt-5 divide-y divide-white/10">
            {snapshotQuery.isLoading && <p className="py-8 text-center text-sm text-zinc-500">Cargando correos...</p>}
            {snapshotQuery.isError && <p className="py-8 text-center text-sm text-red-300">No se pudieron cargar los correos.</p>}
            {!snapshotQuery.isLoading && filteredDrafts.length === 0 && (
              <div className="py-12 text-center">
                <Mail className="mx-auto h-6 w-6 text-zinc-600" />
                <p className="mt-3 text-sm text-zinc-400">No hay correos en esta sección.</p>
                <p className="mt-1 text-xs text-zinc-600">Cuando cambien de estado aparecerán aquí.</p>
              </div>
            )}
            {filteredDrafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                onClick={() => { setSelectedId(draft.id); setEditing(false); setNotice(null); }}
                className={`w-full border-l-2 px-4 py-5 text-left transition ${selected?.id === draft.id ? "border-emerald-400 bg-white/[0.04]" : "border-transparent hover:bg-white/[0.025]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-white">{draft.businessName}</span>
                  <span className="text-xs text-zinc-600">{new Date(draft.updatedAt).toLocaleDateString("es-US", { month: "short", day: "numeric" })}</span>
                </div>
                <p className="mt-1 truncate text-sm text-zinc-400">{draft.subject}</p>
                <p className="mt-2 text-xs text-zinc-600">{outcomeLabel(draft)}</p>
              </button>
            ))}
          </div>
        </aside>

        <article className="flex min-w-0 flex-col px-5 py-6 lg:px-10">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <Inbox className="mx-auto h-8 w-8 text-zinc-700" />
                <p className="mt-4 text-zinc-400">Selecciona un correo para revisarlo.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 pb-6">
                <div>
                  <div className="flex items-center gap-2 text-sm text-emerald-300">
                    <ShieldCheck className="h-4 w-4" />
                    {approvalReady ? "Destinatario y evidencia verificados" : "Necesita correcciones antes de aprobar"}
                  </div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">{selected.businessName}</h2>
                  <p className="mt-2 text-sm text-zinc-400">{selected.contactName} · {selected.recipientEmail}</p>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-500">{selected.businessSummary}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-zinc-600">Oferta sugerida</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-300">{money.format(selected.pricing.totalSetupUsd)}</p>
                  <p className="mt-1 text-xs text-zinc-600">Depósito {money.format(selected.pricing.depositUsd)}</p>
                </div>
              </div>

              <div className="flex-1 py-6">
                {editing ? (
                  <div className="space-y-5">
                    <div>
                      <label htmlFor="email-subject" className="text-sm font-medium text-zinc-300">Asunto</label>
                      <Input id="email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-2 border-white/10 bg-black" />
                    </div>
                    <div>
                      <label htmlFor="email-body" className="text-sm font-medium text-zinc-300">Mensaje completo</label>
                      <Textarea id="email-body" value={body} onChange={(event) => setBody(event.target.value)} className="mt-2 min-h-[390px] border-white/10 bg-black text-[15px] leading-7" />
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-600">Asunto</p>
                    <p className="mt-2 text-lg font-medium text-white">{selected.subject}</p>
                    <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-zinc-300">{selected.body}</p>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#050708]/95 px-5 py-4 backdrop-blur lg:-mx-10 lg:px-10">
                {editing ? (
                  <>
                    <Button variant="outline" onClick={() => setEditing(false)} disabled={busy} className="border-white/15">Cancelar</Button>
                    <Button onClick={() => updateMutation.mutate()} disabled={busy || subject.trim().length < 3 || body.trim().length < 20} className="bg-sky-600 text-white hover:bg-sky-500">
                      {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar corrección
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setEditing(true)} disabled={busy || selected.delivery.sendStatus === "sent"} className="h-12 min-w-[180px] border-sky-700 text-sky-100">
                      <Pencil className="mr-2 h-4 w-4" />Corregir
                    </Button>
                    <Button onClick={() => approveMutation.mutate()} disabled={busy || selected.status === "approved" || !approvalReady || selected.delivery.sendStatus === "sent"} className="h-12 min-w-[180px] bg-emerald-600 text-white hover:bg-emerald-500">
                      {approveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {selected.status === "approved" ? "Aprobado" : "Aprobar"}
                    </Button>
                    <Button onClick={() => sendMutation.mutate()} disabled={busy || selected.status !== "approved" || selected.delivery.sendStatus === "sent" || selected.channel !== "email"} className="h-12 min-w-[180px] bg-sky-600 text-white hover:bg-sky-500">
                      {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar
                    </Button>
                    {selected.delivery.sendStatus === "sent" && !["deposit_collected", "lost"].includes(selected.delivery.outcome || "") && !closing && (
                      <>
                        <Button variant="outline" onClick={() => outcomeMutation.mutate("reply")} disabled={busy} className="ml-auto border-emerald-700 text-emerald-100">
                          <MessageCircle className="mr-2 h-4 w-4" />Registrar respuesta
                        </Button>
                        <Button variant="outline" onClick={() => outcomeMutation.mutate("call_booked")} disabled={busy} className="border-violet-700 text-violet-100">
                          <Phone className="mr-2 h-4 w-4" />Registrar llamada
                        </Button>
                        <Button variant="outline" onClick={() => setClosing("deposit_collected")} disabled={busy} className="border-emerald-700 text-emerald-100">
                          <CircleDollarSign className="mr-2 h-4 w-4" />Registrar depósito
                        </Button>
                        <Button variant="ghost" onClick={() => setClosing("lost")} disabled={busy} className="text-zinc-400 hover:text-red-200">
                          Marcar perdido
                        </Button>
                      </>
                    )}
                    {closing === "deposit_collected" && (
                      <div className="ml-auto flex w-full flex-wrap items-end gap-3 border-t border-white/10 pt-4">
                        <label className="min-w-[180px] flex-1 text-xs text-zinc-400">Monto cobrado
                          <Input type="number" min="1" value={cashCollectedUsd} onChange={(event) => setCashCollectedUsd(event.target.value)} placeholder="750" className="mt-2 border-white/15 bg-black" />
                        </label>
                        <label className="min-w-[280px] flex-[2] text-xs text-zinc-400">Comprobante o referencia verificable
                          <Input value={paymentConfirmation} onChange={(event) => setPaymentConfirmation(event.target.value)} placeholder="ID del pago o enlace al comprobante" className="mt-2 border-white/15 bg-black" />
                        </label>
                        <Button variant="ghost" onClick={() => setClosing(null)}>Cancelar</Button>
                        <Button onClick={() => outcomeMutation.mutate("deposit_collected")} disabled={busy || Number(cashCollectedUsd) <= 0 || paymentConfirmation.trim().length < 3} className="bg-emerald-600 hover:bg-emerald-500">Confirmar depósito</Button>
                      </div>
                    )}
                    {closing === "lost" && (
                      <div className="ml-auto flex items-center gap-3 border-t border-white/10 pt-4 text-sm text-zinc-300">
                        ¿Confirmas que esta oportunidad se perdió?
                        <Button variant="ghost" onClick={() => setClosing(null)}>Cancelar</Button>
                        <Button variant="destructive" onClick={() => outcomeMutation.mutate("lost")} disabled={busy}>Sí, marcar perdido</Button>
                      </div>
                    )}
                    {selected.channel !== "email" && selected.delivery.sendStatus !== "sent" && (
                      <p className="text-xs text-amber-200">Este canal es manual. Ábrelo desde el correo original o cambia el draft a Email.</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </article>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto grid max-w-[1500px] gap-px bg-white/10 sm:grid-cols-4">
          {[
            { label: "Cobrado confirmado", value: money.format(snapshotQuery.data?.metrics.cashCollectedUsd || 0), detail: "Solo pagos verificados", icon: CircleDollarSign },
            { label: "Pipeline estimado", value: money.format(pipelineEstimated), detail: "No es ingreso", icon: TrendingUp },
            { label: "Respuestas", value: String(replies), detail: "Registradas", icon: MessageCircle },
            { label: "Llamadas", value: String(calls), detail: "Agendadas", icon: Phone },
          ].map(({ label, value, detail, icon: Icon }) => (
            <div key={label} className="flex items-center gap-4 bg-[#050708] px-6 py-5">
              <Icon className="h-6 w-6 text-emerald-300" />
              <div><p className="text-xs text-zinc-600">{label}</p><p className="mt-1 text-lg font-semibold text-white">{value}</p><p className="text-xs text-zinc-600">{detail}</p></div>
            </div>
          ))}
        </div>
      </footer>
    </main>
  );
}
