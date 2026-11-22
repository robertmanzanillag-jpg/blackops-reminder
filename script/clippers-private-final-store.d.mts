export const CHUNK_BYTES:number;
export const MAX_FINAL_BYTES:number;
export const OWNER_ACTIVE_BYTES:number;
export interface PrivateFinalStore {read(key:string):Promise<string|null>;transact(key:string,update:(raw:string|null)=>Promise<string>):Promise<string>}
export interface PrivateFinalSummary {status:string;ready:boolean;privateFinalRef:string;manifestSha256:string;byteLength:number;sha256:string;chunkBytes:number;receivedChunks:number;totalChunks:number;ownerUsageBytes:number}
type Request={store:PrivateFinalStore;owner:string;record:any;now?:number};
export function reservePrivateFinal(options:Request):Promise<PrivateFinalSummary>;
export function putPrivateFinalChunk(options:Request&{index:number;bytes:Uint8Array;sha256:string}):Promise<PrivateFinalSummary>;
export function finalizePrivateFinal(options:Request):Promise<PrivateFinalSummary>;
export function privateFinalStatus(options:Request):Promise<PrivateFinalSummary>;
export function assertPrivateFinalReady(options:Request):Promise<PrivateFinalSummary>;
export function streamPrivateFinalRange(options:Request&{start?:number;end?:number}):AsyncGenerator<Buffer>;
export function sealPrivateFinal(options:Request&{probe?:(file:string)=>Promise<unknown>}):Promise<{file:string;cleanup:()=>Promise<void>;verification:Record<string,unknown>}>;

export function cleanupPrivateFinals(options:{store:PrivateFinalStore;owner:string;now?:number;refs?:string[];maxFiles?:number}):Promise<{retired:number;bytesReclaimed:number;held:string[]}>;

export function inspectPrivateFinalForApproval(options:Request&{probe?:(file:string)=>Promise<unknown>;fetch?:typeof fetch;loadTrack?:any;verifyAudio?:any}):Promise<{origin:'private_final_owner_technical_inspection';manifestSha256:string;sha256:string;byteLength:number;checkedAt:string;audioProfile:string;audioVerification:Record<string,unknown>}>;
