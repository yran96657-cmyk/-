// Report data can contain manuscript text. Render only text nodes, never HTML.
export function showJournalReport(result){
 const report=result.report,quality=report.quality,items=quality.diagnostics||[];
 const errors=items.filter(d=>d.severity==='error'),warnings=items.filter(d=>d.severity!=='error');
 const dialog=document.createElement('dialog');dialog.style.cssText='width:min(760px,90vw);max-height:85vh;overflow:auto;padding:24px';
 const append=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
 append(dialog,'h2',errors.length?`校样有 ${errors.length} 项阻断`:'校样已生成，待逐页验收');
 append(dialog,'p',`${result.pages} 页 · ${report.formulaCoverage?.total??'未统计'} 个数学区 · 工程 ${result.projectId} · 修订 ${result.revision}`);
 append(dialog,'p','PDF 和完整报告已下载。以下页码是 PDF 物理页；这是当前修订的检查记录，修改稿件后请重新生成。');
 for(const [heading,entries] of [['必须修复',errors],['待核对',warnings]]){
  if(!entries.length)continue;
  append(dialog,'h3',heading);const list=append(dialog,'ol','');
  for(const d of entries){
   const li=append(list,'li','');li.style.marginBottom='16px';
   const pages=new Set(d.page?[d.page]:[]);
   for(const loc of [...(d.sourceLocations||[]),...(d.candidateLocations||[])]){
    const range=loc.pages||(loc.start&&loc.end?[loc.start.page,loc.end.page]:[]);
    for(const page of range)if(Number.isInteger(page))pages.add(page);
   }
   const position=pages.size?`PDF 第 ${[...pages].sort((a,b)=>a-b).join('、')} 页 · `:'';
   append(li,'strong',position+(d.message||d.code));
   if(d.sourcePath){const detail=append(li,'p',`原稿位置：${d.sourcePart||''}${d.sourcePath}${d.sourceAsset?' · '+d.sourceAsset:''}`);detail.style.cssText='font-size:12px;overflow-wrap:anywhere';}
   const locations=d.sourceLocations||d.candidateLocations||[];
   if(locations.length)append(li,'p','候选来源（需对照 PDF 确认具体位置）：');
   for(const loc of locations){
    const cell=Number.isInteger(loc.row)?` · 第 ${loc.row+1} 行、第 ${loc.col+1} 列`:'';
    const text=[loc.objectId||loc.field||'',cell,loc.excerpt?' · '+loc.excerpt:''].join('');
    const detail=append(li,'div',text);detail.style.cssText='font-size:12px;overflow-wrap:anywhere;margin:4px 0';
   }
   if(d.totalSourceLocations>locations.length)append(li,'p',`共 ${d.totalSourceLocations} 个候选来源，本报告只保留前 ${locations.length} 个。`);
   if(!locations.length&&d.blockId)append(li,'p','对象：'+d.blockId);
   if(d.compilerMessage){const details=append(li,'details','');append(details,'summary','编译器证据');const pre=append(details,'pre',d.compilerMessage);pre.style.whiteSpace='pre-wrap';}
  }
 }
 append(dialog,'h3','交付验收');
 append(dialog,'p','自动检查不等于可发印。仍需核对全文、公式语义、图文锚定、每页版面、字体许可和印厂要求。');
 const close=append(dialog,'button','关闭报告');close.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
 return dialog;
}
