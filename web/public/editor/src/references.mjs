import {replaceBlockText} from './model.mjs';
export const referencePattern=()=>/\[\[(ref|cite):([-\w]+)\]\]/g;
export function referenceDiagnostics(doc){
  const errors=[];const inspect=(text,location)=>{
    for(const m of text.matchAll(/\[\^([-\w]+)\]|\[\[(ref|cite):([-\w]+)\]\]/g)){
      const kind=m[1]?'note':m[2],id=m[1]||m[3];
      if(!(kind==='note'?doc.notes:kind==='cite'?doc.bibliography:doc.blocks).some(x=>x.id===id))errors.push({code:'DANGLING_REFERENCE',location,kind,targetId:id});
    }
  };
  for(const b of doc.blocks){if(b.type!=='equation')inspect(b.text,b.id);b.rows?.forEach((r,ri)=>r.forEach((s,ci)=>inspect(s,`${b.id}[${ri},${ci}]`)));}
  for(const n of doc.notes)inspect(n.text,`note:${n.id}`);
  return errors;
}
// Resolve only for display/export. Source keeps stable tokens; review comments never print.
export function materializeReferences(input){
  const doc=structuredClone(input),byId=new Map(doc.blocks.map(b=>[b.id,b]));
  const label=(kind,id)=>kind==='cite'?`[${doc.bibliography.findIndex(b=>b.id===id)+1}]`:(byId.get(id)?.text.replace(referencePattern(),'')||id);
  const resolve=s=>s.replace(referencePattern(),(token,k,id)=>(k==='cite'?doc.bibliography.some(b=>b.id===id):byId.has(id))?label(k,id):token);
  for(const b of doc.blocks){if(b.type!=='equation'){
    const matches=[...b.text.matchAll(referencePattern())];
    for(const m of matches.reverse())replaceBlockText(b,b.text.slice(0,m.index)+resolve(m[0])+b.text.slice(m.index+m[0].length));
    if(matches.length)b._generated=true;
  }if(b.rows)b.rows=b.rows.map(r=>r.map(resolve));}
  for(const n of doc.notes)n.text=resolve(n.text);
  if(doc.bibliography.length){doc.blocks.push({id:'_bibliography-heading',type:'heading',text:'参考文献',...(doc.journal?{role:'reference-heading'}:{}),level:1,_generated:true});doc.bibliography.forEach((b,i)=>doc.blocks.push({id:`_bibliography-${b.id}`,type:'paragraph',text:`[${i+1}] ${b.text}`,role:'reference',indent:0,_generated:true}));}
  return doc;
}
