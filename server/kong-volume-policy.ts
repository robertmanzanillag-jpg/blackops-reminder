import { cohort, median, type LearningLedger, type Observation } from "./kong-content-learning";
import { dayInNewYork, dayPlus, networks, type Network } from "./kong-autopilot-core";
import type { PublishedCreative } from "./kong-metricool-learning";

export type DailyVolume = 5 | 6 | 7;
export interface VolumeEvidence {
  horizon: "72h"; baselineDays: string[]; recentDays: string[];
  baselinePosts: number; recentPosts: number;
  metric?: "shares" | "websiteClicks";
  medianViews?: number; baselineMedianViews?: number;
  medianPrimaryPerThousand?: number | null; baselineMedianPrimaryPerThousand?: number | null;
  medianPrimaryCount?: number; baselineMedianPrimaryCount?: number;
  medianDailyViews?: number; baselineMedianDailyViews?: number;
}
export interface NetworkVolumePolicy {
  target: DailyVolume; evaluatedAt: string; lastChangedAt?: string;
  reason: string; evidence: VolumeEvidence;
}
export interface VolumePolicyState { version: 1; networks: Record<Network, NetworkVolumePolicy>; }
const DAY = 86400_000;
const emptyEvidence = (): VolumeEvidence => ({horizon:"72h",baselineDays:[],recentDays:[],baselinePosts:0,recentPosts:0});
export const volumeTargets = (state:VolumePolicyState):Record<Network,DailyVolume> => ({tiktok:state.networks.tiktok.target,facebook:state.networks.facebook.target});

/** Operational trial heuristic, not causal optimization or a prediction. Only
 * full registered days with age-comparable 72h observations can change volume.
 * At least 7 baseline + 7 recent days are required; missing is never zero. */
export function evaluateKongVolumePolicy(previous:VolumePolicyState|undefined, ledger:LearningLedger|undefined,
  registry:PublishedCreative[], now:Date):VolumePolicyState {
  if(!Number.isFinite(+now)) throw Error("invalid_volume_clock");
  if(previous && previous.version!==1) throw Error("invalid_volume_policy");
  const result={} as Record<Network,NetworkVolumePolicy>;
  for(const network of networks){
    const prior=previous?.networks?.[network], target=prior?.target??5;
    if(![5,6,7].includes(target) || (prior?.lastChangedAt && (!Number.isFinite(Date.parse(prior.lastChangedAt)) || Date.parse(prior.lastChangedAt)>+now))) throw Error("invalid_volume_policy");
    const next:NetworkVolumePolicy={target,evaluatedAt:now.toISOString(),lastChangedAt:prior?.lastChangedAt,
      reason:"insufficient_comparable_complete_days",evidence:emptyEvidence()};result[network]=next;
    if(!ledger || ledger.version!==1) continue;
    // Duplicate/conflicting registry identity or snapshot metadata cannot support decisions.
    const registered=new Map<string,PublishedCreative>();let conflict=false;
    for(const p of registry.filter(p=>p.network===network)){
      if(registered.has(p.postId) || !Number.isFinite(Date.parse(p.publishedAt)) || Date.parse(p.publishedAt)>+now){conflict=true;break;}
      registered.set(p.postId,p);
    }
    if(conflict){next.reason="publication_registry_needs_reconciliation";continue;}
    const rows=cohort(ledger,network,"72h",now).filter(o=>{
      const p=registered.get(o.postId);return p && Date.parse(o.publishedAt)===Date.parse(p.publishedAt)
        && o.sourceUrl===p.publicUrl && o.family===p.family && o.hookStyle===p.hookStyle;
    });
    const byId=new Map(rows.map(o=>[o.postId,o]));
    const days=new Map<string,PublishedCreative[]>();
    for(const p of registered.values()){
      const day=dayInNewYork(new Date(p.publishedAt));days.set(day,[...(days.get(day)||[]),p]);
    }
    // Use the latest date with any measured snapshot, never cherry-pick an earlier winning week.
    const end=rows.map(o=>dayInNewYork(new Date(o.publishedAt))).sort().at(-1);
    if(!end || end<dayPlus(dayInNewYork(now),-5)){next.reason="fresh_72h_evidence_unavailable";continue;}
    const baselineDays=Array.from({length:7},(_,i)=>dayPlus(end,i-13));
    const recentDays=Array.from({length:7},(_,i)=>dayPlus(end,i-6));
    const complete=(day:string,minimum:number)=>{
      const posts=days.get(day)||[];
      return posts.length>=minimum && posts.every(p=>{
        const o=byId.get(p.postId);return o && o.metrics.views!=null && Number.isFinite(o.metrics.views) && o.metrics.views>=0;
      });
    };
    next.evidence.baselineDays=baselineDays;next.evidence.recentDays=recentDays;
    if(!baselineDays.every(d=>complete(d,5)) || !recentDays.every(d=>complete(d,target))) continue;
    const getRows=(ds:string[])=>ds.flatMap(d=>days.get(d)!.map(p=>byId.get(p.postId)!));
    const base=getRows(baselineDays), recent=getRows(recentDays);
    next.evidence.baselinePosts=base.length;next.evidence.recentPosts=recent.length;
    if(prior?.lastChangedAt && recent.some(o=>Date.parse(o.publishedAt)<Date.parse(prior.lastChangedAt!))){next.reason="need_complete_days_at_current_volume";continue;}
    const metric=(["shares","websiteClicks"] as const).find(m=>[...base,...recent].every(o=>o.metrics[m]!=null));
    if(!metric){next.reason="non_view_outcome_missing";continue;}
    const view=(rs:Observation[])=>median(rs.map(o=>o.metrics.views!))!;
    // Zero exposure has no defined engagement rate. Preserve null rather than
    // inventing 0/0 or dropping zero-view posts and biasing the sample.
    const primary=(rs:Observation[])=>rs.some(o=>o.metrics.views===0) ? null : median(rs.map(o=>o.metrics[metric]!/o.metrics.views!*1000));
    const primaryCount=(rs:Observation[])=>median(rs.map(o=>o.metrics[metric]!))!;
    if([...base,...recent].some(o=>o.metrics.views===0 && o.metrics[metric]!>0)){next.reason="inconsistent_zero_view_outcome_needs_reconciliation";continue;}
    const daily=(ds:string[])=>median(ds.map(d=>days.get(d)!.reduce((sum,p)=>sum+byId.get(p.postId)!.metrics.views!,0)))!;
    const b=view(base),r=view(recent),bp=primary(base),rp=primary(recent),bc=primaryCount(base),rc=primaryCount(recent),bd=daily(baselineDays),rd=daily(recentDays);
    Object.assign(next.evidence,{metric,medianViews:r,baselineMedianViews:b,medianPrimaryPerThousand:rp,
      baselineMedianPrimaryPerThousand:bp,medianPrimaryCount:rc,baselineMedianPrimaryCount:bc,medianDailyViews:rd,baselineMedianDailyViews:bd});
    if(bc<=0 || b<=0){next.reason="positive_non_view_baseline_required";continue;}
    if(prior?.lastChangedAt && +now-Date.parse(prior.lastChangedAt)<7*DAY){next.reason="weekly_change_cooldown";continue;}
    const adequateExposure=[...base,...recent].every(o=>o.metrics.views!>=100);
    const improve=adequateExposure && bp!==null && bp>0 && rp!==null && r>=b*1.2 && rp>=bp*1.1 && rd>=bd;
    // When rate is undefined because exposure is zero, joint declines in actual
    // non-view counts and views can still justify rolling back a volume trial.
    const primaryWeak=bp!==null && bp>0 && rp!==null ? rp<=bp*.8 : rc<=bc*.8;
    const weak=primaryWeak && (r<=b*.8 || rd<=bd*.8);
    if(weak && target>5){next.target=(target-1) as DailyVolume;next.lastChangedAt=now.toISOString();next.reason="revert_one_volume_step_descriptive_decline";}
    else if(improve && target<7){next.target=(target+1) as DailyVolume;next.lastChangedAt=now.toISOString();next.reason="trial_one_additional_daily_post_descriptive_signal";}
    else next.reason=target===5&&weak?"floor_five_preserved":target===7&&improve?"trial_ceiling_seven_preserved":"hold_current_volume_mixed_or_neutral_evidence";
  }
  return {version:1,networks:result};
}
