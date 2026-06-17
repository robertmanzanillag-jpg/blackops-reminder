import { useState } from "react";
import {
  ArrowLeft,
  Bot,
  Building2,
  Clapperboard,
  Code2,
  Github,
  LayoutDashboard,
  Monitor,
  Radio,
  Settings,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsPanel } from "@/components/settings-panel";

const tools = [
  {
    title: "Oficina",
    description: "Vista visual de tus agentes trabajando juntos.",
    href: "/agents-office",
    icon: Building2,
    primary: true,
  },
  {
    title: "CEO",
    description: "Prioridades, riesgos, approvals y salud general.",
    href: "/ceo",
    icon: LayoutDashboard,
    primary: true,
  },
  {
    title: "Apps",
    description: "Proyectos, estado, GitHub, alertas y checks.",
    href: "/projects",
    icon: Monitor,
    primary: true,
  },
  {
    title: "Automatizaciones",
    description: "Pausar, correr y revisar automations.",
    href: "/automations",
    icon: Bot,
  },
  {
    title: "GitHub",
    description: "Repos, archivos y cambios con aprobacion.",
    href: "/github-agent",
    icon: Github,
  },
  {
    title: "Code",
    description: "Generar cambios y revisar codigo local.",
    href: "/code-agent",
    icon: Code2,
  },
  {
    title: "Portfolio",
    description: "Inversiones, alertas y seguimiento.",
    href: "/portfolio",
    icon: TrendingUp,
  },
  {
    title: "Radio",
    description: "Flyers, DJs y calendario de Black Room.",
    href: "/radio",
    icon: Radio,
  },
  {
    title: "Promo Video",
    description: "Clips locales para fiestas, dinners, pool parties y yachts.",
    href: "/promo-video",
    icon: Clapperboard,
    primary: true,
  },
  {
    title: "Control",
    description: "Permisos, approvals y capa de confianza.",
    href: "/ceo",
    icon: ShieldCheck,
  },
];

export default function ToolsPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-white">Herramientas</h1>
              <p className="text-sm text-zinc-500">Todo lo secundario en una sola pestaña.</p>
            </div>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="text-left"
            data-testid="tool-ajustes"
          >
            <Card className="cursor-pointer border-zinc-800 bg-zinc-950/70 transition-colors hover:border-white/20">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black">
                  <Settings className="h-5 w-5 text-zinc-300" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white">Ajustes</p>
                  <p className="mt-1 text-sm text-zinc-500">Calendarios, conexiones y sala de agentes.</p>
                </div>
              </CardContent>
            </Card>
          </button>

          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link key={tool.title} href={tool.href}>
                <Card
                  className={`cursor-pointer border-zinc-800 bg-zinc-950/70 transition-colors hover:border-white/20 ${
                    tool.primary ? "bg-white/[0.04]" : ""
                  }`}
                  data-testid={`tool-${tool.title.toLowerCase()}`}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black">
                      <Icon className="h-5 w-5 text-zinc-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-white">{tool.title}</p>
                      <p className="mt-1 text-sm text-zinc-500">{tool.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
