// SPDX-License-Identifier: MIT
import { replaceBlockText as defaultReplaceBlockText } from './model.mjs';
const WORD = /[\p{L}\p{N}\p{M}_]/u;
const STYLE_KEYS = ['type','fontFamily','fontSize','align','bold','indent','level'];

function fields(doc, scope = 'all') {
  const result = [];
  const includes = name => scope === 'all' || scope === name;
  for (const block of doc.blocks || []) {
    if ((block.type === 'paragraph' && includes('body')) || (block.type === 'heading' && includes('heading')) || (['image','table'].includes(block.type) && includes('caption'))) {
      result.push({ blockId: block.id, field: 'text', text: block.text || '', limit: 300000 });
    }
    if (block.type === 'table' && includes('table')) for (let row = 0; row < (block.rows || []).length; row++) {
      for (let col = 0; col < block.rows[row].length; col++) result.push({ blockId: block.id, field: 'cell', row, col, text: block.rows[row][col], limit: 10000 });
    }
  }
  if (includes('notes')) for (const note of doc.notes || []) result.push({ noteId: note.id, field: 'note', text: note.text, limit: 30000 });
  return result;
}

/** Literal matches; offsets always address the original UTF-16 string. */
export function findMatches(doc, needle, options = {}) {
  if (typeof needle !== 'string' || !needle.length) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, options.caseSensitive ? 'gu' : 'giu');
  const matches = [];
  for (const field of fields(doc, options.scope)) {
    const protectedRanges = [...field.text.matchAll(/\[\^[^\]\r\n]*\]|\[\[(?:math|ref|cite):[-\w]+\]\]/g)].map(m => [m.index, m.index + m[0].length]);
    let protectedIndex = 0;
    for (const hit of field.text.matchAll(re)) {
      const start = hit.index, end = start + hit[0].length;
      while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex][1] <= start) protectedIndex++;
      const range = protectedRanges[protectedIndex];
      if (range && start < range[1] && end > range[0]) continue;
      if (options.wholeWord) {
        const before = Array.from(field.text.slice(Math.max(0,start-2),start)).at(-1) || '';
        const after = Array.from(field.text.slice(end,end+2))[0] || '';
        if (WORD.test(before) || WORD.test(after)) continue;
      }
      matches.push({ ...field, start, end, match: hit[0] });
    }
  }
  return matches;
}

function applyMatches(doc, matches, replacement, replaceBlockText) {
  for (const match of [...matches].reverse()) {
    const block = match.blockId ? doc.blocks.find(b => b.id === match.blockId) : null;
    const note = match.noteId ? doc.notes?.find(n => n.id === match.noteId) : null;
    const current = match.field === 'cell' ? block?.rows?.[match.row]?.[match.col] : match.field === 'note' ? note?.text : block?.text;
    if (typeof current !== 'string' || current.slice(match.start,match.end) !== match.match) throw Error('文稿已改变，请重新查找后替换。');
    const next = current.slice(0,match.start) + replacement + current.slice(match.end);
    if (next.length > match.limit) throw Error('替换后文字超出段落、单元格或注释长度限制，请缩短替换内容。');
    if (match.field === 'cell') block.rows[match.row][match.col] = next;
    else if (match.field === 'note') note.text = next;
    else replaceBlockText(block,next);
  }
}

/** Returns a changed copy, never mutates the original document. */
export function replaceAll(doc, needle, replacement, options = {}, replaceBlockText = defaultReplaceBlockText) {
  if (typeof replacement !== 'string') throw new TypeError('替换内容必须为字符串。');
  const matches = findMatches(doc,needle,options);
  const document = structuredClone(doc);
  applyMatches(document,matches,replacement,replaceBlockText);
  return { document, count: matches.length };
}

function element(tag, text, props = {}) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  Object.assign(el,props);
  return el;
}
function field(label, input) { const el=element('label',label); el.style.display='grid';el.style.gap='6px';el.style.margin='12px 0';el.append(input);return el; }
function button(text, action) { const el=element('button',text,{type:'button'});el.onclick=action;return el; }
function dialog(title) {
  const el=element('dialog');el.dataset.editorTools='true';el.style.width='min(580px, 90vw)';el.append(element('h2',title));document.body.append(el);return el;
}

export function setupEditorTools({ getDoc, change, select, status, replaceBlockText, getSelected }) {
  if (typeof replaceBlockText !== 'function') throw new TypeError('setupEditorTools requires replaceBlockText');
  const toolbar=document.querySelector('.toolbar');
  if (!toolbar) throw Error('找不到编辑器工具栏。');
  const selectedId=()=>getSelected?.() ?? document.querySelector('.outline button.active, #outline button.active')?.dataset.id;
  const report=error=>{
    const message=error.message || String(error);status(message,true);
    const open=document.querySelector('dialog[data-editor-tools][open]');
    if(open){let notice=open.querySelector('[data-editor-error]');if(!notice){notice=element('p',undefined,{role:'alert'});notice.dataset.editorError='true';notice.style.color='#aa3447';open.append(notice);}notice.textContent=message;}
  };
  const searchDialog=dialog('查找替换');
  const find=element('input',undefined,{type:'text',placeholder:'输入查找文字',ariaLabel:'查找文字'});
  const replacement=element('input',undefined,{type:'text',placeholder:'输入替换文字（留空即删除）',ariaLabel:'替换文字'});
  const scope=element('select',undefined,{ariaLabel:'查找范围'});
  for (const [value,label] of [['all','全部可编辑文字'],['body','正文'],['heading','标题'],['table','表格单元格'],['caption','题注'],['notes','注释文字']]) scope.append(element('option',label,{value}));
  const sensitive=element('input',undefined,{type:'checkbox'}),whole=element('input',undefined,{type:'checkbox'});
  const checks=element('div');checks.style.display='flex';checks.style.gap='16px';
  for (const [box,title] of [[sensitive,'区分大小写'],[whole,'全字匹配']]) {const label=element('label');label.append(box,document.createTextNode(title));checks.append(label);}
  const count=element('p','输入文字开始查找。',{ariaLive:'polite'}),preview=element('p');preview.style.whiteSpace='pre-wrap';preview.style.overflowWrap='anywhere';
  let matches=[],current=-1;
  const options=()=>({scope:scope.value,caseSensitive:sensitive.checked,wholeWord:whole.checked});
  const update=(reset=false)=>{
    matches=findMatches(getDoc(),find.value,options());
    current=reset ? (matches.length?0:-1) : Math.min(current,matches.length-1);
    if(current<0&&matches.length)current=0;
    count.textContent=find.value ? `共 ${matches.length} 处${current>=0?`，当前第 ${current+1} 处`:''}` : '输入文字开始查找。';
    const hit=matches[current];
    preview.textContent=hit ? `${hit.field==='cell'?`单元格 ${hit.row+1} 行 ${hit.col+1} 列`:hit.field==='note'?'注释':'段落'}：${hit.text.slice(Math.max(0,hit.start-35),hit.start)}【${hit.match}】${hit.text.slice(hit.end,hit.end+50)}` : '';
  };
  const navigate=delta=>{
    update();if(!matches.length)return;
    current=(current+delta+matches.length)%matches.length;update();const hit=matches[current];
    const blockId=hit.blockId || getDoc().blocks.find(b=>b.text?.includes(`[^${hit.noteId}]`))?.id;
    if(blockId)select(blockId);
  };
  const replace=(all)=>{
    try {
      update();if(!matches.length)return;
      const doc=getDoc(),chosen=all?matches:[matches[current]],next=structuredClone(doc);
      applyMatches(next,chosen,replacement.value,replaceBlockText);
      change(()=>{const live=getDoc();live.blocks=next.blocks;live.notes=next.notes;});
      update();status(`已替换 ${chosen.length} 处，可撤销。`);
    } catch(error) {report(error);}
  };
  const actions=element('div');actions.style.display='flex';actions.style.flexWrap='wrap';actions.style.gap='8px';
  actions.append(button('上一处',()=>navigate(-1)),button('下一处',()=>navigate(1)),button('替换当前',()=>replace(false)),button('全部替换',()=>replace(true)),button('关闭',()=>searchDialog.close()));
  searchDialog.append(field('查找',find),field('替换为',replacement),field('范围',scope),checks,element('p','按原文查找，支持中文与 Unicode；全字匹配以字母、数字及汉字边界判断。公式和 [^注释ID] 引用不会被修改。'),count,preview,actions);
  find.oninput=()=>update(true);scope.onchange=sensitive.onchange=whole.onchange=()=>update(true);

  const styleDialog=dialog('段落样式'),styleName=element('input',undefined,{type:'text',maxLength:80,placeholder:'例如：正文、小节标题',ariaLabel:'样式名称'}),styles=element('select',undefined,{ariaLabel:'已保存的样式'}),summary=element('p');
  const refreshStyles=()=>{
    const previous=styles.value;styles.replaceChildren();
    for(const style of getDoc().styles || [])styles.append(element('option',style.name,{value:style.name}));
    if([...styles.options].some(o=>o.value===previous))styles.value=previous;
    const block=getDoc().blocks.find(b=>b.id===selectedId());
    summary.textContent=block&&['paragraph','heading'].includes(block.type)?`当前段落：${block.text.slice(0,50)||'空白段落'}`:'请先在文稿中选择正文或标题，再打开样式。';
  };
  const createStyle=()=>{
    try {
      const doc=getDoc(),block=doc.blocks.find(b=>b.id===selectedId()),name=styleName.value.trim();
      if(!block||!['paragraph','heading'].includes(block.type))throw Error('请先选择正文或标题。');
      if(!name)throw Error('请输入样式名称。');
      if((doc.styles||[]).some(s=>s.name===name))throw Error('已有同名样式，请使用不同名称。');
      if((doc.styles||[]).length>=100)throw Error('最多保存 100 个样式。');
      const fontSize=block.fontSize || (block.type==='heading'?doc.layout.fontSize*1.5:doc.layout.fontSize);
      const indent=block.indentPt!==undefined ? block.indentPt/fontSize : block.indent??doc.layout.indent;
      if(indent>20)throw Error('当前固定缩进超过样式可保存的 20 字范围。');
      const style={name,type:block.type,fontFamily:block.fontFamily||'serif',fontSize,align:block.align||'justify',bold:!!block.bold,indent,level:block.level||1};
      change(()=>{const live=getDoc();live.styles=[...(live.styles||[]),style];});refreshStyles();styles.value=name;status('段落样式已保存到工程。');
    }catch(error){report(error);}
  };
  const applyStyle=()=>{
    try {
      const doc=getDoc(),id=selectedId(),block=doc.blocks.find(b=>b.id===id),style=(doc.styles||[]).find(s=>s.name===styles.value);
      if(!block||!['paragraph','heading'].includes(block.type))throw Error('请先选择正文或标题。');
      if(!style)throw Error('请先创建或选择一个样式。');
      change(()=>{const target=getDoc().blocks.find(b=>b.id===id);for(const key of STYLE_KEYS){if(style[key]!==undefined)target[key]=style[key];else delete target[key];}delete target.indentPt;});
      refreshStyles();status(`已应用“${style.name}”，保留局部文字样式，可撤销。`);
    }catch(error){report(error);}
  };
  const styleActions=element('div');styleActions.style.display='flex';styleActions.style.gap='8px';styleActions.style.flexWrap='wrap';
  styleActions.append(button('从当前段落创建',createStyle),button('应用所选样式',applyStyle),button('关闭',()=>styleDialog.close()));
  styleDialog.append(summary,field('新样式名称',styleName),field('已保存的样式',styles),element('p','保存段落类型、字体、字号、对齐、加粗、缩进与标题级别。应用时保留原文及局部文字样式。'),styleActions);
  const searchButton=button('查找替换',()=>{searchDialog.querySelector('[data-editor-error]')?.remove();update(true);searchDialog.showModal();find.focus();}),styleButton=button('样式',()=>{styleDialog.querySelector('[data-editor-error]')?.remove();refreshStyles();styleDialog.showModal();});
  toolbar.append(searchButton,styleButton);
  return {destroy(){searchButton.remove();styleButton.remove();searchDialog.remove();styleDialog.remove();}};
}
