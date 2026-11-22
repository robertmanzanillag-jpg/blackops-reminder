// Read-only account identities for external observation. This registry cannot authorize publishing.
// Independent of the installed writer adapter, whose older account aliases may still be in use.
export const OBSERVED_ACCOUNTS=Object.freeze([
 {brandId:6431685,network:'tiktok',account:'streamersus'},
 {brandId:6431687,network:'tiktok',account:'streamersclipusa'},
 {brandId:6591612,network:'tiktok',account:'news305miami'},
 {brandId:6591612,network:'facebook',account:'1193011863901514'},
 {brandId:6595747,network:'facebook',account:'1198281286708321'},
].map(Object.freeze));
const aliases={'6431685:tiktok':'streamersclips','6591612:tiktok':'ynb4b6r6'};
export const findObservedAccount=value=>OBSERVED_ACCOUNTS.find(d=>typeof value?.account==='string'&&d.brandId===value?.brandId&&d.network===value?.network&&(d.account===value?.account||aliases[`${d.brandId}:${d.network}`]===value?.account));
export const observedAccountKey=value=>{const d=findObservedAccount(value)??value;return[d.brandId,d.network,d.account].join(':');};
export const observedLocalDay=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
