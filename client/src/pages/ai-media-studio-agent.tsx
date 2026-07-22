import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  GitPullRequest,
  RefreshCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  AI_MEDIA_STUDIO_AGENT_API,
  aiMediaStudioAgentSnapshotSchema,
  type AiMediaStudioAgentWorkItem,
  type AiMediaStudioAgentWorkState,
} from "@shared/ai-media-studio-agent";

const stateLabels: Record<AiMediaStudioAgentWorkState, string> = {
  review: "Review",
  merged: "Merged",
  running: "Running",
  ready: "Ready",
  blocked: "Blocked",
  backlog: "Backlog",
};

const stateClasses: Record<AiMediaStudioAgentWorkState, string> = {
  review: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
  merged: "border-emerald-300/35 bg-emerald-400/15 text-emerald-50",
  running: "border-sky-300/25 bg-sky-400/10 text-sky-100",
  ready: "border-violet-300/25 bg-violet-400/10 text-violet-100",
  blocked: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  backlog: "border-white/15 bg-white/5 text-zinc-300",
};

const kanbanStates: AiMediaStudioAgentWorkState[] = [
  "backlog",
  "ready",
  "running",
  "review",
  "merged",
  "blocked",
];

const gateLabels = {
  checker: "Checker",
  appQa: "App QA",
  ci: "CI",
  human: "Human",
} as const;

const gateClasses = {
  passed: "border-emerald-300/20 bg-emerald-400/[0.08] text-emerald-100",
  pending: "border-sky-300/20 bg-sky-400/[0.08] text-sky-100",
  blocked: "border-amber-300/20 bg-amber-400/[0.08] text-amber-100",
  not_required: "border-white/10 bg-white/[0.04] text-zinc-400",
} as const;

async function getAgentSnapshot() {
  const response = await fetch(AI_MEDIA_STUDIO_AGENT_API, { credentials: "include" });
  if (!response.ok) throw new Error(`AI Media Studio Agent is unavailable (${response.status})`);
  return aiMediaStudioAgentSnapshotSchema.parse(await response.json());
}

function WorkItemCard({ item }: { item: AiMediaStudioAgentWorkItem }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{item.owner}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{item.title}</h2>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${stateClasses[item.state]}`}>
          {stateLabels[item.state]}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-400">Acceptance</h3>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-zinc-300">
            {item.acceptance.map((value) => <li key={value} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />{value}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-400">Merge gate</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{item.mergeGate}</p>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.13em] text-zinc-400">Next action</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{item.nextAction}</p>
        </div>
      </div>

      {item.evidence.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-400">Evidence</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.evidence.map((value) => <span key={value} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-zinc-300">{value}</span>)}
          </div>
        </div>
      )}

      {item.gates && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-400">Gates</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.entries(item.gates).map(([key, gate]) => (
              <div key={key} className={`rounded-lg border px-2.5 py-2 text-xs ${gateClasses[gate.status]}`}>
                <p className="font-semibold">{gateLabels[key as keyof typeof gateLabels]}</p>
                <p className="mt-1 opacity-80">{gate.status.replace("_", " ")}</p>
                {gate.evidence.length > 0 && <p className="mt-1 leading-5 opacity-70">{gate.evidence.join(" · ")}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {item.runtime && (
        <div className="mt-5 rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-3 text-sm text-sky-50">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-sky-100">Runtime health</h3>
          <p className="mt-2"><span className="font-semibold">{item.runtime.health}</span> · {item.runtime.status.replace("_", " ")}</p>
          {item.runtime.evidence.length > 0 && <p className="mt-1 text-xs leading-5 text-sky-100/70">{item.runtime.evidence.join(" · ")}</p>}
        </div>
      )}

      {item.blockers.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-amber-100"><TriangleAlert className="h-4 w-4" aria-hidden="true" />Blockers</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-50/90">{item.blockers.map((value) => <li key={value}>• {value}</li>)}</ul>
        </div>
      )}

      {(item.pullRequestUrl || item.branch || (item.baseBranch && item.headBranch)) && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-xs text-zinc-400">
          {item.baseBranch && item.headBranch && <span className="inline-flex items-center gap-1.5"><CircleDot className="h-3.5 w-3.5" aria-hidden="true" />{item.baseBranch} → {item.headBranch}</span>}
          {item.branch && !(item.baseBranch && item.headBranch) && <span className="inline-flex items-center gap-1.5"><CircleDot className="h-3.5 w-3.5" aria-hidden="true" />{item.branch}</span>}
          {item.pullRequestUrl && <a className="inline-flex items-center gap-1.5 text-emerald-200 hover:text-emerald-100" href={item.pullRequestUrl} target="_blank" rel="noreferrer"><GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />Open PR <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
        </div>
      )}

      {(item.harness || item.heartbeatAt || item.handoff || item.commit || (item.evidenceLinks?.length ?? 0) > 0) && (
        <div className="mt-4 space-y-1.5 text-xs leading-5 text-zinc-400">
          {item.harness && <p><span className="font-semibold text-zinc-300">Harness:</span> {item.harness}</p>}
          {item.heartbeatAt && <p><span className="font-semibold text-zinc-300">Heartbeat:</span> {new Date(item.heartbeatAt).toLocaleString()}</p>}
          {item.handoff && <p><span className="font-semibold text-zinc-300">Handoff:</span> {item.handoff}</p>}
          {item.commit && <p><span className="font-semibold text-zinc-300">Commit:</span> {item.commit}</p>}
          {(item.evidenceLinks?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.evidenceLinks?.map((value, index) => <a key={value} href={value} target="_blank" rel="noreferrer" className="text-emerald-200 hover:text-emerald-100">Evidence {index + 1} <ExternalLink className="inline h-3 w-3" aria-hidden="true" /></a>)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function AiMediaStudioAgentPage() {
  const query = useQuery({
    queryKey: ["ai-media-studio", "agent"],
    queryFn: getAgentSnapshot,
    staleTime: 30_000,
  });
  const snapshot = query.data;

  return (
    <main className="min-h-screen bg-[#050706] px-4 py-8 text-zinc-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/agents-office" className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-zinc-400 hover:bg-white/5 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Agents Office</Link>
          <Link href="/ai-media-studio" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-zinc-200 hover:bg-white/10">Open product studio <ExternalLink className="h-4 w-4" aria-hidden="true" /></Link>
        </div>

        <header className="mt-7 rounded-3xl border border-emerald-300/15 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_45%)] p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.17em] text-emerald-300"><Bot className="h-4 w-4" aria-hidden="true" />Dedicated delivery agent</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">AI Media Studio Agent</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300 sm:text-base">{snapshot?.agent.mission ?? "Loading the dedicated delivery plan, review gates and launch blockers."}</p>
            </div>
            <Button type="button" variant="outline" className="border-white/10 bg-white/5 text-zinc-100" disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RefreshCcw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />Refresh
            </Button>
          </div>
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4 text-sm text-emerald-50">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>This control pane is read-only. Spend, deployment, migrations and live provider calls remain disabled until their explicit human gates pass.</p>
          </div>
          {snapshot && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1.5"><CircleDot className="h-3.5 w-3.5" aria-hidden="true" />Agent: {snapshot.agent.status.replace("_", " ")}</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Data as of {new Date(snapshot.dataAsOf).toLocaleString()}</span>
            </div>
          )}
        </header>

        {query.isLoading && <p role="status" className="mt-8 rounded-xl border border-white/10 bg-white/[0.025] p-5 text-sm text-zinc-400">Loading agent work items…</p>}
        {query.isError && <div role="alert" className="mt-8 rounded-xl border border-red-300/20 bg-red-400/10 p-5 text-sm text-red-100">The agent control pane could not be loaded. No action was executed.</div>}

        {snapshot && (
          <>
            <section aria-label="Launch target and work summary" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 sm:col-span-2 xl:col-span-2"><p className="text-xs uppercase tracking-[0.13em] text-zinc-500">Initial target</p><p className="mt-2 text-xl font-semibold text-white">{snapshot.launchTarget.minimumAvatars}–{snapshot.launchTarget.maximumAvatars} avatars × {snapshot.launchTarget.videosPerAvatar}</p><p className="mt-1 text-xs text-zinc-400">{snapshot.launchTarget.minimumVideos}–{snapshot.launchTarget.maximumVideos} blocked slots</p></div>
              {kanbanStates.map((state) => <div key={state} className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><p className="text-xs uppercase tracking-[0.13em] text-zinc-500">{stateLabels[state]}</p><p className="mt-2 text-2xl font-semibold text-white">{snapshot.summary[state]}</p></div>)}
            </section>
            <section aria-labelledby="agent-work-items-heading" className="mt-9">
              <div className="mb-4"><h2 id="agent-work-items-heading" className="text-xl font-semibold text-white">Agent Kanban</h2><p className="mt-1 text-sm text-zinc-400">Review is not merge. Ownership and merge readiness are shown as gates, not estimates.</p></div>
              <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
                {kanbanStates.map((state) => {
                  const items = snapshot.workItems.filter((item) => item.state === state);
                  return (
                    <section key={state} aria-labelledby={`agent-column-${state}`} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="mb-3 flex items-center justify-between px-2 py-1">
                        <h3 id={`agent-column-${state}`} className="font-semibold text-white">{stateLabels[state]}</h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-zinc-400">{items.length}</span>
                      </div>
                      <div className="space-y-3">
                        {items.length > 0 ? items.map((item) => <WorkItemCard key={item.id} item={item} />) : <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">No items</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
