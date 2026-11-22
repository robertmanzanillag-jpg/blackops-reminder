import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { collectBuildProvenance, isRuntimeSourcePath } from "../script/build-provenance";
import { buildProvenance } from "../server/build-provenance";

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blackops-build-proof-"));
  for (const dir of ["server", "client/src", "shared", "script", "config"]) await mkdir(join(root, dir), { recursive: true });
  for (const [path, body] of Object.entries({ "package.json": "{}", "package-lock.json": "{}", ".replit": "run='node dist/index.cjs'", "server/index.ts": "export const boot=1;", "server/routes.ts": "export const routes=1;", "client/src/main.ts": "export const ui=1;", "shared/model.ts": "export const shared=1;", "script/worker.ts": "export const worker=1;", "config/local-news-delivery-policy.json": "{}" })) await writeFile(join(root, path), body);
  git(root, "init", "-q"); git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  return root;
}
test("clean tracked runtime identity includes preserved overrides and never trusts revision env", async () => {
  const root = await fixture(); const old = process.env.OFFICE_WEB_REVISION;
  try {
    process.env.OFFICE_WEB_REVISION = "f".repeat(40);
    const a = collectBuildProvenance(root);
    assert.equal(a.status, "verified"); assert.equal(a.trackedClean, true);
    assert.equal(a.revision, git(root, "rev-parse", "HEAD").toString().trim());
    assert.notEqual(a.revision, process.env.OFFICE_WEB_REVISION);
    for (const path of [".replit", "package.json", "package-lock.json", "server/routes.ts", "client/src/main.ts", "config/local-news-delivery-policy.json"]) {
      await writeFile(join(root, path), `changed:${path}`); git(root, "add", path);
      git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "preserved override");
      const b = collectBuildProvenance(root); assert.equal(b.status, "verified"); assert.notEqual(b.runtimeSourceSha256, a.runtimeSourceSha256);
      git(root, "revert", "--no-commit", "HEAD"); git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "restore");
    }
  } finally { if (old === undefined) delete process.env.OFFICE_WEB_REVISION; else process.env.OFFICE_WEB_REVISION=old; await rm(root, { recursive:true, force:true }); }
});
test("missing Git, dirty tracked files and unsafe source remain unverified", async () => {
  const absent = await mkdtemp(join(tmpdir(), "blackops-no-git-")); const root = await fixture();
  try {
    assert.equal(collectBuildProvenance(absent).status, "unverified");
    await writeFile(join(root, "server/index.ts"), "dirty");
    assert.equal(collectBuildProvenance(root).reason, "tracked_dirty");
    git(root,"add","server/index.ts"); assert.equal(collectBuildProvenance(root).status,"unverified");
    git(root,"reset","--hard","HEAD");
    await writeFile(join(root,"server/untracked.ts"),"export const extra=1;");
    assert.equal(collectBuildProvenance(root).reason,"tracked_dirty");
    await rm(join(root,"server/untracked.ts"));
    await symlink("/dev/null",join(root,"server/unsafe.ts")); git(root,"add","server/unsafe.ts");
    git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","symlink");
    assert.equal(collectBuildProvenance(root).reason,"source_unavailable");
  } finally { await rm(root,{recursive:true,force:true});await rm(absent,{recursive:true,force:true}); }
});
test("digest scope excludes secrets, archives, media, data and documents", () => {
  for (const path of [".env", "server/.env.ts", "secrets/key.ts", "server/private/data.ts", "server/backups/routes.ts", "client/src/media/video.ts", "docs/guide.ts", "server/customer.json", "office-current-source.zip", "../server/index.ts"]) assert.equal(isRuntimeSourcePath(path),false,path);
  for (const path of [".replit","package-lock.json","server/push-notifications.ts","server/storage.ts","shared/clippers-orchestra.ts","script/software-factory-worker.ts","client/src/components/notification-settings.tsx"]) assert.equal(isRuntimeSourcePath(path),true,path);
});
test("unstamped development health identity fails closed regardless of env", () => {
  const prior=process.env.OFFICE_WEB_REVISION;process.env.OFFICE_WEB_REVISION="a".repeat(40);
  try { assert.equal(buildProvenance().status,"unverified");assert.equal(buildProvenance().revision,null);assert.ok(Object.isFrozen(buildProvenance())); }
  finally {if(prior===undefined)delete process.env.OFFICE_WEB_REVISION;else process.env.OFFICE_WEB_REVISION=prior;}
});
test("compiled health field is literal, immutable through stale env, with matching emitted metadata", async () => {
  const root=await fixture(); const out=join(root,"health.cjs");
  try {
    const stamp=collectBuildProvenance(root);assert.equal(stamp.status,"verified");
    const {build}=await import("esbuild");
    await build({stdin:{contents:`import { buildProvenance } from ${JSON.stringify(resolve("server/build-provenance.ts"))}; export function health(){return {status:"ok",buildProvenance:buildProvenance()}}`,resolveDir:process.cwd(),loader:"ts"},outfile:out,bundle:true,platform:"node",format:"cjs",define:{__BLACKOPS_BUILD_PROVENANCE__:JSON.stringify(stamp)},logLevel:"silent"});
    const metadata=join(root,"build-provenance.json"); await writeFile(metadata,JSON.stringify(stamp));
    const actual=JSON.parse(execFileSync(process.execPath,["-e",`console.log(JSON.stringify(require(${JSON.stringify(out)}).health()))`],{env:{...process.env,OFFICE_WEB_REVISION:"b".repeat(40),BLACKOPS_BUILD_PROVENANCE:JSON.stringify({revision:"forged"})},encoding:"utf8"}));
    assert.deepEqual(actual.buildProvenance,stamp);assert.equal(actual.status,"ok");
    const index=await import("node:fs/promises").then(fs=>fs.readFile(resolve("server/index.ts"),"utf8"));
    assert.match(index,/buildProvenance: buildProvenance\(\)/);
  } finally {await rm(root,{recursive:true,force:true});}
});
