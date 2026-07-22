import { Activity, BarChart3, Bot, Gauge, Library, ListChecks, ListVideo, Send, ShieldCheck, Users, Workflow, type LucideIcon } from "lucide-react";

export type StudioNavItem = { href: string; label: string; icon: LucideIcon };

export const studioNavigation: StudioNavItem[] = [
  { href: "#overview", label: "Overview", icon: Gauge },
  { href: "#influencers", label: "AI influencers", icon: Users },
  { href: "#media-library", label: "Media library", icon: Library },
  { href: "#production-batch", label: "Production batch", icon: ListChecks },
  { href: "#jobs", label: "Generation jobs", icon: ListVideo },
  { href: "#publishing", label: "Publishing", icon: Send },
  { href: "#analytics", label: "Analytics", icon: BarChart3 },
  { href: "#automation", label: "Automation", icon: Workflow },
  { href: "#providers", label: "Provider configuration", icon: Bot },
  { href: "#activity", label: "Recent activity", icon: Activity },
  { href: "/ai-media-studio-agent", label: "Media Agent", icon: ShieldCheck },
];
