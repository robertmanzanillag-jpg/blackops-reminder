import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, CalendarDays, Check, Clock, Link2, Loader2, Megaphone, Send, X } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { NETWORK_CAPABILITIES, SOCIAL_NETWORKS, type SocialMediaKind, type SocialNetwork, type SocialPost } from "@shared/social-hub";

type Connections = {
  apps: Record<SocialNetwork, { ready: boolean; needs: string[] }>;
  connected: Array<{ network: SocialNetwork; accountId: string; label: string; connectedAt: string; expiresAt?: string }>;
  storage?: { backend: string; lastWriteError: { message: string } | null };
};
type Networks = { publishingEnabled: boolean };
type Analytics = {
  byNetwork: Record<string, { posts: number; views: number; likes: number; comments: number; shares: number; engagement: number }>;
  topPosts: Array<{ network: SocialNetwork; externalId: string; engagement: number; views: number }>;
};

const NETWORK_LABEL: Record<SocialNetwork, string> = {
  facebook: "Facebook", instagram: "Instagram", threads: "Threads", tiktok: "TikTok",
  youtube: "YouTube", x: "X", linkedin: "LinkedIn", reddit: "Reddit",
};
const NETWORK_COLOR: Record<SocialNetwork, string> = {
  facebook: "bg-blue-500/15 text-blue-100 border-blue-300/30",
  instagram: "bg-pink-500/15 text-pink-100 border-pink-300/30",
  threads: "bg-zinc-500/15 text-zinc-100 border-zinc-300/30",
  tiktok: "bg-cyan-500/15 text-cyan-100 border-cyan-300/30",
  youtube: "bg-red-500/15 text-red-100 border-red-300/30",
  x: "bg-zinc-500/15 text-zinc-100 border-zinc-300/30",
  linkedin: "bg-sky-500/15 text-sky-100 border-sky-300/30",
  reddit: "bg-orange-500/15 text-orange-100 border-orange-300/30",
};
const STATUS: Record<SocialPost["status"], { label: string; cls: string }> = {
  draft: { label: "Borrador", cls: "border-zinc-300/30 text-zinc-200" },
  pending_approval: { label: "Por aprobar", cls: "border-amber-300/40 bg-amber-500/10 text-amber-100" },
  scheduled: { label: "Programado", cls: "border-violet-300/40 bg-violet-500/10 text-violet-100" },
  publishing: { label: "Publicando", cls: "border-cyan-300/40 bg-cyan-500/10 text-cyan-100" },
  published: { label: "Publicado", cls: "border-emerald-300/40 bg-emerald-500/10 text-emerald-100" },
  partially_published: { label: "Parcial", cls: "border-amber-300/40 bg-amber-500/10 text-amber-100" },
  failed: { label: "Falló", cls: "border-red-300/40 bg-red-500/10 text-red-100" },
  cancelled: { label: "Cancelado", cls: "border-zinc-300/20 text-zinc-400" },
};
const BRANDS = ["blackroom", "kong", "miami-news", "ny-news", "personal"];

const fmt = (iso: string) => new Date(iso).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const refresh = () => {
  queryClient.invalidateQueries({ queryKey: ["/api/social-hub/posts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/social-hub/connections"] });
};
async function errorText(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  try { const j = JSON.parse(m.replace(/^\d+:\s*/, "")); return j.problems?.join(" ") || j.error || m; } catch { return m; }
}

export default function SocialHubPage() {
  const connections = useQuery<Connections>({ queryKey: ["/api/social-hub/connections"] });
  const networks = useQuery<Networks>({ queryKey: ["/api/social-hub/networks"] });
  const posts = useQuery<SocialPost[]>({ queryKey: ["/api/social-hub/posts"] });
  const analytics = useQuery<Analytics>({ queryKey: ["/api/social-hub/analytics"] });

  const accounts = connections.data?.connected ?? [];
  const publishingOn = networks.data?.publishingEnabled ?? false;

  return (
    <div className="min-h-screen bg-[#03060b] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(167,139,250,0.16),transparent_35%)]" />
      <main className="relative mx-auto max-w-6xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <Link href="/tools">
              <Button variant="ghost" size="icon" data-testid="button-back-tools"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-200/25 bg-violet-300/10">
              <Megaphone className="h-6 w-6 text-violet-100" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-200">Social Hub</p>
              <h1 className="text-2xl font-semibold">Publicar en todas tus redes</h1>
            </div>
          </div>
          <Badge variant="outline" className={publishingOn ? "border-emerald-300/40 text-emerald-100" : "border-amber-300/40 text-amber-100"} data-testid="badge-publishing">
            {publishingOn ? "Publicación externa: activa" : "Publicación externa: apagada"}
          </Badge>
        </header>

        {connections.data?.storage?.lastWriteError && (
          <div className="mb-4 rounded-xl border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-100" data-testid="alert-storage">
            No se pudo guardar en la base de datos: {connections.data.storage.lastWriteError.message}
          </div>
        )}

        <AccountsCard data={connections.data} loading={connections.isLoading} />
        <div className="my-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Composer accounts={accounts} />
          <QueueCard posts={posts.data ?? []} loading={posts.isLoading} publishingOn={publishingOn} />
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <WeekCalendar posts={posts.data ?? []} />
          <AnalyticsCard data={analytics.data} />
        </div>
      </main>
    </div>
  );
}

function AccountsCard({ data, loading }: { data?: Connections; loading: boolean }) {
  return (
    <Card className="border-white/10 bg-[#080d18]/88">
      <CardHeader><CardTitle className="flex items-center gap-2 text-white"><Link2 className="h-5 w-5 text-violet-200" />Cuentas conectadas</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-zinc-400" /> : (
          <>
            <div className="mb-4 flex flex-wrap gap-2" data-testid="list-connected">
              {(data?.connected ?? []).length === 0 && <p className="text-sm text-zinc-400">Todavía no hay cuentas conectadas.</p>}
              {(data?.connected ?? []).map((a) => (
                <span key={a.network + a.accountId} className={cn("rounded-full border px-3 py-1 text-sm", NETWORK_COLOR[a.network])}>
                  {NETWORK_LABEL[a.network]} · {a.label}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SOCIAL_NETWORKS.filter((n) => n !== "instagram").map((n) => {
                const ready = data?.apps?.[n]?.ready;
                return ready ? (
                  <a key={n} href={`/api/social-hub/oauth/start/${n}`} data-testid={`button-connect-${n}`}>
                    <Button size="sm" variant="outline" className="border-white/15 bg-black/40 text-white hover:bg-white/10">
                      Conectar {n === "facebook" ? "Facebook + Instagram" : NETWORK_LABEL[n]}
                    </Button>
                  </a>
                ) : (
                  <Button key={n} size="sm" variant="outline" disabled className="border-white/10 text-zinc-500" title={`Falta: ${data?.apps?.[n]?.needs.join(", ")}`}>
                    {NETWORK_LABEL[n]} (sin app)
                  </Button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Composer({ accounts }: { accounts: Connections["connected"] }) {
  const [brand, setBrand] = useState("kong");
  const [caption, setCaption] = useState("");
  const [mediaKind, setMediaKind] = useState<SocialMediaKind>("none");
  const [mediaUrls, setMediaUrls] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [when, setWhen] = useState<"best" | "custom">("best");
  const [at, setAt] = useState("");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const chosen = accounts.filter((a) => selected.includes(a.network + ":" + a.accountId));
  const limit = chosen.length ? Math.min(...chosen.map((a) => NETWORK_CAPABILITIES[a.network].maxCaptionChars)) : null;

  const create = useMutation({
    mutationFn: async () => {
      const urls = mediaUrls.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const body = {
        brand, caption, mediaKind, mediaUrls: mediaKind === "none" ? [] : urls,
        targets: chosen.map((a) => ({ network: a.network, accountId: a.accountId, options: a.network === "youtube" || a.network === "reddit" ? { title } : undefined })),
        publishAt: when === "best" ? "best" : new Date(at).toISOString(),
      };
      return (await apiRequest("POST", "/api/social-hub/posts", body)).json();
    },
    onSuccess: (p: SocialPost) => { setMsg({ ok: true, text: `Programado para ${fmt(p.publishAt)}.` }); setCaption(""); setMediaUrls(""); refresh(); },
    onError: async (e) => setMsg({ ok: false, text: await errorText(e) }),
  });

  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

  return (
    <Card className="border-white/10 bg-[#080d18]/88">
      <CardHeader><CardTitle className="flex items-center gap-2 text-white"><Send className="h-5 w-5 text-violet-200" />Nuevo post</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Dónde publicar</p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
              const key = a.network + ":" + a.accountId;
              const on = selected.includes(key);
              return (
                <button key={key} type="button" onClick={() => toggle(key)} data-testid={`toggle-account-${a.network}-${a.accountId}`}
                  className={cn("rounded-full border px-3 py-1 text-sm transition", on ? NETWORK_COLOR[a.network] : "border-white/10 text-zinc-400 hover:text-white")}>
                  {on && <Check className="mr-1 inline h-3 w-3" />}{NETWORK_LABEL[a.network]} · {a.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-400">Marca
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1 w-full rounded-md border border-white/15 bg-black/40 p-2 text-white" data-testid="select-brand">
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-sm text-zinc-400">Tipo
            <select value={mediaKind} onChange={(e) => setMediaKind(e.target.value as SocialMediaKind)} className="mt-1 w-full rounded-md border border-white/15 bg-black/40 p-2 text-white" data-testid="select-media-kind">
              <option value="none">Solo texto</option><option value="image">Imagen</option><option value="video">Video</option><option value="carousel">Carrusel</option>
            </select>
          </label>
        </div>

        <div>
          <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Texto del post" rows={4} className="border-white/15 bg-black/40 text-white" data-testid="input-caption" />
          {limit !== null && <p className={cn("mt-1 text-xs", caption.length > limit ? "text-red-300" : "text-zinc-500")}>{caption.length} / {limit}</p>}
        </div>

        {mediaKind !== "none" && (
          <Textarea value={mediaUrls} onChange={(e) => setMediaUrls(e.target.value)} placeholder="URL pública del archivo (una por línea en carrusel)" rows={2} className="border-white/15 bg-black/40 text-white" data-testid="input-media-urls" />
        )}
        {chosen.some((a) => a.network === "youtube" || a.network === "reddit") && (
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (YouTube / Reddit)" className="border-white/15 bg-black/40 text-white" data-testid="input-title" />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant={when === "best" ? "default" : "outline"} onClick={() => setWhen("best")} data-testid="button-when-best">Mejor hora</Button>
          <Button size="sm" variant={when === "custom" ? "default" : "outline"} onClick={() => setWhen("custom")} data-testid="button-when-custom">Elegir hora</Button>
          {when === "custom" && <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="w-auto border-white/15 bg-black/40 text-white" data-testid="input-publish-at" />}
        </div>

        <Button className="w-full" disabled={create.isPending || !chosen.length || !caption.trim() || (when === "custom" && !at)} onClick={() => { setMsg(null); create.mutate(); }} data-testid="button-schedule">
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}Programar
        </Button>
        {msg && <p className={cn("text-sm", msg.ok ? "text-emerald-300" : "text-red-300")} data-testid="text-composer-result">{msg.text}</p>}
      </CardContent>
    </Card>
  );
}

function QueueCard({ posts, loading, publishingOn }: { posts: SocialPost[]; loading: boolean; publishingOn: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "cancel" | "publish-now" }) => (await apiRequest("POST", `/api/social-hub/posts/${id}/${action}`)).json(),
    onSuccess: () => { setErr(null); refresh(); },
    onError: async (e) => setErr(await errorText(e)),
  });
  const visible = [...posts].filter((p) => p.status !== "cancelled").sort((a, b) => b.publishAt.localeCompare(a.publishAt)).slice(0, 25);

  return (
    <Card className="border-white/10 bg-[#080d18]/88">
      <CardHeader><CardTitle className="flex items-center gap-2 text-white"><Clock className="h-5 w-5 text-violet-200" />Cola y aprobaciones</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />}
        {!loading && visible.length === 0 && <p className="text-sm text-zinc-400">No hay posts todavía.</p>}
        {err && <p className="text-sm text-red-300" data-testid="text-queue-error">{err}</p>}
        {visible.map((p) => (
          <div key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-3" data-testid={`post-${p.id}`}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-zinc-400">{fmt(p.publishAt)} · {p.brand} · {p.createdBy}</span>
              <Badge variant="outline" className={STATUS[p.status].cls}>{STATUS[p.status].label}</Badge>
            </div>
            <p className="line-clamp-2 text-sm text-zinc-200">{p.caption}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.results.map((r) => (
                <span key={r.network + r.accountId} className={cn("rounded-full border px-2 py-0.5 text-xs", NETWORK_COLOR[r.network])} title={r.error}>
                  {NETWORK_LABEL[r.network]} {r.status === "published" ? "✓" : r.status === "failed" ? "✗" : "…"}
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="ml-1 underline">ver</a>}
                </span>
              ))}
            </div>
            {p.results.some((r) => r.error) && <p className="mt-1 text-xs text-red-300">{p.results.filter((r) => r.error).map((r) => r.error).join(" · ")}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {p.status === "pending_approval" && <Button size="sm" onClick={() => act.mutate({ id: p.id, action: "approve" })} data-testid={`button-approve-${p.id}`}><Check className="mr-1 h-3 w-3" />Aprobar</Button>}
              {(p.status === "scheduled" || p.status === "partially_published") && (
                <Button size="sm" variant="outline" disabled={!publishingOn} title={publishingOn ? "" : "La publicación externa está apagada"} onClick={() => act.mutate({ id: p.id, action: "publish-now" })} data-testid={`button-publish-${p.id}`}>
                  <Send className="mr-1 h-3 w-3" />Publicar ya
                </Button>
              )}
              {["pending_approval", "scheduled", "failed", "draft"].includes(p.status) && (
                <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => act.mutate({ id: p.id, action: "cancel" })} data-testid={`button-cancel-${p.id}`}><X className="mr-1 h-3 w-3" />Cancelar</Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function WeekCalendar({ posts }: { posts: SocialPost[] }) {
  const days = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, []);
  return (
    <Card className="border-white/10 bg-[#080d18]/88">
      <CardHeader><CardTitle className="flex items-center gap-2 text-white"><CalendarDays className="h-5 w-5 text-violet-200" />Próximos 7 días</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => {
          const items = posts.filter((p) => p.status !== "cancelled" && new Date(p.publishAt).toDateString() === d.toDateString());
          return (
            <div key={d.toISOString()} className="min-h-24 rounded-lg border border-white/10 bg-black/30 p-2">
              <p className="mb-1 text-xs font-semibold text-zinc-300">{d.toLocaleDateString("es", { weekday: "short", day: "numeric" })}</p>
              {items.map((p) => (
                <p key={p.id} className="mb-1 truncate rounded bg-violet-500/15 px-1 text-[11px] text-violet-100" title={p.caption}>
                  {new Date(p.publishAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} {p.caption}
                </p>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AnalyticsCard({ data }: { data?: Analytics }) {
  const rows = Object.entries(data?.byNetwork ?? {});
  return (
    <Card className="border-white/10 bg-[#080d18]/88">
      <CardHeader><CardTitle className="flex items-center gap-2 text-white"><BarChart3 className="h-5 w-5 text-violet-200" />Analíticas (30 días)</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-zinc-400">Aparecen después de los primeros posts publicados (se actualizan cada 6 horas).</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-zinc-500"><th>Red</th><th>Posts</th><th>Vistas</th><th>Likes</th><th>Coment.</th></tr></thead>
            <tbody>
              {rows.map(([n, v]) => (
                <tr key={n} className="border-t border-white/10 text-zinc-200">
                  <td className="py-1">{NETWORK_LABEL[n as SocialNetwork] ?? n}</td><td>{v.posts}</td><td>{v.views}</td><td>{v.likes}</td><td>{v.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
