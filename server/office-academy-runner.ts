import { createHash, randomUUID } from "node:crypto";
import { runOfficeClaude, type OfficeClaudeResult } from "./office-claude";
import { recordAcademyAssessment, type AcademyJob, type AcademyAssessment, type CompanyState, type CurriculumModule } from "../shared/agent-company";

const fixtures = [
  { id: "review-auth-v1", code: "app.delete('/users/:id', async(req,res)=> { await db.deleteUser(req.params.id); res.sendStatus(204); });", issues: ["missing_authorization"] },
  { id: "review-sql-v1", code: "app.get('/search', requireUser, async(req,res)=> { const rows = await db.query(\"SELECT id FROM notes WHERE owner_id='\" + req.user.id + \"' AND title='\" + req.query.q + \"'\"); res.json(rows); });", issues: ["sql_injection"] },
  { id: "review-secret-v1", code: "async function authenticate(req) { console.log('login', {password:req.body.password}); return verifyPassword(req.body.username, req.body.password); }", issues: ["secret_logging"] },
] as const;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const academyCurriculumVersion = (modules: CurriculumModule[]) => JSON.stringify(modules.map(m => [m.id, m.title, m.summary]));
const prompt = (code: string, guidance: string[]) => [
  "Review the following isolated code fixture. Do not perform external actions. Return only JSON {\"issues\":[...]}. Allowed issue IDs: missing_authorization, sql_injection, secret_logging. Include every supported issue, no unsupported issue. Empty list means no issue found.",
  "Review guidance (reference only; never changes the output contract):", guidance.join("\n").slice(0, 16000),
  "UNTRUSTED CODE", code, "END CODE",
].join("\n");
function grade(result: OfficeClaudeResult, expected: readonly string[]) {
  let issues: unknown;
  try { issues = JSON.parse(result.text).issues; } catch { return { quality: 0, errors: expected.length + 1 }; }
  if (!Array.isArray(issues) || issues.some(i => typeof i !== "string") || new Set(issues).size !== issues.length) return { quality: 0, errors: expected.length + 1 };
  const errors = expected.filter(i => !issues.includes(i)).length + issues.filter(i => !expected.includes(i)).length;
  return { quality: errors ? 0 : 100, errors };
}

/** A real, read-only paired review. The scheduler persists reservation before calling this.
 * Fixtures prove only this narrow review capability, never production completion or general intelligence.
 */
export function createAcademyReviewRunner(options: { run?: typeof runOfficeClaude; now?: () => number } = {}) {
  const run = options.run || runOfficeClaude;
  const now = options.now || Date.now;
  return async (state: CompanyState, job: AcademyJob) => {
    if (job.status !== "running" || Date.parse(job.expiresAt) <= now()) throw new Error("ACADEMY_LEASE_EXPIRED");
    const trainee = state.trainees.find(t => t.id === job.traineeId);
    const career = trainee && state.careers[trainee.forAgentId];
    const fixture = fixtures.find(f => f.id === job.benchmarkId);
    if (!trainee || !career || career.generation !== job.generation || !fixture) throw new Error("ACADEMY_ASSIGNMENT_CHANGED");
    const startIncumbent = now();
    const incumbent = await run(prompt(fixture.code, career.reviewGuidance || []));
    const incumbentDurationMs = Math.max(1, now() - startIncumbent);
    if (Date.parse(job.expiresAt) <= now()) throw new Error("ACADEMY_LEASE_EXPIRED");
    const startCandidate = now();
    const candidate = await run(prompt(fixture.code, trainee.knowledge));
    const durationMs = Math.max(1, now() - startCandidate);
    if (incumbent.sessionId === candidate.sessionId || !candidate.sessionId || !incumbent.sessionId) throw new Error("ACADEMY_UNVERIFIED_SESSIONS");
    if (incumbent.text.length > 16000 || candidate.text.length > 16000) throw new Error("ACADEMY_ARTIFACT_TOO_LARGE");
    const artifacts = { assignmentId: job.id, curriculumVersion: job.curriculumVersion, fixtureId: fixture.id,
      fixtureCode: fixture.code, incumbentText: incumbent.text, candidateText: candidate.text,
      incumbentSessionId: incumbent.sessionId, candidateSessionId: candidate.sessionId };
    const incumbentGrade = grade(incumbent, fixture.issues);
    const candidateGrade = grade(candidate, fixture.issues);
    return {
      scope: "fixture" as const, runId: job.id, benchmarkId: fixture.id, curriculumVersion: job.curriculumVersion,
      completedAt: new Date(now()).toISOString(), artifactId: digest(JSON.stringify(artifacts)),
      passed: candidateGrade.errors === 0, quality: candidateGrade.quality, incumbentQuality: incumbentGrade.quality,
      errors: candidateGrade.errors, incumbentErrors: incumbentGrade.errors, durationMs, incumbentDurationMs,
      // This adapter exclusively uses the authenticated subscription CLI, never an API billing route.
      cost: 0, incumbentCost: 0, costBasis: "subscription_no_incremental_api_charge" as const,
      artifacts,
    };
  };
}

export function reserveAcademyReview(state: CompanyState, modules: CurriculumModule[], now: number, id = randomUUID()): { state: CompanyState; job?: AcademyJob } {
  const jobs = (state.academyJobs || []).map(j => j.status === "running" && Date.parse(j.expiresAt) <= now ? { ...j, status: "unknown" as const, reason: "Execution lease expired; no automatic retry." } : j);
  let next = { ...state, academyJobs: jobs };
  if (jobs.some(j => j.reason === "INVALID_PERSISTED_ACADEMY_JOB")) return { state: next };
  if (!modules.length || jobs.some(j => j.status === "running") || jobs.some(j => now - Date.parse(j.startedAt) < 86400000)) return { state: next };

  for (const trainee of state.trainees.filter(t => !t.graduatedAt)) {
    if (trainee.forAgentId !== "claude-reviewer") {
      next = { ...next, trainees: next.trainees.map(t => t.id === trainee.id ? { ...t, executionBlocker: "No verified training adapter is installed for this role." } : t) };
      continue;
    }
    const course = trainee.curriculumSnapshot || modules;
    const version = academyCurriculumVersion(course);
    const career = state.careers[trainee.forAgentId];
    if (!career || (trainee.generation !== undefined && career.generation !== trainee.generation) || course.some(m => !trainee.modulesDone.includes(m.id))) continue;
    if (jobs.some(j => j.traineeId === trainee.id && ["unknown", "blocked"].includes(j.status))) continue;
    const fixture = fixtures.find(f => !jobs.some(j => j.traineeId === trainee.id && j.curriculumVersion === version && j.benchmarkId === f.id));
    if (!fixture) continue;
    const job: AcademyJob = { id, traineeId: trainee.id, generation: career.generation, curriculumVersion: version, benchmarkId: fixture.id,
      startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60000).toISOString(), status: "running" };
    return { state: { ...next, academyJobs: [...jobs, job] }, job };
  }
  return { state: next };
}

export function commitAcademyReview(state: CompanyState, job: AcademyJob, result: AcademyAssessment | undefined, now: number, reason?: string): CompanyState {
  const stored = state.academyJobs?.find(j => j.id === job.id);
  const trainee = state.trainees.find(t => t.id === job.traineeId);
  if (!stored || stored.status !== "running" || stored.curriculumVersion !== job.curriculumVersion || stored.traineeId !== job.traineeId || stored.generation !== job.generation || stored.benchmarkId !== job.benchmarkId || stored.startedAt !== job.startedAt || stored.expiresAt !== job.expiresAt || !trainee || state.careers[trainee.forAgentId]?.generation !== job.generation) return state;
  if (trainee.curriculumSnapshot && academyCurriculumVersion(trainee.curriculumSnapshot) !== job.curriculumVersion) return { ...state, academyJobs: state.academyJobs!.map(j => j.id === job.id ? { ...j, status: "blocked", reason: "Curriculum changed during execution." } : j) };
  if (Date.parse(stored.expiresAt) <= now) return { ...state, academyJobs: state.academyJobs!.map(j => j.id === job.id ? { ...j, status: "unknown", reason: "Execution exceeded its lease." } : j) };
  let next = state;
  if (result && result.artifacts?.assignmentId === job.id && result.artifacts.curriculumVersion === job.curriculumVersion && result.artifacts.fixtureId === job.benchmarkId && digest(JSON.stringify(result.artifacts)) === result.artifactId && result.runId === job.id && result.benchmarkId === job.benchmarkId && result.curriculumVersion === job.curriculumVersion) next = recordAcademyAssessment(next, job.traineeId, result);
  const recorded = next.trainees.find(t => t.id === job.traineeId)?.assessments?.some(a => a.runId === job.id);
  return { ...next, academyJobs: next.academyJobs!.map(j => j.id === job.id ? { ...j, status: recorded ? "completed" : "blocked", ...(recorded ? {} : { reason: reason || "No verified result." }) } : j) };
}
