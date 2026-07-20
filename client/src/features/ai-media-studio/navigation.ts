import { Activity, Bot, Clapperboard, Gauge, Library, ListVideo, Users, type LucideIcon } from "lucide-react";

export type StudioNavItem = { href: string; label: string; icon: LucideIcon };

export const studioNavigation: StudioNavItem[] = [
  { href: "#overview", label: "Overview", icon: Gauge },
  { href: "#influencers", label: "AI influencers", icon: Users },
  { href: "#media-library", label: "Media library", icon: Library },
  { href: "#create", label: "Create video", icon: Clapperboard },
  { href: "#jobs", label: "Generation jobs", icon: ListVideo },
  { href: "#providers", label: "Provider health", icon: Bot },
  { href: "#activity", label: "Recent activity", icon: Activity },
];
