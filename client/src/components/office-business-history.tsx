import {useQuery} from "@tanstack/react-query";
import {apiRequest} from "@/lib/queryClient";
type Job={id:string;role:string;generation:number;status:string;startedAt:string;completedAt?:string;reason?:string;artifact?:{text?:string}};
type History={ownerId:string;checkedAt:string;jobs:Job[];capacity?:{reached:boolean;usedJobs:number;maxJobs:number}};
const names:Record<string,string>={automations:"Automatizaciones",portfolio:"Cartera"};
const statuses:Record<string,string>={completed:"Entregable guardado",blocked:"Falta una condición necesaria",running:"En ejecución",unknown:"Resultado sin confirmar",failed:"Falló"};
const reasons:Record<string,string>={SOURCE_UNAVAILABLE:"No se pudo verificar la fuente de datos.",LEASE_EXPIRED:"La ejecución excedió su plazo; requiere revisión antes de repetirla.",HOLDER_CHANGED:"Cambió el agente asignado durante la ejecución.",HISTORY_CAPACITY:"El historial alcanzó su capacidad; requiere revisión.",STOP_REQUESTED:"El ejecutor se detuvo antes de consultar los datos.",ARTIFACT_LIMIT:"El entregable excede el espacio disponible; requiere revisión."};
export function OfficeBusinessHistory({sessionScope,ownerId}:{sessionScope:string|null|undefined;ownerId:string|null}){
 const query=useQuery<History>({queryKey:["office-business-history",sessionScope],queryFn:async()=>{const response=await apiRequest("GET","/api/agents-office/business-work");return response.json();},enabled:Boolean(sessionScope&&ownerId),retry:false,staleTime:0,gcTime:0,refetchInterval:30000});
 const data=sessionScope&&ownerId&&!query.isError&&query.data?.ownerId===ownerId?query.data:undefined;
 return <section aria-label="Entregables de trabajo interno" className="space-y-2 border-t border-cyan-200/20 pt-3">
  <h3 className="text-sm font-semibold">Entregables de trabajo interno</h3>
  <p className="text-xs text-slate-300">Expedientes de automatizaciones y conciliación de cartera. No ejecutan reparaciones, operaciones financieras ni acciones externas; no acreditan el puesto completo.</p>
  {!sessionScope||!ownerId?<p className="text-xs">Verificando acceso al historial…</p>:query.isError?<p role="alert" className="text-xs text-amber-200">No se pudo verificar el historial de entregables.</p>:!data?<p className="text-xs">Cargando entregables…</p>:<>
   <p className="text-xs text-slate-400">Consulta: {new Date(data.checkedAt).toLocaleString()}. Son resultados guardados, no una señal de actividad actual.</p>
   {data.capacity?.reached&&<p role="alert" className="text-xs text-amber-200">El historial alcanzó su capacidad. Las nuevas tareas de estos dos agentes están detenidas hasta revisar el archivo; sus resultados se conservan.</p>}
   {!data.jobs.length?<p className="text-xs">Todavía no hay entregables registrados.</p>:data.jobs.slice(-20).reverse().map(job=><article key={job.id} className="rounded-lg border border-white/10 p-2 text-xs">
    <p className="font-semibold">{names[job.role]??job.role} · generación {job.generation}</p>
    <p>{statuses[job.status]??"Estado sin verificar"} · {new Date(job.completedAt??job.startedAt).toLocaleString()}</p>
    {job.reason&&<p className="text-amber-200">{reasons[job.reason]??"Existe un bloqueo pendiente de revisión."}</p>}
    {["completed","blocked"].includes(job.status)&&job.artifact?.text&&<details className="mt-2"><summary className="cursor-pointer">Leer entregable</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{job.artifact.text}</pre></details>}
   </article>)}
  </>}
 </section>;
}
