import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const read = (path: string) => readFile(resolve(repositoryRoot, path), "utf8");

test("production batch UI is preparation-only, accessible, and explicit about zero spend", async () => {
  const workbench = await read("client/src/features/ai-media-studio/core/production-batch-workbench.tsx");
  assert.match(workbench, /Preparation only · Generation disabled · No credits can be spent/);
  assert.match(workbench, /Prepare script batch — no credits/);
  assert.match(workbench, /batch\.status !== "not_started"/);
  assert.match(workbench, /Script refresh requires review/);
  assert.match(workbench, /variantCount: 3/);
  assert.match(workbench, /crypto\.randomUUID/);
  assert.match(workbench, /attemptRef\.current \?\?=/);
  assert.match(workbench, /planId: batch\.planId/);
  assert.match(workbench, /role="status"/);
  assert.match(workbench, /role="alert"/);
  assert.match(workbench, /const errorMessage = localError \|\| prepare\.error\?\.message/);
  assert.match(workbench, /aria-live="polite"/);
  assert.match(workbench, /<details/);
  assert.match(workbench, /<summary/);
  assert.match(workbench, /<ol/);
  assert.match(workbench, /item\.preparation === "draft"/);
  assert.match(workbench, /Source pending preparation/);
  assert.match(workbench, /Script: Not prepared/);
  assert.match(workbench, /LoadingPanel/);
  assert.match(workbench, /ErrorPanel/);
  assert.match(workbench, /EmptyPanel/);
  assert.doesNotMatch(workbench, />\s*(Generate|Queue|Retry|Approve)\b/);
  assert.doesNotMatch(workbench, /providerAccountId|avatarResourceId|voiceResourceId|nativeId/);
});

test("studio navigation replaces legacy creation and exposes no generation or retry mutation", async () => {
  const [page, navigation, api, hooks, jobList] = await Promise.all([
    read("client/src/pages/ai-media-studio.tsx"),
    read("client/src/features/ai-media-studio/navigation.ts"),
    read("client/src/features/ai-media-studio/api.ts"),
    read("client/src/features/ai-media-studio/hooks.ts"),
    read("client/src/features/ai-media-studio/job-list.tsx"),
  ]);
  assert.match(page, /ProductionBatchWorkbench/);
  assert.doesNotMatch(page, /CreateVideoWorkbench/);
  assert.match(navigation, /#production-batch/);
  assert.match(navigation, /Production batch/);
  assert.doesNotMatch(navigation, /Create video/);
  assert.doesNotMatch(api, /\/generations|\/retry|createGeneration|retryJob/);
  assert.doesNotMatch(hooks, /createGeneration|retryJob/);
  assert.doesNotMatch(jobList, />\s*Retry\s*</);
  assert.match(jobList, /cancel\.mutate\(job\.id\)/);
});
