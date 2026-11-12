import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// Chat with the CEO Black Room (owner and partner). Server: server/blackroom-ceo-chat-routes.ts.

type Author = { userId: string; role: "owner" | "partner" | "ceo"; name: string };
type Approval = { agentId: string; id: string; title: string; summary: string; status: string; createdAt: string; publicationDateTime?: string | null; networks?: string[]; dryRun: boolean };
type ResultCard = { agentId: string; agentName: string; operation: string; label: string; ok: boolean; summary: string; details: string[]; blocked: boolean; needs: string[]; timedOut?: boolean; approvals: Approval[]; orderId?: string | null; orderClosed?: boolean };
type Message = { id: string; at: string; author: Author; text: string; results?: ResultCard[]; orderIds?: string[]; routedBy?: string };
type ChatView = { messages: Message[]; pendingApprovals: Approval[]; maxExecutions: number; role: "owner" | "partner"; me: string };

export const BLACKROOM_CEO_CHAT_KEY = ["blackroom-ceo-chat"] as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error || `Error ${response.status}`);
  return body as T;
}

function time(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toLocaleString("es", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

const SUGGESTIONS = ["Dame el reporte de la semana", "¿Qué está haciendo la competencia?", "Hazme 3 ideas de video para el viernes", "Revisa la web", "¿Qué hay por aprobar?"];

export function BlackRoomCeoChatPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const chat = useQuery<ChatView>({
    queryKey: BLACKROOM_CEO_CHAT_KEY,
    queryFn: async () => readJson<ChatView>(await fetch("/api/blackroom-ceo-chat", { credentials: "same-origin", headers: { Accept: "application/json" } })),
    refetchInterval: 20_000,
    retry: false,
  });
  const messages = chat.data?.messages || [];
  const pending = chat.data?.pendingApprovals || [];

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const post = async (url: string, body?: unknown) => readJson<{ pendingApprovals?: Approval[] }>(await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

  const send = async (value = text) => {
    const message = value.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await post("/api/blackroom-ceo-chat/messages", { text: message });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje.");
    }
    await queryClient.invalidateQueries({ queryKey: BLACKROOM_CEO_CHAT_KEY });
    await queryClient.invalidateQueries({ queryKey: ["agent-council-state"] });
    setSending(false);
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    setDeciding(id);
    setError(null);
    try {
      await post(`/api/blackroom-ceo-chat/approvals/${encodeURIComponent(id)}/${decision}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la decision.");
    }
    await queryClient.invalidateQueries({ queryKey: BLACKROOM_CEO_CHAT_KEY });
    setDeciding(null);
  };

  return (
    <section className="absolute top-[220px] right-3 z-30 sm:top-36 lg:top-24 flex max-h-[70%] w-[min(460px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-fuchsia-200/25 bg-[#12051a]/95 p-4 text-white shadow-2xl [color-scheme:dark]" aria-label="Chat con el CEO Black Room" data-testid="blackroom-ceo-chat">
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-200">Chat con el CEO Black Room</p>
        <button type="button" onClick={onClose} className="text-xs text-zinc-400 hover:text-white" aria-label="Cerrar chat">✕</button>
      </div>
      <p className="mt-1 shrink-0 text-[11px] text-zinc-400">
        Pide lo que necesites: el CEO lo reparte al equipo y lo ejecuta (máximo {chat.data?.maxExecutions ?? 3} tareas por mensaje). Nada se publica sin que alguien lo apruebe aquí.
        {chat.data?.role === "partner" ? " Estás como socio: Robert ve esta misma conversación." : ""}
      </p>

      {pending.length > 0 && (
        <div className="mt-2 shrink-0 space-y-1.5 rounded-xl border border-amber-200/25 bg-amber-300/5 p-2" data-testid="blackroom-ceo-chat-approvals">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Esperan aprobación · {pending.length}</p>
          {pending.slice(0, 5).map((item) => (
            <div key={item.id} className="rounded-lg bg-black/40 p-2 text-[11px]" data-testid="blackroom-ceo-chat-approval">
              <p className="font-semibold">{item.title}</p>
              {item.summary && <p className="text-zinc-300">{item.summary}</p>}
              <p className="text-[10px] text-zinc-500">{item.networks?.join(", ")}{item.dryRun ? " · modo simulación" : ""}</p>
              <div className="mt-1 flex gap-2">
                <button type="button" disabled={deciding !== null} onClick={() => decide(item.id, "approve")} className="rounded-full bg-emerald-400 px-3 py-1 text-[11px] font-bold text-black disabled:opacity-50" data-testid="blackroom-ceo-chat-approve">Aprobar</button>
                <button type="button" disabled={deciding !== null} onClick={() => decide(item.id, "reject")} className="rounded-full border border-rose-300/50 px-3 py-1 text-[11px] text-rose-100 disabled:opacity-50" data-testid="blackroom-ceo-chat-reject">Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div ref={listRef} className="mt-2 min-h-[120px] flex-1 space-y-2 overflow-y-auto pr-1" data-testid="blackroom-ceo-chat-messages">
        {chat.isLoading && <p className="text-xs text-zinc-500">Cargando conversación...</p>}
        {chat.isError && <p className="text-xs text-rose-200">{chat.error instanceof Error ? chat.error.message : "No se pudo cargar el chat."}</p>}
        {!chat.isLoading && !chat.isError && messages.length === 0 && <p className="text-xs text-zinc-500">Todavía no hay mensajes. Prueba con una de las sugerencias.</p>}
        {messages.map((message) => {
          const fromCeo = message.author.role === "ceo";
          return (
            <article key={message.id} className={cn("rounded-xl p-2 text-xs", fromCeo ? "border border-fuchsia-300/15 bg-fuchsia-400/5" : "ml-6 bg-white/[0.06]")} data-testid="blackroom-ceo-chat-message">
              <p className="text-[10px] text-zinc-400"><b className={fromCeo ? "text-fuchsia-200" : "text-white"}>{message.author.name}</b>{message.author.role === "partner" ? " · socio" : message.author.role === "owner" ? " · owner" : ""} · {time(message.at)}</p>
              <p className="mt-1 whitespace-pre-wrap leading-5 text-zinc-100">{message.text}</p>
              {(message.results || []).map((card, index) => (
                <div key={`${message.id}-${index}`} className={cn("mt-1.5 rounded-lg border p-2", card.ok ? "border-emerald-300/25 bg-emerald-400/5" : "border-rose-300/25 bg-rose-500/5")} data-testid="blackroom-ceo-chat-result">
                  <p className="text-[11px] font-semibold">{card.agentName} · {card.label}</p>
                  <p className={cn("text-[11px]", card.ok ? "text-emerald-100" : "text-rose-100")}>{card.ok ? "Hecho" : card.timedOut ? "Sin respuesta a tiempo" : "Bloqueado"}: {card.summary}</p>
                  {card.details.map((line) => <p key={line} className="text-[10px] text-zinc-300">· {line}</p>)}
                  {!card.ok && card.needs.length > 0 && <p className="mt-0.5 text-[10px] text-amber-200">Necesita: {card.needs.join("; ")}</p>}
                  {card.orderId && <p className="mt-0.5 text-[10px] text-zinc-500">Orden {card.orderClosed ? "cerrada (sin puntos)" : "abierta"} en la empresa.</p>}
                </div>
              ))}
            </article>
          );
        })}
        {sending && <p className="text-xs text-fuchsia-200">El CEO está trabajando con el equipo...</p>}
      </div>

      {error && <p role="status" className="mt-1 shrink-0 text-[11px] text-rose-200">{error}</p>}
      {messages.length === 0 && (
        <div className="mt-2 flex shrink-0 flex-wrap gap-1">
          {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={sending} onClick={() => send(suggestion)} className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10">{suggestion}</button>)}
        </div>
      )}
      <div className="mt-2 flex shrink-0 gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void send(); }}
          aria-label="Mensaje para el CEO Black Room"
          placeholder="Ej: prepara un post para el viernes a las 8pm"
          maxLength={1000}
          disabled={sending}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-fuchsia-200/50 focus:outline-none"
          data-testid="blackroom-ceo-chat-input"
        />
        <button type="button" onClick={() => send()} disabled={sending || !text.trim()} className="rounded-full bg-fuchsia-300 px-3 py-2 text-xs font-bold text-black hover:bg-fuchsia-200 disabled:opacity-50" data-testid="blackroom-ceo-chat-send">Enviar</button>
      </div>
    </section>
  );
}
