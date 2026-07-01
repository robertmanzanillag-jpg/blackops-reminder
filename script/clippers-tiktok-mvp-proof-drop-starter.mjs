import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const proofDropDir = path.join(rootDir, "proof-drop", "tiktok-mvp");
const filledDropPath = path.join(proofDropDir, "proof-links-paste-packet-filled.txt");
const handoffPath = path.join(reportsDir, "proof-handoff.json");

function runJsonScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${scriptPath} failed`);
  }
  return result.stdout ? JSON.parse(result.stdout) : {};
}

async function readJson(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function containsSecretLikeText(value) {
  return /access_token=|refresh_token=|client_secret=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|(?:^|[\s"'[{,?&#;=])(cookie|password|passcode|recovery|api[_-]?key|private[_ -]?key)["']?\s*[:=]/i.test(String(value || ""))
    || /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i.test(String(value || ""))
    || /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|refresh|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i.test(String(value || ""));
}

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(proofDropDir, { recursive: true });
  const existing = await readFile(filledDropPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing !== null && !force) {
    if (containsSecretLikeText(existing)) throw new Error("Existing proof drop contains secret-like text; remove secrets before using the starter flow.");
    console.log(JSON.stringify({
      status: "preserved_existing",
      generatedAt: new Date().toISOString(),
      sourcePath: filledDropPath,
      bytes: Buffer.byteLength(existing, "utf8"),
      overwritten: false,
      realPublishEnabled: false,
      directSocialApisRequired: false,
      nextStep: "Existing proof drop was preserved. Edit it with real non-secret SPORT and memes proof URLs, then run the import/preview flow.",
    }, null, 2));
    return;
  }

  let handoff = await readJson(handoffPath);
  if (!handoff?.fastPathPastePacketText && !handoff?.pastePacketText) {
    runJsonScript("script/clippers-tiktok-mvp-proof-handoff.mjs");
    handoff = await readJson(handoffPath);
  }
  const starterText = String(handoff?.fastPathPastePacketText || handoff?.pastePacketText || "").trimEnd();
  if (!starterText.trim()) throw new Error("Proof handoff did not produce a proof links starter packet.");
  if (containsSecretLikeText(starterText)) throw new Error("Proof starter unexpectedly contains secret-like text; refusing to write.");

  await writeFile(filledDropPath, `${starterText}\n`);
  console.log(JSON.stringify({
    status: existing !== null ? "overwritten_by_force" : "created",
    generatedAt: new Date().toISOString(),
    sourcePath: filledDropPath,
    bytes: Buffer.byteLength(`${starterText}\n`, "utf8"),
    overwritten: existing !== null,
    starterKind: starterText.includes("Metricool fast-path proof packet") ? "metricool_fast_path" : "full_paste_packet",
    realPublishEnabled: false,
    directSocialApisRequired: false,
    guardrails: [
      "Creates only a local proof-drop starter file.",
      "Does not save proof-links.json.",
      "Does not apply evidence, queue Metricool, schedule, publish, or enable direct APIs.",
      "Use --force only if you intentionally want to replace the local starter/drop file.",
    ],
    nextStep: "Fill the blank proof URL lines with real non-secret SPORT and memes Metricool or concrete Drive/Docs proof URLs, then run Import preview.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
