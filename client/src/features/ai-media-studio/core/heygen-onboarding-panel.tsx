import { CheckCircle2, CircleAlert, LockKeyhole, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHeyGenOnboardingReadiness } from "./hooks";
import { HeyGenRosterSetup } from "./heygen-roster-setup";
import type { HeyGenOnboardingReadiness } from "@shared/ai-media-studio-heygen-onboarding";

const statusLabels: Record<HeyGenOnboardingReadiness["status"], string> = {
  awaiting_secure_credential: "Secure credential handoff required",
  credential_metadata_attention: "Credential metadata needs attention",
  account_ambiguous: "Choose one provider account",
  ready_for_roster_ids: "Ready for avatar and voice IDs",
  roster_configured_blocked: "Roster configured; launch remains blocked",
  stale_roster_binding: "Roster binding needs replacement",
  unavailable: "Readiness unavailable",
};

const stepLabels: Record<HeyGenOnboardingReadiness["steps"][number]["id"], string> = {
  secure_credential_handoff: "Secure credential handoff",
  unique_account_metadata: "Unique account metadata",
  roster_mapping: "Avatar and voice roster",
  blocked_plan_materialization: "Blocked production plan",
  external_sandbox_requirements: "External sandbox requirements",
};

const stepStateLabels: Record<HeyGenOnboardingReadiness["steps"][number]["state"], string> = {
  complete: "Prepared",
  action_required: "Action required",
  blocked: "Blocked",
  unavailable: "Unavailable",
};

function ReadinessPanel({ readiness, refreshing, onRefresh }: {
  readiness: HeyGenOnboardingReadiness;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const metadataPrepared = readiness.secretHandling.channelState === "configured";
  return (
    <section aria-labelledby="heygen-onboarding-heading" className="rounded-2xl border border-sky-300/15 bg-sky-400/[0.035] p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Secure HeyGen onboarding · read-only</p>
          <h2 id="heygen-onboarding-heading" className="mt-2 text-2xl font-semibold text-white">Prepare the provider connection</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">Kong checks safe server-side metadata before accepting provider IDs. API keys, secrets, and tokens are never entered or read in this browser.</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0 border-white/15 bg-white/5 text-zinc-100" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh readiness"}
        </Button>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-start gap-3">
          {readiness.status === "ready_for_roster_ids" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />}
          <div><p className="font-semibold text-white">{statusLabels[readiness.status]}</p><p className="mt-1 text-xs leading-5 text-zinc-400">Observed {new Date(readiness.observedAt).toLocaleString()} from private read-only persistence.</p></div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" aria-hidden="true" /><div><h3 className="font-semibold text-white">Deployment secret manager only</h3><p className="mt-1 text-sm leading-6 text-zinc-300">{metadataPrepared ? "Secret reference metadata is prepared. The key value was not observed and has not been live-verified." : "A deployment secret channel has not been selected. Add the key outside this browser, then refresh."}</p></div></div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3"><dt className="text-zinc-400">Launch target</dt><dd className="mt-1 text-lg font-semibold text-white">{readiness.target.minAvatars}–{readiness.target.maxAvatars} avatars</dd></div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3"><dt className="text-zinc-400">Initial plan</dt><dd className="mt-1 text-lg font-semibold text-white">{readiness.target.minVideos}–{readiness.target.maxVideos} videos</dd></div>
        </dl>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Five secure HeyGen onboarding steps">
        {readiness.steps.map((step, index) => (
          <li key={step.id} className="rounded-lg border border-white/10 bg-black/15 p-3 text-sm">
            <p className="text-xs text-zinc-500">{index + 1}/5 · {step.owner}</p>
            <p className="mt-1 font-medium text-zinc-100">{stepLabels[step.id]}</p>
            <p className={step.state === "complete" ? "mt-2 text-xs text-emerald-300" : "mt-2 text-xs text-amber-200"}>{stepStateLabels[step.state]}</p>
          </li>
        ))}
      </ol>

      <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-100">
        No provider call · No live verification · No generation · No admission · No spend · No migration · No deployment · No publishing.
      </p>
    </section>
  );
}

export function HeyGenOnboardingPanel() {
  const query = useHeyGenOnboardingReadiness();
  if (query.isLoading) {
    return <section aria-labelledby="heygen-onboarding-loading" className="rounded-2xl border border-white/10 p-6"><h2 id="heygen-onboarding-loading" className="text-xl font-semibold text-white">Secure HeyGen onboarding</h2><p role="status" className="mt-3 text-sm text-zinc-400">Checking read-only onboarding readiness…</p></section>;
  }
  if (query.isError || !query.data) {
    return (
      <section aria-labelledby="heygen-onboarding-error" className="rounded-2xl border border-red-300/20 bg-red-400/[0.05] p-6">
        <h2 id="heygen-onboarding-error" className="text-xl font-semibold text-white">Secure HeyGen onboarding unavailable</h2>
        <div role="alert" className="mt-3 flex flex-col gap-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between"><p>Provider IDs remain blocked because readiness could not be verified. No external action occurred.</p><Button type="button" variant="outline" className="border-red-200/30 bg-transparent text-red-50" disabled={query.isFetching} onClick={() => query.refetch().then(() => undefined)}>Retry readiness</Button></div>
      </section>
    );
  }
  return (
    <div className="space-y-6">
      <ReadinessPanel readiness={query.data} refreshing={query.isFetching} onRefresh={() => query.refetch().then(() => undefined)} />
      <HeyGenRosterSetup onboardingReadiness={query.data} />
    </div>
  );
}
