import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, KeyRound, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeyGenOnboardingReadiness } from "@shared/ai-media-studio-heygen-onboarding";
import {
  HEYGEN_DEPLOYMENT_SECRET_NAME,
  newHeyGenCredentialReferenceAttemptKey,
  registerHeyGenCredentialReference,
} from "./heygen-secure-reference";

type GuidedStep = Readonly<{
  id: string;
  label: string;
  description: string;
  state: "current" | "complete" | "available" | "blocked";
  href?: string;
}>;

const stepStateLabel: Record<GuidedStep["state"], string> = {
  current: "Current action",
  complete: "Prepared",
  available: "Available next",
  blocked: "Blocked by an earlier gate",
};

function setupSteps(readiness: HeyGenOnboardingReadiness): readonly GuidedStep[] {
  const credentialReady = ["ready_for_roster_ids", "roster_configured_blocked", "stale_roster_binding"]
    .includes(readiness.status);
  const credentialStepLabel = readiness.status === "account_ambiguous"
    ? "Resolve duplicate HeyGen accounts"
    : readiness.status === "credential_metadata_attention"
      ? "Review the credential reference metadata"
      : readiness.status === "unavailable"
        ? "Retry the safe setup observation"
        : "Register the deployment-secret reference";
  const rosterReady = readiness.roster.state === "configured";
  const rosterCurrent = credentialReady && !rosterReady;
  return [
    {
      id: "secure-reference",
      label: credentialStepLabel,
      description: credentialReady
        ? "The reference is registered. The API key value has not crossed this browser."
        : readiness.secretHandling.channelState === "configured"
          ? "The saved reference is not usable yet. Keep provider IDs and live verification blocked until account metadata is repaired."
          : "Add the API key in Replit Secrets, then register only its approved variable reference here.",
      state: credentialReady ? "complete" : "current",
    },
    {
      id: "avatar-roster",
      label: "Enter 5–10 avatar-look and voice IDs",
      description: "Each avatar receives exactly ten blocked, no-spend video slots.",
      state: rosterReady ? "complete" : rosterCurrent ? "current" : "blocked",
      href: rosterCurrent ? "#heygen-roster" : undefined,
    },
    {
      id: "script-batch",
      label: "Prepare and review 10 scripts per avatar",
      description: "Script approval remains separate from provider access and launch authority.",
      state: rosterReady ? "available" : "blocked",
      href: rosterReady ? "#production-batch" : undefined,
    },
    {
      id: "governance",
      label: "Complete rights and governance",
      description: "Record current consent and allowed-use evidence for every creator.",
      state: rosterReady ? "available" : "blocked",
      href: rosterReady ? "#influencers" : undefined,
    },
    {
      id: "live-verification",
      label: "Approve GET-only HeyGen verification",
      description: "A later explicit authorization may read account, avatar-look and voice metadata. It cannot generate or spend.",
      state: "blocked",
    },
    {
      id: "maximum-quote",
      label: "Obtain a maximum one-video quote",
      description: "The quote remains blocked until exact live verification passes.",
      state: "blocked",
    },
    {
      id: "cost-approval",
      label: "Approve one-video cost",
      description: "Robert must approve the exact maximum cost in a separate decision.",
      state: "blocked",
    },
    {
      id: "sandbox",
      label: "Run one vertical sandbox video",
      description: "Generation stays blocked until verification, quote and cost approval are current.",
      state: "blocked",
    },
  ];
}

export function HeyGenGuidedSetup({
  readiness,
  onReadinessRefresh,
}: {
  readiness: HeyGenOnboardingReadiness;
  onReadinessRefresh: () => Promise<void>;
}) {
  const attemptRef = useRef<string | undefined>(undefined);
  const resultRef = useRef<HTMLDivElement>(null);
  const registrationAllowed = readiness.status === "awaiting_secure_credential"
    && readiness.secretHandling.channelState === "unselected";
  const steps = setupSteps(readiness);
  const current = steps.find((step) => step.state === "current") ?? steps.find((step) => step.state === "available");
  const registration = useMutation({
    mutationFn: async () => {
      attemptRef.current ??= newHeyGenCredentialReferenceAttemptKey();
      return registerHeyGenCredentialReference(attemptRef.current);
    },
    onSuccess: async () => {
      attemptRef.current = undefined;
      await onReadinessRefresh();
      requestAnimationFrame(() => resultRef.current?.focus());
    },
  });

  useEffect(() => {
    if (readiness.secretHandling.channelState === "configured") attemptRef.current = undefined;
  }, [readiness.secretHandling.channelState]);

  return (
    <section aria-labelledby="heygen-guided-setup-heading" className="rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.035] p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Guided HeyGen setup</p>
          <h3 id="heygen-guided-setup-heading" className="mt-2 text-xl font-semibold text-white">One safe action at a time</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">Current action: <span className="font-semibold text-white">{current?.label ?? "Refresh setup status"}</span>. Sensitive actions remain closed until their own explicit approvals.</p>
        </div>
      </div>

      <section aria-labelledby="heygen-robert-handoff-heading" className="mt-5 rounded-xl border border-violet-300/20 bg-violet-400/[0.05] p-4">
        <h4 id="heygen-robert-handoff-heading" className="font-medium text-violet-100">What Robert provides later</h4>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">
          <li>The exact deployment variable <code className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-200">{HEYGEN_DEPLOYMENT_SECRET_NAME}</code>; its value never belongs in chat, GitHub, or this UI.</li>
          <li>Five to ten creator display names.</li>
          <li>One exact HeyGen avatar-look ID and the intended HeyGen voice ID for each creator.</li>
          <li>Language defaults to en-US, accent to Neutral, and gender to Unspecified; each can be adjusted before roster submission.</li>
        </ul>
        <p role="note" className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-zinc-300">
          Each avatar plans exactly 10 blocked videos. This checklist does not generate video, contact HeyGen, or authorize spend.
        </p>
      </section>

      <div className="mt-5 rounded-xl border border-sky-300/20 bg-black/20 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">Step 1 · Replit deployment secret</p>
        <p className="mt-2 text-sm leading-6 text-zinc-300">Create this exact variable in Replit Secrets:</p>
        <code className="mt-2 block overflow-x-auto rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-emerald-200">{HEYGEN_DEPLOYMENT_SECRET_NAME}</code>
        <p id="heygen-reference-safety" className="mt-2 text-xs leading-5 text-zinc-400">Never paste its value into AI Media Studio, chat, GitHub, avatar fields, or this request. Registration sends only a random idempotency key; it does not read the environment, contact HeyGen, or verify the API key.</p>
        {registrationAllowed && (
          <Button
            type="button"
            className="mt-4 min-h-11 bg-sky-300 text-zinc-950 hover:bg-sky-200"
            disabled={registration.isPending}
            aria-busy={registration.isPending}
            aria-describedby="heygen-reference-safety"
            onClick={() => registration.mutate()}
          >
            {registration.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {registration.isPending ? "Registering safe reference…" : "I added the Replit secret — register reference"}
          </Button>
        )}
        {readiness.secretHandling.channelState === "configured" && (
          <div ref={resultRef} tabIndex={-1} role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/[0.07] p-3 text-sm text-emerald-100">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Deployment-secret reference registered. The secret value was not observed or returned.</span>
          </div>
        )}
        {registration.isError && <p role="alert" className="mt-4 rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{registration.error.message}</p>}
      </div>

      <ol className="mt-5 grid gap-3 lg:grid-cols-2" aria-label="Eight guided HeyGen setup gates">
        {steps.map((step, index) => (
          <li key={step.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-start gap-3">
              {step.state === "complete" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" /> : <CircleDashed className={`mt-0.5 h-5 w-5 shrink-0 ${step.state === "current" || step.state === "available" ? "text-cyan-200" : "text-zinc-500"}`} aria-hidden="true" />}
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">{index + 1}/8 · {stepStateLabel[step.state]}</p>
                <p className="mt-1 font-medium text-white">{step.href ? <a href={step.href} className="underline decoration-white/30 underline-offset-4 hover:text-cyan-100">{step.label}</a> : step.label}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{step.description}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-4">
        <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" /><div><p className="font-medium text-amber-100">Live verification remains a separate authorization</p><p id="heygen-live-verification-blocker" className="mt-1 text-xs leading-5 text-amber-100/80">When authorized later, it is limited to GET-only provider metadata and no spend. Quote, approval, sandbox, batch generation, publishing and deployment remain blocked.</p></div></div>
        <Button type="button" variant="outline" className="mt-3 border-amber-200/20 bg-transparent text-amber-100" disabled aria-describedby="heygen-live-verification-blocker">GET-only verification — authorization required</Button>
      </div>
    </section>
  );
}
