import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward=readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr27_heygen_terminal_forward.sql",
  import.meta.url,
),"utf8");
const rollback=readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr27_heygen_terminal_rollback.sql",
  import.meta.url,
),"utf8");
const compact=(value:string)=>value.replace(/\s+/gu," ");

const terminalSignatures=[
  "ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer)",
  "ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,timestamptz,text)",
  "ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)",
] as const;

test("PR27 removes default PUBLIC EXECUTE before granting only the reconciler role",()=>{
  const sql=compact(forward);
  const revokeStart=sql.indexOf(`REVOKE ALL ON FUNCTION ${terminalSignatures.join(", ")} FROM PUBLIC;`);
  const grantStart=sql.indexOf(`GRANT EXECUTE ON FUNCTION ${terminalSignatures.join(", ")} TO ai_media_admitted_reconcile_executor;`);

  assert.ok(revokeStart>=0,"all exact terminal function signatures must be revoked from PUBLIC");
  assert.ok(grantStart>revokeStart,"the function-only reconciler grant must follow the PUBLIC revoke");
});

test("PR27 evidence-preserving rollback revokes every terminal entrypoint from PUBLIC and reconciler",()=>{
  const sql=compact(rollback);
  const revoke=`REVOKE EXECUTE ON FUNCTION ${terminalSignatures.join(", ")} FROM PUBLIC,ai_media_admitted_reconcile_executor;`;

  assert.ok(sql.includes(revoke),"rollback must remove both default-public and explicit reconciler execution");
  for(const signature of terminalSignatures)
    assert.ok(sql.includes(`DROP FUNCTION ${signature};`),`rollback must drop ${signature}`);
});
