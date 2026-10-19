import {legacySource,vectorSource} from './asset-sources.mjs';
export const journalRoles=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','classification','title-en','authors-en','affiliation-en','abstract-en','keywords-en','citation','article-note','reference'];
export function validateJournal(raw,blocks,notes=[]){
  if(raw===undefined){if(blocks.some(b=>b.role&&b.role!=='reference'))throw Error('首面角色须启用期刊模板。');return undefined;}
  if(!raw||raw.template!=='cn-academic')throw Error('不支持的期刊模板。');
  if(raw.normalizeTypography!==undefined&&typeof raw.normalizeTypography!=='boolean')throw Error('期刊字体规范选项无效。');
  const config={template:'cn-academic',normalizeTypography:raw.normalizeTypography!==false};
  if(raw.latinFont!==undefined){if(!['tex-default','times'].includes(raw.latinFont))throw Error('西文字体方案无效');config.latinFont=raw.latinFont;}
  if(raw.mathFont!==undefined){if(!['tex-default','stix-two'].includes(raw.mathFont))throw Error('数学字体方案无效');config.mathFont=raw.mathFont;}
  for(const [key,choices] of [['bodyWeight',['regular','light']],['headingFamily',['serif','sans']],['pageNumberStyle',['plain','dots']]])if(raw[key]!==undefined){if(!choices.includes(raw[key]))throw Error('期刊字样选项无效：'+key);config[key]=raw[key];}
  if(raw.inlineDisplayThreshold!==undefined){if(!Number.isFinite(raw.inlineDisplayThreshold)||raw.inlineDisplayThreshold<.65||raw.inlineDisplayThreshold>.95)throw Error('行内公式宽度阈值无效。');config.inlineDisplayThreshold=raw.inlineDisplayThreshold;}
  if(raw.tableWidthPercent!==undefined){if(!Number.isFinite(raw.tableWidthPercent)||raw.tableWidthPercent<70||raw.tableWidthPercent>100)throw Error('表格版心比例无效。');config.tableWidthPercent=raw.tableWidthPercent;}
  if(raw.captionBold!==undefined){if(typeof raw.captionBold!=='boolean')throw Error('题注字重无效。');config.captionBold=raw.captionBold;}
  if(raw.headSepMm!==undefined){if(!Number.isFinite(raw.headSepMm)||raw.headSepMm<2||raw.headSepMm>12)throw Error('页眉间距无效。');config.headSepMm=raw.headSepMm;}
  if(raw.yearSuffix!==undefined){if(typeof raw.yearSuffix!=='string'||raw.yearSuffix.length>5)throw Error('年份后缀无效。');config.yearSuffix=raw.yearSuffix;}
  if(raw.roleStyles!==undefined){
    if(!raw.roleStyles||Array.isArray(raw.roleStyles)||typeof raw.roleStyles!=='object')throw Error('期刊角色样式无效。');
    config.roleStyles={};
    for(const [role,style] of Object.entries(raw.roleStyles)){
      if(!journalRoles.includes(role)||!style||typeof style!=='object'||Array.isArray(style))throw Error('期刊角色样式无效。');
      const value={};for(const [key,v] of Object.entries(style)){
        if(key==='bold'){if(typeof v!=='boolean')throw Error('角色字重无效。');}
        else if(key==='fontFamily'){if(!['serif','sans'].includes(v))throw Error('角色字体无效。');}
        else {const bounds={fontSize:[6,24],leading:[7,36],spaceBefore:[0,36],spaceAfter:[0,24]}[key];if(!bounds||!Number.isFinite(v)||v<bounds[0]||v>bounds[1])throw Error('角色样式数值无效。');}
        value[key]=v;
      }
      config.roleStyles[role]=value;
    }
  }
  for(const k of ['name','nameEn','volume','issue','year','date','dateEn','shortTitle']){
    if(raw[k]!==undefined){if(typeof raw[k]!=='string'||raw[k].length>200)throw Error('期刊字段无效：'+k);config[k]=raw[k];}
  }
  if(raw.articleNoteId!==undefined){if(typeof raw.articleNoteId!=='string'||!notes.some(n=>n.id===raw.articleNoteId))throw Error('首面脚注引用失效。');config.articleNoteId=raw.articleNoteId;}
  return config;
}
export function journalBlockFields(b){
  const fields={};
  if(b.floatPlacement!==undefined){if(!['in-flow','top'].includes(b.floatPlacement)||!['image','table'].includes(b.type)||b.floatPlacement==='top'&&(b.placement!=='full-width'||b.sideTextIds?.length))throw Error('页顶浮动仅支持通栏图或短表。');fields.floatPlacement=b.floatPlacement;}
  if(b.legacySource!==undefined){if(b.type!=='equation')throw Error('旧式公式来源类型无效。');fields.legacySource=legacySource(b.legacySource);}
  if(b.vectorSource!==undefined){if(b.type!=='image')throw Error('矢量来源类型无效。');fields.vectorSource=vectorSource(b.vectorSource);}
  if(b.role!=null){if(!journalRoles.includes(b.role)||!['paragraph','heading'].includes(b.type))throw Error('期刊语义角色无效。');fields.role=b.role;}
  if(b.sourceOmml!==undefined||b.sourceSha256!==undefined){if(b.type!=='equation'||typeof b.sourceOmml!=='string'||!b.sourceOmml.length||b.sourceOmml.length>300000||!(/^[a-f0-9]{64}$/).test(b.sourceSha256))throw Error('公式来源无效。');fields.sourceOmml=b.sourceOmml;fields.sourceSha256=b.sourceSha256;}
  for(const key of ['equationNumber','equationSuffix'])if(b[key]!==undefined){if(b.type!=='equation'||typeof b[key]!=='string'||b[key].length>80)throw Error('公式编号或后缀无效。');fields[key]=b[key];}
  if(b.placement!==undefined){if(!['table','image','equation'].includes(b.type)||!['auto','column','full-width'].includes(b.placement))throw Error('对象位置无效。');fields.placement=b.placement;}
  if(b.anchor){
    const a=b.anchor;
    if(!['image','table','equation'].includes(b.type)||!/^[-\w]{1,80}$/.test(a.targetId)||!['before','after'].includes(a.position)||!Number.isInteger(a.maxPageDistance)||a.maxPageDistance<0||a.maxPageDistance>3)throw Error('锚点关系无效。');
    fields.anchor={targetId:a.targetId,position:a.position,maxPageDistance:a.maxPageDistance};
  }
  if(b.captionIds!==undefined){if(!['image','table'].includes(b.type)||!Array.isArray(b.captionIds)||b.captionIds.length>8||b.captionIds.some(x=>typeof x!=='string')||new Set(b.captionIds).size!==b.captionIds.length)throw Error('题注关联无效。');fields.captionIds=[...b.captionIds];}
  if(b.sideTextIds!==undefined){if(b.type!=='image'||!Array.isArray(b.sideTextIds)||b.sideTextIds.length<1||b.sideTextIds.length>32||b.sideTextIds.some(x=>typeof x!=='string'||!/^[-\w]{1,80}$/.test(x))||new Set(b.sideTextIds).size!==b.sideTextIds.length)throw Error('图文并排正文范围无效。');fields.sideTextIds=[...b.sideTextIds];}
  return fields;
}
export function validateRelations(blocks){
  const byId=new Map(blocks.map(b=>[b.id,b])),owners=new Set();
  for(const b of blocks)for(const id of b.captionIds||[]){const c=byId.get(id);if(!c||!['paragraph','heading'].includes(c.type)||c.role||owners.has(id))throw Error('题注不存在、重复归属或占用首面字段。');owners.add(id);}
  for(const b of blocks)if(b.anchor){const target=byId.get(b.anchor.targetId);if(!target||!['paragraph','heading'].includes(target.type)||target.role||owners.has(target.id))throw Error('锚点须指向普通正文/标题，且不能指向题注。');}
  const used=new Set(),anchored=new Set(blocks.filter(b=>b.anchor).map(b=>b.id));
  const before=new Map(),after=new Map();
  for(const b of blocks)if(b.anchor){const map=b.anchor.position==='before'?before:after;const list=map.get(b.anchor.targetId)||[];list.push(b);map.set(b.anchor.targetId,list);}
  const cellIds=new Set(blocks.flatMap(b=>(b.cellImages||[]).map(c=>c.imageId)));
  const flow=blocks.filter(b=>!owners.has(b.id)&&!cellIds.has(b.id)&&!anchored.has(b.id)&&(!b.role||b.role==='reference')).flatMap(b=>[...(before.get(b.id)||[]),b,...(after.get(b.id)||[])]);
  for(const image of blocks.filter(b=>b.sideTextIds)){
    if(!['left','right'].includes(image.wrap)||!image.anchor||!image.sideTextIds.includes(image.anchor.targetId)||!Number.isFinite(image.width)||image.width<15||image.width>60)throw Error('图文并排须指定左右位置、15–60% 图宽及范围内锚点。');
    const ids=new Set([...image.sideTextIds,image.id]);
    for(const id of image.sideTextIds){const b=byId.get(id);if(!b||!['paragraph','equation'].includes(b.type)||b.role||owners.has(id)||used.has(id)||b.anchor||/\[\^/.test(b.text||''))throw Error('并排范围只支持连续正文/公式，不能重叠、含脚注或嵌套锚点。');used.add(id);}
    const indices=flow.map((b,i)=>ids.has(b.id)?i:-1).filter(i=>i>=0);
    if(indices.length!==ids.size||indices.at(-1)-indices[0]+1!==ids.size||flow.filter(b=>image.sideTextIds.includes(b.id)).some((b,i)=>b.id!==image.sideTextIds[i]))throw Error('图文并排范围必须按正文顺序连续，不能跨越其他图表或标题。');
  }
}
export function journalDiagnostics(doc){
  if(!doc.journal)return [];
  const required=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','title-en','authors-en','affiliation-en','abstract-en','keywords-en'];
  return required.filter(role=>!doc.blocks.some(b=>b.role===role&&b.text?.trim())).map(role=>({code:'JOURNAL_FIELD_MISSING',severity:'error',message:'首面缺少字段：'+role}));
}
