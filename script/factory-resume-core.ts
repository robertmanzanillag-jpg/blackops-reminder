// Pure decision for the factory-ops `factory-resume` action. Resuming reuses the same store
// method as the owner web UI (POST /api/software-factory/pause -> store.setPaused(owner, false)).
// It refuses while any Factory job is `unknown` or the API authority reports an unknown hold.
export type ResumeInput = { paused: boolean; unknownJobs: number; apiUnknown: boolean;
  unknownHolds: { apiReservations: number; externalCheckpoint: number; factoryJobUnknown: boolean } };

export function decideResume(input: ResumeInput) {
  const refusal = input.unknownJobs > 0 || input.unknownHolds.factoryJobUnknown ? "FACTORY_JOB_UNKNOWN"
    : input.apiUnknown || input.unknownHolds.apiReservations > 0 || input.unknownHolds.externalCheckpoint > 0 ? "FACTORY_API_UNKNOWN_HOLD"
    : null;
  return { paused: input.paused, refusal, alreadyRunning: !input.paused && !refusal, wouldResume: input.paused && !refusal };
}

/** Dry run (apply=false) writes nothing. Apply calls setPaused(false) only when the decision allows it. */
export async function runResume(input: ResumeInput & { apply: boolean; setPaused: (paused: boolean) => Promise<unknown> }) {
  const decision = decideResume(input);
  if (input.apply && decision.wouldResume) { await input.setPaused(false); return { applied: true, ...decision }; }
  return { applied: false, ...decision };
}
