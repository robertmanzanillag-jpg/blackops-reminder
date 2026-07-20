import { Activity, Bot, Clapperboard, Gauge, ListVideo, type LucideIcon } from "lucide-react";

export type StudioNavItem = { href: string; label: string; icon: LucideIcon };

export const studioNavigation: StudioNavItem[] = [
  { href: "#overview", label: "Overview", icon: Gauge },
  { href: "#create", label: "Create video", icon: Clapperboard },
  { href: "#jobs", label: "Generation jobs", icon: ListVideo },
  { href: "#providers", label: "Provider health", icon: Bot },
  { href: "#activity", label: "Recent activity", icon: Activity },
];
