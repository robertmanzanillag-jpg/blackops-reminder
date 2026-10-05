import assert from "node:assert/strict";
import test from "node:test";
import { buildRobertCredentialCloseoutQueue } from "../server/clippers-agent";

const setup = { credentialDropDiagnostic: { files: [], acceptedEnvVars: [], rejectedEnvVars: [], dropDirs: [], status: "no_candidates", totals: { files: 0, dropCandidates: 0, rootCandidates: 0, importEligible: 0, templateFiles: 0, pendingEnvVars: 0, fileErrors: 0 }, nextStep: "No files." }, credentialDropDirs: [], credentialTransferKitItems: [] } as any;

test("missing runtime configuration stays pending without drop files", () => {
  const prior = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  try {
    const queue = buildRobertCredentialCloseoutQueue(setup);
    assert.equal(queue.files.length, 0);
    assert.ok(queue.runtimeEnv.missingEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
    assert.ok(queue.pendingEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
    assert.equal(queue.totals.pendingEnvVars, queue.pendingEnvVars.length);
    assert.match(queue.nextStep, /runtime/);
  } finally { if (prior === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN; else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = prior; }
});

test("configured runtime value is not reported as pending even with an old placeholder", () => {
  const prior = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = "offline-test-configured-value";
  try {
    const queue = buildRobertCredentialCloseoutQueue({ ...setup, credentialDropDiagnostic: { ...setup.credentialDropDiagnostic, files: [{ pendingEnvVars: ["GOOGLE_DRIVE_REFRESH_TOKEN"] }] } });
    assert.ok(queue.runtimeEnv.configuredEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
    assert.ok(!queue.pendingEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
    assert.ok(!JSON.stringify(queue).includes("offline-test-configured-value"));
  } finally { if (prior === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN; else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = prior; }
});
