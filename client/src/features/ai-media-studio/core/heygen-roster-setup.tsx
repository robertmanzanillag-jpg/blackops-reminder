import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, type FieldErrors, type UseFormRegisterReturn } from "react-hook-form";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  HEYGEN_ROSTER_MAX_AVATARS,
  HEYGEN_ROSTER_MAX_PLANNED_VIDEOS,
  HEYGEN_ROSTER_MIN_AVATARS,
  HEYGEN_ROSTER_MIN_PLANNED_VIDEOS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  createHeyGenRosterRequestSchema,
} from "@shared/ai-media-studio-heygen-roster";
import { useConfigureHeyGenRoster, useHeyGenRoster, useHeyGenRosterDailyPlan } from "./hooks";
import type {
  CreateHeyGenRosterMember,
  CreateHeyGenRosterRequest,
  HeyGenRosterGender,
} from "./types";
import type { HeyGenOnboardingReadiness } from "@shared/ai-media-studio-heygen-onboarding";

const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30 disabled:cursor-not-allowed disabled:opacity-50";
const nativeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const languagePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

type RosterFormValues = { members: CreateHeyGenRosterMember[] };
type Attempt = { fingerprint: string; key: string };

const genderOptions: ReadonlyArray<{ value: HeyGenRosterGender; label: string }> = [
  { value: "unspecified", label: "Unspecified" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
];

export function emptyHeyGenRosterMember(): CreateHeyGenRosterMember {
  return { name: "", avatarId: "", voiceId: "", language: "en-US", accent: "Neutral", gender: "unspecified" };
}

function initialValues(): RosterFormValues {
  return { members: Array.from({ length: HEYGEN_ROSTER_MIN_AVATARS }, emptyHeyGenRosterMember) };
}

export function newHeyGenRosterAttemptKey(): string {
  if (typeof crypto === "undefined") throw new Error("Secure randomness is unavailable");
  if (typeof crypto.randomUUID === "function") return `heygen-roster-${crypto.randomUUID()}`;
  if (typeof crypto.getRandomValues !== "function") throw new Error("Secure randomness is unavailable");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `heygen-roster-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function TextField({
  id,
  label,
  registration,
  error,
  hint,
  privateValue = false,
}: {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  hint?: string;
  privateValue?: boolean;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <Label htmlFor={id}>{label} <span aria-hidden="true">*</span></Label>
      <input
        id={id}
        required
        aria-required="true"
        aria-invalid={Boolean(error)}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        autoComplete="off"
        spellCheck={privateValue ? false : undefined}
        className={inputClass}
        {...registration}
      />
      {hint && <p id={hintId} className="mt-1 text-xs leading-5 text-zinc-400">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-xs text-red-200">{error}</p>}
    </div>
  );
}

function firstInvalidMemberField(errors: FieldErrors<RosterFormValues>): string | undefined {
  const members = errors.members;
  if (!Array.isArray(members)) return undefined;
  for (const [index, member] of members.entries()) {
    if (!member) continue;
    const field = Object.keys(member)[0];
    if (field) return `heygen-member-${index}-${field}`;
  }
  return undefined;
}

export function HeyGenRosterSetup({ onboardingReadiness }: { onboardingReadiness: HeyGenOnboardingReadiness }) {
  const rosterObservationAllowed = onboardingReadiness.status === "ready_for_roster_ids"
    || onboardingReadiness.status === "roster_configured_blocked";
  const rosterQuery = useHeyGenRoster(rosterObservationAllowed);
  const mutation = useConfigureHeyGenRoster();
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const attemptRef = useRef<Attempt | undefined>(undefined);
  const statusRef = useRef<HTMLDivElement>(null);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<RosterFormValues>({ defaultValues: initialValues() });
  const { fields, append, remove } = useFieldArray({ control, name: "members" });
  const plannedVideoCount = fields.length * HEYGEN_ROSTER_VIDEOS_PER_AVATAR;
  const currentRoster = mutation.data?.roster ?? rosterQuery.data?.roster;
  const dailyPlanQuery = useHeyGenRosterDailyPlan(rosterObservationAllowed && Boolean(currentRoster));
  const dailyPlan = dailyPlanQuery.data?.plan;
  const setupBlocked = rosterObservationAllowed && (rosterQuery.isLoading || rosterQuery.isError);
  const staleRoster = onboardingReadiness.status === "stale_roster_binding";
  const canCollectProviderIds = onboardingReadiness.status === "ready_for_roster_ids"
    || onboardingReadiness.status === "roster_configured_blocked"
    || staleRoster;
  const showRosterForm = canCollectProviderIds && (staleRoster ? replaceConfirmed : !currentRoster || replaceConfirmed);

  useEffect(() => {
    setReplaceConfirmed(false);
  }, [onboardingReadiness.status]);

  const invalid = (invalidFields: FieldErrors<RosterFormValues>) => {
    const id = firstInvalidMemberField(invalidFields);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  const submit = (values: RosterFormValues) => {
    const normalizedMembers = values.members.map((member) => ({
      name: member.name.trim(),
      avatarId: member.avatarId.trim(),
      voiceId: member.voiceId.trim(),
      language: member.language.trim(),
      accent: member.accent.trim(),
      gender: member.gender,
    }));
    const fingerprint = JSON.stringify(normalizedMembers);
    let key: string;
    try {
      if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
        attemptRef.current = { fingerprint, key: newHeyGenRosterAttemptKey() };
      }
      key = attemptRef.current.key;
    } catch {
      setError("root", { message: "A secure save attempt could not be started. Reload and try again." });
      return;
    }
    const request: CreateHeyGenRosterRequest = { members: normalizedMembers, idempotencyKey: key };
    const parsed = createHeyGenRosterRequestSchema.safeParse(request);
    if (!parsed.success) {
      setError("root", { message: "Review the highlighted roster values before saving." });
      return;
    }
    mutation.mutate(parsed.data, {
      onSuccess: () => {
        attemptRef.current = undefined;
        reset(initialValues());
        setReplaceConfirmed(false);
        requestAnimationFrame(() => statusRef.current?.focus());
      },
    });
  };

  return (
    <section id="heygen-roster" aria-labelledby="heygen-roster-heading" className="scroll-mt-24 rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.035] p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">HeyGen launch setup</p>
          <h2 id="heygen-roster-heading" className="mt-2 text-2xl font-semibold text-white">Connect the first avatar roster</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">Paste the avatar and voice IDs from HeyGen for 5–10 creators. Kong stores their provider mapping privately and keeps the public creator profiles provider-neutral.</p>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3"><dt className="text-zinc-400">Target per avatar</dt><dd className="mt-1 text-lg font-semibold text-white">{HEYGEN_ROSTER_VIDEOS_PER_AVATAR}</dd></div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3"><dt className="text-zinc-400">This roster plans</dt><dd className="mt-1 text-lg font-semibold text-white">{plannedVideoCount}</dd></div>
        </dl>
      </div>

      <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100">
        This plans {HEYGEN_ROSTER_MIN_PLANNED_VIDEOS}–{HEYGEN_ROSTER_MAX_PLANNED_VIDEOS} videos; it does not generate or spend credits. Provider access, consent/rights, governance approval, budget admission, and a separate launch approval remain required.
      </div>

      {rosterQuery.isLoading && <p role="status" className="mt-4 text-sm text-zinc-400">Checking the current roster…</p>}
      {rosterQuery.isError && (
        <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
          <p>The current roster status is unavailable. Saving remains blocked until the setup can be checked.</p>
          <Button type="button" size="sm" variant="outline" className="shrink-0 border-red-200/30 bg-transparent text-red-50" disabled={rosterQuery.isFetching} onClick={() => rosterQuery.refetch()}>{rosterQuery.isFetching ? "Checking…" : "Retry status check"}</Button>
        </div>
      )}

      {currentRoster && (
        <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="mt-6 rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-4 text-sm text-emerald-50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">Roster configured: {currentRoster.avatarCount} avatars and {currentRoster.plannedVideoCount} planned videos.</p>
              <p className="mt-1 text-xs leading-5 text-emerald-100/80">Saved provider IDs stay private. The form is closed until replacement is explicitly confirmed.</p>
            </div>
            {!replaceConfirmed && (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline" className="shrink-0 border-emerald-200/25 bg-transparent text-emerald-50">Replace roster</Button></AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-zinc-950 text-white">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Replace the saved HeyGen roster?</AlertDialogTitle>
                    <AlertDialogDescription className="text-zinc-400">Cancel keeps the current roster unchanged. Confirm only opens a fresh ID form; it does not delete, generate, call HeyGen, or spend credits.{!canCollectProviderIds ? " Replacement remains unavailable until readiness returns ready for roster IDs." : ""}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-white/15 bg-white/5 text-white">Keep current roster</AlertDialogCancel>
                    <AlertDialogAction disabled={!canCollectProviderIds} className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" onClick={() => setReplaceConfirmed(true)}>Open replacement form</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {currentRoster.members.map((member) => <li key={member.memberId} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">{member.name} · {member.language} · {member.videosPlanned} planned</li>)}
          </ul>
          <p className="mt-3 text-xs leading-5 text-emerald-100/80">Next blocker: complete rights/governance and launch approvals before generation.</p>
        </div>
      )}

      {staleRoster && !replaceConfirmed && (
        <div role="status" className="mt-6 rounded-xl border border-amber-300/25 bg-amber-400/[0.08] p-4 text-sm text-amber-50">
          <p className="font-semibold">The saved roster belongs to an older credential version.</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/80">Replace all 5–10 avatar and voice mappings before any live verification. The existing blocked plan remains inert.</p>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline" className="mt-3 border-amber-200/30 bg-transparent text-amber-50">Replace stale roster</Button></AlertDialogTrigger>
            <AlertDialogContent className="border-white/10 bg-zinc-950 text-white">
              <AlertDialogHeader>
                <AlertDialogTitle>Open a fresh roster for the new credential version?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">Cancel preserves the existing blocked roster. Confirm only opens empty ID fields; it does not call HeyGen, generate, publish, or spend credits.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/15 bg-white/5 text-white">Keep blocked roster</AlertDialogCancel>
                <AlertDialogAction className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" onClick={() => setReplaceConfirmed(true)}>Open replacement form</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {!canCollectProviderIds && !currentRoster && !rosterQuery.isLoading && !rosterQuery.isError && (
        <p role="status" className="mt-5 rounded-lg border border-amber-300/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100">Avatar and voice ID entry remains closed until secure onboarding reports ready for roster IDs.</p>
      )}

      {showRosterForm && <form onSubmit={handleSubmit(submit, invalid)} noValidate className="mt-6 space-y-5">
        <fieldset disabled={mutation.isPending || setupBlocked} className="space-y-4">
          <legend className="sr-only">HeyGen avatar and voice roster</legend>
          {fields.map((field, index) => {
            const fieldErrors = errors.members?.[index];
            const prefix = `heygen-member-${index}`;
            return (
              <div key={field.id} className="rounded-xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="font-medium text-zinc-100">Avatar {index + 1}</h3>
                  <Button type="button" size="sm" variant="ghost" className="text-zinc-300 hover:text-red-200" disabled={fields.length <= HEYGEN_ROSTER_MIN_AVATARS} onClick={() => remove(index)} aria-label={`Remove avatar ${index + 1}`}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <TextField id={`${prefix}-name`} label="Creator name" registration={register(`members.${index}.name`, { required: "Enter a creator name", maxLength: { value: 120, message: "Use 120 characters or fewer" }, validate: (value) => !controlCharacterPattern.test(value) || "Remove control characters" })} error={fieldErrors?.name?.message} />
                  <TextField id={`${prefix}-avatarId`} label="HeyGen avatar ID" privateValue hint="ID only — never paste an API key here." registration={register(`members.${index}.avatarId`, { required: "Enter the HeyGen avatar ID", maxLength: { value: 256, message: "Use 256 characters or fewer" }, pattern: { value: nativeIdPattern, message: "Use a valid HeyGen avatar ID" }, validate: (value, form) => form.members.findIndex((member) => member.avatarId.trim() === value.trim()) === index || "Each avatar ID must be unique" })} error={fieldErrors?.avatarId?.message} />
                  <TextField id={`${prefix}-voiceId`} label="HeyGen voice ID" privateValue hint="A voice may be shared by more than one avatar." registration={register(`members.${index}.voiceId`, { required: "Enter the HeyGen voice ID", maxLength: { value: 256, message: "Use 256 characters or fewer" }, pattern: { value: nativeIdPattern, message: "Use a valid HeyGen voice ID" } })} error={fieldErrors?.voiceId?.message} />
                  <TextField id={`${prefix}-language`} label="Language" hint="Use a locale such as en-US or es-MX." registration={register(`members.${index}.language`, { required: "Enter a language", maxLength: { value: 35, message: "Use 35 characters or fewer" }, pattern: { value: languagePattern, message: "Use a valid language locale" } })} error={fieldErrors?.language?.message} />
                  <TextField id={`${prefix}-accent`} label="Accent" registration={register(`members.${index}.accent`, { required: "Enter an accent", maxLength: { value: 80, message: "Use 80 characters or fewer" }, validate: (value) => !controlCharacterPattern.test(value) || "Remove control characters" })} error={fieldErrors?.accent?.message} />
                  <div>
                    <Label htmlFor={`${prefix}-gender`}>Gender <span aria-hidden="true">*</span></Label>
                    <select id={`${prefix}-gender`} required aria-required="true" className={inputClass} {...register(`members.${index}.gender`, { required: true })}>
                      {genderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" className="border-white/15 bg-white/5 text-zinc-100" disabled={mutation.isPending || setupBlocked || fields.length >= HEYGEN_ROSTER_MAX_AVATARS} onClick={() => append(emptyHeyGenRosterMember())}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Add avatar ({fields.length}/{HEYGEN_ROSTER_MAX_AVATARS})
          </Button>
          <Button type="submit" className="min-h-11 bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={mutation.isPending || setupBlocked} aria-busy={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {mutation.isPending ? "Saving roster…" : `Save ${fields.length} avatars`}
          </Button>
        </div>

        {(errors.root || mutation.isError) && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{errors.root?.message ?? "The roster could not be saved. Check the setup and retry; no generation was started."}</p>}
      </form>}

      {currentRoster && !dailyPlan && (dailyPlanQuery.isLoading || dailyPlanQuery.isFetching) && (
        <p role="status" className="mt-4 text-sm text-zinc-400">Preparing the no-spend daily plan preview…</p>
      )}
      {currentRoster && dailyPlanQuery.isError && (
        <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
          <p>The daily plan preview is unavailable. No jobs were queued and no credits were spent.</p>
          <Button type="button" size="sm" variant="outline" className="shrink-0 border-red-200/30 bg-transparent text-red-50" disabled={dailyPlanQuery.isFetching} onClick={() => dailyPlanQuery.refetch()}>{dailyPlanQuery.isFetching ? "Checking…" : "Retry daily plan"}</Button>
        </div>
      )}

      {dailyPlan && (
        <div aria-labelledby="heygen-daily-plan-heading" className="mt-4 rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-4 text-sm text-sky-50">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 id="heygen-daily-plan-heading" className="font-semibold">Daily plan preview: {dailyPlan.plannedVideoCount} videos</h3>
              <p className="mt-1 text-xs leading-5 text-sky-100/80">
                {dailyPlan.planDate} · {dailyPlan.timeZone}. {dailyPlan.avatarCount} avatars × {dailyPlan.videosPerAvatar} videos each. All slots are blocked before generation, so this view creates no jobs and spends no credits.
              </p>
            </div>
            <span className="rounded-full border border-sky-200/25 px-3 py-1 text-xs font-medium text-sky-100">No spend: {dailyPlan.noSpendGuarantee ? "on" : "off"}</span>
          </div>
          <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/15 p-3"><dt className="text-sky-100/70">Queued</dt><dd className="mt-1 font-semibold text-white">0</dd></div>
            <div className="rounded-lg border border-white/10 bg-black/15 p-3"><dt className="text-sky-100/70">Plan slots</dt><dd className="mt-1 font-semibold text-white">{dailyPlan.slots.length}</dd></div>
            <div className="rounded-lg border border-white/10 bg-black/15 p-3"><dt className="text-sky-100/70">Generation allowed</dt><dd className="mt-1 font-semibold text-white">{dailyPlan.canGenerate ? "Yes" : "No"}</dd></div>
          </dl>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-sky-100/70">Blockers before launch</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {dailyPlan.blockers.map((blocker) => (
              <li key={blocker} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{blocker.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
