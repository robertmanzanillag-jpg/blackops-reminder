import test from "node:test";
import assert from "node:assert/strict";
import { runSoftwareFactoryOnce, FACTORY_CLAIM_WINDOW_MS } from "../server/software-factory-once";
function fixture() {
 let time=0,scheduled=0,ticks=0,maintained=0,stopped=0;
 const intervals=new Map<number,()=>void>(),timers=new Map<number,()=>void>();let serial=0;
 const clock={setTimeout:(fn:()=>void,_ms:number)=>{timers.set(++serial,fn);return serial;},clearTimeout:(id:unknown)=>{timers.delete(id as number);},setInterval:(fn:()=>void,_ms:number)=>{intervals.set(++serial,fn);return serial;},clearInterval:(id:unknown)=>{intervals.delete(id as number);}};
 const worker={schedule:async()=>{scheduled++;},tick:async()=>{ticks++;return {kind:"idle" as const};},maintain:async()=>{maintained++;},stop:()=>{stopped++;}};
 const signal=new AbortController();
 return {worker,signal,clock,options:{signal:signal.signal,maxStages:4,durationMs:1800000,clock,now:()=>time},advance:(ms:number)=>{time+=ms;},interval:()=>{for(const fn of intervals.values())fn();},expire:()=>{for(const fn of timers.values())fn();},counts:()=>({scheduled,ticks,maintained,stopped,timers:timers.size,intervals:intervals.size})};
}
test("idle exits without dormant polling and releases all timers",async()=>{
 const f=fixture();assert.deepEqual(await runSoftwareFactoryOnce(f.worker,f.options),{reason:"idle",progressed:0});assert.deepEqual(f.counts(),{scheduled:1,ticks:1,maintained:0,stopped:1,timers:0,intervals:0});
});
test("bounded stages continue immediately but never claim without a full lease and settlement window",async()=>{
 const f=fixture();let calls=0;f.worker.tick=async()=>{calls++;f.advance(600000);return {kind:"progressed"} as any;};
 assert.deepEqual(await runSoftwareFactoryOnce(f.worker,f.options),{reason:"deadline",progressed:2});assert.equal(calls,2);
 const g=fixture();g.worker.tick=async()=>({kind:"progressed"} as any);assert.deepEqual(await runSoftwareFactoryOnce(g.worker,{...g.options,maxStages:2}),{reason:"stage-limit",progressed:2});
});
test("active work maintains and aborts without another claim or replay",async()=>{
 const f=fixture();let release!:()=>void;const active=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 f.worker.tick=async()=>{calls++;f.interval();await active;return {kind:"quarantined"} as any;};
 const running=runSoftwareFactoryOnce(f.worker,f.options);await Promise.resolve();await Promise.resolve();f.signal.abort();release();
 assert.equal((await running).reason,"aborted");assert.equal(calls,1);assert.equal(f.counts().maintained,1);assert.ok(f.counts().stopped>=1);assert.equal(f.counts().intervals,0);
});
test("maintenance or admission uncertainty never continues to another stage",async()=>{
 const f=fixture();let calls=0;f.worker.maintain=async()=>{throw Error("private failure");};f.worker.tick=async()=>{calls++;f.interval();await Promise.resolve();return {kind:"progressed"} as any;};
 assert.equal((await runSoftwareFactoryOnce(f.worker,f.options)).reason,"quarantined");assert.equal(calls,1);
 const g=fixture();g.worker.schedule=async()=>{throw Error("lost ack");};assert.equal((await runSoftwareFactoryOnce(g.worker,g.options)).reason,"quarantined");assert.equal(g.counts().ticks,0);
});
test("pre-abort, elapsed admission, busy and unknown results never loop",async()=>{
 const f=fixture();f.signal.abort();assert.equal((await runSoftwareFactoryOnce(f.worker,f.options)).reason,"aborted");assert.equal(f.counts().scheduled,0);
 const g=fixture();g.worker.schedule=async()=>{g.advance(1800000-FACTORY_CLAIM_WINDOW_MS+1);};assert.equal((await runSoftwareFactoryOnce(g.worker,g.options)).reason,"deadline");assert.equal(g.counts().ticks,0);
 for(const kind of ["retry","quarantined"]){const h=fixture();let calls=0;h.worker.tick=async()=>{calls++;return {kind,delayMs:5000} as any;};assert.equal((await runSoftwareFactoryOnce(h.worker,h.options)).reason,kind==="retry"?"busy":"quarantined");assert.equal(calls,1);}
});
test("invalid bounds reject before schedule or claim",async()=>{
 const f=fixture();for(const changes of [{maxStages:0},{maxStages:9},{durationMs:FACTORY_CLAIM_WINDOW_MS-1},{durationMs:1800001}])await assert.rejects(runSoftwareFactoryOnce(f.worker,{...f.options,...changes}),/LIMIT_INVALID/);assert.equal(f.counts().scheduled,0);
});

test("hard deadline never hides a quarantined active outcome",async()=>{
 const f=fixture();let calls=0;f.worker.tick=async()=>{calls++;f.expire();return {kind:"quarantined"} as any;};
 assert.equal((await runSoftwareFactoryOnce(f.worker,f.options)).reason,"quarantined");assert.equal(calls,1);assert.ok(f.counts().stopped>=1);assert.equal(f.counts().timers,0);
});

test("verified completion followed by invocation deadline is a clean bounded exit",async()=>{
 const f=fixture();let calls=0;f.worker.tick=async()=>{calls++;f.expire();return {kind:"progressed"} as any;};
 assert.equal((await runSoftwareFactoryOnce(f.worker,f.options)).reason,"deadline");assert.equal(calls,1);assert.equal(f.counts().timers,0);
});
test("quarantine reports the failing stage and only a safe code-owned error code",async()=>{
 const { factoryOnceFailure } = await import("../server/software-factory-diagnostics");
 const secret="owner order text postgres://u:p@h/db";
 const logs:string[]=[];const onFailure=(stage:string,error:unknown)=>logs.push(JSON.stringify(factoryOnceFailure(error,"execution",stage)));
 const a=fixture();a.worker.schedule=async()=>{throw Error("FACTORY_DISCOVERY_SCOPE_INVALID");};
 assert.equal((await runSoftwareFactoryOnce(a.worker,{...a.options,onFailure})).reason,"quarantined");
 const b=fixture();b.worker.tick=async()=>{throw Error(secret);};
 assert.equal((await runSoftwareFactoryOnce(b.worker,{...b.options,onFailure})).reason,"quarantined");
 const c=fixture();c.worker.tick=async()=>({kind:"quarantined"} as any);
 assert.equal((await runSoftwareFactoryOnce(c.worker,{...c.options,onFailure:(s,e)=>{onFailure(s,e);throw Error("x");}})).reason,"quarantined");
 const parsed=logs.map(l=>JSON.parse(l));
 assert.equal(parsed[1].errorClass,"CLASS_Error");assert.match(parsed[1].frame,/^[A-Za-z0-9_.-]+\.(?:ts|mjs|js):\d+$/);delete parsed[1].errorClass;delete parsed[1].frame;
 assert.deepEqual(parsed,[
  {event:"factory_once_failure",phase:"execution",stage:"schedule",code:"FACTORY_DISCOVERY_SCOPE_INVALID",automaticReplay:false},
  {event:"factory_once_failure",phase:"execution",stage:"tick",code:"FACTORY_ONCE_UNAVAILABLE",automaticReplay:false},
  {event:"factory_once_failure",phase:"execution",stage:"tick-quarantined",code:"FACTORY_ONCE_UNAVAILABLE",automaticReplay:false}]);
 assert.equal(logs.join().includes(secret),false);
});
