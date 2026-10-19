// SPDX-License-Identifier: MIT
// Browser-measured flow. No legacy engine or binary-derived implementation.
import { tableRowGroups, headerRowCount } from './table-layout.mjs';
const MM=96/25.4;
export function flowGeometry(layout) {
  const columns=Math.max(1,layout.columns||1),fullWidth=(layout.width-layout.inner-layout.outer)*MM;
  const width=(fullWidth-(layout.gap||0)*MM*(columns-1))/columns,height=(layout.height-layout.top-layout.bottom)*MM;
  return {writingMode:layout.writingMode==='vertical-rl'?'vertical-rl':'horizontal-tb',columns,width,height,fullWidth};
}
export function needsFlow(doc) {return doc.layout.writingMode==='vertical-rl'||doc.blocks.some(b=>b.type==='image'&&['left','right'].includes(b.wrap));}
export function applyFlowColumn(el,layout,width,height,{measure=false}={}) {
  const vertical=layout.writingMode==='vertical-rl';
  el.dataset.writingMode=vertical?'vertical-rl':'horizontal-tb';
  Object.assign(el.style,{writingMode:el.dataset.writingMode,textOrientation:'mixed',display:'flow-root',boxSizing:'content-box',width:vertical&&measure?'max-content':`${width}px`,height:vertical||!measure?`${height}px`:'auto',flex:measure?'none':`0 0 ${width}px`,minWidth:'0',overflow:'visible'});
  el.style.setProperty('--flow-column-width',`${width}px`);el.style.setProperty('--flow-column-height',`${height}px`);
  return el;
}
export function partFlow(block,layout) {
  const g=flowGeometry(layout),vertical=g.writingMode==='vertical-rl';
  return {writingMode:g.writingMode,columnWidth:g.width,columnHeight:g.height,floatSide:!vertical&&block.type==='image'&&['left','right'].includes(block.wrap)?block.wrap:'none',clear:['heading','table','equation','toc','index'].includes(block.type)||(block.type==='image'&&!['left','right'].includes(block.wrap))?'both':'none'};
}
export function applyFlowPart(el,block,layout,flow=partFlow(block,layout)) {
  el.dataset.flowMode=flow.writingMode;el.style.clear=flow.clear;
  if(flow.writingMode==='vertical-rl') {
    Object.assign(el.style,{padding:'0',paddingBlockEnd:'6pt',minHeight:'0',minWidth:'1em'});
    if(block.type==='heading'){el.style.paddingBlockStart='12pt';el.style.paddingBlockEnd='10pt';}
    if(['image','table','equation','toc','index'].includes(block.type)) {
      // These structures keep their own horizontal orientation; the column flow remains vertical.
      el.style.writingMode='horizontal-tb';el.style.width=`${flow.columnWidth}px`;el.style.boxSizing='border-box';
    }
  }
  if(block.type==='image'&&flow.floatSide!=='none') {
    el.dataset.floatSide=flow.floatSide;
    Object.assign(el.style,{float:flow.floatSide,width:`${Math.min(85,block.width||50)}%`,maxWidth:'calc(100% - 24px)',margin:flow.floatSide==='left'?'0 12px 8px 0':'0 0 8px 12px',paddingBottom:'0'});
    const img=el.querySelector('img');if(img)img.style.width='100%';
  }
  return el;
}
export function safeFlowCut(points,start,count,ruby=[]) {
  const prefix=points.slice(start,start+count).join(''),open=prefix.lastIndexOf('[^');
  if(open>=0&&!prefix.slice(open).includes(']'))count=Array.from(prefix.slice(0,open)).length;
  const closing=/^[，。！？；：、）】》〉」』”’…,.!?;:%]/,opening=/^[（【《〈「『“‘(\[]/;
  for(let n=0;count>1&&n<12&&(closing.test(points[start+count]||'')||opening.test(points[start+count-1]||''));n++)count--;
  const offset=points.slice(0,start).join('').length,end=offset+points.slice(start,start+count).join('').length;
  const hit=ruby.find(r=>r.start<end&&r.end>end);
  if(hit)count=Array.from(points.slice(start).join('').slice(0,Math.max(0,hit.start-offset))).length;
  // Punctuation adjustment may enter a structural token; protect after it too.
  const rest=points.slice(start).join(''),cut=points.slice(start,start+count).join('').length;
  for(const m of rest.matchAll(/\[\^[-\w]+\]|\[\[(?:math|ref|cite):[-\w]+\]\]/g))if(m.index<cut&&m.index+m[0].length>cut)count=Array.from(rest.slice(0,m.index)).length;
  return count;
}
export function minimumFlowUnit(points,start,ruby=[]) {
  const text=points.slice(start).join(''),offset=points.slice(0,start).join('').length;
  const hit=ruby.find(r=>r.start===offset),note=/^(?:\[\^[-\w]+\]|\[\[(?:math|ref|cite):[-\w]+\]\])/.exec(text);
  return hit?Array.from(text.slice(0,hit.end-offset)).length:note?Array.from(note[0]).length:1;
}
// Count physical text lines, excluding annotation text. Marks can produce several
// rectangles on the same line; their common cross-axis position is counted once.
export function countFlowLineRects(rectangles,vertical=false) {
  const bands=[];
  for(const r of rectangles) {
    if(!r.width||!r.height)continue;
    const start=vertical?r.left:r.top,end=vertical?r.right:r.bottom;
    const band=bands.find(b=>Math.min(b.end,end)-Math.max(b.start,start)>=Math.min(b.end-b.start,end-start)*.4);
    if(band){band.start=Math.min(band.start,start);band.end=Math.max(band.end,end);}else bands.push({start,end});
  }
  return bands.length;
}
function physicalLines(el,vertical) {
  const rectangles=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
    const node=walker.currentNode;if(!node.textContent.trim()||node.parentElement.closest('rt,rp'))continue;
    const range=document.createRange();range.selectNodeContents(node);
    rectangles.push(...range.getClientRects());
  }
  return countFlowLineRects(rectangles,vertical);
}

/** The same DOM builder and column geometry are used in measurement and preview.
 * Parts retain source UTF-16 offsets. Floats stay with their column and affect all
 * following normal paragraphs until clear/end; they are never silently repeated.
 */
export function paginateFlow(doc,measure,entries,renderBlock) {
  const l={...doc.layout,_notes:doc.notes||[]},g=flowGeometry(l),vertical=g.writingMode==='vertical-rl';
  const warnings=[],pages=[];let column=0,host;
  const capacity=vertical?g.width:g.height;
  measure.style.width=`${g.width}px`;measure.style.height='auto';measure.style.writingMode='horizontal-tb';
  function resetHost(){host=document.createElement('div');applyFlowColumn(host,l,g.width,g.height,{measure:true});measure.replaceChildren(host);}
  function page(){pages.push(Array.from({length:g.columns},()=>[]));column=0;resetHost();}
  function next(){if(column+1<g.columns){column++;resetHost();}else page();}
  function extent(){const r=host.getBoundingClientRect();return vertical?Math.max(r.width,host.scrollWidth):Math.max(r.height,host.scrollHeight);}
  function trial(b,text,meta={}) {
    const flow=partFlow(b,l),part={start:0,end:b.text.length,flow,...meta};
    const el=renderBlock(b,l,b.type==='table'?b.text:text,!!part.continued,part);host.append(el);
    const r=el.getBoundingClientRect(),total=extent(),cross=vertical?r.height:r.width;
    const fits=total<=capacity+.5&&cross<=(vertical?g.height:g.width)+.5;
    const lines=physicalLines(el,vertical);
    el.remove();return {part,el,total,fits,blockExtent:vertical?r.width:r.height,lines};
  }
  function freshTrial(b,text,meta={}) {
    const old=host;host=document.createElement('div');applyFlowColumn(host,l,g.width,g.height,{measure:true});measure.append(host);
    try{return trial(b,text,meta);}finally{host.remove();host=old;}
  }
  function place(b,text,t) {host.append(t.el);pages.at(-1)[column].push({block:b,text,start:0,end:b.text.length,height:t.el.getBoundingClientRect().height,readOnly:!!b._generated,...t.part});}
  function hasContent(){return host.children.length>0;}
  function advanceText(){
    const parts=pages.at(-1)[column],last=parts.at(-1);
    if(last?.block.type==='heading') {
      if(parts.length===1)return false;
      parts.pop();host.lastElementChild.remove();next();
      place(last.block,last.text,trial(last.block,last.text,last));return true;
    }
    next();return true;
  }
  function rowsText(b,rows){return rows.map(i=>b.rows[i].join(' ')).join('\n');}
  let blocks=doc.blocks.map(b=>['toc','index'].includes(b.type)?{...b,_entries:entries[b.id]||[]}:b);
  if(l._notes.length){
    blocks=[...blocks,{id:'_flow-notes-title',type:'heading',text:'注释',level:1,_generated:true},...l._notes.map((n,i)=>({id:`_flow-note-${n.id}`,type:'paragraph',text:`${n.marker??i+1}　${n.text}`,indent:0,_generated:true}))];
    if(l.notesMode!=='endnote')warnings.push('竖排或图片绕排使用文末注释；本轮不支持该组合的页底脚注。');
  }
  if(vertical&&blocks.some(b=>b.type==='image'&&b.wrap!=='none'&&b.wrap))warnings.push('竖排暂不支持图片左右绕排，图片已按独占块显示。');
  if(vertical&&blocks.some(b=>['table','equation','toc','index'].includes(b.type)))warnings.push('竖排中的表格、公式、目录和索引保留横排块；块内竖排尚未支持。');
  if(blocks.some(b=>b.type==='image'&&['left','right'].includes(b.wrap)&&(b.width||50)>85))warnings.push('绕排图片宽度已限制为栏宽的 85%，为正文保留最小空间。');
  page();
  for(let blockIndex=0;blockIndex<blocks.length;blockIndex++) {
    const b=blocks[blockIndex];
    if(b.type==='pageBreak'){page();continue;}
    if(['table','toc','index'].includes(b.type)) {
      const table=b.type==='table',groups=table?tableRowGroups(b):b._entries.map((_,i)=>({start:i,end:i+1}));
      const header=table?headerRowCount(b):{count:0,warnings:[]};warnings.push(...header.warnings);
      if(!groups.length){const t=trial(b,b.text);if(!t.fits&&hasContent())next();place(b,b.text,trial(b,b.text));continue;}
      let at=0;
      while(at<groups.length){
        let accepted;
        for(let end=at;end<groups.length;end++) {
          const first=groups[at].start,last=groups[end].end;
          const prefix=table&&first>=header.count&&first>0?Array.from({length:header.count},(_,i)=>i):[];
          const meta=table?{rowIndexes:[...prefix,...Array.from({length:last-first},(_,i)=>first+i)],continued:at>0}:{entries:b._entries.slice(first,last),continued:at>0};
          const text=table?rowsText(b,meta.rowIndexes):meta.entries.map(e=>e.text).join('\n');
          const t=trial(b,text,meta);
          if(!t.fits)break;accepted={t,text,end:end+1};
        }
        if(accepted&&table&&at===0&&header.count<b.rows.length&&groups[accepted.end-1].end<=header.count&&hasContent()){next();continue;}
        if(!accepted){
          if(hasContent()){next();continue;}
          const first=groups[at].start,last=groups[at].end,prefix=table&&first>=header.count&&first>0?Array.from({length:header.count},(_,i)=>i):[];
          const meta=table?{rowIndexes:[...prefix,...Array.from({length:last-first},(_,i)=>first+i)],continued:at>0}:{entries:b._entries.slice(first,last),continued:at>0};
          const text=table?rowsText(b,meta.rowIndexes):b.text;
          accepted={t:trial(b,text,meta),text,end:at+1};warnings.push(table?'表格合并行组或重复表头超过版心，请拆分合并组或缩小字号；该片段可能溢出。':'目录或索引项超过版心，请缩短文字。');
        }
        place(b,accepted.text,accepted.t);at=accepted.end;if(at<groups.length)next();
      }
      continue;
    }
    if(['image','equation'].includes(b.type)) {
      let t=trial(b,b.text);if(!t.fits&&hasContent()){next();t=trial(b,b.text);}
      if(!t.fits)warnings.push('图片、题注或公式超过版心，请缩小尺寸或拆分；该块可能溢出。');
      place(b,b.text,t);continue;
    }
    const points=Array.from(b.text);let at=0,offset=0;
    do {
      const text=points.slice(at).join(''),meta={start:offset,end:b.text.length,continued:at>0};
      let t=trial(b,text,meta);
      const minimum=Math.max(1,l.widowLines??2);
      if(!at&&b.type==='heading'&&hasContent()) {
        const following=blocks[blockIndex+1];
        if(following?.type==='paragraph'&&following.text) {
          host.append(t.el);
          const nextPoints=Array.from(following.text);let low=1,high=nextPoints.length;
          while(low<high){const mid=Math.floor((low+high)/2);if(trial(following,nextPoints.slice(0,mid).join('')).lines>=minimum)high=mid;else low=mid+1;}
          // Grow a tentative prefix to the end of an atomic ruby/reference if needed.
          let prefix=low;while(prefix<nextPoints.length&&safeFlowCut(nextPoints,0,prefix,following.ruby)!==prefix)prefix++;
          const nextFits=trial(following,nextPoints.slice(0,prefix).join('')).fits;t.el.remove();
          if(!t.fits||!nextFits){next();t=trial(b,text,meta);}
        }
      }
      if(t.fits){place(b,text,t);break;}
      let lo=0,hi=points.length-at;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2),str=points.slice(at,at+mid).join('');if(trial(b,str,meta).fits)lo=mid;else hi=mid-1;}
      let cut=safeFlowCut(points,at,lo,b.ruby);
      if(!cut&&hasContent()){next();continue;}
      if(!cut){cut=minimumFlowUnit(points,at,b.ruby);warnings.push('个别字符、注音范围或注释标记超过版心，请检查字号和版心尺寸。');}
      let str=points.slice(at,at+cut).join('');t=trial(b,str,{...meta,end:offset+str.length});
      if(b.type==='paragraph'&&minimum>1&&cut<points.length-at) {
        if(t.lines<minimum&&hasContent()&&advanceText())continue;
        if(t.lines<minimum)warnings.push('当前栏无法容纳规定的最少正文行数，已保留完整内容并放宽该处分行约束。');
        const tailTrial=count=>{const prefix=points.slice(at,at+count).join('');return freshTrial(b,points.slice(at+count).join(''),{start:offset+prefix.length,continued:true});};
        if(tailTrial(cut).lines<minimum) {
          let low=0,high=cut;
          while(low<high){const mid=Math.ceil((low+high)/2);if(tailTrial(mid).lines>=minimum)low=mid;else high=mid-1;}
          const balanced=safeFlowCut(points,at,low,b.ruby),candidate=points.slice(at,at+balanced).join(''),bt=balanced?trial(b,candidate,{...meta,end:offset+candidate.length}):null;
          if(bt?.fits&&bt.lines>=minimum){cut=balanced;str=candidate;t=bt;}
          else if(hasContent()&&freshTrial(b,text,meta).fits&&advanceText())continue;
          else warnings.push('当前版心或不可拆注音范围无法同时满足两端最少行数，已保留完整内容并放宽该处分行约束。');
        }
      }
      place(b,str,t);at+=cut;offset+=str.length;if(at<points.length)next();
    }while(at<points.length);
  }
  for(const b of doc.blocks)for(const match of b.text.matchAll(/\[\^([-\w]+)\]/g))if(!l._notes.some(n=>n.id===match[1]))warnings.push(`未找到注释 ${match[1]}，请补充注释内容。`);
  measure.replaceChildren();return {pages,pageNotes:pages.map(()=>[]),noteHeights:pages.map(()=>0),warnings:[...new Set(warnings)],width:g.width,height:g.height,geometry:g};
}
