import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type AgentSummary = {
  enabled: boolean;
  pausedAt: string | null;
  updatedAt: string;
  timezone: string;
  bufferWeeks: number;
  postsPerDay: number;
  totals: { queued: number; processing: number; retry: number; scheduled: number; completed: number };
  nextJob: { targetDate: string; status: string; attempts: number; lastError: string | null } | null;
};

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No pude comunicarme con el agente BlackRoom");
  return data;
}

export default function BlackRoomPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [weeks, setWeeks] = useState("2");
  const query = useQuery<AgentSummary>({
    queryKey: ["/api/clippers/blackroom-agent"],
    queryFn: async () => (await readJson(await fetch("/api/clippers/blackroom-agent"))).agent,
    refetchInterval: 15_000,
  });

  const start = useMutation({
    mutationFn: async () => readJson(await fetch("/api/clippers/blackroom-agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeks: Number(weeks) }),
    })),
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/blackroom-agent"], data.agent);
      toast({ title: "BlackRoom está trabajando", description: `${data.agent.bufferWeeks} semanas quedaron en cola.` });
    },
    onError: (error: Error) => toast({ title: "No pude iniciar BlackRoom", description: error.message, variant: "destructive" }),
  });

  const pause = useMutation({
    mutationFn: async () => readJson(await fetch("/api/clippers/blackroom-agent/pause", { method: "POST" })),
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/blackroom-agent"], data.agent);
      toast({ title: "BlackRoom quedó pausado", description: "La cola está guardada y continuará cuando vuelvas a iniciarla." });
    },
    onError: (error: Error) => toast({ title: "No pude pausar BlackRoom", description: error.message, variant: "destructive" }),
  });

  const agent = query.data;
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/dashboard" className="mb-4 inline-flex items-center text-sm text-zinc-400 hover:text-white"><ArrowLeft className="mr-2 h-4 w-4" />Dashboard</Link>
            <h1 className="text-3xl font-bold tracking-tight">BlackRoom Content Agent</h1>
            <p className="mt-2 text-zinc-400">YouTube BlackRoom → edición automática → TikTok por Metricool</p>
          </div>
          <a href="https://www.youtube.com/@blackroom_us" target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-cyan-200 hover:text-cyan-100">
            Canal oficial <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </div>

        <Card className="border-cyan-300/25 bg-gradient-to-br from-cyan-950/35 via-zinc-950 to-violet-950/25">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Control del agente</CardTitle>
              <Badge className={cn("border", agent?.enabled ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200")}>
                {query.isLoading ? "Cargando" : agent?.enabled ? "Trabajando" : "Pausado"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="max-w-4xl text-sm leading-6 text-zinc-400">
              Prepara 10 publicaciones diarias de 5 DJs, selecciona videos aleatorios, busca drops y crea cortes diferentes verticales y horizontales en inglés y español.
            </p>
            {query.isError && <p className="rounded-md border border-red-300/30 bg-red-950/20 p-3 text-sm text-red-200">El servidor principal no está disponible. Inícialo en el puerto 5000 y recarga esta página.</p>}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="blackroom-weeks">Semanas que quieres preparar</Label>
                <Select value={weeks} onValueChange={setWeeks} disabled={Boolean(agent?.enabled)}>
                  <SelectTrigger id="blackroom-weeks" className="mt-2" data-testid="blackroom-page-weeks"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 semana · 70 posts</SelectItem>
                    <SelectItem value="2">2 semanas · 140 posts</SelectItem>
                    <SelectItem value="3">3 semanas · 210 posts</SelectItem>
                    <SelectItem value="4">4 semanas · 280 posts</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {agent?.enabled ? (
                <Button variant="outline" className="border-amber-300/30 text-amber-100 hover:bg-amber-300/10" onClick={() => pause.mutate()} disabled={pause.isPending} data-testid="blackroom-page-pause">
                  {pause.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}Pausar agente
                </Button>
              ) : (
                <Button className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100" onClick={() => start.mutate()} disabled={start.isPending || query.isError} data-testid="blackroom-page-play">
                  {start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Iniciar agente
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(["queued", "processing", "retry", "scheduled", "completed"] as const).map((key) => (
            <Card key={key} className="border-white/10 bg-zinc-950"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-zinc-500">{{ queued: "En cola", processing: "Procesando", retry: "Reintentos", scheduled: "Agendados", completed: "Completados" }[key]}</p><p className="mt-2 text-2xl font-semibold">{agent?.totals[key] || 0}</p></CardContent></Card>
          ))}
        </div>

        <Card className="border-white/10 bg-zinc-950">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-zinc-400">
              {agent?.nextJob ? <>Próximo lote: <span className="text-white">{agent.nextJob.targetDate}</span> · {agent.nextJob.status} · 10 videos cada 90 minutos</> : "La cola comenzará cuando pulses Iniciar agente."}
              {agent?.nextJob?.lastError && <p className="mt-2 text-amber-200">{agent.nextJob.lastError}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={cn("mr-2 h-4 w-4", query.isFetching && "animate-spin")} />Actualizar</Button>
          </CardContent>
        </Card>

        <p className="text-xs leading-5 text-zinc-500">La Mac debe estar encendida y sin suspensión para descargar, editar y cargar. Metricool seguirá publicando lo que ya haya quedado programado.</p>
      </div>
    </main>
  );
}
