import {validateDocument,replaceBlockText,uid} from './model.mjs';

export function transformText(text,operation){
  switch(operation){
    case 'upper':return text.toLocaleUpperCase();
    case 'lower':return text.toLocaleLowerCase();
    case 'fullwidth':return text.replace(/[!-~]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)).replace(/ /g,'　');
    case 'halfwidth':return text.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/　/g,' ');
    case 'trim':return text.split('\n').map(s=>s.trim()).join('\n');
    case 'thousands':return text.replace(/(?<![\w.,])([+-]?\d{4,})(\.\d+)?(?![\w.,])/g,(_,n,f='')=>n.replace(/\B(?=(\d{3})+(?!\d))/g,',')+f);
    default:throw Error('未知文字转换。');
  }
}
export function runTextOperations(doc,operations,blockId=null){
  if(!Array.isArray(operations)||operations.length<1||operations.length>20)throw Error('操作序列需要 1–20 步。');
  const next=structuredClone(doc);
  let changed=0;
  for(const b of next.blocks){
    if(!['paragraph','heading'].includes(b.type)||(blockId&&b.id!==blockId))continue;
    let text=b.text;
    // References are structural tokens, never subject to case or width changes.
    for(const op of operations)text=text.split(/(\[\^[-\w]+\]|\[\[(?:ref|cite|math):[-\w]+\]\])/g).map(s=>/^(?:\[\^[-\w]+\]|\[\[(?:ref|cite|math):[-\w]+\]\])$/.test(s)?s:transformText(s,op)).join('');
    if(text!==b.text){replaceBlockText(b,text);changed++;}
  }
  return {doc:validateDocument(next),changed};
}
export function compareDocuments(before,after){
  const old=new Map(before.blocks.map(b=>[b.id,b])),current=new Map(after.blocks.map(b=>[b.id,b]));
  const changes=[];
  for(const [id,b] of old){const next=current.get(id);if(!next)changes.push({kind:'删除',id,before:b.text,after:''});else if(JSON.stringify(b)!==JSON.stringify(next))changes.push({kind:'修改',id,before:b.text,after:next.text});}
  for(const [id,b] of current)if(!old.has(id))changes.push({kind:'新增',id,before:'',after:b.text});
  if(JSON.stringify(before.layout)!==JSON.stringify(after.layout))changes.unshift({kind:'版式变化',id:'',before:JSON.stringify(before.layout),after:JSON.stringify(after.layout)});
  const commonBefore=before.blocks.map(b=>b.id).filter(id=>current.has(id)),commonAfter=after.blocks.map(b=>b.id).filter(id=>old.has(id));
  if(JSON.stringify(commonBefore)!==JSON.stringify(commonAfter))changes.push({kind:'顺序变化',id:'',before:commonBefore.join(', '),after:commonAfter.join(', ')});
  if(JSON.stringify(before.notes)!==JSON.stringify(after.notes))changes.push({kind:'注释变化',id:'',before:JSON.stringify(before.notes),after:JSON.stringify(after.notes)});
  for(const key of ['comments','bibliography'])if(JSON.stringify(before[key])!==JSON.stringify(after[key]))changes.push({kind:key==='comments'?'批注变化':'参考文献变化',id:'',before:JSON.stringify(before[key]),after:JSON.stringify(after[key])});
  return changes;
}
export function assembleBook(doc,chapters){
  const next=structuredClone(validateDocument(doc)),warnings=[];
  for(const raw of chapters){
    const chapter=validateDocument(raw);if(chapter.journal||next.journal)throw Error('期刊论文暂不支持直接合书；请分别验收首面与刊内页码。');const ids=new Map(),noteIds=new Map(),bibIds=new Map();
    for(const b of chapter.blocks)ids.set(b.id,uid());
    for(const n of chapter.notes)noteIds.set(n.id,'n'+uid().replaceAll('-',''));
    for(const n of chapter.bibliography)bibIds.set(n.id,'b'+uid().replaceAll('-',''));
    const remap=text=>text.replace(/\[\^([-\w]+)\]/g,(s,id)=>noteIds.has(id)?`[^${noteIds.get(id)}]`:s).replace(/\[\[(ref|cite):([-\w]+)\]\]/g,(s,k,id)=>{const map=k==='ref'?ids:bibIds;return map.has(id)?`[[${k}:${map.get(id)}]]`:s;});
    if(next.blocks.length)next.blocks.push({id:uid(),type:'pageBreak',text:''});
    for(const b of chapter.blocks){
      // Update ranges one token at a time so imported character styles keep their positions.
      for(const m of [...b.text.matchAll(/\[\^([-\w]+)\]|\[\[(ref|cite):([-\w]+)\]\]/g)].reverse())replaceBlockText(b,b.text.slice(0,m.index)+remap(m[0])+b.text.slice(m.index+m[0].length));
      b.id=ids.get(b.id);if(b.anchor)b.anchor.targetId=ids.get(b.anchor.targetId);if(b.captionIds)b.captionIds=b.captionIds.map(id=>ids.get(id));if(b.rows)b.rows=b.rows.map(r=>r.map(remap));next.blocks.push(b);
    }
    next.notes.push(...chapter.notes.map(n=>({...n,id:noteIds.get(n.id),text:remap(n.text)})));
    next.bibliography.push(...chapter.bibliography.map(n=>({...n,id:bibIds.get(n.id)})));
    next.comments.push(...chapter.comments.map(c=>({...c,id:uid(),blockId:ids.get(c.blockId)})));
    next.proSources.push(...chapter.proSources);
    next.importReports.push(...chapter.importReports);
    next.bookmarks.push(...chapter.bookmarks.map(b=>({...b,blockId:ids.get(b.blockId)})));
    next.indexTerms=[...new Set([...next.indexTerms,...chapter.indexTerms])];
    for(const s of chapter.styles){if(!next.styles.some(x=>x.name===s.name))next.styles.push(s);else if(JSON.stringify(next.styles.find(x=>x.name===s.name))!==JSON.stringify(s))warnings.push(`章节“${chapter.title}”的同名样式“${s.name}”使用当前工程定义；已有段落直接格式保留。`);}
    if(JSON.stringify(chapter.layout)!==JSON.stringify(next.layout))warnings.push(`章节“${chapter.title}”按当前整书版式重排。`);
  }
  return {doc:validateDocument(next),warnings};
}
export function codepointInfo(text){return Array.from(text).slice(0,200).map(c=>({character:c,codepoint:'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'),utf16:c.length}));}

function openLibrary(){return new Promise((resolve,reject)=>{const request=indexedDB.open('shuye-project-library',1);request.onupgradeneeded=()=>request.result.createObjectStore('projects',{keyPath:'name'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function library(action,value){const db=await openLibrary();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('projects',action==='getAll'?'readonly':'readwrite'),store=tx.objectStore('projects'),req=action==='getAll'?store.getAll():store.put(value);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('工程库事务中断'));});}finally{db.close();}}

export function setupWorkspaceTools({getDoc,getSelected,change,select,status,replaceDoc,getSelectionRange}){
  const toolbar=document.querySelector('.toolbar>div'),dialog=document.createElement('dialog');dialog.className='workspace-dialog';document.body.append(dialog);
  const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{try{await fn();}catch(e){status(e.message,true);}};return b;};
  const heading=text=>{const h=document.createElement('h2');h.textContent=text;dialog.append(h);};
  const label=(text,el)=>{const l=document.createElement('label');l.append(document.createTextNode(text),el);dialog.append(l);return el;};
  const input=(text,value='')=>{const i=document.createElement('input');i.value=value;return label(text,i);};
  const close=()=>dialog.append(button('关闭',()=>dialog.close()));
  const launch=fn=>{dialog.replaceChildren();fn();close();dialog.showModal();};
  const active=()=>getDoc().blocks.find(b=>b.id===getSelected());
  toolbar.append(button('工程库',async()=>{
    const rows=await library('getAll');launch(()=>{heading('本机工程库');const p=document.createElement('p');p.textContent='保存多个工程快照；重新打开替换当前编辑文稿，可撤销。工程库按浏览器和端口隔离，仍请下载备份。';dialog.append(p);const name=input('快照名称',getDoc().title+' '+new Date().toLocaleString());
      dialog.append(button('保存当前工程快照',async()=>{const key=name.value.trim();if(!key)throw Error('请输入快照名称。');await library('put',{name:key,updated:new Date().toISOString(),doc:structuredClone(getDoc())});status('快照已保存到本机工程库');dialog.close();}));
      const list=document.createElement('div');list.className='project-list';for(const r of rows.sort((a,b)=>b.updated.localeCompare(a.updated)))list.append(button(`${r.name} · ${r.doc.blocks.length} 块`,()=>{replaceDoc(validateDocument(r.doc));dialog.close();}));dialog.append(list);
    });
  }));
  toolbar.append(button('编辑辅助',()=>launch(()=>{
    heading('编辑辅助');const scope=document.createElement('select');for(const [v,t]of [['current','当前段落'],['all','全部正文与标题']]){const o=document.createElement('option');o.value=v;o.textContent=t;scope.append(o);}label('应用范围',scope);
    const op=document.createElement('select');for(const [v,t]of [['upper','英文转大写'],['lower','英文转小写'],['fullwidth','ASCII 转全角'],['halfwidth','全角转半角'],['trim','清除每行首尾空白'],['thousands','数字添加千分位']]){const o=document.createElement('option');o.value=v;o.textContent=t;op.append(o);}label('文字转换',op);
    dialog.append(button('执行转换',async()=>{const r=runTextOperations(getDoc(),[op.value],scope.value==='current'?getSelected():null);await replaceDoc(r.doc);status(`已转换 ${r.changed} 段，可撤销`);dialog.close();}));
    const sequence=input('操作序列（依次执行，用逗号分隔）','halfwidth,trim');dialog.append(button('执行操作序列',async()=>{const r=runTextOperations(getDoc(),sequence.value.split(',').map(s=>s.trim()),scope.value==='current'?getSelected():null);await replaceDoc(r.doc);dialog.close();status(`操作序列已修改 ${r.changed} 段`);}));
    const p=document.createElement('p');p.textContent='序列仅接受上列操作：upper、lower、fullwidth、halfwidth、trim、thousands。不会执行脚本。脚注引用保持原样。批量转换涉及注音基文时可能移除注音绑定，请转换后核对。';dialog.append(p);
    const chars=document.createElement('pre');const b=active(),range=getSelectionRange();chars.textContent=codepointInfo(b?(range?.id===b.id&&range.end>range.start?b.text.slice(range.start,range.end):b.text):'').map(c=>`${c.character}  ${c.codepoint}  UTF-16: ${c.utf16}`).join('\n');chars.className='character-report';dialog.append(chars);
  })));
  toolbar.append(button('书签',()=>launch(()=>{
    heading('书签与定位');const name=input('书签名称',active()?.text.slice(0,24)||'新书签');dialog.append(button('标记当前段落',()=>{if(!active())throw Error('请先选择段落。');change(()=>getDoc().bookmarks.push({name:name.value||'书签',blockId:getSelected()}));dialog.close();}));
    for(const mark of getDoc().bookmarks||[])dialog.append(button(mark.name,()=>{select(mark.blockId);document.querySelector(`.block[data-id="${mark.blockId}"]`)?.scrollIntoView({block:'center'});dialog.close();}));
  })));
  const file=document.createElement('input');file.type='file';file.accept='.json';file.multiple=true;file.hidden=true;document.body.append(file);let mode='append';
  file.onchange=async()=>{try{const files=[...file.files];if(!files.length)return;if(files.some(f=>f.size>100*1024*1024))throw Error('单工程不得超过 100 MB。');const docs=[];for(const f of files)docs.push(validateDocument(JSON.parse(await f.text())));
    if(mode==='append'){const r=assembleBook(getDoc(),docs);await replaceDoc(r.doc);status(`已插入 ${docs.length} 个章节。`+r.warnings.join(' '));}
    else {const differences=compareDocuments(docs[0],getDoc());launch(()=>{heading('与选定工程比较');const p=document.createElement('p');p.textContent=`共 ${differences.length} 项变化，比较不修改文稿。块 ID 不同的独立工程会显示为新增/删除。`;dialog.append(p);for(const row of differences){const section=document.createElement('section'),h=document.createElement('strong'),pre=document.createElement('pre');h.textContent=row.kind;pre.textContent=`原：${row.before}\n现：${row.after}`;section.append(h,pre);dialog.append(section);}});}
  }catch(e){status(e.message,true);}finally{file.value='';}};
  toolbar.append(button('插入章节',()=>{mode='append';file.multiple=true;file.click();}),button('版本比较',()=>{mode='compare';file.multiple=false;file.click();}));
  toolbar.append(button('符号',()=>launch(()=>{
    heading('Unicode 符号');const symbols='αβγδεζηθλμνξπρστυφχψωΑΒΓΔΘΛΞΠΣΦΨΩ±×÷≈≠≤≥∞∑∏∫∂√∈∉⊂⊆∪∩∅∀∃→←↔⇒⇔℃℉°‰©®™§†‡※★☆●○□■△▲';const grid=document.createElement('div');grid.className='symbol-grid';for(const symbol of Array.from(symbols))grid.append(button(symbol,()=>{const b=active(),r=getSelectionRange();if(!b||!['paragraph','heading','equation'].includes(b.type))throw Error('请先选择正文、标题或公式。');change(()=>{const start=r?.id===b.id?r.start:b.text.length,end=r?.id===b.id?r.end:start;replaceBlockText(b,b.text.slice(0,start)+symbol+b.text.slice(end));});dialog.close();}));dialog.append(grid);
  })));
}
