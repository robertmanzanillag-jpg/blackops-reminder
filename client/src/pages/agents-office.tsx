import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Code2,
  X,
  Github,
  LineChart,
  MessageSquare,
  Monitor,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MonitoredProject } from "@shared/schema";

type GitHubOverview = Record<
  string,
  {
    error?: string;
    language?: string | null;
    html_url?: string;
    homepage?: string | null;
    pushed_at?: string | null;
    open_issues?: number | null;
    open_prs?: number | null;
  }
>;

const agents = [
  {
    id: "assistant",
    name: "Asistente",
    role: "Agenda y memoria",
    href: "/assistant",
    icon: Bot,
    station: "Recepcion",
    status: "Listo",
    activity: "Recibiendo solicitudes y organizando agenda",
    shortAction: "Agenda",
    mode: "working",
    color: "from-sky-400 to-cyan-300",
    outfit: "bg-sky-500",
    hair: "bg-zinc-900",
    skin: "bg-amber-200",
    position: "left-[13%] top-[31%]",
    bubblePosition: "left-[10%] top-[11%]",
  },
  {
    id: "ceo",
    name: "CEO",
    role: "Prioridades y riesgos",
    href: "/ceo",
    icon: BriefcaseBusiness,
    station: "Sala principal",
    status: "Revisando",
    activity: "Definiendo prioridades del dia",
    shortAction: "Prioridades",
    mode: "working",
    color: "from-amber-300 to-orange-400",
    outfit: "bg-amber-500",
    hair: "bg-stone-800",
    skin: "bg-orange-200",
    position: "left-[45%] top-[29%]",
    bubblePosition: "left-[38%] top-[7%]",
  },
  {
    id: "code",
    name: "Code",
    role: "Cambios locales",
    href: "/code-agent",
    icon: Code2,
    station: "Mesa tecnica",
    status: "En foco",
    activity: "Trabajando cambios y revisando codigo",
    shortAction: "Codigo",
    mode: "working",
    color: "from-emerald-300 to-teal-400",
    outfit: "bg-emerald-500",
    hair: "bg-zinc-950",
    skin: "bg-amber-100",
    position: "left-[72%] top-[31%]",
    bubblePosition: "right-[12%] top-[12%]",
  },
  {
    id: "github",
    name: "GitHub",
    role: "Repos y PRs",
    href: "/github-agent",
    icon: Github,
    station: "Control de versiones",
    status: "Sincronizando",
    activity: "Mirando PRs, ramas y checks",
    shortAction: "PRs",
    mode: "working",
    color: "from-zinc-200 to-zinc-500",
    outfit: "bg-zinc-300",
    hair: "bg-zinc-900",
    skin: "bg-orange-100",
    position: "left-[84%] top-[31%]",
    bubblePosition: "right-[18%] top-[32%]",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    role: "Inversiones",
    href: "/portfolio",
    icon: LineChart,
    station: "Pantalla de mercado",
    status: "Monitoreando",
    activity: "Analizando cartera y senales de mercado",
    shortAction: "Mercado",
    mode: "working",
    color: "from-lime-300 to-green-500",
    outfit: "bg-lime-500",
    hair: "bg-stone-700",
    skin: "bg-amber-200",
    position: "left-[15%] top-[58%]",
    bubblePosition: "left-[9%] top-[39%]",
  },
  {
    id: "radio",
    name: "Radio",
    role: "Black Room",
    href: "/radio",
    icon: Radio,
    station: "Cabina creativa",
    status: "Produciendo",
    activity: "Preparando radio, flyers y calendario creativo",
    shortAction: "Radio",
    mode: "working",
    color: "from-fuchsia-300 to-rose-400",
    outfit: "bg-rose-500",
    hair: "bg-violet-950",
    skin: "bg-orange-200",
    position: "left-[74%] top-[61%]",
    bubblePosition: "right-[9%] top-[49%]",
  },
  {
    id: "automations",
    name: "Autos",
    role: "Rutinas",
    href: "/automations",
    icon: Zap,
    station: "Rack operativo",
    status: "Vigilando",
    activity: "Esperando el proximo job programado",
    shortAction: "Rutinas",
    mode: "break",
    color: "from-violet-300 to-indigo-400",
    outfit: "bg-indigo-500",
    hair: "bg-zinc-800",
    skin: "bg-amber-100",
    position: "left-[47%] top-[61%]",
    bubblePosition: "left-[36%] top-[44%]",
  },
  {
    id: "control",
    name: "Control",
    role: "Permisos",
    href: "/tools",
    icon: ShieldCheck,
    station: "Puerta segura",
    status: "Activo",
    activity: "Revisando permisos y acciones sensibles",
    shortAction: "Permisos",
    mode: "working",
    color: "from-red-300 to-stone-300",
    outfit: "bg-red-500",
    hair: "bg-stone-900",
    skin: "bg-orange-100",
    position: "left-[82%] top-[80%]",
    bubblePosition: "right-[7%] top-[69%]",
  },
];

type Agent = (typeof agents)[number];
type AgentId = Agent["id"];
type OfficeContact = {
  id: string;
  name: string;
  role: string;
  station: string;
  status: string;
  activity: string;
  href?: string;
  icon: Agent["icon"];
  color: string;
};
type ChatMessage = {
  role: "user" | "agent";
  text: string;
};

const OFFICE_GITHUB_HANDOFF_KEY = "office.githubAgentHandoff";

const agentById = agents.reduce<Record<AgentId, Agent>>((lookup, agent) => {
  lookup[agent.id] = agent;
  return lookup;
}, {} as Record<AgentId, Agent>);

function buildAgentReply(contact: OfficeContact, message: string): string {
  const text = message.toLowerCase();
  const opener = `Estoy en ${contact.station}. `;

  if (text.includes("oficina") || text.includes("sala") || text.includes("room") || text.includes("diseno") || text.includes("diseño")) {
    if (contact.name === "CEO") {
      return `${opener}Mi opinion: la oficina debe ayudarte a decidir rapido, no distraerte. Yo la dejaria con pocos rooms claros, nombres grandes, agentes separados y un panel de chat que no tape el mapa.`;
    }
    if (contact.name === "Code") {
      return `${opener}Lo puedo resolver desde UI: reducir elementos superpuestos, ordenar posiciones, hacer labels persistentes y probar que cada click abra el chat correcto.`;
    }
    if (contact.name === "Control") {
      return `${opener}Desde control, lo importante es que no confundas roles. Si un agente no tiene trabajo real, mejor convertirlo en herramienta dentro de otro agente.`;
    }
  }

  if (contact.name === "Asistente") {
    return `${opener}Lo tomo contigo como tarea: primero aclaro que quieres lograr, luego lo convierto en pasos y te ayudo a moverlo al calendario o pendientes. Para empezar: dime fecha, prioridad y si depende de alguien.`;
  }
  if (contact.name === "CEO") {
    return `${opener}Lo miro como decision: impacto, urgencia y riesgo. Mi recomendacion inicial es separar esto en: que hay que decidir hoy, que puede esperar y que dato falta para no improvisar.`;
  }
  if (contact.name === "Code") {
    return `${opener}Lo reviso como problema tecnico.${text.includes("repo objetivo") ? " Voy a trabajar con el repo objetivo que seleccionaste, no con todos a la vez." : ""} Necesito: que pantalla falla, que esperabas, que paso realmente y si hay error visible. Con eso preparo un cambio pequeno y verificable.`;
  }
  if (contact.name === "GitHub") {
    return `${opener}Lo veo desde repos/PRs/checks.${text.includes("repo objetivo") ? " Ya tengo el repo objetivo seleccionado." : " Si hablas de un proyecto, dime cual repo o rama."} Yo revisaria estado remoto, cambios pendientes, issues y si hay CI fallando.`;
  }
  if (contact.name === "Portfolio") {
    return `${opener}Lo traduzco a lectura financiera: posicion, riesgo, noticia relevante y accion posible. Si me das ticker o captura, lo organizo como mantener, revisar o actuar.`;
  }
  if (contact.name === "Radio") {
    return `${opener}Lo manejo como Black Room: evento, calendario, flyer/media y ejecucion. Si es un evento, dime fecha, venue, assets disponibles y que falta publicar.`;
  }
  if (contact.name === "Autos") {
    return `${opener}Puedo convertir esto en una rutina. Dime cada cuanto debe correr, que condicion dispara la accion y como quieres que te avise si falla.`;
  }
  if (contact.name === "Control") {
    return `${opener}Lo reviso como permisos y riesgo. Antes de ejecutar, confirmo: que accion se hara, que datos toca, si se puede deshacer y si necesita aprobacion tuya.`;
  }
  if (contact.name === "KONG AI") {
    return `${opener}Lo tomo como chat central de Kong. Puedo coordinar venues, promoters, mesas y contexto del app. Si el problema es operativo, dime si toca eventos, mesas o usuarios.`;
  }
  if (contact.name === "Promoters + Mesas") {
    return `${opener}Lo veo como flujo de promoters/mesas. Yo separaria: quien falta confirmar, que mesa/promoter esta pendiente y que mensaje hay que mandar.`;
  }
  if (contact.name === "Venues") {
    return `${opener}Lo reviso como venues/eventos. Si quieres resolverlo bien, dime venue, fecha aproximada y si hay una fuente donde mirar eventos nuevos.`;
  }

  if (text.includes("error") || text.includes("falla") || text.includes("problema")) {
    return `${opener}Voy a tratarlo como problema: dime que paso, donde paso y que resultado esperabas. Con eso preparo el siguiente paso desde mi area.`;
  }
  return `${opener}Entendido. Desde mi rol (${contact.role}) puedo ayudarte a ordenar esto, proponer el siguiente paso y decirte que dato necesito para resolverlo.`;
}

function buildAgentGreeting(contact: OfficeContact): string {
  if (contact.name === "CEO") return "Estoy aqui. Dime que decision o problema quieres ordenar y lo bajo a prioridades.";
  if (contact.name === "Code") return "Listo. Cuentame que quieres cambiar o que esta fallando y lo reviso como trabajo de codigo.";
  if (contact.name === "GitHub") return "Estoy mirando el lado de repos, PRs y branches. Dime que repo o cambio quieres revisar.";
  if (contact.name === "Autos") return "Estoy listo para convertir algo repetitivo en una rutina o recordatorio.";
  if (contact.name === "Radio") return "Estoy en Black Room. Dime si hablamos de evento, flyer, calendario o media.";
  if (contact.name === "Control") return "Estoy aqui para revisar permisos, riesgo y acciones sensibles antes de ejecutar.";
  if (contact.name === "KONG AI") return "Estoy conectado al contexto de Kong. Dime si el tema es eventos, mesas, promoters, venues o usuarios.";
  if (contact.name === "Promoters + Mesas") return "Estoy con promoters y mesas. Dime quien falta por confirmar o que seguimiento quieres hacer.";
  if (contact.name === "Venues") return "Estoy revisando venues/eventos. Dime venue, fecha o fuente y lo organizo.";
  return `Estoy aqui como ${contact.name}. Dime que necesitas resolver en mi area.`;
}

const officeThreads: Record<AgentId, { from: AgentId; to?: AgentId; text: string }[]> = {
  assistant: [
    { from: "assistant", to: "ceo", text: "Tengo la agenda y los pendientes de Robert listos para priorizar." },
    { from: "ceo", to: "assistant", text: "Perfecto. Dame lo urgente primero y deja espacio para trabajo profundo." },
    { from: "automations", to: "assistant", text: "Yo vigilo las rutinas y te aviso si algo necesita aprobacion." },
  ],
  ceo: [
    { from: "ceo", to: "portfolio", text: "Necesito lectura rapida: riesgo, oportunidad y algo que requiera accion." },
    { from: "portfolio", to: "ceo", text: "Estoy monitoreando mercado y cartera. Te paso solo senales utiles." },
    { from: "control", to: "ceo", text: "Cualquier accion sensible pasa por permisos antes de ejecutarse." },
  ],
  code: [
    { from: "code", to: "github", text: "Tengo cambios locales. Necesito contexto de ramas y PRs antes de publicar." },
    { from: "github", to: "code", text: "Yo reviso estado remoto, checks y comentarios para que no subamos a ciegas." },
    { from: "ceo", to: "code", text: "Mantengan cambios pequenos y verificados. Nada de ruido innecesario." },
  ],
  github: [
    { from: "github", to: "code", text: "Hay que mirar checks, diff y comentarios antes de cerrar cualquier PR." },
    { from: "code", to: "github", text: "Pasame el contexto y preparo el parche con el menor alcance posible." },
    { from: "control", to: "github", text: "Push y PR siempre con confirmacion clara." },
  ],
  portfolio: [
    { from: "portfolio", to: "ceo", text: "Estoy mirando posiciones, noticias y movimientos para avisar cuando importe." },
    { from: "ceo", to: "portfolio", text: "Traducelo a decision: mantener, revisar o actuar." },
    { from: "assistant", to: "portfolio", text: "Si Robert sube una captura, extraigo activos y la conecto contigo." },
  ],
  radio: [
    { from: "radio", to: "assistant", text: "Tengo flyers, DJs y calendario creativo en la mesa." },
    { from: "assistant", to: "radio", text: "Yo te ayudo a convertir fechas y notas en tareas concretas." },
    { from: "ceo", to: "radio", text: "Que se vea bien, pero que tambien salga a tiempo." },
  ],
  automations: [
    { from: "automations", to: "control", text: "Estoy listo para correr rutinas, pero necesito permisos cuando haya impacto real." },
    { from: "control", to: "automations", text: "Correcto. Automatiza lo repetible y pausa lo riesgoso." },
    { from: "assistant", to: "automations", text: "Yo convierto instrucciones de Robert en tareas claras para ti." },
  ],
  control: [
    { from: "control", to: "ceo", text: "Yo marco limites: aprobaciones, confianza y acciones sensibles." },
    { from: "ceo", to: "control", text: "Bien. Velocidad con criterio, no piloto automatico ciego." },
    { from: "github", to: "control", text: "Te consulto antes de push, PR o cambios con efecto externo." },
  ],
};

const breakRoomThreads: { from: AgentId; text: string }[] = [
  { from: "automations", text: "Estoy en break hasta que llegue el proximo job. Idea: mostrar un timeline de rutinas activas." },
  { from: "radio", text: "Podemos mejorar el studio con previews de flyers y eventos pendientes." },
  { from: "assistant", text: "Yo puedo resumir cada area al inicio del dia: que paso, que falta y quien necesita ayuda." },
];

const githubAppTeams = [
  {
    app: "Kong",
    repo: "robertmanzanillag-jpg/kong-nightlife",
    agents: [
      { name: "KONG AI", job: "Chat central", position: "left-[55%] top-[30%]", tone: "bg-[#3fb66f]" },
      { name: "Promoters + Mesas", job: "Outreach + Monday", position: "left-[39%] top-[39%]", tone: "bg-[#f1c36a]" },
      { name: "Venues", job: "Events", position: "left-[54%] top-[39%]", tone: "bg-[#60a5fa]" },
    ],
  },
];

function OfficeDesk({ className, wide = false }: { className?: string; wide?: boolean }) {
  return (
    <div
      className={cn(
        "absolute rounded-sm border-2 border-[#0f172a] bg-[#202836] shadow-[6px_6px_0_rgba(0,0,0,0.55)]",
        wide ? "h-16 w-36" : "h-14 w-28",
        className
      )}
    >
      <div className="absolute inset-x-2 top-2 h-2 bg-[#39465b]" />
      <div className="absolute left-3 top-4 h-6 w-9 border-2 border-[#1f7a8c] bg-[#70e1f5]" />
      <div className="absolute left-5 top-10 h-1.5 w-7 bg-[#06080d]" />
      <div className="absolute bottom-3 right-3 h-2 w-12 bg-[#4b5563]" />
      <div className="absolute -bottom-3 left-4 h-4 w-2 bg-[#111827]" />
      <div className="absolute -bottom-3 right-4 h-4 w-2 bg-[#111827]" />
    </div>
  );
}

function Chair({ className }: { className?: string }) {
  return (
    <div className={cn("absolute h-8 w-7 border-2 border-[#2a2a33] bg-[#4b4b59] shadow-[4px_4px_0_rgba(0,0,0,0.25)]", className)}>
      <div className="absolute left-1/2 top-6 h-7 w-1 -translate-x-1/2 bg-[#2b2b34]" />
      <div className="absolute -bottom-2 left-1 h-1.5 w-5 bg-[#2b2b34]" />
    </div>
  );
}

function OfficePlant({ className }: { className?: string }) {
  return (
    <div className={cn("absolute h-16 w-14", className)}>
      <div className="absolute bottom-0 left-5 h-6 w-6 border-2 border-[#594433] bg-[#8b6548]" />
      <div className="absolute bottom-5 left-6 h-8 w-2 bg-[#236229]" />
      <div className="absolute bottom-8 left-2 h-6 w-7 bg-[#2fa84f]" />
      <div className="absolute bottom-11 left-6 h-7 w-7 bg-[#71c837]" />
      <div className="absolute bottom-7 left-8 h-6 w-7 bg-[#247b39]" />
    </div>
  );
}

function AreaLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("absolute border-2 border-[#334155] bg-[#020617] px-3 py-1.5 text-center font-mono text-[12px] font-bold uppercase tracking-wide text-[#c7f9ff] shadow-[3px_3px_0_rgba(0,0,0,0.45)]", className)}>
      {children}
    </div>
  );
}

function Cubicle({
  className,
  label,
  tone = "bg-[#111827]/82",
}: {
  className?: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className={cn("absolute border-[7px] border-[#475569] shadow-[8px_8px_0_rgba(0,0,0,0.38)]", tone, className)}>
      <AreaLabel className="-top-4 left-4 right-4 z-[60] truncate">{label}</AreaLabel>
      <div className="absolute inset-x-5 bottom-5 h-2 bg-[#64748b]" />
      <div className="absolute right-5 top-16 h-16 w-2 bg-[#64748b]" />
    </div>
  );
}

function Workstation({ className, wide = false }: { className?: string; wide?: boolean }) {
  return (
    <div className={cn("absolute", className)}>
      <OfficeDesk wide={wide} />
      <Chair className={wide ? "left-[62px] top-[62px]" : "left-[48px] top-[58px]"} />
    </div>
  );
}

function BreakRoom({ className }: { className?: string }) {
  return (
    <div className={cn("absolute border-4 border-[#334155] bg-[#0f172a]", className)}>
      <div className="absolute left-5 top-8 h-16 w-28 border-2 border-[#020617] bg-[#1f2937] shadow-[4px_4px_0_rgba(0,0,0,0.45)]" />
      <div className="absolute left-8 top-11 h-5 w-5 rounded-full bg-[#e5e7eb]" />
      <div className="absolute left-16 top-13 h-3 w-8 bg-[#84cc16]" />
      <div className="absolute right-6 top-7 h-20 w-10 border-2 border-[#475569] bg-[#111827]" />
      <div className="absolute right-8 top-11 h-3 w-6 bg-[#70e1f5]" />
      <div className="absolute left-8 bottom-5 h-9 w-16 border-2 border-[#353544] bg-[#5c5c6b]" />
      <div className="absolute left-28 bottom-5 h-9 w-16 border-2 border-[#353544] bg-[#5c5c6b]" />
    </div>
  );
}

function AgentPerson({
  agent,
  selected,
  onSelect,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: (agent: Agent) => void;
}) {
  const Icon = agent.icon;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(agent)}
      className={cn(
        "absolute z-30 flex h-32 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center",
        agent.position
      )}
      animate={{ y: selected ? [0, -4, 0] : [0, -2, 0] }}
      transition={{ duration: selected ? 2 : 3.4, repeat: Infinity, ease: "easeInOut" }}
      aria-label={`Ver agente ${agent.name}`}
      data-testid={`agent-avatar-${agent.id}`}
    >
      <span className="absolute bottom-2 h-5 w-14 rounded-full bg-black/35 blur-sm" />
      <span className="relative flex h-24 w-16 flex-col items-center [image-rendering:pixelated]">
        <span className={cn("absolute top-0 h-9 w-9 border-2 border-[#4a2e22]", agent.skin)}>
          <span className={cn("absolute -top-1 left-0 h-4 w-9", agent.hair)} />
          <span className={cn("absolute -left-1 top-2 h-5 w-2", agent.hair)} />
          <span className={cn("absolute -right-1 top-2 h-5 w-2", agent.hair)} />
          <span className="absolute left-2 top-5 h-1.5 w-1.5 bg-zinc-900" />
          <span className="absolute right-2 top-5 h-1.5 w-1.5 bg-zinc-900" />
          <span className="absolute left-1/2 top-7 h-1 w-3 -translate-x-1/2 bg-rose-700/70" />
        </span>
        <span
          className={cn(
            "absolute top-9 h-11 w-11 border-2 border-[#2a2a33] shadow-[3px_3px_0_rgba(0,0,0,0.22)]",
            agent.outfit,
            selected && "ring-2 ring-white"
          )}
        >
          <span className="absolute -left-3 top-2 h-8 w-3 border-2 border-[#2a2a33] bg-inherit" />
          <span className="absolute -right-3 top-2 h-8 w-3 border-2 border-[#2a2a33] bg-inherit" />
          <span className={cn("absolute left-1/2 top-2 flex h-7 w-7 -translate-x-1/2 items-center justify-center border-2 border-[#2a2a33] bg-gradient-to-br text-zinc-950", agent.color)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </span>
        <span className="absolute top-[76px] left-4 h-7 w-3 bg-zinc-950" />
        <span className="absolute top-[76px] right-4 h-7 w-3 bg-zinc-950" />
        <span className="absolute top-[100px] left-2 h-2 w-6 bg-black" />
        <span className="absolute top-[100px] right-2 h-2 w-6 bg-black" />
      </span>
      <span className={cn("mt-1 max-w-24 truncate border px-2 py-0.5 font-mono text-[10px] font-bold shadow-[2px_2px_0_rgba(0,0,0,0.3)]", selected ? "border-cyan-100 bg-cyan-100 text-zinc-950" : "border-[#334155] bg-[#020617] text-white")}>
        {agent.name}
      </span>
    </motion.button>
  );
}

function AppAgentSprite({
  name,
  repo,
  status,
  position,
  connected,
}: {
  name: string;
  repo?: string | null;
  status?: string;
  position: string;
  connected: boolean;
}) {
  return (
    <Link href="/projects">
      <motion.button
        type="button"
        className={cn("absolute z-40 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center", position)}
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        data-testid={`app-agent-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        aria-label={`Abrir app agent ${name}`}
      >
        <span className="mb-1 border-2 border-[#4d3424] bg-[#fff4d6] px-2 py-1 font-mono text-[10px] font-bold text-[#2d2018] shadow-[3px_3px_0_rgba(0,0,0,0.28)]">
          {connected ? "App activa" : "Conectar app"}
        </span>
        <span className="relative h-20 w-16 [image-rendering:pixelated]">
          <span className="absolute left-3 top-0 h-8 w-10 border-2 border-[#2a2a33] bg-[#6b7280]" />
          <span className="absolute left-5 top-2 h-4 w-6 bg-[#9ee7f0]" />
          <span
            className={cn(
              "absolute left-2 top-8 h-10 w-12 border-2 border-[#2a2a33]",
              connected ? "bg-[#3fb66f]" : "bg-[#7a7f8f]"
            )}
          >
            <Monitor className="absolute left-1/2 top-2 h-5 w-5 -translate-x-1/2 text-[#1d241f]" />
          </span>
          <span className="absolute left-3 top-[66px] h-2 w-5 bg-black" />
          <span className="absolute right-3 top-[66px] h-2 w-5 bg-black" />
        </span>
        <span className="mt-1 max-w-24 truncate border border-[#2d2018] bg-[#4b3728] px-2 py-0.5 font-mono text-[10px] font-bold text-white shadow-[2px_2px_0_rgba(0,0,0,0.3)]">
          {name}
        </span>
        <span
          className={cn(
            "mt-1 border px-1.5 py-0.5 font-mono text-[9px] shadow-[2px_2px_0_rgba(0,0,0,0.25)]",
            status === "online" && "border-[#214b35] bg-[#62b36c] text-[#102915]",
            status === "github" && "border-[#214b35] bg-[#62b36c] text-[#102915]",
            status === "offline" && "border-[#6b2727] bg-[#ef6f6f] text-[#321111]",
            status === "degraded" && "border-[#7a522a] bg-[#f1c36a] text-[#3a2516]",
            (!status || status === "unknown") && "border-[#4b5360] bg-[#cbd5e1] text-[#1f2937]"
          )}
        >
          {connected ? status || "unknown" : "pendiente"}
        </span>
        {repo && <span className="mt-1 max-w-28 truncate text-[9px] text-[#2d2018]">{repo}</span>}
      </motion.button>
    </Link>
  );
}

function GitHubTeamAgent({
  name,
  job,
  repo,
  position,
  tone,
  onSelect,
}: {
  name: string;
  job: string;
  repo: string;
  position: string;
  tone: string;
  onSelect: () => void;
}) {
  return (
      <motion.button
        type="button"
        onClick={onSelect}
        className={cn("absolute z-40 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center", position)}
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        aria-label={`${name} en ${repo}`}
        data-testid={`github-team-agent-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
        <span className="relative h-16 w-14 [image-rendering:pixelated]">
          <span className="absolute left-3 top-0 h-7 w-8 border-2 border-[#2a2a33] bg-[#f2c49b]" />
          <span className="absolute left-3 -top-1 h-3 w-8 bg-[#2d2018]" />
          <span className={cn("absolute left-1 top-7 h-8 w-12 border-2 border-[#2a2a33]", tone)}>
            <Github className="absolute left-1/2 top-1.5 h-4 w-4 -translate-x-1/2 text-[#1d241f]" />
          </span>
          <span className="absolute left-3 top-[58px] h-2 w-4 bg-black" />
          <span className="absolute right-3 top-[58px] h-2 w-4 bg-black" />
        </span>
        <span className="mt-1 max-w-28 truncate border border-[#334155] bg-[#020617] px-2 py-0.5 font-mono text-[9px] font-bold text-white shadow-[2px_2px_0_rgba(0,0,0,0.45)]">
          {name}
        </span>
      </motion.button>
  );
}

export default function AgentsOfficePage() {
  const [selectedAgent, setSelectedAgent] = useState<Agent>(agents[0]);
  const [selectedContact, setSelectedContact] = useState<OfficeContact | null>(null);
  const [activeChatContact, setActiveChatContact] = useState<OfficeContact | null>(null);
  const [agentChats, setAgentChats] = useState<Record<string, ChatMessage[]>>({});
  const [directMessage, setDirectMessage] = useState("");
  const [targetRepo, setTargetRepo] = useState("workspace");
  const [lastRemoteTask, setLastRemoteTask] = useState("");
  const [sentMessages, setSentMessages] = useState<{ to: string; text: string }[]>([]);
  const [visibleNotes, setVisibleNotes] = useState({
    chat: true,
    reply: true,
    break: true,
  });
  const { data: projects = [] } = useQuery<MonitoredProject[]>({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then((response) => response.json()),
    refetchInterval: 30000,
  });
  const { data: githubOverview = {} } = useQuery<GitHubOverview>({
    queryKey: ["projects-github-overview", projects.map((project) => project.githubRepo).filter(Boolean).join(",")],
    queryFn: () => fetch("/api/projects/github-overview").then((response) => response.json()),
    enabled: projects.some((project) => project.githubRepo),
    retry: false,
    refetchInterval: 60000,
  });
  const conversation = officeThreads[selectedAgent.id];
  const activeIndex = useMemo(
    () => agents.findIndex((agent) => agent.id === selectedAgent.id) + 1,
    [selectedAgent]
  );
  const SelectedIcon = selectedAgent.icon;
  const connectedProjects = useMemo(() => {
    const projectText = (project: MonitoredProject) =>
      `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
    const featured = projects.filter((project) => {
      const text = projectText(project);
      return text.includes("kong") || text.includes("black room") || text.includes("blackroom");
    });
    const rest = projects.filter((project) => !featured.some((item) => item.id === project.id));
    return [...featured, ...rest].slice(0, 6);
  }, [projects]);
  const kongProject = connectedProjects.find((project) => {
    const text = `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
    return text.includes("kong");
  });
  const blackRoomProject = connectedProjects.find((project) => {
    const text = `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
    return text.includes("black room") || text.includes("blackroom");
  });
  const appAgentPositions = ["left-[41%] top-[82%]", "left-[50%] top-[82%]", "left-[55%] top-[82%]", "left-[46%] top-[82%]"];
  const appAgents = useMemo(() => {
    return connectedProjects
      .filter((project) => project.id !== kongProject?.id && project.id !== blackRoomProject?.id)
      .slice(0, 4)
      .map((project) => ({
        key: project.id,
        name: project.name,
        repo: project.githubRepo,
        status: project.status,
        connected: true,
      }));
  }, [blackRoomProject, connectedProjects, kongProject]);
  const totalVisibleAgents = agents.length + githubAppTeams.reduce((sum, team) => sum + team.agents.length, 0) + appAgents.length;
  const repoTargets = useMemo(() => {
    const remoteRepos = connectedProjects
      .filter((project) => project.githubRepo)
      .map((project) => ({
        id: project.githubRepo!,
        label: project.name,
        repo: project.githubRepo!,
      }));
    const fallbackRepos = [
      { id: "robertmanzanillag-jpg/kong-nightlife", label: "Kong", repo: "robertmanzanillag-jpg/kong-nightlife" },
      { id: "robertmanzanillag-jpg/br-website", label: "Black Room", repo: "robertmanzanillag-jpg/br-website" },
    ].filter((fallback) => !remoteRepos.some((repo) => repo.id === fallback.id));

    return [{ id: "workspace", label: "Este app", repo: "local workspace" }, ...remoteRepos, ...fallbackRepos];
  }, [connectedProjects]);
  const selectedTarget = repoTargets.find((item) => item.id === targetRepo) || repoTargets[0];
  const contact = selectedContact || {
    id: selectedAgent.id,
    name: selectedAgent.name,
    role: selectedAgent.role,
    station: selectedAgent.station,
    status: selectedAgent.status,
    activity: selectedAgent.activity,
    href: selectedAgent.href,
    icon: selectedAgent.icon,
    color: selectedAgent.color,
  };
  const ContactIcon = contact.icon;
  const activeMessages = agentChats[contact.id] || [];
  const isChatOpen = activeChatContact?.id === contact.id;
  const openContactChat = (nextContact: OfficeContact) => {
    setSelectedContact(nextContact);
    setActiveChatContact(nextContact);
    setAgentChats((current) => {
      if (current[nextContact.id]?.length) return current;
      return {
        ...current,
        [nextContact.id]: [{ role: "agent", text: buildAgentGreeting(nextContact) }],
      };
    });
    setDirectMessage("");
  };
  const handleSendDirectMessage = () => {
    const text = directMessage.trim();
    if (!text) return;
    const repoContext =
      (contact.name === "Code" || contact.name === "GitHub") && selectedTarget
        ? `\n\nRepo objetivo: ${selectedTarget.label} (${selectedTarget.repo}).`
        : "";
    const reply = buildAgentReply(contact, `${text}${repoContext}`);
    if ((contact.name === "Code" || contact.name === "GitHub") && targetRepo !== "workspace") {
      setLastRemoteTask(text);
      window.localStorage.setItem(
        OFFICE_GITHUB_HANDOFF_KEY,
        JSON.stringify({
          repo: selectedTarget.repo,
          app: selectedTarget.label,
          agent: contact.name,
          task: text,
          createdAt: new Date().toISOString(),
        })
      );
    }
    setActiveChatContact(contact);
    setSelectedContact(contact);
    setAgentChats((current) => ({
      ...current,
      [contact.id]: [
        ...(current[contact.id] || []),
        { role: "user", text: repoContext ? `${text}\n${repoContext.trim()}` : text },
        { role: "agent", text: reply },
      ],
    }));
    setSentMessages((current) => [{ to: contact.name, text }, ...current].slice(0, 3));
    setDirectMessage("");
  };
  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    openContactChat({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      station: agent.station,
      status: agent.status,
      activity: agent.activity,
      href: agent.href,
      icon: agent.icon,
      color: agent.color,
    });
  };
  const openHref =
    (contact.name === "Code" || contact.name === "GitHub") && targetRepo !== "workspace"
      ? `/github-agent?repo=${encodeURIComponent(targetRepo)}${lastRemoteTask ? `&task=${encodeURIComponent(lastRemoteTask)}` : ""}`
      : contact.href;
  const handleSelectTeamAgent = (team: (typeof githubAppTeams)[number], agent: (typeof githubAppTeams)[number]["agents"][number]) => {
    const activityByName: Record<string, string> = {
      "KONG AI": "Chat central de Kong: recibe preguntas, usa herramientas internas y coordina informacion de eventos, mesas, promoters y venues.",
      "Promoters + Mesas": "Gestiona el flujo comercial de Kong: outreach a promoters, seguimiento de mesas y recordatorios de lunes.",
      Venues: "Busca, revisa e importa eventos de venues para mantener Kong actualizado.",
    };
    openContactChat({
      id: `${team.app}-${agent.name}`,
      name: agent.name,
      role: agent.job,
      station: team.app,
      status: "Conectado",
      activity: activityByName[agent.name] || `Trabaja en ${team.app} conectado al repo ${team.repo}.`,
      href: "/projects",
      icon: Github,
      color: "from-cyan-300 to-lime-300",
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 px-4 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-white md:text-2xl">Oficina de agentes</h1>
              <p className="truncate text-sm text-zinc-500">{totalVisibleAgents} agentes visibles en vivo</p>
            </div>
          </div>

          <Link href={selectedAgent.href}>
            <Button className="h-10 rounded-full bg-zinc-100 px-4 text-zinc-950 hover:bg-white" data-testid="button-open-selected-agent">
              <SelectedIcon className="mr-2 h-4 w-4" />
              Abrir {selectedAgent.name}
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1780px] space-y-5 px-4 py-5 md:px-8">
        <section className="relative h-[calc(100vh-150px)] min-h-[720px] overflow-hidden rounded-lg border border-white/10 bg-[#05070b] shadow-2xl shadow-black/40">
          <div className="relative h-full min-h-[620px] w-full">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:48px_48px]" />
          <div className="absolute left-[2.5%] top-[4%] h-[92%] w-[95%] border-[14px] border-[#1e293b] bg-[#070b12] shadow-[14px_14px_0_rgba(0,0,0,0.55)]" />
          <div className="absolute left-[4%] top-[7%] h-[86%] w-[92%] bg-[radial-gradient(circle_at_18%_18%,rgba(20,184,166,0.12),transparent_26%),repeating-linear-gradient(0deg,#0b111d_0_24px,#101827_24px_48px)]" />

          <Cubicle className="left-[6%] top-[14%] h-[230px] w-[23%]" label="Recepcion" tone="bg-[#101827]/92" />
          <Cubicle className="left-[34%] top-[14%] h-[300px] w-[27%]" label="Kong room" tone="bg-[#111827]/94" />
          <Cubicle className="right-[6%] top-[14%] h-[260px] w-[31%]" label="Dev room" tone="bg-[#0f172a]/94" />
          <Cubicle className="left-[6%] top-[48%] h-[235px] w-[23%]" label="Finance" tone="bg-[#111827]/92" />
          <Cubicle className="left-[34%] top-[48%] h-[235px] w-[27%]" label="Ops room" tone="bg-[#0f172a]/92" />
          <Cubicle className="right-[6%] top-[48%] h-[235px] w-[31%]" label="Radio / Black Room" tone="bg-[#111827]/94" />
          <Cubicle className="left-[6%] bottom-[6%] h-[170px] w-[27%]" label="Break room" tone="bg-[#101827]/92" />
          <Cubicle className="right-[6%] bottom-[6%] h-[170px] w-[31%]" label="Security / Control" tone="bg-[#111827]/94" />

          <Workstation className="left-[13%] top-[36%]" wide />
          <Workstation className="left-[44%] top-[34%]" wide />
          <Workstation className="left-[55%] top-[34%]" wide />
          <Workstation className="left-[72%] top-[36%]" wide />
          <Workstation className="left-[84%] top-[36%]" wide />
          <Workstation className="left-[15%] top-[66%]" wide />
          <Workstation className="left-[47%] top-[68%]" wide />
          <Workstation className="left-[75%] top-[68%]" wide />
          <BreakRoom className="left-[11%] bottom-[9%] h-[120px] w-[230px]" />

          <OfficePlant className="left-[30%] top-[42%]" />
          <OfficePlant className="left-[61%] top-[42%]" />
          <OfficePlant className="right-[5%] top-[75%]" />

          <div className="absolute left-[44%] top-[6%] flex items-center gap-2 border-2 border-[#334155] bg-[#020617] px-4 py-2 font-mono text-sm font-bold text-[#c7f9ff] shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
            <Sparkles className="h-4 w-4 text-cyan-200" />
            AI Office Room
          </div>

          {agents.map((agent) => (
            <AgentPerson
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedAgent.id}
              onSelect={handleSelectAgent}
            />
          ))}

          {appAgents.map((appAgent, index) => (
            <AppAgentSprite
              key={appAgent.key}
              name={appAgent.name}
              repo={appAgent.repo}
              status={appAgent.status}
              connected={appAgent.connected}
              position={appAgentPositions[index] || "left-[82%] bottom-[17%]"}
            />
          ))}

          {githubAppTeams.flatMap((team) =>
            team.agents.map((agent) => (
              <GitHubTeamAgent
                key={`${team.app}-${agent.name}`}
                name={agent.name}
                job={agent.job}
                repo={team.repo}
                position={agent.position}
                tone={agent.tone}
                onSelect={() => handleSelectTeamAgent(team, agent)}
              />
            ))
          )}
          {selectedContact && (
            <div className="absolute right-6 top-6 z-[70] w-[360px] rounded-lg border border-cyan-200/25 bg-zinc-950/95 p-4 text-white shadow-2xl shadow-black/60 backdrop-blur">
              <button
                type="button"
                onClick={() => setSelectedContact(null)}
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10 hover:text-white"
                aria-label="Cerrar ficha de agente"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-start gap-3 pr-8">
                <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", contact.color)}>
                  <ContactIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-cyan-200">Agente seleccionado</p>
                  <h2 className="mt-1 truncate text-xl font-semibold">{contact.name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{contact.role}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Area</p>
                  <p className="mt-1 text-sm font-medium">{contact.station}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Estado</p>
                  <p className="mt-1 text-sm font-medium">{contact.status}</p>
                </div>
              </div>
              <div className="mt-2 rounded-md border border-white/10 bg-black/35 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Que hace</p>
                <p className="mt-1 text-sm leading-5 text-zinc-200">{contact.activity}</p>
              </div>
              {(contact.name === "Code" || contact.name === "GitHub") && (
                <div className="mt-2 rounded-md border border-cyan-200/15 bg-cyan-950/15 p-3">
                  <label className="text-[10px] uppercase tracking-wide text-cyan-200" htmlFor="office-target-repo">
                    App / repo objetivo
                  </label>
                  <select
                    id="office-target-repo"
                    value={targetRepo}
                    onChange={(event) => setTargetRepo(event.target.value)}
                    className="mt-2 h-9 w-full rounded-md border border-white/10 bg-black px-2 text-sm text-white focus:border-cyan-200/50 focus:outline-none"
                    data-testid="select-office-target-repo"
                  >
                    {repoTargets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label} - {item.repo}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-4 text-zinc-400">
                    {targetRepo === "workspace"
                      ? "Code aplica cambios en este app local con vista previa y aprobacion."
                      : "Para apps de GitHub, abre GitHub Agent con ese repo y crea cambios/commit con aprobacion."}
                  </p>
                </div>
              )}
              {isChatOpen && (
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-md border border-cyan-200/15 bg-black/40 p-3">
                  {activeMessages.map((message, index) => (
                    <div
                      key={`${contact.id}-${index}-${message.role}`}
                      className={cn(
                        "rounded-md px-3 py-2 text-sm leading-5",
                        message.role === "user"
                          ? "ml-8 bg-cyan-300/15 text-cyan-50"
                          : "mr-8 bg-white/[0.07] text-zinc-200"
                      )}
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                        {message.role === "user" ? "Tu" : contact.name}
                      </p>
                      {message.text}
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={directMessage}
                onChange={(event) => setDirectMessage(event.target.value)}
                placeholder={isChatOpen ? `Seguir hablando con ${contact.name}` : `Escribirle a ${contact.name}`}
                className="mt-3 min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/45 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-200/40 focus:outline-none"
                data-testid="textarea-office-agent-popup-message"
              />
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={handleSendDirectMessage}
                  className="h-10 flex-1 rounded-full bg-zinc-100 text-zinc-950 hover:bg-white"
                  data-testid="button-office-agent-popup-send"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {isChatOpen ? "Responder" : "Abrir chat"}
                </Button>
                {openHref && (
                  <Link href={openHref}>
                    <Button type="button" variant="outline" className="h-10 rounded-full border-white/10 bg-black/40 px-4 text-white hover:bg-white/10">
                      Abrir
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)_420px]">
          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-5">
            <div className="flex items-start gap-4">
              <div className={cn("flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br text-zinc-950", selectedAgent.color)}>
                <SelectedIcon className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Agente {activeIndex}</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">{selectedAgent.name}</h2>
                <p className="mt-1 text-sm text-zinc-400">{selectedAgent.role}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Estacion</p>
                <p className="mt-1 text-sm font-medium text-white">{selectedAgent.station}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Estado</p>
                <p className="mt-1 text-sm font-medium text-white">{selectedAgent.status}</p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-white/10 bg-black/35 p-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Funcion actual</p>
              <p className="mt-1 text-sm font-medium text-white">{selectedAgent.activity}</p>
            </div>

            <Link href={selectedAgent.href}>
              <Button className="mt-5 h-11 w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-white">
                <SelectedIcon className="mr-2 h-4 w-4" />
                Entrar a {selectedAgent.name}
              </Button>
            </Link>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-zinc-300">Notas de la oficina</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-zinc-500">
                Se pueden cerrar
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {visibleNotes.chat && (
                <div className="relative rounded-lg border border-amber-200/30 bg-amber-100 p-4 pr-10 text-[#2d2018]">
                  <button
                    type="button"
                    onClick={() => setVisibleNotes((notes) => ({ ...notes, chat: false }))}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-[#4d3424] bg-[#f1c36a] text-[#2d2018] hover:bg-[#ffd98b]"
                    aria-label="Cerrar chat interno"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-[#7a522a]">Chat interno</p>
                  <p className="mt-2 text-sm font-medium leading-5">{conversation[0].text}</p>
                </div>
              )}
              {visibleNotes.reply && (
                <div className="relative rounded-lg border border-amber-200/30 bg-amber-100 p-4 pr-10 text-[#2d2018]">
                  <button
                    type="button"
                    onClick={() => setVisibleNotes((notes) => ({ ...notes, reply: false }))}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-[#4d3424] bg-[#f1c36a] text-[#2d2018] hover:bg-[#ffd98b]"
                    aria-label="Cerrar respuesta"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-[#7a522a]">
                    {agentById[conversation[1].from].name} responde
                  </p>
                  <p className="mt-2 text-sm font-medium leading-5">{conversation[1].text}</p>
                </div>
              )}
              {visibleNotes.break && (
                <div className="relative rounded-lg border border-amber-200/30 bg-amber-100 p-4 pr-10 text-[#2d2018]">
                  <button
                    type="button"
                    onClick={() => setVisibleNotes((notes) => ({ ...notes, break: false }))}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-[#4d3424] bg-[#f1c36a] text-[#2d2018] hover:bg-[#ffd98b]"
                    aria-label="Cerrar break room"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-[#7a522a]">Break room catch-up</p>
                  <div className="mt-2 space-y-2">
                    {breakRoomThreads.map((item) => (
                      <p key={`${item.from}-${item.text}`} className="text-xs font-medium leading-4">
                        <span className="font-bold">{agentById[item.from].name}:</span> {item.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-lime-200" />
                <p className="text-sm font-medium text-zinc-300">Apps conectadas</p>
              </div>
              <Link href="/projects">
                <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs text-zinc-400 hover:text-white">
                  Ver Apps
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-lime-300/20 bg-lime-950/20 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Kong</p>
                <p className="mt-1 truncate text-sm font-medium text-white">{kongProject?.name || "kong-nightlife"}</p>
                <p className="mt-1 text-xs text-lime-200">GitHub detectado</p>
              </div>
              <div className="rounded-lg border border-rose-300/20 bg-rose-950/20 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Black Room</p>
                <p className="mt-1 truncate text-sm font-medium text-white">{blackRoomProject?.name || "br-website"}</p>
                <p className="mt-1 text-xs text-rose-200">GitHub detectado</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {connectedProjects.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 bg-black/30 p-3 text-sm text-zinc-500">
                  Importa tus repos desde Apps para que esta oficina vea Kong, Black Room y el resto de proyectos.
                </p>
              ) : (
                connectedProjects.map((project) => {
                  const overview = project.githubRepo ? githubOverview[project.githubRepo] : undefined;
                  return (
                    <div key={project.id} className="rounded-lg border border-white/10 bg-black/35 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{project.name}</p>
                          <p className="mt-1 truncate text-xs text-zinc-500">{project.githubRepo || project.url}</p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            project.status === "online" && "bg-emerald-500/15 text-emerald-200",
                            project.status === "offline" && "bg-red-500/15 text-red-200",
                            project.status === "degraded" && "bg-amber-500/15 text-amber-200",
                            project.status === "unknown" && "bg-zinc-500/15 text-zinc-300"
                          )}
                        >
                          {project.status}
                        </span>
                      </div>
                      {project.githubRepo && (
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                          <span className="inline-flex items-center gap-1">
                            <Github className="h-3 w-3" />
                            {overview?.language || "GitHub"}
                          </span>
                          {typeof overview?.open_prs === "number" && <span>{overview.open_prs} PRs</span>}
                          {typeof overview?.open_issues === "number" && <span>{overview.open_issues} issues</span>}
                          {overview?.pushed_at && <span>push {new Date(overview.pushed_at).toLocaleDateString("es-ES")}</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Send className="h-4 w-4 text-cyan-200" />
              <p className="text-sm font-medium text-zinc-300">Escribir directo</p>
            </div>
            <textarea
              value={directMessage}
              onChange={(event) => setDirectMessage(event.target.value)}
              placeholder={`Mensaje para ${contact.name}`}
              className="min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              data-testid="textarea-direct-agent-message"
            />
            <Button
              type="button"
              onClick={handleSendDirectMessage}
              className="mt-3 h-10 w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-white"
              data-testid="button-send-direct-agent-message"
            >
              <Send className="mr-2 h-4 w-4" />
              Enviar a {contact.name}
            </Button>
            {sentMessages.length > 0 && (
              <div className="mt-3 space-y-2">
                {sentMessages.map((message, index) => (
                  <div key={`${message.to}-${message.text}-${index}`} className="rounded-md border border-white/10 bg-black/35 p-2 text-xs text-zinc-300">
                    <span className="font-medium text-white">{message.to}:</span> {message.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-zinc-300">Conversacion</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-zinc-500">
                {agents.length} agentes
              </span>
            </div>

            <div className="space-y-3">
              {conversation.map((message, index) => {
                const SpeakerIcon = agentById[message.from].icon;
                return (
                  <div
                    key={`${message.from}-${index}`}
                    className="rounded-lg border border-white/10 bg-black/35 p-3"
                    data-testid={`agent-message-${index}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", agentById[message.from].color)}>
                        <SpeakerIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{agentById[message.from].name}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {message.to ? `para ${agentById[message.to].name}` : "en la oficina"}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm leading-5 text-zinc-300">{message.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <p className="mb-3 text-sm font-medium text-zinc-300">Directorio</p>
            <div className="space-y-2">
              {agents.map((agent) => {
                const Icon = agent.icon;
                const active = agent.id === selectedAgent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgent(agent)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
                      active ? "border-white/25 bg-white/10" : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                    )}
                    data-testid={`button-select-agent-${agent.id}`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-zinc-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{agent.name}</span>
                      <span className="block truncate text-xs text-zinc-500">{agent.activity}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
