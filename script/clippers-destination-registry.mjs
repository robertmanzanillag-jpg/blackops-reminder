import { createHash } from 'node:crypto';

// Reviewed 2026-11-19 account ownership. Hashes identify Metricool's provider IDs,
// not a claimed global TikTok numeric account ID. A handle alone is insufficient.
const ownerSha256 = 'fb3c03869319c1d817e9f046c8b9c5dd845644cf87b933f9aee6f2977b660a5d';
export const CURRENT_IDENTITY_PINS = Object.freeze([
  ['6431685', 'tiktok', 'streamersus', 'fb63bdfaa9113744a0ac88f006681c4c4b3f0d30ae603445a6e4df0840d35c68'],
  ['6431687', 'tiktok', 'streamersclipusa', 'de49eae7e4a6ecd29890db666526c020ced776e79440d4edcb23f5258e428e42'],
  ['6591612', 'tiktok', 'news305miami', 'b194c23510dc6214323567d35af20232c1273b502205cec9ec2e43afe5c6b237'],
  ['6591612', 'facebook', '1193011863901514', '476b008ebd56453fa0d9ff9ee2a76bbc5f5d61e9bcbd0f27b8ab54766c3a9147'],
  ['6595747', 'facebook', '1198281286708321', 'f5111cde9a7f630dd46ca96282a832e6d06cd948d8e4447d84db131a122afced'],
].map(([brandId,network,account,providerIdSha256]) => Object.freeze({brandId:Number(brandId),network,account,providerIdSha256,ownerSha256})));
export const DESTINATIONS = Object.freeze(CURRENT_IDENTITY_PINS.map(({brandId,network,account})=>Object.freeze({brandId,network,account})));
export const HISTORICAL_DESTINATIONS = Object.freeze([
  Object.freeze({brandId:6431685,network:'tiktok',account:'streamersclips'}),
  Object.freeze({brandId:6591612,network:'tiktok',account:'ynb4b6r6'}),
]);
// NY TikTok remains disconnected. Facebook was positively confirmed on 2026-11-19.
export const DISCONNECTED_BRAND = 6595747;
export const destinationKey = ({brandId,network,account}) => [brandId,network,account].join(':');
const matches = (d,value)=>d.brandId===value?.brandId&&d.network===value?.network&&d.account===value?.account;
export const findPublishDestination = value=>DESTINATIONS.find(d=>matches(d,value));
/** Immutable receipt/history validation only. Publication must use findPublishDestination. */
export const findDestination = value=>findPublishDestination(value)??HISTORICAL_DESTINATIONS.find(d=>matches(d,value));
const hash = value=>createHash('sha256').update(String(value)).digest('hex');
export function verifyCurrentIdentity(response,destination,userId) {
  const pin=CURRENT_IDENTITY_PINS.find(d=>matches(d,destination));
  return verifyIdentityPin(response,destination,userId,pin);
}
/** Pure comparison; production callers always supply the reviewed registry above. */
export function verifyIdentityPin(response,destination,userId,pin) {
  if(!pin||!matches(pin,destination)||hash(userId)!==pin.ownerSha256)return false;
  const data=response?.data??response;
  const row=Array.isArray(data)?(data.length===1?data[0]:null):data;
  if(!row||typeof row!=='object'||String(row.id??row.blogId)!==String(pin.brandId)||row.deleted===true||
    hash(row.ownerUserId??row.userId??'')!==pin.ownerSha256||
    (row.id!=null&&row.blogId!=null&&String(row.id)!==String(row.blogId))||
    (row.ownerUserId!=null&&row.userId!=null&&String(row.ownerUserId)!==String(row.userId)))return false;
  const network=row.networksData?.[pin.network+'Data']??row[pin.network+'Data'];
  if(!network||typeof network!=='object'||Array.isArray(network)||network.connected===false||network.enabled===false||
    network.expired===true||network.disconnected===true)return false;
  if(typeof network.providerUserId!=='string'||!network.providerUserId.length||network.providerUserId.length>512||
    hash(network.providerUserId)!==pin.providerIdSha256)return false;
  const account=pin.network==='facebook'?network.providerUserId:network.username;
  return typeof account==='string'&&account.replace(/^@/,'').toLowerCase()===pin.account;
}
/** Read-only alias grouping for dedupe/capacity; never grants publication eligibility. */
export function currentDestinationForHistory(value) {
  if(!findDestination(value))return undefined;
  return DESTINATIONS.find(d=>d.brandId===value.brandId&&d.network===value.network);
}
export const publicationDestinationKey = value=>{
  const current=currentDestinationForHistory(value);
  return current?destinationKey(current):null;
};
