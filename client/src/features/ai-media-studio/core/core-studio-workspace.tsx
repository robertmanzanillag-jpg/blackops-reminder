import { Database, ShieldCheck } from "lucide-react";
import { InfluencerWorkspace } from "./influencer-workspace";
import { MediaLibrary } from "./media-library";
import { HeyGenOnboardingPanel } from "./heygen-onboarding-panel";

export function CoreStudioWorkspace() {
  return (
    <div className="space-y-12">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" /><div><p className="text-sm font-medium text-zinc-100">Provider-neutral identities</p><p className="mt-1 text-xs leading-5 text-zinc-400">Kong IDs keep creator workflows independent from avatar vendors.</p></div></div>
        <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4"><Database className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" /><div><p className="text-sm font-medium text-zinc-100">Reusable assets</p><p className="mt-1 text-xs leading-5 text-zinc-400">Generated outputs remain discoverable for future productions.</p></div></div>
      </div>
      <HeyGenOnboardingPanel />
      <InfluencerWorkspace />
      <MediaLibrary />
    </div>
  );
}
