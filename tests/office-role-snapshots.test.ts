import test from "node:test";
import assert from "node:assert/strict";
import {readRoleSnapshot,SQL_AUDIT_ROLES} from "../server/office-role-snapshots";
test("every audit read binds canonical owner, projects safe fields and closes transaction",async()=>{
 for(const role of SQL_AUDIT_ROLES){const queries:Array<{sql:string,args?:unknown[]}>=[];let released=false;const pool={connect:async()=>({query:async(sql:string,args?:unknown[])=>{queries.push({sql,args});return {rows:sql.startsWith("SELECT id FROM users")?[{id:"owner"}]:sql.includes("clock_timestamp")?[{observed:new Date("2026-11-07T01:00:00Z")}]:[]};},release:()=>{released=true;}})};
 const source=await readRoleSnapshot(pool,"owner",role);assert.equal(source.total,0);assert.equal(released,true);assert.ok(queries.some(q=>q.sql.includes("READ ONLY")));assert.equal(queries.at(-1)!.sql,"COMMIT");
 for(const q of queries.filter(q=>q.sql.startsWith("SELECT")&&!q.sql.includes("clock_timestamp"))){assert.deepEqual(q.args,["owner"]);assert.match(q.sql,/\$1/);assert.ok(!/SELECT \*|oauth|secret|notes|clientName/i.test(q.sql));}
 }
});
test("foreign owner or invalid database rows rollback and never masquerade as empty",async()=>{
 for(const wrongIdentity of [true,false]){let rollback=false,released=false;const pool={connect:async()=>({query:async(sql:string)=>{if(sql==="ROLLBACK")rollback=true;return {rows:sql.startsWith("SELECT id FROM users")?[{id:wrongIdentity?"other":"owner"}]:sql.includes("FROM investments")?[{id:"bad",total:1}]:[]};},release:()=>{released=true;}})};await assert.rejects(()=>readRoleSnapshot(pool,"owner","portfolio"));assert.equal(rollback,true);assert.equal(released,true);}
});
