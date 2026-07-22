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
  assert.match(workbench, /return crypto\.randomUUID\(\)/);
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
  assert.match(workbench, /item\.script\.selectedVariant\.angle/);
  assert.match(workbench, /item\.script\.selectedVariant\.title/);
  assert.match(workbench, /item\.script\.selectedVariant\.hook/);
  assert.match(workbench, /item\.script\.selectedVariant\.script/);
  assert.match(workbench, /item\.script\.selectedVariant\.cta/);
  assert.match(workbench, /item\.script\.selectedVariant\.caption/);
  assert.match(workbench, /item\.script\.selectedVariant\.hashtags\.join/);
  assert.match(workbench, /item\.script\.selectedVariant\.seoKeywords\.join/);
  assert.match(workbench, /I reviewed the complete content/);
  assert.match(workbench, /Approve all \$\{batch\.plannedVideoCount\} scripts/);
  assert.match(workbench, /expectedBatchId: batch\.batchId/);
  assert.match(workbench, /disabled=\{!approvalAcknowledged \|\| !allReviewsAvailable \|\| approve\.isPending\}/);
  assert.match(workbench, /const identity = batch \? `\$\{batch\.planId\}:\$\{batch\.batchId\}` : undefined/);
  assert.match(workbench, /reviewedBatchRef\.current !== identity[\s\S]*setApprovalAcknowledged\(false\)[\s\S]*approvalAttemptRef\.current = undefined/);
  assert.match(workbench, /\[batch\?\.batchId, batch\?\.planId\]/);
  assert.match(workbench, /prepare\.reset\(\);[\s\S]*approve\.reset\(\);/);
  assert.match(workbench, /prepare\.isSuccess && batch\.status === "draft_ready"/);
  assert.match(workbench, /approve\.isSuccess && batch\.status === "approved_ready"/);
  assert.match(workbench, /Complete selected-variant content is required for every slot/);
  assert.match(workbench, /This batch cannot be approved because its source content changed/);
  assert.match(workbench, /href="#heygen-roster"/);
  assert.match(workbench, /No safe in-place refresh is available yet/);
  assert.match(workbench, />Scripts ready</);
  assert.doesNotMatch(workbench, />Draft scripts ready</);
  assert.doesNotMatch(workbench, /Approve (video|slot|script) /);
  assert.match(workbench, /LoadingPanel/);
  assert.match(workbench, /ErrorPanel/);
  assert.match(workbench, /EmptyPanel/);
  assert.doesNotMatch(workbench, />\s*(Generate|Queue|Retry)\b/);
  assert.doesNotMatch(workbench, /providerAccountId|avatarResourceId|voiceResourceId|nativeId/);
});

test("approval client action is one batch mutation and refreshes authoritative state", async () => {
  const [api, hooks] = await Promise.all([
    read("client/src/features/ai-media-studio/core/api.ts"),
    read("client/src/features/ai-media-studio/core/hooks.ts"),
  ]);
  assert.match(api, /\/production-batches\/\$\{encodeURIComponent\(planId\)\}\/approve-scripts/);
  assert.match(api, /body: JSON\.stringify\(input\)/);
  assert.match(hooks, /mutationFn: mediaStudioCoreApi\.approveProductionBatchScripts/);
  assert.match(hooks, /setQueryData\(coreStudioKeys\.productionBatch, response\)/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: coreStudioKeys\.productionBatch \}\)/);
  assert.doesNotMatch(api, /approve-(slot|item|video|script)\//);
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
