import { areas, type Area, type Entity } from './agents-world';
export const rooms: Record<Area, { x: number; z: number; width: number; depth: number; color: string }> = {
  Oficina: { x: -14, z: -12, width: 24, depth: 20, color: '#46c9c0' },
  KONG: { x: 14, z: -12, width: 24, depth: 20, color: '#ab94ec' },
  'Black Room': { x: -14, z: 11, width: 24, depth: 20, color: '#e79ebf' },
  'Daily Planner': { x: 14, z: 11, width: 24, depth: 20, color: '#efc47f' },
  Contenido: { x: 0, z: 31, width: 52, depth: 14, color: '#8fbeed' },
};
/** Deterministic conceptual placement. Never interpreted as presence or work. */
export function stationLayout(entities: Entity[]) {
  return areas.flatMap(area => {
    const items=entities.filter(entity=>entity.area===area), room=rooms[area];
    const cols=Math.max(1,Math.ceil(Math.sqrt(items.length*room.width/room.depth)));
    const rows=Math.max(1,Math.ceil(items.length/cols));
    return items.map((entity,i)=>({entity,color:room.color,
      x:room.x-room.width/2+3+(i%cols+.5)*(room.width-6)/cols,
      z:room.z-room.depth/2+4+(Math.floor(i/cols)+.5)*(room.depth-7)/rows,
    }));
  });
}
export function visualMotion(phase: number, seconds: number, enabled: boolean) {
  if (!enabled) return {x:0,z:0,leg:0,yaw:0};
  const t=seconds*.65+phase;
  return {x:Math.sin(t)*.6,z:Math.cos(t)*.45,leg:Math.sin(t*5)*.2,yaw:t};
}
export const renderBudget = (mobile: boolean, devicePixelRatio: number) => ({
  fps:mobile?20:30,pixelRatio:Math.max(1,Math.min(mobile?1:1.5,devicePixelRatio||1)),
});
