import { useEffect, useRef } from "react";
import type { FieldErrors, UseFormRegisterReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PaginationError } from "./pagination-feedback";
import { selectableProviderResources } from "./provider-resource-selection";
import {
  emptyInfluencerForm,
  commaList,
  influencerToForm,
  toInfluencerRequest,
  type CreateInfluencerRequest,
  type Influencer,
  type InfluencerFormValues,
  type ProviderResource,
} from "./types";

const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30 disabled:cursor-not-allowed disabled:opacity-50";
const textareaClass = "mt-2 min-h-24 border-white/15 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-emerald-300";

type InfluencerFormProps = {
  influencer?: Influencer;
  avatars: ProviderResource[];
  voices: ProviderResource[];
  hasMoreAvatars?: boolean;
  hasMoreVoices?: boolean;
  loadingMoreAvatars?: boolean;
  loadingMoreVoices?: boolean;
  avatarPaginationError?: string;
  voicePaginationError?: string;
  onLoadMoreAvatars: () => void;
  onLoadMoreVoices: () => void;
  pending: boolean;
  serverError?: string;
  onSubmit: (input: CreateInfluencerRequest) => void;
  onCancel: () => void;
};

function TextField({
  id,
  label,
  registration,
  required = true,
  hint,
  error,
  type = "text",
  min,
  max,
}: {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  required?: boolean;
  hint?: string;
  error?: string;
  type?: "text" | "number";
  min?: number;
  max?: number;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <Label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</Label>
      <input id={id} type={type} min={min} max={max} required={required} aria-required={required || undefined} aria-invalid={Boolean(error)} aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined} className={inputClass} {...registration} />
      {hint && <p id={hintId} className="mt-1 text-xs leading-5 text-zinc-400">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-xs text-red-200">{error}</p>}
    </div>
  );
}

function TextareaField({ id, label, registration, error, maxLength }: { id: string; label: string; registration: UseFormRegisterReturn; error?: string; maxLength: number }) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <Label htmlFor={id}>{label} <span aria-hidden="true">*</span></Label>
      <Textarea id={id} required aria-required="true" aria-invalid={Boolean(error)} aria-describedby={errorId} maxLength={maxLength} className={textareaClass} {...registration} />
      {error && <p id={errorId} role="alert" className="mt-1 text-xs text-red-200">{error}</p>}
    </div>
  );
}

export function InfluencerForm({ influencer, avatars, voices, hasMoreAvatars, hasMoreVoices, loadingMoreAvatars, loadingMoreVoices, avatarPaginationError, voicePaginationError, onLoadMoreAvatars, onLoadMoreVoices, pending, serverError, onSubmit, onCancel }: InfluencerFormProps) {
  const errorRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<InfluencerFormValues>({ defaultValues: influencer ? influencerToForm(influencer) : emptyInfluencerForm });

  useEffect(() => {
    reset(influencer ? influencerToForm(influencer) : emptyInfluencerForm);
  }, [influencer, reset]);

  useEffect(() => {
    if (serverError) errorRef.current?.focus();
  }, [serverError]);

  const minimumAge = Number(watch("minimumAge"));
  const selectedAvatarResourceId = watch("avatarResourceId");
  const selectedVoiceResourceId = watch("voiceResourceId");
  const { active: activeAvatars, selectedUnavailable: selectedAvatarUnavailable } = selectableProviderResources(avatars, selectedAvatarResourceId);
  const { active: activeVoices, selectedUnavailable: selectedVoiceUnavailable } = selectableProviderResources(voices, selectedVoiceResourceId);

  const invalid = (invalidFields: FieldErrors<InfluencerFormValues>) => requestAnimationFrame(() => {
    const fieldName = Object.keys(invalidFields)[0];
    if (fieldName) document.querySelector<HTMLElement>(`[name="${fieldName}"]`)?.focus();
  });

  const submit = (values: InfluencerFormValues) => onSubmit(toInfluencerRequest(values));

  return (
    <form onSubmit={handleSubmit(submit, invalid)} noValidate className="space-y-6">
      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">AI influencer identity and creative direction</legend>

        <section aria-labelledby="identity-heading" className="space-y-4">
          <h3 id="identity-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">Identity</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="influencer-name" label="Name" registration={register("name", { required: "Enter a name", maxLength: { value: 120, message: "Use 120 characters or fewer" } })} error={errors.name?.message} />
            <TextField id="influencer-language" label="Language" registration={register("language", { required: "Enter a language", minLength: { value: 2, message: "Use a valid language code" }, maxLength: { value: 35, message: "Use 35 characters or fewer" } })} error={errors.language?.message} hint="Use a locale such as en-US or es-MX." />
            <div>
              <Label htmlFor="influencer-gender">Gender</Label>
              <select id="influencer-gender" className={inputClass} {...register("gender", { required: true })}>
                <option value="unspecified">Unspecified</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option>
              </select>
            </div>
            <TextField id="influencer-accent" label="Accent" registration={register("accent", { required: "Enter an accent", maxLength: { value: 80, message: "Use 80 characters or fewer" } })} error={errors.accent?.message} />
            <TextField id="influencer-min-age" label="Minimum age" type="number" min={18} max={120} registration={register("minimumAge", { required: "Enter a minimum age", min: { value: 18, message: "Minimum age is 18" }, max: { value: 120, message: "Maximum age is 120" } })} error={errors.minimumAge?.message} />
            <TextField id="influencer-max-age" label="Maximum age" type="number" min={minimumAge || 18} max={120} registration={register("maximumAge", { required: "Enter a maximum age", min: { value: minimumAge || 18, message: "Maximum age cannot be lower than minimum age" }, max: { value: 120, message: "Maximum age is 120" } })} error={errors.maximumAge?.message} />
          </div>
        </section>

        <section aria-labelledby="performance-heading" className="space-y-4 border-t border-white/10 pt-5">
          <h3 id="performance-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">Performance</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="influencer-avatar">Avatar</Label>
              <select id="influencer-avatar" className={inputClass} {...register("avatarResourceId")}>
                <option value="">Assign later</option>
                {selectedAvatarUnavailable && <option value={selectedAvatarResourceId} disabled>Current avatar · unavailable</option>}
                {activeAvatars.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
              </select>
              {selectedAvatarUnavailable && <p className="mt-1 text-xs leading-5 text-amber-200">This avatar is not verified or is not loaded. Choose an active avatar or Assign later before saving.</p>}
              {hasMoreAvatars && <Button type="button" size="sm" variant="ghost" className="mt-1 px-1 text-emerald-200" disabled={loadingMoreAvatars} onClick={onLoadMoreAvatars}>{loadingMoreAvatars ? "Loading avatars…" : "Load more avatars"}</Button>}
              {avatarPaginationError && <PaginationError label="More avatars could not be loaded" message={avatarPaginationError} pending={loadingMoreAvatars} onRetry={onLoadMoreAvatars} />}
            </div>
            <div>
              <Label htmlFor="influencer-voice">Voice</Label>
              <select id="influencer-voice" className={inputClass} {...register("voiceResourceId")}>
                <option value="">Assign later</option>
                {selectedVoiceUnavailable && <option value={selectedVoiceResourceId} disabled>Current voice · unavailable</option>}
                {activeVoices.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}{resource.accent ? ` · ${resource.accent}` : ""}</option>)}
              </select>
              {selectedVoiceUnavailable && <p className="mt-1 text-xs leading-5 text-amber-200">This voice is not verified or is not loaded. Choose an active voice or Assign later before saving.</p>}
              {hasMoreVoices && <Button type="button" size="sm" variant="ghost" className="mt-1 px-1 text-emerald-200" disabled={loadingMoreVoices} onClick={onLoadMoreVoices}>{loadingMoreVoices ? "Loading voices…" : "Load more voices"}</Button>}
              {voicePaginationError && <PaginationError label="More voices could not be loaded" message={voicePaginationError} pending={loadingMoreVoices} onRetry={onLoadMoreVoices} />}
            </div>
            <TextField id="influencer-personality" label="Personality" registration={register("personality", { required: "Enter at least one personality trait" })} error={errors.personality?.message} hint="Comma-separated traits, for example: curious, warm, witty." />
            <TextField id="influencer-tone" label="Tone" registration={register("tone", { required: "Enter at least one tone" })} error={errors.tone?.message} hint="Comma-separated tones." />
            <TextField id="influencer-categories" label="Categories" registration={register("categories", { required: "Enter at least one category" })} error={errors.categories?.message} hint="Food, brunch, coffee, travel…" />
            <TextField id="influencer-expressions" label="Facial expressions" registration={register("facialExpressions", { required: "Enter at least one facial expression" })} error={errors.facialExpressions?.message} hint="Warm smile, thoughtful, excited…" />
            <TextField id="influencer-colors" label="Brand colors" registration={register("brandColors", { required: "Enter at least one brand color", validate: (value) => commaList(value).every((color) => /^#[0-9A-Fa-f]{6}$/.test(color)) || "Use six-digit hex colors such as #34D399" })} error={errors.brandColors?.message} hint="Comma-separated six-digit hex colors." />
            <TextField id="influencer-energy" label="Energy level" type="number" min={1} max={10} registration={register("energyLevel", { required: "Enter an energy level", min: { value: 1, message: "Energy starts at 1" }, max: { value: 10, message: "Energy ends at 10" } })} error={errors.energyLevel?.message} hint="1 is calm; 10 is highly energetic." />
          </div>
          <TextareaField id="influencer-style" label="Speaking style" maxLength={500} registration={register("speakingStyle", { required: "Describe the speaking style", maxLength: { value: 500, message: "Use 500 characters or fewer" } })} error={errors.speakingStyle?.message} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField id="influencer-intro" label="Intro" maxLength={1_000} registration={register("intro", { required: "Enter an intro", maxLength: { value: 1_000, message: "Use 1,000 characters or fewer" } })} error={errors.intro?.message} />
            <TextareaField id="influencer-outro" label="Outro" maxLength={1_000} registration={register("outro", { required: "Enter an outro", maxLength: { value: 1_000, message: "Use 1,000 characters or fewer" } })} error={errors.outro?.message} />
          </div>
        </section>

        <section aria-labelledby="lifecycle-heading" className="border-t border-white/10 pt-5">
          <h3 id="lifecycle-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">Lifecycle</h3>
          <div className="mt-4 max-w-xs"><Label htmlFor="influencer-status">Status</Label><select id="influencer-status" className={inputClass} {...register("status")}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option></select><p className="mt-1 text-xs leading-5 text-zinc-400">Archiving requires a separate confirmation from the influencer card.</p></div>
        </section>
      </fieldset>

      {Object.keys(errors).length > 0 && <div role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">Review the highlighted required values. Ages must be between 18 and 120.</div>}
      {serverError && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{serverError}</div>}

      <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="border-white/15 bg-white/5 text-zinc-100" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {pending ? "Saving…" : influencer ? "Save changes" : "Create influencer"}
        </Button>
      </div>
    </form>
  );
}
