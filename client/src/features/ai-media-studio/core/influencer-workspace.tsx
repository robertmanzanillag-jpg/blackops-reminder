import { useReducer, useState } from "react";
import { Archive, Edit3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "../feedback";
import { useInfluencerMutations, useInfluencers, useProviderResources } from "./hooks";
import { InfluencerForm } from "./influencer-form";
import { archiveDialogReducer, initialArchiveDialogState } from "./archive-dialog-state";
import { PaginationError } from "./pagination-feedback";
import type { CreateInfluencerRequest, Influencer } from "./types";
import { InfluencerGovernanceControl } from "../governance/influencer-governance";

const statusStyles: Record<Influencer["status"], string> = {
  active: "border-emerald-300/30 bg-emerald-400/10 text-emerald-200",
  draft: "border-sky-300/30 bg-sky-400/10 text-sky-200",
  paused: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  archived: "border-white/15 bg-white/5 text-zinc-300",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function ArchiveInfluencerDialog({ influencer, remove }: { influencer: Influencer; remove: ReturnType<typeof useInfluencerMutations>["remove"] }) {
  const [state, dispatch] = useReducer(archiveDialogReducer, initialArchiveDialogState);
  const pending = state.phase === "pending";

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      remove.reset();
      dispatch({ type: "open" });
    } else {
      dispatch({ type: "close" });
    }
  };

  return (
    <AlertDialog open={state.open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="border-white/15 bg-transparent text-zinc-300"><Archive className="mr-2 h-4 w-4" aria-hidden="true" /> Archive</Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-white/10 bg-zinc-950 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {influencer.name}?</AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">The influencer leaves the active workspace. Existing media assets remain reusable in the library.</AlertDialogDescription>
        </AlertDialogHeader>
        {state.phase === "error" && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">Archiving failed: {state.error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/15 bg-white/5 text-white" disabled={pending}>Keep influencer</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-500 text-white hover:bg-red-400"
            disabled={pending}
            aria-busy={pending}
            onClick={(event) => {
              event.preventDefault();
              dispatch({ type: "confirm" });
              remove.mutate(influencer.id, {
                onSuccess: () => dispatch({ type: "success" }),
                onError: (error) => dispatch({ type: "failure", message: error.message }),
              });
            }}
          >
            {pending ? "Archiving…" : "Archive influencer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function InfluencerWorkspace() {
  const influencersQuery = useInfluencers();
  const avatarsQuery = useProviderResources("avatar");
  const voicesQuery = useProviderResources("voice");
  const mutations = useInfluencerMutations();
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Influencer | undefined>();

  const openCreate = () => { setSelected(undefined); setEditorOpen(true); };
  const openEdit = (influencer: Influencer) => { setSelected(influencer); setEditorOpen(true); };
  const pending = mutations.create.isPending || mutations.update.isPending;
  const mutationError = (mutations.create.error ?? mutations.update.error)?.message;

  const save = (input: CreateInfluencerRequest) => {
    const options = {
      onSuccess: () => setEditorOpen(false),
    };
    if (selected) mutations.update.mutate({ id: selected.id, input }, options);
    else mutations.create.mutate(input, options);
  };

  const loading = influencersQuery.isLoading || avatarsQuery.isLoading || voicesQuery.isLoading;
  const error = (!influencersQuery.data ? influencersQuery.error : undefined)
    ?? (!avatarsQuery.data ? avatarsQuery.error : undefined)
    ?? (!voicesQuery.data ? voicesQuery.error : undefined);
  const influencers = influencersQuery.data?.pages.flatMap((page) => page.influencers) ?? [];
  const avatars = avatarsQuery.data?.pages.flatMap((page) => page.resources) ?? [];
  const voices = voicesQuery.data?.pages.flatMap((page) => page.resources) ?? [];

  return (
    <section id="influencers" aria-labelledby="influencers-heading" className="scroll-mt-24">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Creator roster</p>
          <h2 id="influencers-heading" className="mt-2 text-2xl font-semibold text-white">AI influencers</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Own reusable personalities, performance direction, avatars, and voices without exposing provider-native IDs.</p>
        </div>
        <Button type="button" className="min-h-11 bg-emerald-400 text-zinc-950 hover:bg-emerald-300" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New influencer
        </Button>
      </div>

      {loading ? (
        <LoadingPanel label="Loading AI influencers" />
      ) : error ? (
        <ErrorPanel message={error.message} onRetry={() => Promise.all([influencersQuery.refetch(), avatarsQuery.refetch(), voicesQuery.refetch()]).then(() => undefined)} />
      ) : influencers.length === 0 ? (
        <EmptyPanel title="No AI influencers yet" description="Create the first reusable personality, then assign a synced avatar and voice when they are ready." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {influencers.map((influencer) => (
            <Card key={influencer.id} className="border-white/10 bg-white/[0.035] text-white shadow-none">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-400/10 text-sm font-semibold text-emerald-200" aria-hidden="true">{initials(influencer.name)}</div>
                  <div className="min-w-0"><CardTitle className="truncate text-base">{influencer.name}</CardTitle><p className="mt-1 text-xs text-zinc-400">{influencer.language} · {influencer.accent}</p></div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusStyles[influencer.status]}`}>{influencer.status}</span>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">{influencer.categories.slice(0, 5).map((category) => <span key={category} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-zinc-300">{category}</span>)}</div>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-300">{influencer.speakingStyle}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
                  <div><dt className="text-zinc-400">Energy</dt><dd className="mt-1 font-medium text-zinc-100">{influencer.energyLevel}/10</dd></div>
                  <div><dt className="text-zinc-400">Resources</dt><dd className="mt-1 font-medium text-zinc-100">{influencer.avatarResourceId && influencer.voiceResourceId ? "Ready" : "Needs setup"}</dd></div>
                </dl>
                <InfluencerGovernanceControl influencer={influencer} />
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="outline" className="flex-1 border-white/15 bg-white/5 text-zinc-100" onClick={() => openEdit(influencer)}><Edit3 className="mr-2 h-4 w-4" aria-hidden="true" /> Edit</Button>
                  <ArchiveInfluencerDialog influencer={influencer} remove={mutations.remove} />
                </div>
              </CardContent>
            </Card>
          ))}
          {influencersQuery.hasNextPage && <div className="md:col-span-2 2xl:col-span-3"><Button type="button" variant="outline" className="w-full border-white/15 bg-white/5 text-zinc-100" disabled={influencersQuery.isFetchingNextPage} onClick={() => influencersQuery.fetchNextPage()}>{influencersQuery.isFetchingNextPage ? "Loading more influencers…" : "Load more influencers"}</Button></div>}
          {influencersQuery.isFetchNextPageError && <div className="md:col-span-2 2xl:col-span-3"><PaginationError label="More influencers could not be loaded" message={influencersQuery.error.message} pending={influencersQuery.isFetchingNextPage} onRetry={() => influencersQuery.fetchNextPage()} /></div>}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!pending) setEditorOpen(open); }}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-y-auto border-white/10 bg-zinc-950 p-4 text-white sm:p-6">
          <DialogHeader className="pr-8"><DialogTitle>{selected ? `Edit ${selected.name}` : "Create AI influencer"}</DialogTitle><DialogDescription className="text-zinc-400">Define a provider-neutral creator profile. Provider credentials are never entered here.</DialogDescription></DialogHeader>
          <InfluencerForm
            influencer={selected}
            avatars={avatars}
            voices={voices}
            hasMoreAvatars={avatarsQuery.hasNextPage}
            hasMoreVoices={voicesQuery.hasNextPage}
            loadingMoreAvatars={avatarsQuery.isFetchingNextPage}
            loadingMoreVoices={voicesQuery.isFetchingNextPage}
            avatarPaginationError={avatarsQuery.isFetchNextPageError ? avatarsQuery.error.message : undefined}
            voicePaginationError={voicesQuery.isFetchNextPageError ? voicesQuery.error.message : undefined}
            onLoadMoreAvatars={() => avatarsQuery.fetchNextPage()}
            onLoadMoreVoices={() => voicesQuery.fetchNextPage()}
            pending={pending}
            serverError={mutationError}
            onSubmit={save}
            onCancel={() => setEditorOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
