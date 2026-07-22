import {
  Activity,
  CircleDollarSign,
  Clock3,
  Film,
  Layers3,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProviderStatus, StudioDashboard } from "./types";
import { EmptyPanel } from "./feedback";

const integer = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function duration(milliseconds: number) {
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1000)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown time";
  const delta = Math.max(0, Date.now() - time);
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

const providerTone: Record<ProviderStatus, string> = {
  healthy: "border-emerald-300/30 bg-emerald-400/10 text-emerald-200",
  degraded: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  offline: "border-red-300/30 bg-red-400/10 text-red-200",
  unconfigured: "border-zinc-600 bg-zinc-800/70 text-zinc-300",
};

const providerConfigurationLabels: Record<ProviderStatus, string> = {
  healthy: "Configured locally",
  degraded: "Local attention needed",
  offline: "Locally unavailable",
  unconfigured: "Not configured locally",
};

export function DashboardOverview({ dashboard }: { dashboard: StudioDashboard }) {
  const summary = dashboard.summary;
  const metrics = [
    { label: "Generated today", value: integer.format(summary.generatedToday), icon: Film, tone: "text-emerald-300" },
    { label: "Videos published", value: integer.format(summary.published), icon: UploadCloud, tone: "text-emerald-300" },
    { label: "Pending jobs", value: integer.format(summary.pending), icon: Layers3, tone: "text-amber-300" },
    { label: "Failed jobs", value: integer.format(summary.failed), icon: TriangleAlert, tone: "text-red-300" },
    { label: "Avg. generation", value: duration(summary.avgGenerationMs), icon: Clock3, tone: "text-violet-300" },
    { label: "Estimated cost", value: money.format(summary.estimatedCostUsd), icon: CircleDollarSign, tone: "text-emerald-300" },
  ];

  return (
    <>
      <section id="overview" aria-labelledby="overview-heading" className="scroll-mt-24">
        <h2 id="overview-heading" className="sr-only">Studio overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <Card key={metric.label} className="border-white/10 bg-white/[0.035] text-white shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.13em] text-zinc-500">{metric.label}</p>
                      <p className="mt-3 text-2xl font-semibold tracking-tight">{metric.value}</p>
                    </div>
                    <Icon className={cn("h-5 w-5", metric.tone)} aria-hidden="true" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card id="providers" className="scroll-mt-24 border-white/10 bg-white/[0.035] text-white shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Local provider configuration</CardTitle>
              <p className="mt-1 text-sm text-zinc-400">Saved application configuration only; this is not a live provider health check.</p>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.providers.length === 0 ? (
              <EmptyPanel title="No local provider configuration" description="Register a compatible provider in the controlled setup flow before requesting generation approval." />
            ) : (
              <ul className="space-y-3" aria-label="Provider status list">
                {dashboard.providers.map((provider) => (
                  <li key={provider.key} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-100">{provider.label}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {provider.capabilities.map((capability) => (
                            <span key={capability} className="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-400">{capability}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline" className={cn(providerTone[provider.status])}>{providerConfigurationLabels[provider.status]}</Badge>
                        <p className="mt-2 text-xs text-zinc-400">Observed locally {provider.lastCheckedAt ? relativeTime(provider.lastCheckedAt) : "never"}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Queue snapshot</CardTitle>
            <p className="text-sm text-zinc-400">Current workload across the media pipeline.</p>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-2">
              {Object.entries(dashboard.queue).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-black/20 p-3 last:sm:col-span-1 last:xl:col-span-2">
                  <dt className="text-xs capitalize text-zinc-400">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold text-zinc-100">{integer.format(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card id="activity" className="mt-5 scroll-mt-24 border-white/10 bg-white/[0.035] text-white shadow-none">
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Activity className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.recentActivity.length === 0 ? (
            <EmptyPanel title="No activity yet" description="Script, generation, and processing events will appear here." />
          ) : (
            <ol className="divide-y divide-white/10">
              {dashboard.recentActivity.map((activity) => (
                <li key={activity.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200">{activity.message}</p>
                    <p className="mt-1 text-xs capitalize text-zinc-400">{activity.type.replaceAll("_", " ")} · {relativeTime(activity.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
