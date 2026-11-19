export interface StreamerState { version: 1; failureStreak?: number; updatedAt: string | null; lastRun: any; creators: Record<string, any>; takedowns: any[]; candidates: any[]; signals: any[]; cityPages?: any[] }
export declare const STREAMER_SECRET_NAMES: readonly string[];
export declare const STREAMER_APPROVAL_ACTION: string;
export declare function STREAMER_STATE_NAMESPACE(owner: string): string;
export declare function parseStreamerState(raw: string | null): StreamerState;
export declare function emptyStreamerState(): StreamerState;
export declare function localWorkQueue(state: StreamerState): Array<Record<string, unknown>>;
export declare function streamerConfig(env?: Record<string, string | undefined>): Record<string, any>;
export declare function runStreamerDiscovery(input: Record<string, any>): Promise<{ report: any; state: StreamerState }>;
