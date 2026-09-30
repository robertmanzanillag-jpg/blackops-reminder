const definitions = [
 ['projectCount','Proyectos únicos','Colectivos, radios, sellos y otros proyectos.'],
 ['collectiveCount','Colectivos','Algunos también son radios o sellos.'],
 ['radioCount','Radios','Algunas también son colectivos o sellos.'],
 ['labelCount','Sellos','Algunos también son colectivos o radios.'],
 ['djCount','DJs','Catálogo aparte de los proyectos únicos.'],
 ['candidateCount','Por corroborar','Candidatos aparte; no publicados como verificados.'],
 ['corroboratedCount','Proyectos corroborados','Dentro de los proyectos únicos; con varias fuentes.'],
];
const number = n => new Intl.NumberFormat('es').format(n);
const date = value => value ? new Date(value).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'}) : 'Sin actividad registrada';
async function refresh() {
 const button=document.querySelector('#refresh');button.disabled=true;
 document.querySelector('#error').hidden=true;
 try {
  const response=await fetch('./snapshot.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('HTTP error');
  const data=await response.json();
  if(data.version!==1 || data.mode!=='snapshot' || !Number.isFinite(Date.parse(data.capturedAt)) || definitions.some(([key])=>!Number.isSafeInteger(data.counts?.[key]) || data.counts[key]<0)) throw new Error('Invalid snapshot');
  const cards=document.querySelector('#cards');cards.replaceChildren();
  for(const [key,title,description] of definitions){const card=document.createElement('article');const heading=document.createElement('h2');heading.textContent=title;const value=document.createElement('div');value.className='value';value.textContent=number(data.counts[key]);const detail=document.createElement('p');detail.textContent=description;card.append(heading,value,detail);cards.append(card);}
  document.querySelector('#stamp').textContent=`Copia generada: ${date(data.capturedAt)}. No confirma que la Mac esté conectada ahora.`;
  const c=data.counts;
  document.querySelector('#breakdown').textContent=`${number(c.collectiveCount)} colectivos + ${number(c.radioCount)} radios + ${number(c.labelCount)} sellos − ${number(c.extraTypeAssignments)} clasificaciones repetidas + ${number(c.otherProjectCount)} de otros tipos = ${number(c.projectCount)} proyectos únicos.`;
  document.querySelector('#activity').textContent=`Última actividad registrada en esta copia: ${date(data.lastActivityAt)}.`;
  document.querySelector('#result').textContent='Copia cargada. Esto no inicia ni comprueba el buscador de la Mac.';
 } catch {
  document.querySelector('#cards').replaceChildren();
  for(const id of ['stamp','breakdown','activity','result'])document.getElementById(id).textContent='';
  const error=document.querySelector('#error');error.hidden=false;error.textContent='No se pudo cargar la copia. No se puede confirmar el estado del buscador. Puedes intentar cargarla de nuevo.';
 } finally {button.disabled=false;}
}
document.querySelector('#refresh').addEventListener('click',refresh);
refresh();
