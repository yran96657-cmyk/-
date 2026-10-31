// Report data can contain manuscript text. Render only text nodes, never HTML.
export function showJournalReport(result,{openPdf,downloadPdf,downloadReport,editJournal,locateBlock}={}){
 const report=result.report,quality=report.quality,items=quality.diagnostics||[];
 const errors=items.filter(d=>d.severity==='error'),warnings=items.filter(d=>d.severity==='warning'),evidence=items.filter(d=>d.severity==='info');
 const dialog=document.createElement('dialog');dialog.className='proof-dialog';dialog.setAttribute('aria-labelledby','proofTitle');
 const append=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
 const header=append(dialog,'header','');header.className='proof-heading';
 const title=append(header,'h2',errors.length?`校样有 ${errors.length} 项阻断`:'校样已生成');title.id='proofTitle';
 append(header,'span',`r${result.revision} · 待人工验收`);
 const metrics=append(dialog,'dl','');metrics.className='proof-metrics';
 const fonts=report.fonts||[],coverage=report.semanticLayout?.sourceObjectCoverage;
 for(const [name,value] of [['PDF 页数',result.pages],['数学区',report.formulaCoverage?.total??'—'],['字体嵌入',fonts.length?`${fonts.filter(f=>f.embedded).length} / ${fonts.length}`:'—'],['对象映射',coverage?`${coverage.mapped} / ${coverage.expected}`:'—']]){
  const item=append(metrics,'div','');append(item,'dt',name);append(item,'dd',String(value));
 }
 const actions=append(dialog,'div','');actions.className='proof-actions';
 const actionError=append(dialog,'p','');actionError.hidden=true;actionError.setAttribute('role','alert');
 for(const [text,fn,primary] of [['打开 PDF 校样',openPdf,true],['下载 PDF',downloadPdf],['检查报告',downloadReport]])if(fn){const b=append(actions,'button',text);b.type='button';if(primary)b.className='primary';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;actionError.hidden=true;try{await fn();}catch(e){actionError.textContent=e.message;actionError.hidden=false;}finally{b.disabled=false;}};}
 append(dialog,'p','检查绑定当前修订。修改文稿后，请重新生成校样。').className='proof-context';
 for(const [heading,entries] of [['必须修复',errors],['待核对',warnings],['来源核验记录',evidence]]){
  if(!entries.length)continue;
  const parent=entries===evidence?append(dialog,'details',''):dialog;
  append(parent,entries===evidence?'summary':'h3',entries===evidence?`${heading}（${entries.length}）`:heading);const list=append(parent,'ol','');
  if(editJournal&&entries.some(d=>d.code==='JOURNAL_METADATA_REVIEW'&&!d.blockId)){
   const edit=append(parent,'button','补全刊物信息');edit.type='button';edit.onclick=()=>{dialog.close();editJournal();};
  }
  for(const d of entries){
   const li=append(list,'li','');li.style.marginBottom='16px';
   const pages=new Set(d.page?[d.page]:[]);
   for(const loc of [...(d.sourceLocations||[]),...(d.candidateLocations||[])]){
    const range=loc.pages||(loc.start&&loc.end?[loc.start.page,loc.end.page]:[]);
    for(const page of range)if(Number.isInteger(page))pages.add(page);
   }
   const position=pages.size?`PDF 第 ${[...pages].sort((a,b)=>a-b).join('、')} 页 · `:'';
   append(li,'strong',position+(d.message||d.code));
   if(locateBlock&&d.blockId){const locate=append(li,'button','定位并编辑');locate.type='button';locate.onclick=()=>{dialog.close();locateBlock(d.blockId);};}
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
 const review=append(dialog,'details','');review.className='proof-review';append(review,'summary','人工验收范围');
 append(review,'p','自动检查不等于可发印。仍需核对全文、公式语义、图文锚定、每页版面、字体许可和印厂要求。');
 for(const text of quality.notChecked||[])append(review,'p',text);
 const footer=append(dialog,'footer','');footer.className='proof-footer';
 append(footer,'span',`PDF SHA-256 · ${(report.pdfSha256||'').slice(0,16)}`);
 const close=append(footer,'button','返回编辑');close.onclick=()=>dialog.close();
 const previous=document.activeElement;dialog.onclose=()=>{dialog.remove();previous?.focus?.();};document.body.append(dialog);dialog.showModal();
 return dialog;
}
