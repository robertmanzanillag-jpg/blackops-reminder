export function reviewedDispatchMode(manifest:any):'exact'|'owner_hour_window';
export function validateReviewedDispatch(manifest:any,now?:number):{start:number;end:number}|null;
export function selectReviewedHourSlot(manifest:any,now?:number):string;
export function reviewedDeliverySlot(record:any):string;
export function reviewedHourWindowDueRecords(state:any,options?:{now?:number}):string[];
