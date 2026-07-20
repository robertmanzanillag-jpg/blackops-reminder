import { useState } from "react";
import { BarChart3, Clock3, DollarSign, Eye, Heart, MousePointerClick, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmptyPanel, LoadingPanel } from "../feedback";
import { LoadMoreError, OperationsPageError } from "./feedback";
import { useAnalyticsSummary, useAttributions } from "./hooks";
import { rankAttributions, validateAnalyticsDateWindow, type AnalyticsDateWindow, type AnalyticsFilters, type AttributionDimension, type SocialPlatform } from "./types";

const platforms: Array<{ value: SocialPlatform; label: string }> = [
  { value: "tiktok", label: "TikTok" }, { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" }, { value: "youtube_shorts", label: "YouTube Shorts" },
];
const dimensions: Array<{ value: AttributionDimension; label: string }> = [
  { value: "avatar", label: "Avatar" }, { value: "hook", label: "Hook" }, { value: "cta", label: "CTA" },
  { value: "posting_time", label: "Posting time" }, { value: "category", label: "Category" },
];
const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30";
const integer = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function duration(milliseconds: number | null) { return milliseconds === null ? "—" : `${(milliseconds / 1_000).toFixed(1)}s`; }
function isoDate(value: string, end = false) { return value ? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z` : undefined; }

export function AnalyticsWorkspace() {
  const [platform, setPlatform] = useState<"all" | SocialPlatform>("all");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [appliedWindow, setAppliedWindow] = useState<AnalyticsDateWindow | null>(null);
  const [dateError, setDateError] = useState("");
  const [dimension, setDimension] = useState<AttributionDimension>("avatar");
  const filters: AnalyticsFilters = {
    ...(platform === "all" ? {} : { platform }),
    ...(appliedWindow ? { from: isoDate(appliedWindow.from), to: isoDate(appliedWindow.to, true) } : {}),
  };
  const summaryQuery = useAnalyticsSummary(filters);
  const attributionQuery = useAttributions({ ...filters, dimension, limit: 25 });
  const attributions = attributionQuery.data?.pages.flatMap((page) => page.attributions) ?? [];
  const rankings = rankAttributions(attributions, dimension);
  const summary = summaryQuery.data;

  const applyDateWindow = () => {
    const result = validateAnalyticsDateWindow(draftFrom, draftTo);
    if (!result.ok) {
      setDateError(result.message);
      return;
    }
    setDateError("");
    setAppliedWindow(result.window);
  };

  const clearDateWindow = () => {
    setDraftFrom("");
    setDraftTo("");
    setDateError("");
    setAppliedWindow(null);
  };

  const cards = summary ? [
    { label: "Views", value: integer.format(summary.metrics.views), icon: Eye },
    { label: "Engagement", value: percent(summary.engagementRate), icon: Heart },
    { label: "CTR", value: percent(summary.metrics.ctr), icon: MousePointerClick },
    { label: "Retention", value: percent(summary.metrics.retentionRate), icon: BarChart3 },
    { label: "Avg. watch", value: duration(summary.averageWatchTimeMs), icon: Clock3 },
    { label: "Cost / video", value: summary.costPerVideoUsd === null ? "—" : money.format(summary.costPerVideoUsd), icon: DollarSign },
    { label: "Cost / view", value: summary.costPerViewUsd === null ? "—" : money.format(summary.costPerViewUsd), icon: DollarSign },
    { label: "Shares", value: integer.format(summary.metrics.shares), icon: Share2 },
  ] : [];

  return (
    <section id="analytics" aria-labelledby="analytics-heading" className="scroll-mt-24 space-y-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Measured outcomes</p><h2 id="analytics-heading" className="mt-2 text-2xl font-semibold text-white">Analytics</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Compare engagement, watch behavior, and unit cost using provider-neutral publication mappings.</p></div>
      <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="analytics-platform">Platform</Label><select id="analytics-platform" className={inputClass} value={platform} onChange={(event) => setPlatform(event.target.value as "all" | SocialPlatform)}><option value="all">All platforms</option>{platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div><Label htmlFor="analytics-from">From</Label><input id="analytics-from" type="date" className={inputClass} value={draftFrom} max={draftTo || undefined} aria-describedby="analytics-date-help analytics-date-error" aria-invalid={Boolean(dateError)} onChange={(event) => { setDraftFrom(event.target.value); setDateError(""); }} /></div>
        <div><Label htmlFor="analytics-to">To</Label><input id="analytics-to" type="date" className={inputClass} value={draftTo} min={draftFrom || undefined} aria-describedby="analytics-date-help analytics-date-error" aria-invalid={Boolean(dateError)} onChange={(event) => { setDraftTo(event.target.value); setDateError(""); }} /></div>
        <div><Label htmlFor="analytics-dimension">Rank by</Label><select id="analytics-dimension" className={inputClass} value={dimension} onChange={(event) => setDimension(event.target.value as AttributionDimension)}>{dimensions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4">
          <p id="analytics-date-help" className="text-xs text-zinc-400">Date edits stay in draft until both endpoints are applied together.</p>
          {dateError && <p id="analytics-date-error" role="alert" className="text-sm text-red-200">{dateError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={applyDateWindow} className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300">Apply date range</Button>
            <Button type="button" variant="outline" onClick={clearDateWindow} disabled={!draftFrom && !draftTo && !appliedWindow} className="border-white/15 bg-white/5 text-zinc-100">Clear date range</Button>
          </div>
          {appliedWindow && <p role="status" className="text-xs text-emerald-200">Applied range: {appliedWindow.from} through {appliedWindow.to}.</p>}
        </div>
      </div>

      {summaryQuery.isLoading ? <LoadingPanel label="Loading analytics summary" /> : summaryQuery.isError ? <OperationsPageError message={summaryQuery.error.message} onRetry={() => void summaryQuery.refetch()} /> : summary ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon }) => <Card key={label} className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div><Icon className="h-5 w-5 text-emerald-300" aria-hidden="true" /></CardContent></Card>)}</div><Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardHeader><CardTitle className="text-base">Engagement details</CardTitle></CardHeader><CardContent><dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[["Impressions", summary.metrics.impressions], ["Likes", summary.metrics.likes], ["Comments", summary.metrics.comments], ["Shares", summary.metrics.shares], ["Clicks", summary.metrics.clicks], ["Publications", summary.publicationCount]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-white/10 bg-black/20 p-3"><dt className="text-xs text-zinc-400">{label}</dt><dd className="mt-1 text-lg font-semibold text-zinc-100">{integer.format(Number(value))}</dd></div>)}</dl></CardContent></Card></> : null}

      <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardHeader><CardTitle className="text-base">Attribution rankings · {dimensions.find((item) => item.value === dimension)?.label}</CardTitle><p className="text-sm text-zinc-400">Ranked by attributed publications in the loaded result set; performance scoring awaits joined per-publication metrics.</p></CardHeader><CardContent>{attributionQuery.isLoading ? <LoadingPanel label="Loading attribution data" /> : attributionQuery.isError && !attributionQuery.data ? <OperationsPageError message={attributionQuery.error.message} onRetry={() => void attributionQuery.refetch()} /> : rankings.length === 0 ? <EmptyPanel title="No attribution data" description="Published content with mapped scripts and creators will appear here." /> : <><ol className="space-y-2">{rankings.map((item, index) => <li key={item.label} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-sm font-semibold text-emerald-200">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{item.label}</span><span className="text-xs text-zinc-400">{item.count} attributed</span></li>)}</ol>{attributionQuery.hasNextPage && <Button type="button" variant="outline" className="mt-4 w-full border-white/15 bg-white/5 text-zinc-100" disabled={attributionQuery.isFetchingNextPage} onClick={() => void attributionQuery.fetchNextPage()}>{attributionQuery.isFetchingNextPage ? "Loading more…" : "Load more attribution"}</Button>}{attributionQuery.isFetchNextPageError && <LoadMoreError message={attributionQuery.error.message} pending={attributionQuery.isFetchingNextPage} onRetry={() => void attributionQuery.fetchNextPage()} />}</>}</CardContent></Card>
    </section>
  );
}
