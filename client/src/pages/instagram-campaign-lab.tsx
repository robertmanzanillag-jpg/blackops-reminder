import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, CheckCircle2, CopyCheck, Images, Megaphone, Plus, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type AccountProfile = {
  platform: string;
  handle: string;
  url: string;
  notes: string;
  researchStatus: string;
  likelySignals: string[];
  platformFocus: string[];
  missingEvidence: string[];
};

type CampaignStudy = {
  id: string;
  createdAt: string;
  brandName: string;
  businessType: string;
  targetAudience: string;
  goal: string;
  accounts: AccountProfile[];
  sharedPatterns: string[];
  ownableStrategy: {
    positioning: string;
    contentPillars: string[];
    visualRules: string[];
    approvalRules: string[];
  };
  platformPlans: Array<{
    platform: string;
    goal: string;
    formats: string[];
    dataToCapture: string[];
    campaignAngles: string[];
    postingRhythm: string;
  }>;
  photoDirections: Array<{ id: string; name: string; shotList: string[]; productionNotes: string[] }>;
  campaignBlueprints: Array<{ id: string; name: string; posts: string[]; reels: string[]; ctas: string[] }>;
  promptPack: Array<{ id: string; useFor: string; prompt: string }>;
  nextInputsNeeded: string[];
  safetyCheck: string[];
};

type LabSnapshot = {
  status: string;
  minimumAccounts: number;
  maxAccountsPerStudy: number;
  supportedPlatforms: string[];
  workflow: string[];
  installedStack: Array<{ name: string; status: string; useFor: string }>;
  studies: CampaignStudy[];
  latestStudy: CampaignStudy | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function parseAccounts(value: string, fallbackNotes: string) {
  const platforms = new Set(["instagram", "tiktok", "youtube", "facebook", "linkedin", "x", "pinterest", "other"]);
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const firstPart = parts[0] || "";
      const hasPlatformPrefix = platforms.has(firstPart.toLowerCase());
      const platform = hasPlatformPrefix ? firstPart.toLowerCase() : undefined;
      const rawHandle = hasPlatformPrefix ? parts[1] || "" : firstPart;
      const noteParts = hasPlatformPrefix ? parts.slice(2) : parts.slice(1);
      const url = rawHandle.startsWith("http") ? rawHandle : "";
      return {
        platform,
        handle: rawHandle,
        url,
        notes: noteParts.join(" | ") || fallbackNotes,
      };
    });
}

function statusTone(status: string) {
  if (["ready", "available", "created", "notes_supplied"].includes(status)) return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  if (["needs_manual_review", "not_detected_in_this_session"].includes(status)) return "border-amber-400/40 bg-amber-400/10 text-amber-100";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

export default function InstagramCampaignLabPage() {
  const [brandName, setBrandName] = useState("Nuestra marca");
  const [businessType, setBusinessType] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [goal, setGoal] = useState("Llevar la cuenta con una vibra inspirada por referencias, pero a nuestro modo.");
  const [accountsText, setAccountsText] = useState("@cuenta1\n@cuenta2\n@cuenta3");
  const [globalNotes, setGlobalNotes] = useState("");
  const [lastStudy, setLastStudy] = useState<CampaignStudy | null>(null);

  const { data: snapshot, isLoading } = useQuery<LabSnapshot>({
    queryKey: ["instagram-campaign-lab"],
    queryFn: async () => {
      const response = await fetch("/api/instagram-campaign-lab");
      if (!response.ok) throw new Error("Failed to load Instagram Campaign Lab");
      return response.json();
    },
  });

  const accounts = useMemo(() => parseAccounts(accountsText, globalNotes), [accountsText, globalNotes]);
  const canSubmit = brandName.trim().length > 0 && accounts.length >= 3;

  const createMutation = useMutation({
    mutationFn: () =>
      postJson<{ study: CampaignStudy }>("/api/instagram-campaign-lab/studies", {
        brandName,
        businessType,
        targetAudience,
        goal,
        accounts,
      }),
    onSuccess: (data) => {
      setLastStudy(data.study);
      queryClient.invalidateQueries({ queryKey: ["instagram-campaign-lab"] });
    },
  });

  const activeStudy = lastStudy || snapshot?.latestStudy || null;

  if (isLoading || !snapshot) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando Social Lab...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/marketing-command-center">
              <Button variant="ghost" className="mb-3 h-9 px-0 text-zinc-400 hover:bg-transparent hover:text-white">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Marketing HQ
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-fuchsia-400 text-zinc-950">
                <Camera className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold">Social Campaign Lab</h1>
                <p className="mt-1 text-sm text-zinc-400">Analiza cuentas de IG, TikTok, Shorts y otras redes para crear campanas nativas propias.</p>
              </div>
            </div>
          </div>
          <Badge variant="outline" className={cn("w-fit", statusTone(snapshot.status))}>{snapshot.status}</Badge>
        </header>

        <div className="mb-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-zinc-800 bg-zinc-900/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" />
                Nuevo estudio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="Nombre de la marca" />
                <Input value={businessType} onChange={(event) => setBusinessType(event.target.value)} placeholder="Tipo de negocio" />
              </div>
              <Input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} placeholder="Audiencia objetivo" />
              <Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} placeholder="Objetivo de la cuenta" />
              <Textarea
                value={accountsText}
                onChange={(event) => setAccountsText(event.target.value)}
                rows={6}
                placeholder={"instagram | @cuenta1 | notas opcionales\ntiktok | @cuenta2 | hooks fuertes, trends, retencion\nhttps://youtube.com/@cuenta3 | Shorts educativos"}
              />
              <Textarea
                value={globalNotes}
                onChange={(event) => setGlobalNotes(event.target.value)}
                rows={4}
                placeholder="Notas generales: estilo de fotos/videos, campanas, colores, hooks, retencion, captions o CTAs que te gustan."
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-zinc-500">{accounts.length}/{snapshot.minimumAccounts} cuentas minimas detectadas.</p>
                <Button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending} className="bg-fuchsia-600 text-white hover:bg-fuchsia-500">
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Crear analisis
                </Button>
              </div>
              {createMutation.error && <p className="text-sm text-red-300">No se pudo crear el estudio. Revisa que haya al menos 3 cuentas.</p>}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                Stack instalado
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {snapshot.installedStack.map((item) => (
                <div key={item.name} className="rounded-lg border border-zinc-800 bg-black p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-white">{item.name}</p>
                    <Badge variant="outline" className={cn("shrink-0", statusTone(item.status))}>{item.status}</Badge>
                  </div>
                  <p className="text-xs leading-5 text-zinc-400">{item.useFor}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {activeStudy ? <StudyView study={activeStudy} /> : <EmptyWorkflow snapshot={snapshot} />}
      </div>
    </div>
  );
}

function EmptyWorkflow({ snapshot }: { snapshot: LabSnapshot }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4" />
          Flujo
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-5">
        {snapshot.workflow.map((step, index) => (
          <div key={step} className="rounded-lg border border-zinc-800 bg-black p-3">
            <p className="text-xs uppercase text-zinc-500">Paso {index + 1}</p>
            <p className="mt-2 text-sm leading-5 text-zinc-300">{step}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StudyView({ study }: { study: CampaignStudy }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
      <div className="space-y-4">
        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" />
              Estrategia propia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-6 text-zinc-300">{study.ownableStrategy.positioning}</p>
            <ChipList items={study.ownableStrategy.contentPillars} />
            <InfoList title="Reglas visuales" items={study.ownableStrategy.visualRules} />
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              Plan por red
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {study.platformPlans.map((plan) => (
              <div key={plan.platform} className="rounded-lg border border-zinc-800 bg-black p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-medium capitalize text-white">{plan.platform}</p>
                  <Badge variant="outline" className="border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100">native</Badge>
                </div>
                <p className="text-xs leading-5 text-zinc-400">{plan.goal}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{plan.postingRhythm}</p>
                <ChipList items={plan.formats} />
                <InfoList title="Data" items={plan.dataToCapture} />
                <InfoList title="Angulos" items={plan.campaignAngles} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Images className="h-4 w-4" />
              Direccion de fotos
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {study.photoDirections.map((direction) => (
              <div key={direction.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                <p className="text-sm font-medium text-white">{direction.name}</p>
                <InfoList title="Shot list" items={direction.shotList} />
                <InfoList title="Produccion" items={direction.productionNotes} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CopyCheck className="h-4 w-4" />
              Prompts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {study.promptPack.map((prompt) => (
              <div key={prompt.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                <p className="text-sm font-medium text-white">{prompt.useFor}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{prompt.prompt}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" />
              Cuentas referencia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {study.accounts.map((account) => (
              <div key={account.handle} className="rounded-lg border border-zinc-800 bg-black p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-white">@{account.handle}</p>
                    <p className="mt-1 text-xs text-zinc-500">{account.url}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="border-fuchsia-400/30 bg-fuchsia-400/10 capitalize text-fuchsia-100">{account.platform}</Badge>
                    <Badge variant="outline" className={cn(statusTone(account.researchStatus))}>{account.researchStatus}</Badge>
                  </div>
                </div>
                <ChipList items={account.likelySignals} />
                <ChipList items={account.platformFocus} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" />
              Campanas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {study.campaignBlueprints.map((campaign) => (
              <div key={campaign.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                <p className="text-sm font-medium text-white">{campaign.name}</p>
                <InfoList title="Posts" items={campaign.posts} />
                <InfoList title="Reels" items={campaign.reels} />
                <ChipList items={campaign.ctas} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Safety
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InfoList title="Anti-copia" items={study.safetyCheck} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-400">{item}</span>
      ))}
    </div>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs uppercase text-zinc-500">{title}</p>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => (
          <p key={item} className="text-xs leading-5 text-zinc-400">{item}</p>
        ))}
      </div>
    </div>
  );
}
