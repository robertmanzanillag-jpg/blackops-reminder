/** Owner-only review desk: supplied text is textContent, never HTML; no approval happens on load. */
export function reviewedDerivativeReviewHtml(nonce:string){return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisión de clips autorizados</title><style nonce="${nonce}">body{font:17px system-ui;max-width:960px;margin:30px auto;padding:20px;background:#10151d;color:#edf2f8}button,input{font:inherit;padding:10px;margin:6px}input{box-sizing:border-box;max-inline-size:calc(100% - 12px)}button:disabled{opacity:.5}video{max-width:280px;max-height:480px}fieldset{margin:20px 0;min-inline-size:0;overflow-wrap:anywhere}label{display:block;margin:12px 0}p{overflow-wrap:anywhere}a{color:#93c5fd}</style><h1>Revisión de clips autorizados</h1><p>La aprobación autoriza únicamente el archivo final, texto, cuenta y horario indicados. No autoriza el video original. La revisión técnica externa y la autorización del titular deben existir antes de aprobar.</p><p>Revocar impide nuevos envíos. Si el video ya quedó programado, hay que revisarlo y detenerlo en Metricool; esta pantalla no cancela esa publicación.</p><p id="state" role="status">Cargando…</p><h2>Preparar propuesta</h2><label for="manifest">Archivo de propuesta preparado con permisos y revisión independiente</label><input id="manifest" type="file" accept="application/json,.json"><button id="propose">Preparar para revisar</button><h2>Propuestas</h2><div id="records"></div><script nonce="${nonce}">
const base='/api/clippers/reviewed-derivatives', status=document.getElementById('state');let activePrivatePreview=null;
function stopPrivatePreview(){const active=activePrivatePreview;activePrivatePreview=null;if(active)active.stop();}
async function request(path='',body){const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo completar');return result;}
function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function nyTime(value){try{return new Intl.DateTimeFormat('es',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}catch{return 'Fecha no disponible';}}
function verifiedNativeCopy(record){const d=record.delivery,m=record.manifest.media;try{const url=new URL(d?.confirmedMediaUrl);if(!['scheduled','held_nonpublishing_draft'].includes(d.status)||d.confirmedMediaSha256!==m.sha256||d.confirmedByteLength!==m.byteLength||!Number.isFinite(Date.parse(d.copyVerifiedAt))||Date.parse(d.copyVerifiedAt)>Date.now()||url.protocol!=='https:'||url.hostname!=='static.metricool.com'||(url.port&&url.port!=='443')||url.username||url.password||url.search||url.hash||url.pathname.length<=5)return null;return url.href;}catch{return null;}}

async function sha(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');}
async function load(){try{
 stopPrivatePreview();const data=await request();status.textContent=(data.publishingEnabled?'Control de publicación de este servidor: activado. La publicación requiere todas las comprobaciones adicionales.':'Control de publicación de este servidor: desactivado.')+' Este panel no confirma el estado del ejecutor programado. Consulta sus recibos en la oficina.';
 const root=document.getElementById('records');root.replaceChildren();
 for(const r of data.records){
  const box=el('fieldset'),m=r.manifest,isPrivate=m.media.storageKind==='private_council_v1',privatePath='/private-finals/'+encodeURIComponent(m.id),hourWindow=m.dispatch?.mode==='owner_hour_window';
  let privateReady=!isPrivate,previewLoaded=!isPrivate,approve,previewSourceKind='private';const nativeCopyUrl=isPrivate?verifiedNativeCopy(r):null;
  box.append(el('legend',m.id+' · '+r.status));
  box.append(el('p',r.delivery?.status==='held_nonpublishing_draft'?'Borrador confirmado en Metricool; no se publicará ni se repetirá.':r.delivery?.status==='scheduled'?'Programado en Metricool; la publicación final aún debe comprobarse.':r.delivery?.writeStartedAt?'Envío pendiente de conciliación; no se repetirá.':r.lastCheck?.status==='held'?'En espera de comprobar permisos, fuentes o disponibilidad.':'Pendiente de los controles antes del envío.'));
  const video=el('video');video.controls=true;video.preload='none';
  video.setAttribute('aria-label','Vista previa de '+m.id);
  const mediaNote=el('p',isPrivate?'Comprobando archivo privado…':'Vista previa del archivo nativo revisado.');mediaNote.setAttribute('role','status');
  const updateApproval=()=>{if(approve)approve.disabled=isPrivate&&(!privateReady||!previewLoaded);};
  if(isPrivate){
   video.addEventListener('loadeddata',()=>{if(activePrivatePreview?.video!==video||video.currentSrc!==activePrivatePreview.url)return;previewLoaded=true;mediaNote.textContent=previewSourceKind==='native_copy'?'Vista previa cargada de la copia nativa verificada. El archivo privado ya se liberó.':'Vista previa cargada del archivo privado verificado. Revisa el video antes de aprobar.';updateApproval();});
   video.addEventListener('error',()=>{if(activePrivatePreview?.video!==video)return;previewLoaded=false;mediaNote.textContent='No se pudo cargar la vista previa. Vuelve a pulsar el botón para intentarlo.';updateApproval();});
   try{const state=await request(privatePath+'/status');privateReady=state.ready===true;mediaNote.textContent=privateReady?'Archivo privado verificado. Pulsa Ver archivo privado para cargar la vista previa.':nativeCopyUrl?'El archivo privado se liberó. Hay una copia nativa verificada disponible.':'Falta cargar y verificar el archivo final privado.';}catch(e){mediaNote.textContent=nativeCopyUrl?'El archivo privado se liberó. Hay una copia nativa verificada disponible.':e.message;}
   if(privateReady||nativeCopyUrl){const previewButton=el('button',privateReady?'Ver archivo privado':'Ver copia nativa verificada');previewButton.onclick=()=>{
    stopPrivatePreview();previewLoaded=false;updateApproval();previewSourceKind=privateReady?'private':'native_copy';mediaNote.textContent='Cargando la vista previa seleccionada…';
    const url=new URL(privateReady?base+privatePath+'/preview':nativeCopyUrl,location.href).href;
    activePrivatePreview={video,url,stop:()=>{video.pause();video.removeAttribute('src');video.preload='none';video.load();previewLoaded=false;updateApproval();mediaNote.textContent='Vista previa cerrada. Puedes volver a cargarla con el botón.';}};
    video.preload='auto';video.src=url;video.load();
   };box.append(previewButton);}
   if(r.status==='proposed'){
    const label=el('label','Archivo final privado para '+m.id),file=el('input');file.type='file';file.accept='video/mp4,.mp4';file.setAttribute('aria-label','Archivo final privado para '+m.id);label.append(file);box.append(label);
    const upload=el('button','Cargar y verificar archivo privado');upload.onclick=async()=>{
     upload.disabled=true;
     try{
      const selected=file.files[0];if(!selected||selected.size!==m.media.byteLength||selected.size>33554432)throw Error('El tamaño no coincide con el archivo final revisado.');
      mediaNote.textContent='Comprobando el archivo seleccionado…';const bytes=await selected.arrayBuffer();if(await sha(bytes)!==m.media.sha256)throw Error('El archivo seleccionado no coincide con la huella revisada.');
      const bound={expectedDigest:r.manifestSha256};const reserved=await request(privatePath+'/reserve',bound);const chunkBytes=reserved.chunkBytes;
      if(!Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>2097152)throw Error('No se pudo verificar el límite de carga privada.');
      for(let index=0,offset=0;offset<bytes.byteLength;index++,offset+=chunkBytes){
       const chunk=bytes.slice(offset,Math.min(bytes.byteLength,offset+chunkBytes));
       const response=await fetch(base+privatePath+'/chunks/'+index,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-derivative-manifest-sha256':r.manifestSha256,'x-chunk-sha256':await sha(chunk)},body:chunk});
       const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo cargar el fragmento privado.');mediaNote.textContent='Carga privada: '+Math.round(Math.min(bytes.byteLength,offset+chunkBytes)/bytes.byteLength*100)+'%';
      }
      const finished=await request(privatePath+'/finalize',bound);if(finished.ready!==true)throw Error('El archivo privado aún no quedó verificado.');await load();
     }catch(e){mediaNote.textContent=e.message;status.textContent=e.message;}finally{upload.disabled=false;}
    };box.append(upload);
   }
  }else video.src=m.media.url;
  if(r.reconciliationRequired)box.append(el('p','Acción pendiente: revisar el envío iniciado o programado y detenerlo en Metricool.'));
  box.append(mediaNote,video,el('p',m.caption));
  if(hourWindow){
   const label=r.status==='approved'?'Ventana autorizada':r.status==='revoked'?'Ventana revocada':'Ventana propuesta';
   box.append(el('p',m.destination.account+' · '+m.destination.network),el('p',label+' de una hora (Nueva York, America/New_York): '+nyTime(m.dispatch.startAt)+' a '+nyTime(m.dispatch.endAt)+'; fin excluido.'),el('p','Límites UTC: '+m.dispatch.startAt+' a '+m.dispatch.endAt));
   box.append(el('p',r.delivery?.resolvedScheduledAt&&r.delivery?.status!=='held_before_write'?'Horario seleccionado para el envío: '+nyTime(r.delivery.resolvedScheduledAt)+' (Nueva York). UTC: '+r.delivery.resolvedScheduledAt:'Horario de envío pendiente: se seleccionará dentro de esa hora después de las comprobaciones.'));
   box.append(el('p','Una ventana autorizada o una hora seleccionada no confirman programación ni publicación.'));
  }else box.append(el('p',m.destination.account+' · '+m.destination.network+' · '+m.scheduledAt));
  box.append(el('p','Titular: '+m.rights.holder+' · Revisión: '+m.qa.checker+' · Válido hasta: '+m.expiresAt),el('p','Fuente: '+m.source.url+' · Evidencia: '+m.qa.reportReference),el('p','Huella de aprobación: '+r.manifestSha256));
  if(r.status==='proposed'){
   const operator=el('input');operator.placeholder='Operador autorizado';operator.setAttribute('aria-label','Operador autorizado');box.append(operator);const checks=[];
   for(const text of ['Confirmo permisos sobre las imágenes y el audio que quedan en el archivo final.','Confirmo revisión independiente del archivo y texto exactos.','Confirmo la atribución de fuentes y fechas del calendario.','Confirmo la membresía y el plazo operativo cuando son necesarios.']){const label=el('label'),input=el('input');input.type='checkbox';label.append(input,document.createTextNode(text));checks.push(input);box.append(label);}
   approve=el('button',hourWindow?'Aprobar este archivo para la hora propuesta':'Aprobar este archivo y horario');updateApproval();approve.onclick=async()=>{try{if(isPrivate&&(!privateReady||!previewLoaded))throw Error('Primero carga y revisa la vista previa privada.');await request('/approve',{id:m.id,expectedDigest:r.manifestSha256,operatorLabel:operator.value,attestRights:checks[0].checked,attestExternalQa:checks[1].checked,attestSourceBaseline:checks[2].checked,attestMembership:checks[3].checked});await load();}catch(e){status.textContent=e.message;}};box.append(approve);
  }
  if(r.delivery?.writeStartedAt){const check=el('button','Comprobar envío en Metricool');check.onclick=async()=>{try{await request('/reconcile',{id:m.id,expectedDigest:r.manifestSha256});await load();}catch(e){status.textContent=e.message;}};box.append(check);}
  if(isPrivate&&r.status==='revoked'){const cleanup=el('button','Liberar copia privada revocada');cleanup.onclick=async()=>{try{const result=await request(privatePath+'/cleanup',{expectedDigest:r.manifestSha256});await load();status.textContent=result.bytesReclaimed>0?'Se liberó la copia privada que ya no se necesita.':'La copia privada sigue protegida porque tiene referencias o envíos pendientes.';}catch(e){status.textContent=e.message;}};box.append(cleanup);}
  if(r.status!=='revoked'){const revoke=el('button','Revocar autorización');revoke.onclick=async()=>{try{await request('/revoke',{id:m.id,expectedDigest:r.manifestSha256});await load();}catch(e){status.textContent=e.message;}};box.append(revoke);}
  root.append(box);
 }
}catch(e){status.textContent=e.message;}}
document.getElementById('propose').onclick=async()=>{try{const manifest=JSON.parse(await document.getElementById('manifest').files[0].text());if(manifest.media?.storageKind==='private_council_v1'&&manifest.media.privateFinalRef==null&&/^[a-f0-9]{64}$/.test(manifest.media.sha256))manifest.media.privateFinalRef='final-'+manifest.media.sha256;await request('/propose',{manifest});await load();}catch(e){status.textContent=e.message;}};load();</script></html>`;}
