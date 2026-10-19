import {journalRoles} from '../src/journal.mjs';
import {z} from 'zod';
export const id=z.string().regex(/^[A-Za-z0-9][\w-]{0,79}$/);
const text=z.string().max(300000),integer=z.number().int().nonnegative();
const obj=shape=>z.object(shape).strict();
export const layout=obj({fontSet:z.enum(['windows','mac','fandol','source-han']).optional(),width:z.number().min(100).max(320).optional(),height:z.number().min(140).max(450).optional(),top:z.number().min(10).max(70).optional(),bottom:z.number().min(10).max(70).optional(),inner:z.number().min(10).max(70).optional(),outer:z.number().min(10).max(70).optional(),fontSize:z.number().min(8).max(24).optional(),lineHeight:z.number().min(1.1).max(3).optional(),columns:z.number().int().min(1).max(4).optional(),gap:z.number().min(3).max(20).optional(),indent:z.number().min(0).max(4).optional(),header:z.string().max(200).optional(),headerEven:z.string().max(200).optional(),footer:z.string().max(200).optional(),footerEven:z.string().max(200).optional(),pageStart:z.number().int().min(1).max(9999).optional(),writingMode:z.enum(['horizontal-tb','vertical-rl']).optional(),notesMode:z.enum(['footnote','endnote']).optional(),widowLines:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional()});
const style={fontFamily:z.enum(['serif','sans','kai']).optional(),fontSize:z.number().min(5).max(72).optional(),bold:z.boolean().optional(),align:z.enum(['left','center','right','justify']).optional(),indent:z.number().min(0).max(20).optional(),level:z.number().int().min(1).max(4).optional()};
export const mark=obj({start:integer,end:integer,bold:z.boolean().optional(),italic:z.boolean().optional(),underline:z.boolean().optional(),superscript:z.boolean().optional(),subscript:z.boolean().optional(),fontFamily:style.fontFamily,fontSize:style.fontSize,color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()});
export const ruby=obj({start:integer,end:integer,text:z.string().min(1).max(1000)});
export const merge=obj({row:integer,col:integer,rowspan:z.number().int().positive(),colspan:z.number().int().positive()});
const mathSource={sourceOmml:z.string().max(300000).optional(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()};
const inlineMath=obj({id,text:z.string().max(20000),...mathSource});
export const journal=obj({template:z.literal('cn-academic'),normalizeTypography:z.boolean().optional(),...Object.fromEntries(['name','nameEn','volume','issue','year','date','shortTitle'].map(k=>[k,z.string().max(200).optional()]))});
export const blockPatch=obj({role:z.enum(journalRoles).nullable().optional(),...mathSource,equationNumber:z.string().max(80).optional(),equationSuffix:z.string().max(80).optional(),anchor:obj({targetId:id,position:z.enum(["before","after"]),maxPageDistance:z.number().int().min(0).max(3)}).nullable().optional(),captionIds:z.array(id).max(8).optional(),cellMarks:z.array(obj({row:integer,col:integer,marks:z.array(mark).max(20000)})).max(100000).optional(),placement:z.enum(['auto','column','full-width']).optional(),inlineMath:z.array(inlineMath).max(10000).optional(),text:text.optional(),...style,indentPt:z.number().min(0).max(144).optional(),marks:z.array(mark).max(20000).optional(),ruby:z.array(ruby).max(10000).optional(),rows:z.array(z.array(z.string().max(10000)).min(1).max(50)).min(1).max(5000).optional(),headerRows:integer.optional(),borderStyle:z.enum(['grid','three-line']).optional(),merges:z.array(merge).optional(),columnWidths:z.array(z.number().positive()).optional(),src:z.string().max(7000000).optional(),width:z.number().min(10).max(100).optional(),wrap:z.enum(['none','left','right']).optional()});
export const block=blockPatch.extend({id:id.optional(),type:z.enum(['paragraph','heading','pageBreak','image','table','equation','toc','index'])});
const note=obj({id,text:z.string().max(30000),marker:z.string().min(1).max(20).optional()});
const comment=note.extend({blockId:id,resolved:z.boolean().optional()});
const namedStyle=obj({name:z.string().min(1).max(80),type:z.enum(['paragraph','heading']),...style});
const importReport=obj({kind:z.literal('docx'),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceBytes:z.number().int().positive().max(20*1024*1024),counts:z.record(z.string(),integer),diagnostics:z.array(obj({code:z.string().max(80),severity:z.enum(['error','warning','info']),message:z.string().max(4000)})).max(10000)});
export const documentSchema=obj({journal:journal.optional(),importReports:z.array(importReport).max(100).optional(),format:z.literal('open-typesetter'),version:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),title:z.string().max(120).optional(),layout:layout.optional(),blocks:z.array(block).max(10000),notes:z.array(note).optional(),bibliography:z.array(note).optional(),comments:z.array(comment).optional(),styles:z.array(namedStyle).max(100).optional(),indexTerms:z.array(z.string().min(1).max(99)).max(1000).optional(),bookmarks:z.array(obj({name:z.string().max(80),blockId:id})).max(1000).optional(),proSources:z.array(obj({name:z.string().max(255),source:z.string().max(1048576)})).max(20).optional()});
const op=(type,fields)=>obj({op:z.literal(type),...fields});
export const operation=z.discriminatedUnion('op',[
  op('set_journal',{journal}),op('set_title',{title:z.string().min(1).max(120)}),op('set_layout',{patch:layout}),
  op('insert_blocks',{blocks:z.array(block).min(1).max(1000),beforeId:id.optional()}),
  op('update_block',{blockId:id,patch:blockPatch}),op('delete_blocks',{blockIds:z.array(id).min(1)}),op('move_blocks',{blockIds:z.array(id).min(1),beforeId:id.optional()}),
  op('replace_text',{blockId:id,start:integer,end:integer,text}),
  op('upsert_note',{note}),op('delete_note',{noteId:id}),op('upsert_bibliography',{entry:note}),op('delete_bibliography',{entryId:id}),
  op('insert_reference',{blockId:id,offset:integer,kind:z.enum(['note','ref','cite']),targetId:id}),
  op('upsert_comment',{comment}),op('delete_comment',{commentId:id}),
  op('set_styles',{styles:z.array(namedStyle).max(100)}),op('apply_style',{blockIds:z.array(id).min(1),name:z.string()}),
  op('set_index',{terms:z.array(z.string().min(1).max(99)).max(1000)}),op('set_bookmarks',{bookmarks:z.array(obj({name:z.string().max(80),blockId:id})).max(1000)}),
  op('table_set_cell',{blockId:id,row:integer,col:integer,text:z.string().max(10000)}),op('table_merge',{blockId:id,range:merge}),op('table_split',{blockId:id,row:integer,col:integer}),op('table_resize',{blockId:id,axis:z.enum(['row','col']),index:integer,remove:z.boolean().optional()}),
  op('chapter_insert',{heading:block.extend({type:z.literal('heading')}),blocks:z.array(block).max(1000).optional(),beforeId:id.optional()}),
  op('chapter_move',{headingId:id,beforeId:id.optional()}),op('chapter_delete',{headingId:id}),
]);
export const editBase={projectId:id,expectedRevision:z.number().int().positive(),dryRun:z.boolean().optional()};
export const editSchema=obj({...editBase,operations:z.array(operation).min(1).max(500)});
export const projectInput=obj({projectId:id,document:documentSchema.optional(),title:z.string().max(120).optional()});
export const jsonSchema=()=>z.toJSONSchema(documentSchema);
