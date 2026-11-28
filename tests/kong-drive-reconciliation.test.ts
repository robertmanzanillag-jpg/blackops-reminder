import test from "node:test";
import assert from "node:assert/strict";
import { findUniqueDriveHashFile } from "../server/google-drive";
const input = { sha256: "a".repeat(64), folderId: "folder-123456789", userId: "owner" };
const file = (id = "file-123456789") => ({ id, name: `${input.sha256}.mp4`, mimeType: "video/mp4", parents: [input.folderId] });
test("exact folder/hash lookup exhausts pagination read-only before accepting unique ID", async () => {
  let calls = 0;
  const result = await findUniqueDriveHashFile(input, async (request, options) => {
    calls++; assert.match(String(request.q), /trashed = false/); assert.match(String(request.q), new RegExp(input.folderId));
    assert.equal(request.pageSize, 100); assert.equal(options.timeout, 30000);
    if (calls === 1) return { data: { files: [file()], nextPageToken: "next" } };
    assert.equal(request.pageToken, "next"); return { data: { files: [] } };
  });
  assert.deepEqual(result, { fileId: "file-123456789" }); assert.equal(calls, 2);
});
test("duplicate later-page matches, incomplete search, wrong provenance, and repeated pagination fail closed", async () => {
  let calls = 0;
  await assert.rejects(findUniqueDriveHashFile(input, async () => ({ data: { files: [file(calls++ ? "second-123456789" : "first-123456789")], nextPageToken: "next" } })), /duplicate/);
  await assert.rejects(findUniqueDriveHashFile(input, async () => ({ data: { files: [], incompleteSearch: true } })), /incomplete/);
  await assert.rejects(findUniqueDriveHashFile(input, async () => ({ data: { files: [{ ...file(), parents: ["wrong-folder"] }] } })), /invalid_match/);
  await assert.rejects(findUniqueDriveHashFile(input, async () => ({ data: { files: [], nextPageToken: "same" } })), /repeated_page/);
  calls = 0;
  await assert.rejects(findUniqueDriveHashFile(input, async () => ({ data: { files: [], nextPageToken: String(++calls) } })), /page_limit/);
  assert.equal(calls, 5);
  assert.equal(await findUniqueDriveHashFile(input, async () => ({ data: { files: [] } })), null);
});
