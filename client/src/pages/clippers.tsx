import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Eye,
  Flame,
  Gauge,
  KeyRound,
  Loader2,
  Network,
  Play,
  RefreshCw,
  FolderOpen,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UploadCloud,
  Users,
  Wand2,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ClipperAccountCategory = "sports" | "memes" | "streamers";
type ClipperAccountStatus = "ready" | "needs_connection" | "paused";
type ClipperAgentStatus = "active" | "waiting" | "review_required";
type ClipperPlatform = "tiktok" | "instagram" | "youtube";
type ClipperPlatformConnectionStatus = "not_created" | "created" | "needs_oauth" | "needs_review" | "ready";
type ClipperPermissionStatus = "missing" | "requested" | "approved" | "blocked";
type ClipperReadinessStatus = "ready" | "missing" | "partial";
type ClipperConnectActionStatus = "ready" | "blocked";

interface ClipperPlatformAccount {
  platform: ClipperPlatform;
  handle: string;
  displayName: string;
  status: ClipperPlatformConnectionStatus;
  requiredScopes: string[];
  missingSteps: string[];
  notes: string;
}

interface ClipperAccount {
  id: string;
  name: string;
  category: ClipperAccountCategory;
  platforms: string[];
  platformAccounts: ClipperPlatformAccount[];
  dailyClipTarget: number;
  weeklyViewsGoal: number;
  lastWeekViews: number;
  status: ClipperAccountStatus;
  contentPolicy: string;
}

interface ClipperSource {
  id: string;
  label: string;
  type: string;
  freshness: string;
  rightsMode: string;
  status: "connected" | "planned" | "needs_setup";
}

interface ClipperSubAgent {
  id: string;
  name: string;
  job: string;
  status: ClipperAgentStatus;
  output: string;
}

interface ClipperPlatformRequirement {
  platform: ClipperPlatform;
  label: string;
  developerPortalUrl: string;
  accountCreationUrl: string;
  requiredAccountType: string;
  scopes: string[];
  appReview: string;
  postingMode: string;
  humanRequired: string[];
  docs: string[];
}

interface ClipperPermissionRequest {
  id: string;
  platform: ClipperPlatform;
  scope: string;
  label: string;
  status: ClipperPermissionStatus;
  reason: string;
  evidenceRequired: string;
  docsUrl: string;
}

interface ClipperCredentialCheck {
  platform: ClipperPlatform;
  label: string;
  status: ClipperReadinessStatus;
  requiredEnvVars: string[];
  configuredEnvVars: string[];
  missingEnvVars: string[];
  nextStep: string;
}

interface ClipperSourceFolder {
  category: ClipperAccountCategory | "allowlist" | "drafts" | "scheduled";
  label: string;
  path: string;
  status: "ready";
  purpose: string;
}

interface ClipperConnectAction {
  platform: ClipperPlatform;
  label: string;
  status: ClipperConnectActionStatus;
  authUrl: string | null;
  callbackPath: string;
  missingEnvVars: string[];
  scopes: string[];
  nextStep: string;
}

interface ClipperPipelineItem {
  stage: string;
  count: number;
  owner: string;
  status: ClipperAgentStatus;
}

interface ClipperPlannedClip {
  accountId: string;
  title: string;
  sourceStrategy: string;
  format: string;
  hook: string;
  publishWindow: string;
  status: "drafted" | "needs_source" | "needs_review";
}

interface ClipperReport {
  id: string;
  createdAt: string;
  summary: string;
  publishMode: "draft_only" | "approval_required" | "auto_after_connection";
  riskTolerance: "safe" | "growth" | "aggressive";
  plannedClips: ClipperPlannedClip[];
  accountRecommendations: Array<{
    accountId: string;
    recommendation: string;
    reason: string;
  }>;
  nextActions: string[];
  reportPath: string;
}

interface ClipperStatus {
  rootDir: string;
  reportsDir: string;
  sourceRootDir: string;
  accounts: ClipperAccount[];
  sources: ClipperSource[];
  sourceFolders: ClipperSourceFolder[];
  credentialChecks: ClipperCredentialCheck[];
  connectActions: ClipperConnectAction[];
  platformRequirements: ClipperPlatformRequirement[];
  permissionQueue: ClipperPermissionRequest[];
  agents: ClipperSubAgent[];
  pipeline: ClipperPipelineItem[];
  goals: {
    weeklyViewsPerAccount: number;
    totalWeeklyGoal: number;
    dailyClipsTarget: number;
    connectedAccounts: number;
  };
  latestReport: ClipperReport | null;
  guardrails: string[];
}

const categoryLabels: Record<ClipperAccountCategory, string> = {
  sports: "Deportes",
  memes: "Memes",
  streamers: "Streamers",
};

const accountTone: Record<ClipperAccountCategory, string> = {
  sports: "from-emerald-300 to-cyan-300",
  memes: "from-amber-300 to-rose-300",
  streamers: "from-fuchsia-300 to-violet-300",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 1_000_000 ? "compact" : "standard" }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusBadge(status: ClipperAgentStatus | ClipperAccountStatus | ClipperSource["status"]) {
  if (status === "active" || status === "ready" || status === "connected") {
    return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  }
  if (status === "review_required" || status === "needs_connection" || status === "needs_setup") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  }
  return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
}

function connectionBadge(status: ClipperPlatformConnectionStatus | ClipperPermissionStatus) {
  if (status === "ready" || status === "approved") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "requested" || status === "needs_review" || status === "needs_oauth") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  if (status === "blocked") return "border-red-300/30 bg-red-300/10 text-red-200";
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
}

function readinessBadge(status: ClipperReadinessStatus) {
  if (status === "ready") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (status === "partial") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-300/30 bg-red-300/10 text-red-200";
}

function StatCard({ icon: Icon, label, value, detail }: { icon: typeof Target; label: string; value: string; detail: string }) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/70">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black">
          <Icon className="h-5 w-5 text-cyan-200" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="truncate text-xl font-semibold text-white">{value}</p>
          <p className="truncate text-xs text-zinc-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClippersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clipsPerAccount, setClipsPerAccount] = useState(8);
  const [publishMode, setPublishMode] = useState<ClipperReport["publishMode"]>("approval_required");
  const [riskTolerance, setRiskTolerance] = useState<ClipperReport["riskTolerance"]>("growth");
  const [lastRun, setLastRun] = useState<ClipperReport | null>(null);

  const { data: status, isLoading, refetch } = useQuery<ClipperStatus>({
    queryKey: ["/api/clippers/status"],
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/run-daily-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipsPerAccount, publishMode, riskTolerance }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude generar el plan diario");
      return data as { report: ClipperReport; status: ClipperStatus };
    },
    onSuccess: (data) => {
      setLastRun(data.report);
      queryClient.setQueryData(["/api/clippers/status"], data.status);
      toast({
        title: "Plan diario listo",
        description: `${data.report.plannedClips.length} drafts propuestos para revisar.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Fallo el plan", description: error.message, variant: "destructive" });
    },
  });

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/bootstrap-accounts", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar las cuentas");
      return data as ClipperStatus;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data);
      toast({
        title: "Cuentas preparadas",
        description: "Cree el setup interno para deportes, memes y streamers en las plataformas.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar cuentas", description: error.message, variant: "destructive" });
    },
  });

  const workspaceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/clippers/bootstrap-workspace", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude preparar el workspace");
      return data as ClipperStatus;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/clippers/status"], data);
      toast({
        title: "Workspace preparado",
        description: "Carpetas de fuentes, allowlist, drafts y scheduled quedaron listas.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "No pude preparar workspace", description: error.message, variant: "destructive" });
    },
  });

  const report = lastRun || status?.latestReport || null;
  const accountsById = useMemo(() => {
    return (status?.accounts || []).reduce<Record<string, ClipperAccount>>((lookup, account) => {
      lookup[account.id] = account;
      return lookup;
    }, {});
  }, [status?.accounts]);

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-white md:px-8" data-testid="clippers-page">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/agents-office">
              <Button variant="ghost" size="icon" data-testid="button-back-agents-office">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-black">
              <Clapperboard className="h-5 w-5 text-amber-200" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Clippers Command Center</h1>
              <p className="text-sm text-zinc-500">Cuentas virales, agentes, drafts y reportes de crecimiento</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isLoading}
              className="border-zinc-800"
              data-testid="refresh-clippers-status-button"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
              Refrescar
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || isLoading}
              className="bg-amber-200 text-zinc-950 hover:bg-amber-100"
              data-testid="run-clippers-daily-plan-button"
            >
              {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Generar plan diario
            </Button>
            <Button
              onClick={() => bootstrapMutation.mutate()}
              disabled={bootstrapMutation.isPending || isLoading}
              className="bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
              data-testid="bootstrap-clippers-accounts-button"
            >
              {bootstrapMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Preparar cuentas
            </Button>
            <Button
              onClick={() => workspaceMutation.mutate()}
              disabled={workspaceMutation.isPending || isLoading}
              className="bg-emerald-200 text-zinc-950 hover:bg-emerald-100"
              data-testid="bootstrap-clippers-workspace-button"
            >
              {workspaceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
              Preparar workspace
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Target} label="Meta semanal" value={`${formatNumber(status?.goals.totalWeeklyGoal || 0)} views`} detail={`${formatNumber(status?.goals.weeklyViewsPerAccount || 0)} por cuenta`} />
          <StatCard icon={Clapperboard} label="Clips diarios" value={String(status?.goals.dailyClipsTarget || 0)} detail="objetivo configurado" />
          <StatCard icon={Users} label="Cuentas" value={String(status?.accounts.length || 0)} detail={`${status?.goals.connectedAccounts || 0} conectadas`} />
          <StatCard icon={Gauge} label="Modo" value={publishMode === "approval_required" ? "Aprobacion" : publishMode === "draft_only" ? "Drafts" : "Auto"} detail="control de publicacion" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Wand2 className="h-4 w-4 text-amber-200" />
                Control diario
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Clips por cuenta</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={clipsPerAccount}
                  onChange={(event) => setClipsPerAccount(Number(event.target.value))}
                  className="border-zinc-800 bg-black"
                />
              </div>
              <div className="space-y-2">
                <Label>Publicacion</Label>
                <Select value={publishMode} onValueChange={(value) => setPublishMode(value as ClipperReport["publishMode"])}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval_required">Aprobacion requerida</SelectItem>
                    <SelectItem value="draft_only">Solo drafts</SelectItem>
                    <SelectItem value="auto_after_connection">Auto si esta conectado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Riesgo creativo</Label>
                <Select value={riskTolerance} onValueChange={(value) => setRiskTolerance(value as ClipperReport["riskTolerance"])}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="safe">Seguro</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="aggressive">Agresivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                Guardrails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(status?.guardrails || []).map((rule) => (
                <div key={rule} className="flex gap-2 rounded-md border border-white/10 bg-black/35 p-2 text-sm text-zinc-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                  <span>{rule}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <KeyRound className="h-4 w-4 text-cyan-200" />
                Cuentas preparadas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.accounts || []).flatMap((account) =>
                (account.platformAccounts || []).map((platformAccount) => (
                  <div key={`${account.id}-${platformAccount.platform}`} className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{platformAccount.displayName} <span className="text-zinc-500">{platformAccount.handle}</span></p>
                        <p className="mt-1 text-xs text-zinc-500">{categoryLabels[account.category]} · {platformAccount.platform}</p>
                      </div>
                      <Badge className={cn("w-fit border", connectionBadge(platformAccount.status))}>{platformAccount.status}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {platformAccount.requiredScopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="border-zinc-700 text-zinc-300">{scope}</Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{platformAccount.notes}</p>
                    <p className="mt-2 text-xs text-amber-200">Pendiente: {platformAccount.missingSteps.join(" · ")}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                Permisos/API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.permissionQueue || []).map((permission) => (
                <div key={permission.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{permission.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{permission.reason}</p>
                    </div>
                    <Badge className={cn("border", connectionBadge(permission.status))}>{permission.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{permission.evidenceRequired}</p>
                  <a href={permission.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-cyan-100">
                    Docs oficiales
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <UploadCloud className="h-4 w-4 text-amber-200" />
              Setup por plataforma
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 xl:grid-cols-3">
            {(status?.platformRequirements || []).map((platform) => (
              <div key={platform.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{platform.label}</p>
                  <a href={platform.developerPortalUrl} target="_blank" rel="noreferrer" className="text-cyan-200 hover:text-cyan-100" aria-label={`Abrir ${platform.label}`}>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{platform.requiredAccountType}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{platform.appReview}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {platform.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="border-zinc-700 text-zinc-300">{scope}</Badge>
                  ))}
                </div>
                <div className="mt-3 space-y-1">
                  {platform.humanRequired.map((step) => (
                    <p key={step} className="flex gap-2 text-xs leading-5 text-zinc-500">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
                      {step}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <KeyRound className="h-4 w-4 text-amber-200" />
                Credenciales OAuth
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.credentialChecks || []).map((check) => (
                <div key={check.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{check.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{check.nextStep}</p>
                    </div>
                    <Badge className={cn("border", readinessBadge(check.status))}>{check.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-black/30 p-2">
                      <p className="text-zinc-500">Configuradas</p>
                      <p className="mt-1 break-all text-zinc-300">{check.configuredEnvVars.length ? check.configuredEnvVars.join(", ") : "ninguna"}</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/30 p-2">
                      <p className="text-zinc-500">Faltan</p>
                      <p className="mt-1 break-all text-amber-200">{check.missingEnvVars.length ? check.missingEnvVars.join(", ") : "listo"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <ExternalLink className="h-4 w-4 text-cyan-200" />
                Acciones de conexion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.connectActions || []).map((action) => (
                <div key={action.platform} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{action.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{action.nextStep}</p>
                    </div>
                    {action.authUrl ? (
                      <a href={`/api/clippers/oauth/${action.platform}/start`} className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-cyan-200 px-3 text-sm font-medium text-zinc-950 hover:bg-cyan-100">
                        Conectar
                      </a>
                    ) : (
                      <Badge className="w-fit border border-red-300/30 bg-red-300/10 text-red-200">bloqueado</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {action.scopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="border-zinc-700 text-zinc-300">{scope}</Badge>
                    ))}
                  </div>
                  {action.missingEnvVars.length > 0 && (
                    <p className="mt-2 text-xs text-amber-200">Faltan: {action.missingEnvVars.join(", ")}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-600">Callback: {action.callbackPath}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <FolderOpen className="h-4 w-4 text-emerald-200" />
                Carpetas de fuentes
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {(status?.sourceFolders || []).map((folder) => (
                <div key={folder.path} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{folder.label}</p>
                    <Badge className="border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">{folder.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{folder.purpose}</p>
                  <p className="mt-2 break-all text-xs text-zinc-600">{folder.path}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {(status?.accounts || []).map((account) => {
            const progress = Math.min(Math.round((account.lastWeekViews / account.weeklyViewsGoal) * 100), 100);
            return (
              <Card key={account.id} className="border-zinc-800 bg-zinc-950/70">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-3 text-base text-white">
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-zinc-950", accountTone[account.category])}>
                      {account.category === "sports" ? <TrendingUp className="h-4 w-4" /> : account.category === "memes" ? <Flame className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{account.name}</span>
                    <Badge className={cn("border", statusBadge(account.status))}>{account.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="bg-white/10 text-zinc-200">{categoryLabels[account.category]}</Badge>
                    {account.platforms.map((platform) => (
                      <Badge key={platform} variant="outline" className="border-zinc-700 text-zinc-300">{platform}</Badge>
                    ))}
                  </div>
                  <div>
                    <div className="mb-2 flex justify-between text-xs text-zinc-500">
                      <span>{formatNumber(account.lastWeekViews)} views</span>
                      <span>{formatNumber(account.weeklyViewsGoal)} goal</span>
                    </div>
                    <Progress value={progress} className="bg-white/10 [&>div]:bg-amber-200" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md border border-white/10 bg-black/35 p-3">
                      <p className="text-xs text-zinc-500">Diario</p>
                      <p className="font-semibold">{account.dailyClipTarget} clips</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-black/35 p-3">
                      <p className="text-xs text-zinc-500">Progreso</p>
                      <p className="font-semibold">{progress}%</p>
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-zinc-500">{account.contentPolicy}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Network className="h-4 w-4 text-cyan-200" />
                Agentes y subagentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.agents || []).map((agent) => (
                <div key={agent.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-200" />
                    <p className="flex-1 font-medium">{agent.name}</p>
                    <Badge className={cn("border", statusBadge(agent.status))}>{agent.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-zinc-400">{agent.job}</p>
                  <p className="mt-1 text-xs text-zinc-600">{agent.output}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <BarChart3 className="h-4 w-4 text-amber-200" />
                Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.pipeline || []).map((item) => (
                <div key={item.stage} className="grid gap-3 rounded-md border border-white/10 bg-black/35 p-3 md:grid-cols-[1fr_100px_150px] md:items-center">
                  <div>
                    <p className="font-medium">{item.stage}</p>
                    <p className="text-xs text-zinc-500">{item.owner}</p>
                  </div>
                  <p className="text-2xl font-semibold text-white">{item.count}</p>
                  <Badge className={cn("w-fit border", statusBadge(item.status))}>{item.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <UploadCloud className="h-4 w-4 text-emerald-200" />
                Fuentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(status?.sources || []).map((source) => (
                <div key={source.id} className="rounded-md border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{source.label}</p>
                    <Badge className={cn("border", statusBadge(source.status))}>{source.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{source.type} · {source.freshness} · {source.rightsMode}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <CalendarClock className="h-4 w-4 text-cyan-200" />
                Ultimo reporte
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!report ? (
                <p className="text-sm text-zinc-500">Aun no hay reporte. Genera el primer plan diario.</p>
              ) : (
                <>
                  <div className="rounded-md border border-white/10 bg-black/35 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium">{report.summary}</p>
                        <p className="mt-1 text-xs text-zinc-500">{formatDate(report.createdAt)} · {report.publishMode} · {report.riskTolerance}</p>
                      </div>
                      <Badge variant="outline" className="w-fit border-zinc-700 text-zinc-300">{report.plannedClips.length} drafts</Badge>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-600">{report.reportPath}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {report.plannedClips.slice(0, 6).map((clip, index) => {
                      const account = accountsById[clip.accountId];
                      return (
                        <div key={`${clip.accountId}-${index}`} className="rounded-md border border-white/10 bg-black/35 p-3">
                          <div className="flex items-center gap-2">
                            <Eye className="h-4 w-4 text-amber-200" />
                            <p className="min-w-0 flex-1 truncate font-medium">{clip.title}</p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">{account?.name || clip.accountId} · {clip.publishWindow}</p>
                          <p className="mt-2 text-sm text-zinc-300">{clip.hook}</p>
                          <p className="mt-1 text-xs text-zinc-600">{clip.format}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
