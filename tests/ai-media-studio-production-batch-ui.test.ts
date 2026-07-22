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
  assert.match(workbench, /I reviewed all 10 complete scripts for \{group\.creatorName\}/);
  assert.match(workbench, /Creator review progress:/);
  assert.match(workbench, /Approve all \$\{batch\.plannedVideoCount\} scripts/);
  assert.match(workbench, /expectedBatchId: batch\.batchId/);
  assert.match(workbench, /disabled=\{!allCreatorsConfirmed \|\| !allReviewsAvailable \|\| approve\.isPending\}/);
  assert.match(workbench, /`\$\{batch\.planId\}:\$\{batch\.batchId\}:\$\{batch\.status\}:\$\{batch\.preparedAt \?\? "unprepared"\}`/);
  assert.match(workbench, /reviewedBatchRef\.current !== identity[\s\S]*setConfirmedMemberIds\(\[\]\)[\s\S]*approvalAttemptRef\.current = undefined/);
  assert.match(workbench, /const approvalMatchesCurrentBatch = approve\.isSuccess[\s\S]*approvalResultMatchesBatch\(approve\.data\.batch, batch\)/);
  assert.match(workbench, /function approvalResultMatchesBatch\([\s\S]*approval\.planId === batch\.planId[\s\S]*approval\.batchId === batch\.batchId[\s\S]*approval\.preparedAt === batch\.preparedAt[\s\S]*approval\.approvedAt === batch\.approvedAt/);
  assert.match(workbench, /const ownApprovalTransition = Boolean\([\s\S]*batch\.status === "approved_ready"[\s\S]*approve\.isPending[\s\S]*approve\.variables\.planId === batch\.planId[\s\S]*approve\.variables\.input\.expectedBatchId === batch\.batchId[\s\S]*\|\| approvalMatchesCurrentBatch/);
  assert.match(workbench, /if \(!ownApprovalTransition\) approve\.reset\(\)/);
  assert.doesNotMatch(workbench, /reviewedBatchRef\.current !== identity[\s\S]{0,180}approvalAttemptRef\.current = undefined;\s*approve\.reset\(\)/);
  assert.match(workbench, /approve\.data\?\.batch\.approvedAt/);
  assert.match(workbench, /approve\.variables\?\.input\.expectedBatchId/);
  assert.match(workbench, /batch\?\.approvedAt/);
  assert.match(workbench, /batch\.groups\.every\(\(group\) => confirmedMembers\.has\(group\.memberId\)\)/);
  assert.match(workbench, /checked=\{confirmedMembers\.has\(group\.memberId\)\}/);
  assert.match(workbench, /confirmCreatorReview\(group\.memberId, event\.currentTarget\.checked\)/);
  assert.match(workbench, /prepare\.reset\(\);[\s\S]*approve\.reset\(\);/);
  assert.match(workbench, /prepare\.isSuccess && batch\.status === "draft_ready"/);
  assert.match(workbench, /if \(approvalMatchesCurrentBatch\)[\s\S]*resultRef\.current\?\.focus\(\)/);
  assert.match(workbench, /\{approvalMatchesCurrentBatch && <div ref=\{resultRef\}/);
  assert.doesNotMatch(workbench, /approve\.isSuccess && batch\.status === "approved_ready"/);
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
  const creatorListIndex = workbench.indexOf('<ul className="space-y-3" aria-label={`${batch.avatarCount} creator production groups`}>');
  const approvalControlIndex = workbench.indexOf("Atomic script approval");
  const launchPreflightIndex = workbench.indexOf("<LaunchPreflightPanel", approvalControlIndex);
  assert.ok(creatorListIndex >= 0 && approvalControlIndex > creatorListIndex, "approval control must follow every creator group");
  assert.ok(launchPreflightIndex >= 0, "read-only launch preflight must be present");
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

test("launch preflight query is read-only, batch-scoped, disabled before approval, and exposes safe recovery", async () => {
  const [api, hooks, workbench] = await Promise.all([
    read("client/src/features/ai-media-studio/core/api.ts"),
    read("client/src/features/ai-media-studio/core/hooks.ts"),
    read("client/src/features/ai-media-studio/core/production-batch-workbench.tsx"),
  ]);
  assert.match(api, /\/production-batches\/\$\{encodeURIComponent\(planId\)\}\/launch-preflight/);
  assert.match(api, /launchPreflightResponseSchema\.parse/);
  assert.match(api, /subject\.planId !== planId \|\| parsed\.preflight\.subject\.batchId !== batchId/);
  assert.match(api, /404: "Launch preflight was not found for this approved batch\."/);
  assert.match(api, /409: "Launch preflight is not available for the current batch state\."/);
  assert.match(api, /503: "Launch preflight observation is temporarily unavailable\."/);
  assert.doesNotMatch(api, /productionBatchLaunchPreflight[\s\S]{0,500}method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.match(hooks, /productionBatchLaunchPreflight: \(planId: string, batchId: string\)/);
  assert.match(hooks, /"launch-preflight", planId, batchId/);
  assert.match(hooks, /enabled: enabled && Boolean\(planId\) && Boolean\(batchId\)/);
  assert.match(hooks, /retry: false/);
  assert.match(hooks, /refetchOnWindowFocus: false/);
  assert.match(workbench, /enabled=\{batch\.status === "approved_ready"\}/);
  assert.match(workbench, /query\.refetch\(\)/);
  assert.match(workbench, /Refresh read-only check/);
  assert.match(workbench, /Refreshing the read-only observation/);
  assert.match(workbench, /Script approval is not launch approval and does not authorize spend/);
  assert.match(workbench, /Offline foundation ready/);
  assert.match(workbench, /preflight\.summary\.readySlots/);
  assert.match(workbench, /preflight\.summary\.requiredSlots/);
  assert.match(workbench, /preflight\.summary\.pendingExternalGates/);
  assert.match(workbench, /preflight\.summary\.pendingHumanGates/);
  assert.match(workbench, /preflight\.summary\.unavailableGates/);
  assert.match(workbench, /preflight\.gates\.map/);
  assert.match(workbench, /launchGateStateLabels\[gate\.state\]/);
  assert.match(workbench, /launchNextActions\[gate\.nextActionCode\]/);
  assert.match(workbench, /aria-label="Fourteen launch preflight gates"/);
  assert.match(workbench, /role="status" aria-live="polite"/);
  assert.match(workbench, /ErrorPanel message=\{query\.error\.message\}/);
  assert.match(workbench, /grid gap-3 lg:grid-cols-2/);
  assert.doesNotMatch(workbench, /<table/);
  const buttonBlocks = Array.from(workbench.matchAll(/<Button\b[\s\S]*?<\/Button>/g), (match) => match[0]);
  assert.ok(buttonBlocks.length > 0);
  for (const button of buttonBlocks) assert.doesNotMatch(button, />\s*(Generate|Launch|Spend)\b/);
});

test("launch preflight maps every contract next action locally and only to safe in-page links", async () => {
  const [contract, workbench] = await Promise.all([
    read("shared/ai-media-studio-launch-preflight.ts"),
    read("client/src/features/ai-media-studio/core/production-batch-workbench.tsx"),
  ]);
  const actionList = contract.match(/export const launchPreflightNextActionCodes = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
  const actions = Array.from(actionList.matchAll(/"([a-z_]+)"/g), (match) => match[1]);
  assert.equal(actions.length, 22);
  for (const action of actions) assert.match(workbench, new RegExp(`\\b${action}: \\{`));
  const hrefs = Array.from(workbench.matchAll(/href: "([^"]+)"/g), (match) => match[1]);
  assert.ok(hrefs.length > 0);
  assert.ok(hrefs.every((href) => href === "#production-batch" || href === "#heygen-roster"));
});

test("approved batch keeps execution inert while exposing a separate exact-quote approval mutation", async () => {
  const [api, hooks, workbench] = await Promise.all([
    read("client/src/features/ai-media-studio/core/api.ts"),
    read("client/src/features/ai-media-studio/core/hooks.ts"),
    read("client/src/features/ai-media-studio/core/production-batch-workbench.tsx"),
  ]);
  assert.match(api, /\/production-batches\/\$\{encodeURIComponent\(planId\)\}\/sandbox-readiness\/\$\{encodeURIComponent\(slotId\)\}/);
  assert.match(api, /sandboxReadinessResponseSchema\.parse/);
  assert.match(api, /subject\.planId !== planId \|\| subject\.batchId !== batchId \|\| subject\.slotId !== slotId/);
  assert.doesNotMatch(api, /productionBatchSandboxReadiness[\s\S]{0,700}method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.match(hooks, /productionBatchSandboxReadiness\(planId, batchId, slotId\)/);
  assert.match(hooks, /enabled: enabled && Boolean\(planId\) && Boolean\(batchId\) && Boolean\(slotId\)/);
  assert.match(hooks, /retry: false/);
  assert.match(hooks, /refetchOnWindowFocus: false/);
  assert.match(workbench, /batch\.status === "approved_ready" && \(/);
  assert.match(workbench, /<label htmlFor="sandbox-approved-slot"/);
  assert.match(workbench, /<select[\s\S]*value=\{selectedSlotId\}[\s\S]*setSelectedSlotId/);
  assert.match(workbench, /approvedSlots\[0\]\?\.item\.slotId/);
  assert.match(workbench, /Refresh readiness packet/);
  assert.match(workbench, /No spend · No provider call · No execution/);
  assert.match(workbench, /Connecting the provider API remains a separate, later approval step/);
  assert.match(workbench, /aspect-\[9\/16\]/);
  assert.match(workbench, /Vertical · 9:16/);
  assert.match(workbench, /packet\.preview\.creatorName/);
  assert.match(workbench, /packet\.preview\.script\.script/);
  assert.match(workbench, /packet\.gates\.map/);
  assert.match(workbench, /aria-label="Six one-video sandbox readiness gates"/);
  assert.match(workbench, /Required external steps — not performed here/);
  assert.match(api, /oneVideoExecutionControlResponseSchema\.parse/);
  assert.match(api, /one-video-execution-control\/\$\{encodeURIComponent\(slotId\)\}/);
  const executionApi = api.slice(api.indexOf("oneVideoExecutionControl: async"), api.indexOf("oneVideoCostApprovalRuntime: async"));
  assert.doesNotMatch(executionApi, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.match(api, /one-video-cost-approval\/\$\{encodeURIComponent\(slotId\)\}/);
  assert.match(api, /expectedQuoteKey/);
  assert.match(api, /oneVideoCostApprovalResponseSchema\.parse/);
  assert.match(hooks, /mutationFn: mediaStudioCoreApi\.recordOneVideoCostApproval/);
  assert.match(hooks, /oneVideoExecutionControl\(planId, batchId, slotId\)/);
  assert.match(workbench, /key=\{`\$\{batch\.planId\}:\$\{batch\.batchId\}:\$\{selectedSlotId\}`\}/);
  assert.match(workbench, /Execution disabled\. This screen cannot call HeyGen or spend credits\./);
  assert.match(workbench, /Refresh does not contact HeyGen/);
  assert.match(workbench, /Server-attested maximum quote/);
  assert.match(workbench, /formatMaximumQuoteUsd/);
  assert.match(workbench, /Quote key:/);
  assert.match(workbench, /Render spec key:/);
  assert.match(workbench, /Review exact quote approval/);
  assert.match(workbench, /approvalEnabled = quoteIsExact && runtimeAvailable && !alreadyApproved/);
  assert.match(workbench, /<button[\s\S]*disabled[\s\S]*aria-describedby=\{blockerId\}[\s\S]*Execute one approved video/);
  assert.doesNotMatch(workbench, /Execute one approved video[\s\S]{0,180}onClick/);
  assert.doesNotMatch(workbench, /providerAccountId|avatarResourceId|voiceResourceId|nativeId/);
  const buttonBlocks = Array.from(workbench.matchAll(/<Button\b[\s\S]*?<\/Button>/g), (match) => match[0]);
  for (const button of buttonBlocks) assert.doesNotMatch(button, />\s*(Generate|Spend)\b/);
});

test("exact quote approval uses a separate accessible confirmation dialog and resets confirmation identity", async () => {
  const [dialog, workbench] = await Promise.all([
    read("client/src/features/ai-media-studio/core/one-video-cost-approval-dialog.tsx"),
    read("client/src/features/ai-media-studio/core/production-batch-workbench.tsx"),
  ]);
  assert.match(dialog, /<DialogTitle>Approve this exact one-video quote\?<\/DialogTitle>/);
  assert.match(dialog, /Approve exact quote — no generation/);
  assert.match(dialog, /checked=\{confirmed\}/);
  assert.match(dialog, /disabled=\{!confirmed \|\| isPending\}/);
  assert.match(dialog, /setConfirmed\(false\)/);
  assert.match(dialog, /\[open, quote\.quoteKey, quote\.renderSpecKey\]/);
  assert.match(dialog, /<time dateTime=\{quote\.expiresAt\}>\{quote\.expiresAt\}<\/time>/);
  assert.match(dialog, /quote\.quoteKey/);
  assert.match(dialog, /quote\.renderSpecKey/);
  assert.match(dialog, /does not generate a video, call HeyGen, reserve credits, or authorize spend/);
  assert.match(workbench, /expectedBatchId: batchId/);
  assert.match(workbench, /expectedQuoteKey: quoteKey/);
  assert.match(workbench, /decision: "approved"/);
  assert.match(workbench, /operationRef\.current = undefined/);
  assert.match(workbench, /\[quoteKey, renderSpecKey\]/);
  assert.match(workbench, /Execute one approved video/);
  assert.doesNotMatch(workbench, /Execute one approved video[\s\S]{0,180}onClick/);
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
