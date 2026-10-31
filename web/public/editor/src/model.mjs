import {validateComposition} from './composition.mjs';
import {journalBlockFields,validateJournal,validateRelations} from './journal.mjs';
import {validateInlineMath,validateImportReports} from './integrity.mjs';
import { validateTable, validateCellImages } from './table-layout.mjs';
import { validateRuby,adjustRubyOnEdit } from './ruby.mjs';
export const uid = () => globalThis.crypto.randomUUID();
export const defaults = {
  width: 185,
  height: 260,
  top: 24,
  bottom: 22,
  inner: 24,
  outer: 20,
  fontSize: 11,
  lineHeight: 1.8,
  columns: 1,
  gap: 8,
  indent: 2,
  header: "书页 · 开源排版",
  pageStart: 1,
};
const ranges = {
  width: [100, 320],
  height: [140, 450],
  top: [10, 70],
  bottom: [10, 70],
  inner: [10, 70],
  outer: [10, 70],
  fontSize: [8, 24],
  lineHeight: [1.1, 3],
  columns: [1, 4],
  gap: [3, 20],
  indent: [0, 4],
  pageStart: [1, 9999],
};
export function validateDocument(raw) {
  if (
    !raw ||
    raw.format !== "open-typesetter" ||
    ![1, 2, 3, 4].includes(raw.version) ||
    !Array.isArray(raw.blocks)
  )
    throw Error("不是受支持的书页工程（支持 version 1 / 2 / 3 / 4）。");
  if (raw.blocks.length > 10000)
    throw Error("文档超过 10,000 个段落，请分卷处理。");
  const layout = { ...defaults };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = raw.layout?.[key] ?? defaults[key];
    if (!Number.isFinite(n) || n < min || n > max)
      throw Error(`版式参数 ${key} 超出范围。`);
    layout[key] = n;
  }
  if (![1, 2, 3, 4].includes(layout.columns) || !Number.isInteger(layout.pageStart))
    throw Error("栏数和起始页码必须为整数。");
  if (
    (layout.width -
      layout.inner -
      layout.outer -
      layout.gap * (layout.columns - 1)) /
      layout.columns <
      20 ||
    layout.height - layout.top - layout.bottom < 60
  )
    throw Error("页边距过大，每栏至少需要宽 20 mm、版心高 60 mm。");
  layout.header = String(raw.layout?.header ?? defaults.header).slice(0, 200);
  layout.headerEven = String(raw.layout?.headerEven ?? layout.header).slice(0, 200);
  layout.footer = String(raw.layout?.footer ?? '{page}').slice(0,200);
  layout.footerEven = String(raw.layout?.footerEven ?? layout.footer).slice(0,200);
  layout.notesMode = raw.layout?.notesMode === 'endnote' ? 'endnote' : 'footnote';
  if(raw.layout?.writingMode!==undefined&&!['horizontal-tb','vertical-rl'].includes(raw.layout.writingMode))throw Error('文字方向无效。');
  layout.writingMode = raw.layout?.writingMode || 'horizontal-tb';
  layout.widowLines = [1,2,3].includes(raw.layout?.widowLines) ? raw.layout.widowLines : 2;
  if(raw.layout?.fontSet!==undefined&&!['windows','mac','fandol','source-han'].includes(raw.layout.fontSet))throw Error('PDF 字体方案无效。');
  if(raw.layout?.fontSet)layout.fontSet=raw.layout.fontSet;
  const seen = new Set();
  const blocks = raw.blocks.map((b) => {
    if (!b || !["paragraph", "heading", "pageBreak", "image", "table", "equation", "toc", "index"].includes(b.type))
      throw Error("工程含不支持的段落类型。");
    const id =
      typeof b.id === "string" && /^[\w-]{1,80}$/.test(b.id) && !seen.has(b.id)
        ? b.id
        : uid();
    seen.add(id);
    const block = { id, type: b.type, text: String(b.text ?? "") };
    if (block.text.length > 300000) throw Error("单段过长，请拆分段落。");
    if (b.align && !["left", "center", "right", "justify"].includes(b.align))
      throw Error("段落对齐方式无效。");
    block.align = b.align || (b.type === "heading" ? "left" : "justify");
    block.fontFamily = ["serif", "sans", "kai"].includes(b.fontFamily)
      ? b.fontFamily
      : "serif";
    if (b.fontSize !== undefined) {
      if (!Number.isFinite(b.fontSize) || b.fontSize < 5 || b.fontSize > 72)
        throw Error("段落字号需要在 5–72 pt 之间。");
      block.fontSize = b.fontSize;
    }
    block.bold = Boolean(b.bold);
    block.level = Number.isInteger(b.level) ? Math.max(1,Math.min(4,b.level)) : 1;
    if (b.indent !== undefined) {
      if (!Number.isFinite(b.indent) || b.indent<0 || b.indent>20) throw Error('段首缩进需要在 0–20 字之间。');
      block.indent=b.indent;
    }
    if (b.indentPt !== undefined) {
      if (!Number.isFinite(b.indentPt) || b.indentPt<0 || b.indentPt>144) throw Error('段首缩进需要在 0–144 pt 之间。');
      block.indentPt=b.indentPt;
    }
    if (b.marks !== undefined) {
      if (!Array.isArray(b.marks) || b.marks.length>20000) throw Error('文字样式数据无效或过多。');
      block.marks=b.marks.map(m=>{
        if(!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<0||m.end>block.text.length||m.end<=m.start)throw Error('文字样式范围无效。');
        const mark={start:m.start,end:m.end};
        for(const key of ['bold','italic','underline','superscript','subscript'])if(m[key]!==undefined)mark[key]=Boolean(m[key]);
        if(['serif','sans','kai'].includes(m.fontFamily))mark.fontFamily=m.fontFamily;
        if(Number.isFinite(m.fontSize)&&m.fontSize>=5&&m.fontSize<=72)mark.fontSize=m.fontSize;
        if(/^#[0-9a-fA-F]{6}$/.test(m.color||''))mark.color=m.color;
        return mark;
      });
    }
    if(b.ruby!==undefined)block.ruby=validateRuby(b.ruby,block.text);
    if (b.type==='table') {
      if (!Array.isArray(b.rows)||!b.rows.length||b.rows.length>5000)throw Error('表格需要 1–5,000 行。');
      const cols=Math.max(...b.rows.map(r=>Array.isArray(r)?r.length:0));
      if(cols<1||cols>50||b.rows.length*cols>100000)throw Error('表格列数或单元格数超出限制。');
      block.rows=b.rows.map(r=>{if(!Array.isArray(r))throw Error('表格行无效。');return Array.from({length:cols},(_,i)=>String(r[i]??''));});
      if(block.rows.some(r=>r.some(c=>c.length>10000)))throw Error('单元格文字过长。');
      block.headerRows=Number.isInteger(b.headerRows)?Math.max(0,Math.min(b.rows.length,b.headerRows)):1;
      if(b.captionPosition!==undefined){if(!['above','below'].includes(b.captionPosition)||b.captionPosition==='below'&&!b.cellImages?.length)throw Error('下方题注需要单元格图片组。');block.captionPosition=b.captionPosition;}
      block.borderStyle=['three-line','none'].includes(b.borderStyle)?b.borderStyle:'grid';
      Object.assign(block,validateTable(b));
      if(b.placement!==undefined){if(!['auto','column','full-width'].includes(b.placement))throw Error('表格位置无效。');block.placement=b.placement;}
    }
    if(b.type==='equation'&&block.text.length>20000)throw Error('公式过长，请拆分。');
    if (b.type === "image") {
      if (
        typeof b.src !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.src) ||
        b.src.length > 7000000
      )
        throw Error("图片需要为不超过 5 MB 的 PNG/JPEG/WebP。");
      block.src = b.src;
      if(b.wrap!==undefined&&!['none','left','right'].includes(b.wrap))throw Error('图片环绕方式无效。');
      block.wrap = b.wrap || 'none';
      block.width = Number.isFinite(b.width)
        ? Math.max(10, Math.min(100, b.width))
        : 80;
    }
    Object.assign(block,journalBlockFields(b));
    if(b.cellImages!==undefined){
      if(b.type!=='table'||!Array.isArray(b.cellImages)||b.cellImages.length>10000)throw Error('单元格图片列表无效。');
      block.cellImages=b.cellImages.map(c=>{if(!c||typeof c.imageId!=='string')throw Error('单元格图片引用无效。');return {row:c.row,col:c.col,imageId:c.imageId};});
    }
    if(b.cellMarks!==undefined){
      if(b.type!=='table'||!Array.isArray(b.cellMarks)||b.cellMarks.length>100000)throw Error('单元格字样无效。');
      const cells=new Set();block.cellMarks=b.cellMarks.map(c=>{
        const key=c.row+':'+c.col;if(!Number.isInteger(c.row)||!Number.isInteger(c.col)||c.row<0||c.col<0||block.rows[c.row]?.[c.col]===undefined||cells.has(key))throw Error('单元格字样位置无效。');cells.add(key);
        const cellText=block.rows[c.row][c.col],formulaIds=new Set([...cellText.matchAll(/\[\[math:([-\w]+)\]\]/g)].map(m=>m[1]));
        const cleaned=validateDocument({format:'open-typesetter',version:4,blocks:[{type:'paragraph',text:cellText,marks:c.marks,inlineMath:(b.inlineMath||[]).filter(m=>formulaIds.has(m.id))}]}).blocks[0];
        return {row:c.row,col:c.col,marks:cleaned.marks||[]};
      });
    }
    const inlineMath=validateInlineMath({...block,inlineMath:b.inlineMath});
    if(inlineMath.length)block.inlineMath=inlineMath;
    return block;
  });
  validateCellImages(blocks);validateRelations(blocks);
  const journal=validateJournal(raw.journal,blocks,validateNotes(raw.notes));
  return {
    ...(journal?{journal}:{}),
    format: "open-typesetter",
    version: raw.version===4||journal||raw.notes?.some(n=>n.marker!==undefined)||blocks.some(b=>b.role||b.anchor||b.captionIds||b.sourceOmml||b.legacySource||b.vectorSource||b.cellMarks||b.cellImages||b.captionPosition||b.equationNumber!==undefined||b.inlineMath?.some(m=>m.sourceOmml||m.legacySource))?4:raw.version===3||raw.composition||raw.layout?.fontSet||raw.importReports?.length||blocks.some(b=>b.inlineMath?.length||b.placement)?3:2,
    ...(raw.composition ? {composition:validateComposition(raw.composition)} : {}),
    title: String(raw.title || "未命名文稿").slice(0, 120),
    layout,
    blocks,
    notes: validateNotes(raw.notes),
    importReports: validateImportReports(raw.importReports),
    indexTerms: Array.isArray(raw.indexTerms) ? [...new Set(raw.indexTerms.map(String).filter(s=>s.length>0&&s.length<100))].slice(0,1000) : [],
    styles: Array.isArray(raw.styles) ? raw.styles.slice(0,100).map(s=>({name:String(s.name||'未命名样式').slice(0,80),type:s.type==='heading'?'heading':'paragraph',fontFamily:['serif','sans','kai'].includes(s.fontFamily)?s.fontFamily:'serif',fontSize:Number.isFinite(s.fontSize)?Math.max(5,Math.min(72,s.fontSize)):11,align:['left','center','right','justify'].includes(s.align)?s.align:'justify',bold:!!s.bold,indent:Number.isFinite(s.indent)?Math.max(0,Math.min(20,s.indent)):2,level:Number.isInteger(s.level)?Math.max(1,Math.min(4,s.level)):1})) : [],
    bookmarks: Array.isArray(raw.bookmarks)?raw.bookmarks.slice(0,1000).filter(b=>b&&blocks.some(x=>x.id===b.blockId)).map(b=>({name:String(b.name||'书签').slice(0,80),blockId:b.blockId})):[],
    proSources: validateProSources(raw.proSources),
    bibliography: validateRecords(raw.bibliography,'参考文献',30000),
    comments: validateRecords(raw.comments,'审阅批注',30000).map(c=>{
      if(!blocks.some(b=>b.id===c.blockId))throw Error('批注指向不存在的组件。');
      return {...c,blockId:c.blockId,resolved:!!c.resolved};
    }),
  };
}
function validateRecords(raw,label,max) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>10000)throw Error(label+'数据无效。');
  const ids=new Set();return raw.map(r=>{if(!r||!/^[-\w]{1,80}$/.test(r.id)||ids.has(r.id)||typeof r.text!=='string'||r.text.length>max)throw Error(label+' ID或内容无效。');ids.add(r.id);return label==='审阅批注'?{id:r.id,text:r.text,blockId:r.blockId,resolved:!!r.resolved}:{id:r.id,text:r.text};});
}
function validateProSources(raw) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>20)throw Error('PRO 原文记录最多 20 份。');
  return raw.map(s=>{if(!s||typeof s.source!=='string'||s.source.length>1024*1024)throw Error('PRO 原文记录无效或过大。');return {name:String(s.name||'PRO').slice(0,255),source:s.source};});
}
function validateNotes(raw) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>10000)throw Error('注释数据无效。');
  const ids=new Set();
  return raw.map(n=>{if(!n||!/^[-\w]{1,80}$/.test(n.id)||ids.has(n.id)||typeof n.text!=='string'||n.text.length>30000)throw Error('注释 ID 重复、格式错误或文字过长。');if(n.marker!==undefined&&(typeof n.marker!=='string'||!n.marker.length||n.marker.length>20))throw Error('注释标记无效。');ids.add(n.id);return {id:n.id,text:n.text,...(n.marker!==undefined?{marker:n.marker}:{})};});
}
// Preserve ranges around the smallest changed span. Newly typed characters at
// the end of a styled range inherit that range; complete deletions remove it.
export function replaceBlockText(block, text) {
  const old=block.text;
  if(block.ruby)block.ruby=adjustRubyOnEdit(block.ruby,old,text);
  let start=0;while(start<old.length&&start<text.length&&old[start]===text[start])start++;
  let end=old.length,newEnd=text.length;
  while(end>start&&newEnd>start&&old[end-1]===text[newEnd-1]){end--;newEnd--;}
  const delta=text.length-old.length;
  if(block.marks)block.marks=block.marks.map(m=>{
    if(m.end<start)return {...m};
    if(m.start>=end&&m.start>start)return {...m,start:m.start+delta,end:m.end+delta};
    return {...m,start:Math.min(m.start,start),end:m.end>=end?m.end+delta:newEnd};
  }).filter(m=>m.end>m.start&&m.start>=0&&m.end<=text.length);
  block.text=text;
}
export function plainDocument(text, title = "导入文稿") {
  return validateDocument({
    format: "open-typesetter",
    version: 1,
    title,
    layout: defaults,
    blocks: text
      .replace(/\r\n?/g, "\n")
      .split(/\n/)
      .filter((s) => s.trim())
      .map((text) => ({ type: "paragraph", text })),
  });
}
export function sampleDocument() {
  const blocks = [
    { type: "heading", text: "让文字，落在恰好的位置", fontSize: 23 },
    {
      type: "paragraph",
      text: "书页是一款在本机运行的开源排版编辑器。单击纸面上的文字，即可开始编辑；右侧的版式参数决定文字如何流向每一页。你可以先修改这篇示例，再导入自己的稿件。",
    },
    { type: "heading", text: "从文稿到书页", fontSize: 15 },
    {
      type: "paragraph",
      text: "好的版面始于秩序。开本决定一本书的尺度，版心留出阅读的呼吸，行距与字号则共同构成文字的节奏。它们不是彼此孤立的选项：调整其中一项，全文都会重新分页。",
    },
    {
      type: "paragraph",
      text: "在左侧选择一个段落，右侧便会显示它的内容与样式。你可以把它变成小标题，改变字体与对齐方式，或在适当的位置插入分页符。修改会保存在当前浏览器；将工程保存到文件，可以在下次继续编辑。",
    },
    { type: "heading", text: "为中文阅读而设计", fontSize: 15 },
    {
      type: "paragraph",
      text: "正文默认首行缩进两字，采用系统宋体显示。书页使用浏览器实际测量文字的高度，再将长段落分配到后续页面。分栏、页眉、页码与对开页边距，都可以在版面中即时查看。",
    },
    ...Array.from({ length: 8 }, (_, i) => ({
      type: "paragraph",
      text: [
        "纸张上的留白也参与叙事。天头、地脚、内侧与外侧的空间，使读者能够辨认章节的边界，并在连续阅读中保持方向。设计版面时，不妨先确定适合内容的阅读密度，再微调每一处细节。",
        "可视化不应该让内容失去结构。这里的标题、正文、图片和分页符分别保存，页面只是它们在当前版式下的呈现。改变开本之后，文字仍然完整，段落也仍然保持原有顺序。",
        "校对时，可以在纸面上直接改字，也可以使用右侧的段落编辑框。完成一个段落后，点击页面外重新分页。保存工程保留可编辑内容；打印时请选择相同的纸张尺寸，并关闭浏览器附加的页眉页脚。",
      ][i % 3],
    })),
  ];
  return validateDocument({
    format: "open-typesetter",
    version: 1,
    title: "书页使用指南",
    layout: defaults,
    blocks,
  });
}
export class History {
  constructor(limit = 80) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.selection = null;
  }
  push(doc, selected = null) {
    this.past.push({json:JSON.stringify(doc), selected});
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  clear() {
    this.past = [];
    this.future = [];
    this.selection = null;
  }
  undo(doc, selected = null) {
    if (!this.past.length) return null;
    this.future.push({json:JSON.stringify(doc), selected});
    const snapshot = this.past.pop();
    this.selection = snapshot.selected;
    return JSON.parse(snapshot.json);
  }
  redo(doc, selected = null) {
    if (!this.future.length) return null;
    this.past.push({json:JSON.stringify(doc), selected});
    const snapshot = this.future.pop();
    this.selection = snapshot.selected;
    return JSON.parse(snapshot.json);
  }
}
