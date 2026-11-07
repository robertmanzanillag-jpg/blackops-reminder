import {PENDING_OFFICE_ROLES,SQL_AUDIT_ROLES,sourceDigest,validateRoleSnapshot,type PendingOfficeRole,type RoleSnapshot} from "./office-role-snapshots";
export type RoleAudit={role:PendingOfficeRole;status:"completed"|"blocked";capability:string;scope:string;sourceDigest?:string;selected:number;total:number|null;completeCoverage:boolean;findings:Array<{code:string;recordIds:string[];detail:string}>;metrics:Record<string,number>;artifactId:string};
const limits="Auditoría de registros guardados; no acredita ejecución comercial, conexión actual, entrenamiento ni promoción.";
const blocked:Partial<Record<PendingOfficeRole,string>>={code:"Requiere PR/diff identificado y ejecutor de revisión",github:"Requiere repositorios registrados y lectura autorizada",news:"Requiere evidencia del editor existente; no iniciar otro publicador","news:ny-news":"Requiere evidencia del editor de Nueva York","news:miami-news":"Requiere evidencia del editor de Miami","blackroom-videos":"Requiere el worker externo y sus resultados",clippers:"Requiere fuentes y resultados del worker multimedia",dropshipping:"Requiere almacenamiento canónico de productos/proveedores; no usar archivos vacíos de la PC","marketing-cmo":"Requiere campañas y métricas auténticas por cliente"};
export function auditSavedRole(role:PendingOfficeRole,source:RoleSnapshot|undefined,owner:string,now=Date.now()):RoleAudit {
 if(!PENDING_OFFICE_ROLES.includes(role))throw new Error("Unknown role");
 const result:Omit<RoleAudit,"artifactId">={role,status:"blocked",capability:`saved-record-audit:${role}:v1`,scope:limits,selected:0,total:null,completeCoverage:false,findings:[],metrics:{}};
 const finish=()=>({...result,artifactId:sourceDigest(result)});
 if(!SQL_AUDIT_ROLES.includes(role as any)){result.findings.push({code:"CAPABILITY_UNAVAILABLE",recordIds:[],detail:blocked[role]!});return finish();}
 if(!source || source.role!==role){result.findings.push({code:"SOURCE_UNAVAILABLE",recordIds:[],detail:"No hay una lectura canónica verificada."});return finish();}
 const data=validateRoleSnapshot(source,owner,now);result.sourceDigest=data.sourceDigest;result.selected=data.rows.length;result.total=data.total;result.completeCoverage=data.rows.length===data.total;
 if(!data.rows.length){result.findings.push({code:"NO_SOURCE_RECORDS",recordIds:[],detail:"La consulta no devolvió registros; no prueba trabajo comercial completado."});return finish();}
 const add=(code:string,id:string,detail:string)=>result.findings.push({code,recordIds:[id],detail});
 try {
 if(role==="control"){
  const scopes=new Map<string,string[]>();for(const r of data.rows){if(r.enabled){scopes.set(r.scope,[...(scopes.get(r.scope)||[]),r.id]);if(r.level==="autonomous" && ["high","critical"].includes(r.risk))add("HIGH_RISK_AUTONOMY",r.id,"Permiso activo de alto riesgo sin aprobación.");} }
  for(const [scope,ids] of scopes)if(ids.length>1)result.findings.push({code:"DUPLICATE_SCOPE",recordIds:ids,detail:`${scope}: ${ids.length} permisos activos requieren reconciliación.`});result.metrics.enabledPermissions=data.rows.filter(r=>r.enabled).length;
 }else if(role==="automations"){
  for(const r of data.rows){if(r.failureCount>0 || r.lastStatus==="failed")add("RECORDED_FAILURE",r.id,`${r.failureCount} fallos registrados; causa no atribuida al agente.`);
   if(r.status==="active" && (!r.nextRunAt || (r.lastRunAt && Date.parse(r.nextRunAt)<=Date.parse(r.lastRunAt))))add("SCHEDULE_UNVERIFIED",r.id,"Próxima ejecución ausente o consumida; no se inventa una fecha.");
   if(r.nextRunAt && Date.parse(r.nextRunAt)<now && (!r.lastRunAt || Date.parse(r.nextRunAt)>Date.parse(r.lastRunAt)))add("SAVED_RUN_TIME_PASSED",r.id,"Fecha guardada vencida; verificar scheduler antes de atribuir incumplimiento.");}
  result.metrics.activeDefinitions=data.rows.filter(r=>r.status==="active").length;
 }else if(role==="portfolio"){
  for(const r of data.rows){if(!/^(?:\d+\.?\d*|\.\d+)$/.test(r.quantity)||!/^(?:\d+\.?\d*|\.\d+)$/.test(r.avgBuyPrice))throw new Error("Invalid holding");const cost=Number(r.quantity)*Number(r.avgBuyPrice);if(!Number.isFinite(cost))throw new Error("Invalid cost");const key=`costBasis:${r.currency}`;result.metrics[key]=(result.metrics[key]||0)+cost;}
  result.findings.push({code:"MARKET_VALUE_UNVERIFIED",recordIds:data.rows.map(r=>r.id),detail:"Solo costo de adquisición por moneda; sin precios actuales no se calculan valor actual ni ganancias."});
 }else if(role==="revenue"){
  result.metrics.bookedIncomeUsd=0;result.metrics.collectedIncomeUsd=0;result.metrics.recordedExpensesUsd=0;
  for(const r of data.rows){if(!["website_sale","automation_sale","bundle_sale","retainer","expense"].includes(r.kind))throw new Error("Unknown ledger kind");if(Date.parse(r.updatedAt)>now+30000)throw new Error("Future ledger");
   if(r.kind==="expense")result.metrics.recordedExpensesUsd+=r.amountUsd;else{result.metrics.bookedIncomeUsd+=r.amountUsd;result.metrics.collectedIncomeUsd+=r.cashCollectedUsd;if(r.cashCollectedUsd>r.amountUsd)add("COLLECTION_EXCEEDS_BOOKED",r.id,"Cobro registrado supera importe; conciliar antes de interpretar beneficio.");}
   if(now-Date.parse(r.updatedAt)>86400000)add("STALE_LEDGER_COLLECTION",r.id,"Colección sin actualizar en más de 24 horas; no acredita conciliación bancaria actual.");}
  result.metrics.uncollectedRecordedIncomeUsd=result.metrics.bookedIncomeUsd-result.metrics.collectedIncomeUsd;
 }else if(role==="legal"){
  for(const r of data.rows){if(!r.publicUrl)add("PUBLIC_SURFACE_MISSING",r.id,"Falta URL para identificar documentos públicos aplicables.");if(!r.repoOwner||!r.repoName)add("REPOSITORY_TRACE_MISSING",r.id,"Falta repositorio vinculado para verificar versión de documentos.");add("DOCUMENT_REVIEW_REQUIRED",r.id,`${r.name}: inventario guardado (${r.environment}); privacidad/términos/licencias no inspeccionados.`);}
  result.metrics.projectsInventoried=data.rows.length;
 }
 if(Object.values(result.metrics).some(v=>!Number.isFinite(v)))throw new Error("Invalid totals");result.status="completed";
 }catch{result.metrics={};result.findings=[{code:"INVALID_SOURCE_VALUES",recordIds:[],detail:"Datos inválidos impiden cálculos fiables."}];}
 return finish();
}
