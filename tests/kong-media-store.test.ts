import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyImmutableMedia, storeRenderedMedia } from "../server/kong-media-store";
const bytes = Buffer.from("synthetic-mp4-transport-fixture");
const sha = createHash("sha256").update(bytes).digest("hex");
const origin = "https://drive.usercontent.google.com";
test("anonymous complete media hash verifies across approved redirect", async () => {
  const calls: string[] = [];
  const fetcher = (async (url, options) => {
    calls.push(String(url)); assert.equal(options?.redirect, "manual"); assert.equal(options?.headers, undefined);
    return calls.length === 1 ? new Response(null, {status:302,headers:{location:"/asset.mp4"}})
      : new Response(bytes, {headers:{"content-type":"video/mp4"}});
  }) as typeof fetch;
  const result = await verifyImmutableMedia(`${origin}/download`, sha, [origin], fetcher);
  assert.equal(result.sha256, sha); assert.equal(calls.length, 2);
});
test("redirect cannot escape approved origin; HTML and changed bytes rejected", async () => {
  let calls = 0;
  await assert.rejects(verifyImmutableMedia(`${origin}/download`, sha, [origin], (async () => {
    calls++; return new Response(null, {status:302,headers:{location:"http://127.0.0.1/private"}});
  }) as typeof fetch), /unapproved_media_origin/); assert.equal(calls, 1);
  await assert.rejects(verifyImmutableMedia(`${origin}/download`, sha, [origin], (async () => new Response("interstitial", {headers:{"content-type":"text/html"}})) as typeof fetch), /invalid_public_video_response/);
  await assert.rejects(verifyImmutableMedia(`${origin}/download`, sha, [origin], (async () => new Response("changed", {headers:{"content-type":"video/mp4"}})) as typeof fetch), /public_media_hash_mismatch/);
});
test("public distribution requires explicit asset authorization before filesystem or upload", async () => {
  await assert.rejects(storeRenderedMedia({filePath:"/does-not-exist",sha256:sha,folderId:"valid-folder-123",userId:"owner",approvedPublicOrigins:[origin],authorizedForPublicDistribution:false}), /public_distribution_not_authorized/);
});
test("storage copies reviewed bytes under hash filename, verifies receipt and cleans temporary copy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kong-store-test-"));
  let uploadedPath = "";
  try {
    const filePath = path.join(directory, "render.mp4"); await writeFile(filePath, bytes);
    const result = await storeRenderedMedia({filePath,sha256:sha,folderId:"valid-folder-123",userId:"owner",approvedPublicOrigins:[origin],authorizedForPublicDistribution:true}, {
      upload: async (p, folder, user) => { uploadedPath = p; assert.equal(path.basename(p), `${sha}.mp4`); assert.equal(folder,"valid-folder-123"); assert.equal(user,"owner"); assert.deepEqual(await readFile(p),bytes); return "public-file-123"; },
      publicUrl: async id => { assert.equal(id,"public-file-123"); return `${origin}/download`; },
      fetch: (async () => new Response(bytes,{headers:{"content-type":"video/mp4"}})) as typeof fetch,
    });
    assert.equal(result.fileId,"public-file-123"); assert.equal(result.bytes,bytes.length);
    await assert.rejects(access(uploadedPath));
    assert.deepEqual(await readFile(filePath),bytes);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
test("failed public verification also cleans upload copy and preserves source", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kong-store-test-")); let uploadedPath = "";
  try {
    const filePath = path.join(directory,"source.mp4"); await writeFile(filePath,bytes);
    await assert.rejects(storeRenderedMedia({filePath,sha256:sha,folderId:"valid-folder-123",userId:"owner",approvedPublicOrigins:[origin],authorizedForPublicDistribution:true}, {
      upload: async p => {uploadedPath=p; return "file-123456789";}, publicUrl:async()=>`${origin}/download`,
      fetch:(async()=>new Response("quota",{headers:{"content-type":"text/html"}})) as typeof fetch,
    }),/invalid_public_video_response/);
    await assert.rejects(access(uploadedPath)); assert.deepEqual(await readFile(filePath),bytes);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
