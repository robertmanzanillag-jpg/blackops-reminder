import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {cycleTotals,prepareOfficeSourceDocument} from "./office-source-documents";

/** Authenticated, bounded ingest for the Mac Clippers worker (see
 * script/clippers-office-bridge.mjs). The bearer token is
 * CLIPPERS_OFFICE_INGEST_TOKEN (>= 32 chars); without it the route fails closed. */
export const CLIPPERS_OFFICE_INGEST_PATH="/api/clippers/office-ingest";
const stamp=z.string().datetime({offset:true}),num=z.number().finite().nonnegative();
const bridgePayload=z.object({
 version:z.literal(1),
 metrics:z.object({generatedAt:stamp.nullable(),records:z.array(z.object({provider:z.string().regex(/^[a-z0-9_-]{1,40}$/),postId:z.string().min(1).max(400),accountId:z.string().min(1).max(500),clipId:z.string().min(1).max(500),publishedAt:stamp.nullable(),views:num,likes:num,comments:num,shares:num,saves:num}).strict()).max(2000)}).strict(),
 cycle:z.object({createdAt:stamp,status:z.enum(["blocked","partial","ready"]),totals:cycleTotals.strict()}).strict(),
}).strict();

export function hasValidClippersOfficeIngestToken(authorization:string|undefined,configured=process.env.CLIPPERS_OFFICE_INGEST_TOKEN):boolean {
 const token=String(configured||"").trim();
 if(token.length<32 || /replace|example|your[-_ ]?token/i.test(token))return false;
 const supplied=Buffer.from(String(authorization||"").replace(/^Bearer\s+/i,"").trim()),expected=Buffer.from(token);
 return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}

export function cycleReportKey(createdAt:string):string {
 return `automation-cycle-${new Date(createdAt).toISOString().replace(/[:.]/g,"-")}.json`;
}

type Queue=(input:{kind:"clip_metrics"|"clip_report";raw:unknown;owner:string;key?:string})=>boolean;
export type ClippersOfficeIngestResult={status:number;body:{ok:boolean;error?:string;records?:number;reportKey?:string}};

/** Validates the payload, rebuilds the producer-shaped documents server-side
 * (userId is always the server owner, never client supplied), checks both
 * project to "present" with the shared office schemas, then queues them. */
export function ingestClippersOfficeBridge(body:unknown,options:{owner:string;queue:Queue}):ClippersOfficeIngestResult {
 const parsed=bridgePayload.safeParse(body);
 if(!parsed.success)return {status:422,body:{ok:false,error:"INVALID_PAYLOAD"}};
 const {cycle}=parsed.data;
 // Provider-neutral records -> the existing clip_metrics producer shape.
 const metrics={generatedAt:parsed.data.metrics.generatedAt,records:parsed.data.metrics.records.map(({provider,postId,...rest})=>({id:`${provider}:${postId}`,...rest}))};
 if(cycle.totals.posts>10000)return {status:422,body:{ok:false,error:"INVALID_PAYLOAD"}};
 const createdAt=new Date(cycle.createdAt).toISOString(),key=cycleReportKey(createdAt);
 const id=`mac-free-local-worker-${createdAt}`;
 const rawCycle={id,userId:options.owner,createdAt,automation:{id,createdAt,status:cycle.status,totals:cycle.totals,posts:Array.from({length:cycle.totals.posts},()=>null)}};
 const checks=[prepareOfficeSourceDocument("clip_metrics",metrics,{owner:options.owner}),prepareOfficeSourceDocument("clip_report",rawCycle,{owner:options.owner,key})];
 if(checks.some(c=>c.status!=="present"))return {status:422,body:{ok:false,error:"SCHEMA_REJECTED"}};
 const a=options.queue({kind:"clip_metrics",raw:metrics,owner:options.owner});
 const b=options.queue({kind:"clip_report",raw:rawCycle,owner:options.owner,key});
 if(!a||!b)return {status:503,body:{ok:false,error:"OFFICE_SOURCE_DOCUMENTS_UNAVAILABLE"}};
 return {status:202,body:{ok:true,records:metrics.records.length,reportKey:key}};
}
