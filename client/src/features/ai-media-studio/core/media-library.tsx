import { useState, type FormEvent } from "react";
import { FileAudio, FileImage, FileText, Film, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "../feedback";
import { AssetDeliveryControl } from "./asset-delivery-control";
import { useMediaAssets } from "./hooks";
import { PaginationError } from "./pagination-feedback";
import type { MediaAsset, MediaAssetKind, MediaAssetStatus, MediaLibraryRequest } from "./types";

const kinds: Array<{ value: "all" | MediaAssetKind; label: string }> = [
  { value: "all", label: "All assets" }, { value: "video", label: "Videos" }, { value: "script", label: "Scripts" },
  { value: "voice", label: "Voices" }, { value: "b_roll", label: "B-roll" }, { value: "image", label: "Images" },
  { value: "music", label: "Music" }, { value: "logo", label: "Logos" }, { value: "subtitle", label: "Subtitles" }, { value: "thumbnail", label: "Thumbnails" },
];

const inputClass = "h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30";

function iconFor(asset: MediaAsset) {
  if (asset.kind === "video") return Film;
  if (asset.kind === "script" || asset.kind === "subtitle") return FileText;
  if (asset.kind === "voice" || asset.kind === "music") return FileAudio;
  return FileImage;
}

function formatBytes(value: number | null) {
  if (value === null) return "Size pending";
  if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000))} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return null;
  const seconds = Math.round(durationMs / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function deliveryUnavailableLabel(status: MediaAssetStatus) {
  if (status === "processing") return "File is still processing";
  if (status === "failed") return "File generation failed";
  return "Archived files cannot be opened";
}

export function MediaLibrary() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | MediaAssetKind>("all");
  const [status, setStatus] = useState<"all" | MediaAssetStatus>("all");
  const filters: MediaLibraryRequest = {
    ...(kind === "all" ? {} : { kinds: [kind] }),
    ...(status === "all" ? {} : { status }),
    ...(search ? { search } : {}),
    limit: 50,
  };
  const assetsQuery = useMediaAssets(filters);
  const assets = assetsQuery.data?.pages.flatMap((page) => page.assets) ?? [];

  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(searchDraft.trim()); };

  return (
    <section id="media-library" aria-labelledby="media-library-heading" className="scroll-mt-24">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Reusable inventory</p>
        <h2 id="media-library-heading" className="mt-2 text-2xl font-semibold text-white">Media library</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Find videos, scripts, voices, B-roll, images, music, logos, subtitles, and thumbnails. This workspace does not publish content.</p>
      </div>

      <form role="search" onSubmit={submitSearch} className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto] md:items-end">
        <div><Label htmlFor="asset-search">Search assets</Label><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-400" aria-hidden="true" /><input id="asset-search" type="search" className={`${inputClass} pl-9`} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={120} placeholder="Name or metadata" /></div></div>
        <div><Label htmlFor="asset-kind">Asset type</Label><select id="asset-kind" className={`mt-2 ${inputClass}`} value={kind} onChange={(event) => setKind(event.target.value as "all" | MediaAssetKind)}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div><Label htmlFor="asset-status">Status</Label><select id="asset-status" className={`mt-2 ${inputClass}`} value={status} onChange={(event) => setStatus(event.target.value as "all" | MediaAssetStatus)}><option value="all">All statuses</option><option value="ready">Ready</option><option value="processing">Processing</option><option value="failed">Failed</option><option value="archived">Archived</option></select></div>
        <Button type="submit" variant="outline" className="min-h-11 border-white/15 bg-white/5 text-zinc-100">Apply search</Button>
      </form>

      <div className="mt-5">
        {assetsQuery.isLoading ? (
          <LoadingPanel label="Loading media library" />
        ) : assetsQuery.isError && !assetsQuery.data ? (
          <ErrorPanel message={assetsQuery.error.message} onRetry={() => assetsQuery.refetch().then(() => undefined)} />
        ) : assets.length === 0 ? (
          <EmptyPanel title="No assets match these filters" description="Change the filters or generate a preview. Stored assets will remain reusable here." />
        ) : (
          <>
            <p role="status" className="mb-3 text-sm text-zinc-400">Showing {assets.length} asset{assets.length === 1 ? "" : "s"}{assetsQuery.hasNextPage ? " · More available" : ""}</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {assets.map((asset) => {
                const Icon = iconFor(asset);
                return (
                  <Card key={asset.id} className="overflow-hidden border-white/10 bg-white/[0.035] text-white shadow-none">
                    <div className="relative aspect-video border-b border-white/10 bg-[radial-gradient(circle_at_30%_20%,rgba(52,211,153,0.15),transparent_40%),#090c0a]">
                      {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center"><Icon className="h-9 w-9 text-emerald-300" aria-hidden="true" /></div>}
                      <span className="absolute left-3 top-3 rounded-md border border-white/15 bg-black/70 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-200">{asset.kind.replace("_", "-")}</span>
                    </div>
                    <CardContent className="p-4">
                      <h3 className="truncate text-sm font-semibold text-white">{asset.name}</h3>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-400"><span>{formatBytes(asset.byteSize)}</span><span className="capitalize">{asset.status}</span></div>
                      {formatDuration(asset.durationMs) && <p className="mt-1 text-xs text-zinc-400">Duration {formatDuration(asset.durationMs)}</p>}
                      {/* AssetDeliveryControl uses authenticated, short-lived links with rel="noreferrer" semantics. */}
                      <AssetDeliveryControl assetId={asset.id} available={asset.status === "ready"} unavailableLabel={deliveryUnavailableLabel(asset.status)} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {assetsQuery.hasNextPage && <Button type="button" variant="outline" className="mt-4 w-full border-white/15 bg-white/5 text-zinc-100" disabled={assetsQuery.isFetchingNextPage} onClick={() => assetsQuery.fetchNextPage()}>{assetsQuery.isFetchingNextPage ? "Loading more assets…" : "Load more assets"}</Button>}
            {assetsQuery.isFetchNextPageError && <PaginationError label="More assets could not be loaded" message={assetsQuery.error.message} pending={assetsQuery.isFetchingNextPage} onRetry={() => assetsQuery.fetchNextPage()} />}
          </>
        )}
      </div>
    </section>
  );
}
