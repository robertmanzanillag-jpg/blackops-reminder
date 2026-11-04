import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildOrganicPeerHypotheses } from '../server/organic-peer-hypotheses.mjs';
const exec = promisify(execFile);
// Fixed public discovery targets, never accepts URLs from page content or private reports.
export const SOURCES = ['https://www.youtube.com/@boilerroom/shorts','https://www.youtube.com/@residentadvisor/shorts'];
export async function refreshOrganicPeerScout(dir, {now = new Date(), run = exec} = {}) {
  const file = path.join(dir,'organic-peer-hypotheses.json');
  let prior; try { prior=JSON.parse(await readFile(file,'utf8')); } catch {}
  const elapsed=now.getTime()-Date.parse(prior?.evaluatedAt);
  if (elapsed>=0 && elapsed<86400000) return prior;
  const observations=[], sources=[];
  for (const source of SOURCES) {
    try {
      const {stdout}=await run('yt-dlp',['--ignore-config','--skip-download','--no-warnings','--playlist-end','6','--dump-single-json',source],{timeout:90000,maxBuffer:2000000});
      const data=JSON.parse(stdout);
      const channel=data.channel_id;
      if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel||'')) throw new Error('Unverified channel');
      for (const e of (data.entries||[]).slice(0,6)) {
        if (e.channel_id!==channel || !/^[A-Za-z0-9_-]{11}$/.test(e.id||'') || !Number.isFinite(e.timestamp)) continue;
        for (const relevantTo of ['blackroom','kong']) observations.push({relevantTo,url:'https://www.youtube.com/shorts/'+e.id,observedAt:now.toISOString(),publishedAt:new Date(e.timestamp*1000).toISOString(),durationSeconds:e.duration,views:e.view_count});
      }
      sources.push({url:source,channelId:channel,status:'observed'});
    } catch { sources.push({url:source,status:'unavailable'}); }
  }
  const report={...buildOrganicPeerHypotheses(observations,now),sources};
  await mkdir(dir,{recursive:true});
  const temp=file+'.'+process.pid+'.tmp';
  await writeFile(temp,JSON.stringify(report),{mode:0o600});await rename(temp,file);
  return report;
}
