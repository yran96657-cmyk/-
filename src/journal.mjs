export const journalRoles=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','classification','title-en','authors-en','affiliation-en','abstract-en','keywords-en','citation','article-note','reference'];
export function validateJournal(raw,blocks){
  if(raw===undefined){if(blocks.some(b=>b.role&&b.role!=='reference'))throw Error('首面角色须启用期刊模板。');return undefined;}
  if(!raw||raw.template!=='cn-academic')throw Error('不支持的期刊模板。');
  if(raw.normalizeTypography!==undefined&&typeof raw.normalizeTypography!=='boolean')throw Error('期刊字体规范选项无效。');
  const config={template:'cn-academic',normalizeTypography:raw.normalizeTypography!==false};
  for(const k of ['name','nameEn','volume','issue','year','date','shortTitle']){
    if(raw[k]!==undefined){if(typeof raw[k]!=='string'||raw[k].length>200)throw Error('期刊字段无效：'+k);config[k]=raw[k];}
  }
  return config;
}
export function journalBlockFields(b){
  const fields={};
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
  return fields;
}
export function validateRelations(blocks){
  const byId=new Map(blocks.map(b=>[b.id,b])),owners=new Set();
  for(const b of blocks)for(const id of b.captionIds||[]){const c=byId.get(id);if(!c||!['paragraph','heading'].includes(c.type)||c.role||owners.has(id))throw Error('题注不存在、重复归属或占用首面字段。');owners.add(id);}
  for(const b of blocks)if(b.anchor){const target=byId.get(b.anchor.targetId);if(!target||!['paragraph','heading'].includes(target.type)||target.role||owners.has(target.id))throw Error('锚点须指向普通正文/标题，且不能指向题注。');}
}
export function journalDiagnostics(doc){
  if(!doc.journal)return [];
  const required=['title-zh','authors-zh','affiliation-zh','abstract-zh','keywords-zh','title-en','authors-en','affiliation-en','abstract-en','keywords-en'];
  return required.filter(role=>!doc.blocks.some(b=>b.role===role&&b.text?.trim())).map(role=>({code:'JOURNAL_FIELD_MISSING',severity:'error',message:'首面缺少字段：'+role}));
}
