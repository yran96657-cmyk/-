import {validateDocument,replaceBlockText,uid} from '../src/model.mjs';
import {referenceDiagnostics} from '../src/references.mjs';
import {mergeCells,splitCell,resizeTable} from '../src/table-layout.mjs';
import {documentSchema,operation} from './schema.mjs';

export function checkDocument(raw){
  documentSchema.parse(raw);
  const ids=new Set();for(const b of raw.blocks){if(b.id){if(ids.has(b.id))throw Error(`DUPLICATE_ID: ${b.id}`);ids.add(b.id);}if(b.headerRows!==undefined&&b.headerRows>(b.rows?.length??0))throw Error('INVALID_HEADER_ROWS');}
  for(const b of raw.blocks){
    for(const key of ['rows','headerRows','borderStyle','merges','columnWidths','cellMarks'])if(b[key]!==undefined&&b.type!=='table')throw Error(`PROPERTY_REQUIRES_TABLE: ${key}`);
    for(const key of ['src','width','wrap'])if(b[key]!==undefined&&b.type!=='image')throw Error(`PROPERTY_REQUIRES_IMAGE: ${key}`);
    if(b.type==='table'&&new Set(b.rows?.map(r=>r.length)).size>1)throw Error('RAGGED_TABLE_ROWS');
  }
  const doc=validateDocument(raw),diagnostics=referenceDiagnostics(doc);
  if(diagnostics.length)throw Error('DANGLING_REFERENCE: '+JSON.stringify(diagnostics));
  for(const b of doc.bookmarks)if(!doc.blocks.some(x=>x.id===b.blockId))throw Error('INVALID_BOOKMARK');
  for(const b of raw.bookmarks||[])if(!doc.blocks.some(x=>x.id===b.blockId))throw Error('INVALID_BOOKMARK');
  return doc;
}
function boundary(text,index){
  if(index<0||index>text.length)throw Error('INVALID_OFFSET');
  const points=new Set([text.length,...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)].map(x=>typeof x==='number'?x:x.index));
  if(!points.has(index))throw Error('INVALID_GRAPHEME_BOUNDARY');
  for(const m of text.matchAll(/\[\^[-\w]+\]|\[\[(?:ref|cite|math):[-\w]+\]\]/g))if(index>m.index&&index<m.index+m[0].length)throw Error('REFERENCE_TOKEN_IS_ATOMIC');
}
export function chapterIds(doc,headingId){
  const at=doc.blocks.findIndex(b=>b.id===headingId);const heading=doc.blocks[at];if(heading?.type!=='heading')throw Error('CHAPTER_HEADING_NOT_FOUND');
  let end=at+1;while(end<doc.blocks.length&&!(doc.blocks[end].type==='heading'&&doc.blocks[end].level<=heading.level))end++;
  return doc.blocks.slice(at,end).map(b=>b.id);
}
export function applyOperations(input,rawOps){
  const doc=structuredClone(input),createdIds=[];
  const get=id=>{const b=doc.blocks.find(b=>b.id===id);if(!b)throw Error(`BLOCK_NOT_FOUND: ${id}`);return b;};
  const table=id=>{const b=get(id);if(b.type!=='table')throw Error('NOT_A_TABLE');return b;};
  const insert=(blocks,beforeId)=>{let at=beforeId?doc.blocks.findIndex(b=>b.id===beforeId):doc.blocks.length;if(at<0)throw Error('BEFORE_ID_NOT_FOUND');const next=blocks.map(b=>({...b,id:b.id||uid()}));createdIds.push(...next.map(b=>b.id));doc.blocks.splice(at,0,...next);};
  const move=(ids,beforeId)=>{if(new Set(ids).size!==ids.length||ids.includes(beforeId))throw Error('INVALID_MOVE');const blocks=ids.map(get);if(beforeId)get(beforeId);doc.blocks=doc.blocks.filter(b=>!ids.includes(b.id));const at=beforeId?doc.blocks.findIndex(b=>b.id===beforeId):doc.blocks.length;doc.blocks.splice(at,0,...blocks);};
  const remove=ids=>{ids.forEach(get);doc.blocks=doc.blocks.filter(b=>!ids.includes(b.id));doc.bookmarks=doc.bookmarks.filter(b=>!ids.includes(b.blockId));doc.comments=doc.comments.filter(b=>!ids.includes(b.blockId));};
  const upsert=(key,value)=>{const at=doc[key].findIndex(x=>x.id===value.id);if(at<0)doc[key].push(value);else doc[key][at]=value;};
  const erase=(key,id)=>{if(!doc[key].some(x=>x.id===id))throw Error('RECORD_NOT_FOUND');doc[key]=doc[key].filter(x=>x.id!==id);};
  for(const raw of rawOps){const o=operation.parse(raw);switch(o.op){
    case 'set_journal':doc.journal=o.journal;break;
    case 'set_title':doc.title=o.title;break;
    case 'set_layout':Object.assign(doc.layout,o.patch);break;
    case 'insert_blocks':insert(o.blocks,o.beforeId);break;
    case 'update_block':{const b=get(o.blockId);if(o.patch.text!==undefined)replaceBlockText(b,o.patch.text);Object.assign(b,o.patch);break;}
    case 'replace_text':{const b=get(o.blockId);boundary(b.text,o.start);boundary(b.text,o.end);if(o.end<o.start)throw Error('INVALID_RANGE');replaceBlockText(b,b.text.slice(0,o.start)+o.text+b.text.slice(o.end));break;}
    case 'delete_blocks':remove(o.blockIds);break;
    case 'move_blocks':move(o.blockIds,o.beforeId);break;
    case 'upsert_note':upsert('notes',o.note);break;
    case 'delete_note':erase('notes',o.noteId);break;
    case 'upsert_bibliography':upsert('bibliography',o.entry);break;
    case 'delete_bibliography':erase('bibliography',o.entryId);break;
    case 'insert_reference':{const b=get(o.blockId);if(!['paragraph','heading'].includes(b.type))throw Error('REFERENCE_NEEDS_TEXT_BLOCK');boundary(b.text,o.offset);const token=o.kind==='note'?`[^${o.targetId}]`:`[[${o.kind}:${o.targetId}]]`;replaceBlockText(b,b.text.slice(0,o.offset)+token+b.text.slice(o.offset));break;}
    case 'upsert_comment':upsert('comments',o.comment);break;
    case 'delete_comment':erase('comments',o.commentId);break;
    case 'set_styles':doc.styles=o.styles;break;
    case 'apply_style':{const s=doc.styles.find(s=>s.name===o.name);if(!s)throw Error('STYLE_NOT_FOUND');const {name,...patch}=s;for(const id of o.blockIds){const b=get(id);if(!['heading','paragraph'].includes(b.type))throw Error('STYLE_NEEDS_TEXT_BLOCK');Object.assign(b,patch);}break;}
    case 'set_index':doc.indexTerms=o.terms;break;
    case 'set_bookmarks':doc.bookmarks=o.bookmarks;break;
    case 'table_set_cell':{const b=table(o.blockId);if(b.rows[o.row]?.[o.col]===undefined)throw Error('CELL_NOT_FOUND');const styles=b.cellMarks?.find(c=>c.row===o.row&&c.col===o.col);const cell={text:b.rows[o.row][o.col],marks:styles?.marks||[]};replaceBlockText(cell,o.text);b.rows[o.row][o.col]=cell.text;if(styles)styles.marks=cell.marks;break;}
    case 'table_merge':Object.assign(table(o.blockId),mergeCells(table(o.blockId),o.range));break;
    case 'table_split':Object.assign(table(o.blockId),splitCell(table(o.blockId),o.row,o.col));break;
    case 'table_resize':Object.assign(table(o.blockId),resizeTable(table(o.blockId),o.axis,o.index,o.remove));break;
    case 'chapter_insert':insert([o.heading,...(o.blocks||[])],o.beforeId);break;
    case 'chapter_move':move(chapterIds(doc,o.headingId),o.beforeId);break;
    case 'chapter_delete':remove(chapterIds(doc,o.headingId));break;
  }}
  return {document:checkDocument(doc),createdIds};
}
export function outline(doc){return doc.blocks.filter(b=>b.type==='heading').map(b=>({id:b.id,title:b.text,level:b.level,componentIds:chapterIds(doc,b.id)}));}
