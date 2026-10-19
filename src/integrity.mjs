import {journalDiagnostics} from './journal.mjs';
// Inline formulas have stable IDs. The marker is atomic in the editable text;
// its TeX lives outside text so edits cannot silently move or duplicate it.
export const mathTokens = text => [...String(text).matchAll(/\[\[math:([-\w]+)\]\]/g)];
export function validateInlineMath(block) {
  const raw=block.inlineMath??[];
  if(!Array.isArray(raw)||raw.length>10000)throw Error('行内公式数据无效。');
  if(raw.length&&!['paragraph','heading','table'].includes(block.type))throw Error('行内公式只能位于正文、标题或表格。');
  const ids=new Set(),items=raw.map(m=>{
    if(!m||!/^[-\w]{1,80}$/.test(m.id)||ids.has(m.id)||typeof m.text!=='string'||m.text.length>20000)throw Error('行内公式 ID 重复或内容无效。');
    ids.add(m.id);const result={id:m.id,text:m.text};if(m.sourceOmml!==undefined||m.sourceSha256!==undefined){if(typeof m.sourceOmml!=='string'||!m.sourceOmml.length||m.sourceOmml.length>300000||!(/^[a-f0-9]{64}$/).test(m.sourceSha256))throw Error('公式来源记录无效。');result.sourceOmml=m.sourceOmml;result.sourceSha256=m.sourceSha256;}return result;
  });
  const used=new Set();
  for(const text of [block.text,...(block.rows||[]).flat()]){
    const tokens=mathTokens(text);
    if(String(text).replace(/\[\[math:([-\w]+)\]\]/g,'').includes('[[math:'))throw Error('行内公式标记不完整。');
    for(const m of tokens){if(!ids.has(m[1])||used.has(m[1]))throw Error('行内公式标记缺少定义或被重复使用。');used.add(m[1]);}
  }
  if(used.size!==ids.size)throw Error('删除公式时须同时删除其标记与 inlineMath 定义。');
  for(const r of block.ruby||[])for(const m of mathTokens(block.text))if(r.start<m.index+m[0].length&&r.end>m.index)throw Error('注音不能覆盖行内公式。');
  return items;
}
export function validateImportReports(raw) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>100)throw Error('导入记录最多 100 份。');
  return raw.map(r=>{
    if(!r||r.kind!=='docx'||!/^\w{64}$/.test(r.sourceSha256)||!/^[a-f0-9]+$/.test(r.sourceSha256)||!Number.isInteger(r.sourceBytes)||r.sourceBytes<1||r.sourceBytes>20*1024*1024)throw Error('导入来源记录无效。');
    if(!Array.isArray(r.diagnostics)||r.diagnostics.length>10000)throw Error('导入诊断记录无效。');
    const diagnostics=r.diagnostics.map(d=>{
      if(!d||!['error','warning','info'].includes(d.severity)||typeof d.code!=='string'||d.code.length>80||typeof d.message!=='string'||d.message.length>4000)throw Error('导入诊断内容无效。');
      return {code:d.code,severity:d.severity,message:d.message};
    });
    const counts={};for(const [k,v]of Object.entries(r.counts||{})){if(!/^[a-zA-Z]{1,50}$/.test(k)||!Number.isInteger(v)||v<0||v>1000000)throw Error('导入计数无效。');counts[k]=v;}
    return {kind:'docx',sourceSha256:r.sourceSha256,sourceBytes:r.sourceBytes,counts,diagnostics};
  });
}
export function documentDiagnostics(doc) {
  return [...(doc.importReports||[]).flatMap(r=>r.diagnostics.map(d=>({...d,sourceSha256:r.sourceSha256}))),...journalDiagnostics(doc)];
}
