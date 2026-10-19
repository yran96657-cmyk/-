import {mathTokens} from './integrity.mjs';
import { needsFlow, paginateFlow, applyFlowPart, safeFlowCut, minimumFlowUnit } from './flow-layout.mjs';
import { buildTableElement, cellDisplayMarks, tableRowGroups, headerRowCount } from './table-layout.mjs';
import { buildRuby } from './ruby.mjs';
const MM = 96 / 25.4;
export const families = {serif:'SimSun,"Songti SC",serif',sans:'"Microsoft YaHei",sans-serif',kai:'KaiTi,STKaiti,serif'};
const refs = text => [...text.matchAll(/\[\^([-\w]+)\]/g)].map(m=>m[1]);
export function styleBlock(el,b,l,continued=false) {
  el.className=`block ${b.type}${continued?' fragment':''}`;
  el.style.fontSize=`${b.fontSize||(b.type==='heading'?l.fontSize*(1.8-(b.level||1)*.2):l.fontSize)}pt`;
  el.style.lineHeight=b.type==='heading'?'1.5':l.lineHeight;
  el.style.fontFamily=families[b.fontFamily]||families.serif;
  el.style.fontWeight=b.bold||b.type==='heading'?'700':'400';
  el.style.textAlign=b.align||(b.type==='heading'?'left':'justify');
  el.style.textIndent=b.type==='paragraph'&&!continued?(b.indentPt!==undefined?`${b.indentPt}pt`:`${b.indent??l.indent}em`):'0';
  el.style.setProperty('--image-max',`${(l.height-l.top-l.bottom)*MM-60}px`);
}
function applyMark(span,m) {
  if(m.bold!==undefined)span.style.fontWeight=m.bold?'700':'400';
  if(m.italic!==undefined)span.style.fontStyle=m.italic?'italic':'normal';
  if(m.underline!==undefined)span.style.textDecoration=m.underline?'underline':'none';
  if(m.superscript||m.subscript){span.style.verticalAlign=m.superscript?'super':'sub';span.style.fontSize='.75em';}
  if(m.fontFamily)span.style.fontFamily=families[m.fontFamily];
  if(m.fontSize)span.style.fontSize=`${m.fontSize}pt`;
  if(m.color)span.style.color=m.color;
}
function inline(el,b,l,text,start=0) {
  const annotations=(b.ruby||[]).filter(r=>r.start>=start&&r.end<=start+text.length);
  if(annotations.length) {
    let cursor=0;
    for(const annotation of annotations){
      const begin=annotation.start-start,end=annotation.end-start;
      if(begin>cursor)inline(el,{...b,ruby:[]},l,text.slice(cursor,begin),start+cursor);
      el.append(buildRuby(text.slice(begin,end),annotation.text,{renderBase:(rb,base)=>inline(rb,{...b,ruby:[]},l,base,annotation.start)}));
      cursor=end;
    }
    if(cursor<text.length)inline(el,{...b,ruby:[]},l,text.slice(cursor),start+cursor);
    return;
  }
  const boundaries=new Set([0,text.length]),notes=[...text.matchAll(/\[\^([-\w]+)\]/g)],formulas=mathTokens(text),atoms=[...notes,...formulas];
  for(const m of b.marks||[])for(const pos of [m.start-start,m.end-start])if(pos>0&&pos<text.length)boundaries.add(pos);
  for(const n of atoms){boundaries.add(n.index);boundaries.add(n.index+n[0].length);}
  for(const n of atoms)for(const point of boundaries)if(point>n.index&&point<n.index+n[0].length)boundaries.delete(point);
  const cuts=[...boundaries].sort((a,b)=>a-b);
  for(let i=0;i<cuts.length-1;i++) {
    const begin=cuts[i],end=cuts[i+1],str=text.slice(begin,end),span=document.createElement('span');
    for(const m of b.marks||[])if(m.start<=start+begin&&m.end>start+begin)applyMark(span,m);
    const note=notes.find(n=>n.index===begin&&n[0].length===end-begin);
    if(note) {
      const index=(l._notes||[]).findIndex(n=>n.id===note[1]);
      span.className='note-reference';span.dataset.number=index<0?'?':(l._notes[index].marker??index+1);
      span.title=index<0?'注释未定义':l._notes[index].text;
    }
    const formula=formulas.find(m=>m.index===begin&&m[0].length===end-begin);
    if(formula){
      const value=b.inlineMath?.find(m=>m.id===formula[1])?.text;
      span.className='inline-math';span.dataset.mathId=formula[1];span.title=value||'公式缺少定义';
      if(globalThis.katex&&value!==undefined)globalThis.katex.render(value,span,{displayMode:false,throwOnError:false,trust:false,maxExpand:1000,strict:'warn'});
      else span.textContent=value??str;
    }else span.textContent=str;
    el.append(span);
  }
}
export function notesElement(ids,l) {
  const el=document.createElement('div');el.className='page-notes';
  for(const id of ids){const i=l._notes.findIndex(n=>n.id===id);if(i<0)continue;const p=document.createElement('div');p.textContent=`${l._notes[i].marker??i+1}　${l._notes[i].text}`;el.append(p);}
  return el;
}
export function blockElement(b,l,text=b.text,continued=false,part={}) {
  const el=document.createElement(b.type==='image'?'figure':'div');styleBlock(el,b,l,continued);
  if(b.type==='image') {
    const img=document.createElement('img');img.src=b.src;img.alt=b.text||'文稿插图';img.style.width=`${b.width||80}%`;el.append(img);
    if(b.text){const cap=document.createElement('figcaption');cap.textContent=b.text;el.append(cap);}
  } else if(b.type==='equation') {
    if(globalThis.katex)try{globalThis.katex.render(text,el,{displayMode:true,throwOnError:false,trust:false,maxExpand:1000,strict:'warn'});}catch(e){el.textContent=`公式错误：${e.message}`;}
    else el.textContent=text;
  } else if(b.type==='table') {
    if(b.text){const caption=document.createElement('div');caption.className='table-caption';inline(caption,b,l,b.text+(continued?'（续）':''));el.append(caption);}
    const table=buildTableElement(b,{rowIndexes:part.rowIndexes,renderCell:(td,text,{row,col})=>inline(td,{inlineMath:b.inlineMath,marks:cellDisplayMarks(b,row,col)},l,text)});
    el.append(table);
  } else if(b.type==='toc'||b.type==='index') {
    if(!continued){const title=document.createElement('h2');title.textContent=b.text||(b.type==='toc'?'目录':'索引');el.append(title);}
    const entries=part.entries||b._entries||[];
    for(const item of entries){const row=document.createElement('div');row.className='toc-entry';row.style.paddingLeft=`${((item.level||1)-1)*1.2}em`;const label=document.createElement('span');label.textContent=item.text;const number=document.createElement('span');number.textContent=item.page;row.append(label,number);el.append(row);}
    if(!entries.length){const hint=document.createElement('p');hint.textContent=b.type==='toc'?'添加标题后自动生成目录':'在右侧填写索引词，每行一项';el.append(hint);}
  } else inline(el,b,l,text,part.start||0);
  if(part.flow)applyFlowPart(el,b,l,part.flow);
  return el;
}
const safeCut=safeFlowCut;
function once(doc,measure,entries) {
  if(needsFlow(doc))return paginateFlow(doc,measure,entries,blockElement);
  measure.style.writingMode='horizontal-tb';measure.style.height='auto';
  const l={...doc.layout,_notes:doc.notes||[]},fullWidth=(l.width-l.inner-l.outer)*MM,width=(fullWidth-l.gap*MM*(l.columns-1))/l.columns,height=(l.height-l.top-l.bottom)*MM;
  measure.style.width=`${width}px`;
  const pages=[],pageNotes=[],noteHeights=[],warnings=[],usedPages=[];let col=0,used,notes;
  const newPage=()=>{pages.push(Array.from({length:l.columns},()=>[]));used=Array(l.columns).fill(0);usedPages.push(used);notes=new Set();pageNotes.push(notes);noteHeights.push(0);col=0;};
  const nextColumn=()=>{if(col+1<l.columns)col++;else newPage();};
  const noteCache=new Map();
  function noteHeight(ids){const key=[...ids].sort().join('|');if(!key)return 0;if(noteCache.has(key))return noteCache.get(key);measure.style.width=`${fullWidth}px`;measure.replaceChildren(notesElement(ids,l));const h=measure.firstChild.getBoundingClientRect().height;measure.style.width=`${width}px`;noteCache.set(key,h);return h;}
  const longNotes=new Set(l._notes.filter(n=>noteHeight(new Set([n.id]))>height*.35).map(n=>n.id));
  const noteIds=text=>new Set(refs(text).filter(id=>l.notesMode!=='endnote'&&!longNotes.has(id)&&l._notes.some(n=>n.id===id)));
  function reserve(text){return noteHeight(new Set([...notes,...noteIds(text)]));}
  function size(b,text,continued,part){measure.replaceChildren(blockElement(b,l,text,continued,part));return measure.firstChild.getBoundingClientRect().height;}
  function fits(h,text){const capacity=height-reserve(text);return used[col]+h<=capacity+.1&&used.every(n=>n<=capacity+.1);}
  function place(b,text,h,meta={}){pages.at(-1)[col].push({block:b,text,start:0,end:b.text.length,height:h,readOnly:!!b._generated,...meta});used[col]+=h;for(const id of noteIds(text))notes.add(id);noteHeights[noteHeights.length-1]=noteHeight(notes);}
  newPage();
  let blocks=doc.blocks.map(b=>['toc','index'].includes(b.type)?{...b,_entries:entries[b.id]||[]}:b);
  const endnotes=l.notesMode==='endnote'?l._notes:l._notes.filter(n=>longNotes.has(n.id));
  if(endnotes.length){blocks=[...blocks,{id:'_endnotes-title',type:'heading',text:'注释',fontFamily:'sans',level:1,_generated:true},...endnotes.map(n=>({id:`_endnote-${n.id}`,type:'paragraph',text:`${n.marker??l._notes.indexOf(n)+1}　${n.text}`,indent:0,_generated:true}))];if(l.notesMode!=='endnote')warnings.push('超过版心高度 35% 的长注释已移到文末，避免脚注溢出。');}
  for(const b of blocks){
    if(b.type==='pageBreak'){newPage();continue;}
    if(['table','toc','index'].includes(b.type)){
      const isTable=b.type==='table',count=isTable?b.rows.length:b._entries.length,header=isTable?headerRowCount(b):{count:0,warnings:[]},headers=header.count;
      warnings.push(...header.warnings);
      const groupEnds=isTable?tableRowGroups(b).map(g=>g.end):Array.from({length:Math.max(1,count)},(_,i)=>i+1);
      let at=0;
      do{
        let accepted=null;
        const prefix=at>=headers&&at>0?Array.from({length:headers},(_,i)=>i):[];
        for(const end of groupEnds.filter(end=>end>at)){
          const meta=isTable?{rowIndexes:[...prefix,...Array.from({length:Math.max(0,end-at)},(_,i)=>at+i)]}:{entries:b._entries.slice(at,end)};
          if(!count&&isTable)break;
          const text=isTable?meta.rowIndexes.map(i=>b.rows[i].join(' ')).join('\n'):meta.entries.map(e=>e.text).join('\n');
          const h=size(b,b.text,at>0,meta);
          if(fits(h,text)){accepted={meta,h,end,text};}else break;
        }
        if(isTable&&at===0&&count>headers&&accepted?.end<=headers&&used[col]>0){nextColumn();continue;}
        if(!accepted){
          if(used[col]>0||notes.size){nextColumn();continue;}
          const end=groupEnds.find(end=>end>at)||at+1;
          const meta=isTable?{rowIndexes:[...prefix,...Array.from({length:end-at},(_,i)=>at+i)]}:{entries:b._entries.slice(at,end)},text=isTable?meta.rowIndexes.map(i=>b.rows[i].join(' ')).join('\n'):b.text,h=size(b,b.text,at>0,meta);
          accepted={meta,h,end,text};warnings.push(isTable?'表格含超高行组，请拆分纵向合并组或缩小字号；当前行组可能超出版心。':'目录或索引项过长，请缩短文字。');
        }
        place(b,accepted.text,accepted.h,{...accepted.meta,continued:at>0,start:0,end:b.text.length});at=accepted.end;if(at<count)nextColumn();
      }while(at<count);
      continue;
    }
    if(b.type==='image'||b.type==='equation'){
      const h=size(b,b.text,false,{});while(!fits(h,b.text)&&(used.some(n=>n>0)||notes.size))nextColumn();
      if(!fits(h,b.text))warnings.push('有图片、题注或公式超过版心，请缩小尺寸或拆分。');place(b,b.text,h);continue;
    }
    const points=Array.from(b.text);let at=0,offset=0;
    do{
      const text=points.slice(at).join(''),continued=at>0,h=size(b,text,continued,{start:offset});
      if(!continued&&b.type==='heading'&&used[col]>0&&h+l.fontSize*96/72*l.lineHeight*2>height-reserve(text)-used[col])nextColumn();
      if(fits(h,text)){place(b,text,h,{start:offset,end:b.text.length});break;}
      let lo=0,hi=points.length-at;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2),s=points.slice(at,at+mid).join('');if(fits(size(b,s,continued,{start:offset}),s))lo=mid;else hi=mid-1;}
      let cut=safeCut(points,at,lo,b.ruby);
      if(!cut&&(used[col]>0||notes.size)){nextColumn();continue;}
      if(!cut){cut=minimumFlowUnit(points,at,b.ruby);warnings.push('个别字符、注音范围或注释标记超过版心，请检查字号和版心尺寸。');}
      let part=points.slice(at,at+cut).join(''),ph=size(b,part,continued,{start:offset});
      const line=(b.fontSize||l.fontSize)*96/72*l.lineHeight,minimum=l.widowLines||2;
      if(used[col]>0&&ph<line*minimum&&b.type==='paragraph'){nextColumn();continue;}
      // Keep at least two lines in the final fragment when possible.
      const tail=points.slice(at+cut).join('');
      if(tail&&size(b,tail,true,{start:offset+part.length})<line*minimum&&cut>2){
        let target=cut;while(target>1){target--;const remaining=points.slice(at+target).join('');if(size(b,remaining,true,{start:offset+points.slice(at,at+target).join('').length})>=line*minimum)break;}
        target=safeCut(points,at,target,b.ruby);if(target>0){cut=target;part=points.slice(at,at+cut).join('');ph=size(b,part,continued,{start:offset});}
      }
      place(b,part,ph,{start:offset,end:offset+part.length});at+=cut;offset+=part.length;
      if(ph>height)warnings.push('个别字行超过版心，请缩小字号。');
      if(at<points.length)nextColumn();
    }while(at<points.length);
  }
  for(const b of doc.blocks)for(const id of refs(b.text))if(!l._notes.some(n=>n.id===id))warnings.push(`未找到注释 ${id}，请补充注释内容。`);
  measure.replaceChildren();return {pages,pageNotes:pageNotes.map(s=>[...s]),noteHeights,warnings:[...new Set(warnings)],width,height};
}
export function paginate(doc,measure) {
  let entries={},last='',result;
  for(let pass=0;pass<6;pass++){
    result=once(doc,measure,entries);const positions=new Map();
    result.pages.forEach((cols,p)=>cols.flat().forEach(part=>{if(!positions.has(part.block.id))positions.set(part.block.id,p+doc.layout.pageStart);}));
    const toc=doc.blocks.filter(b=>b.type==='heading').map(b=>({text:b.text,level:b.level||1,page:String(positions.get(b.id)||'—')}));
    const index=(doc.indexTerms||[]).map(term=>{const nums=[];result.pages.forEach((cols,p)=>{if(cols.flat().some(part=>{if(['index','toc'].includes(part.block.type))return false;if(part.block.type==='table')return part.text.includes(term);let at=part.block.text.indexOf(term);while(at>=0){if(at>=part.start&&at<part.end)return true;at=part.block.text.indexOf(term,at+term.length);}return false;}))nums.push(p+doc.layout.pageStart);});return {text:term,page:[...new Set(nums)].join('、')||'—'};}).sort((a,b)=>a.text.localeCompare(b.text,'zh-CN'));
    for(const b of doc.blocks)if(b.type==='toc')entries[b.id]=toc;else if(b.type==='index')entries[b.id]=index;
    const key=JSON.stringify(entries);if(key===last||!Object.keys(entries).length)break;last=key;
    if(pass===5)result.warnings.push('目录页码尚未稳定，请检查超长标题。');
  }
  return result;
}
