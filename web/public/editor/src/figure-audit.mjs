const text = b => (b?.text || '').trim();
const number = b => text(b).match(/^(?:图\s*|Fig(?:ure)?\.?\s*)(\d+)/i)?.[1];
const note = b => /^(?:注\s*[:：]|反应条件\s*[:：]|[（(][a-z][）)])/i.test(text(b));
const asset = b => b?.type === 'image' || b?.type === 'table' && b.cellImages?.length;

// A figure reference in prose is not a caption. Bilingual pairs also cover
// Word captions whose number/title have lost their separating whitespace.
export function figureGroups(doc) {
  const blocks = doc.blocks, groups = [], used = new Set(), byId = new Map(blocks.map(b=>[b.id,b]));
  const owners = new Map(), references = new Set();
  for(const a of blocks.filter(asset)){
    for(const id of a.captionIds||[])owners.set(id,a.id);
    const target=byId.get(a.anchor?.targetId),n=number(target);
    if(n&&a.captionIds?.some(id=>id!==target.id&&number(byId.get(id))===n))references.add(target.id);
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], n = number(b);
    if (!n || used.has(b.id) || b.role || !['paragraph','heading'].includes(b.type) || text(b).length > 1000) continue;
    const pair = /^图/.test(text(b)) && /^Fig(?:ure)?\.?\s*\d/i.test(text(blocks[i+1])) && number(blocks[i+1]) === n;
    if (!pair && !/^(?:图\s*\d+|Fig(?:ure)?\.?\s*\d+)(?:\s|[.:：])/i.test(text(b))) continue;
    const prose = /^(?:图\s*\d+\s*(?:展示|显示|表明|说明|所示|可见|给出|描绘|呈现)|Fig(?:ure)?\.?\s*\d+\s+(?:shows?|depicts?|illustrates?|presents?|demonstrates?|is|was)\b)/i.test(text(b));
    if (references.has(b.id) || prose && !owners.has(b.id)) continue;
    const captionIds = [b.id];
    if (pair) { captionIds.push(blocks[i+1].id); used.add(blocks[i+1].id); }
    let first = i;
    while (first > 0 && note(blocks[first-1]) && captionIds.length < 8) captionIds.unshift(blocks[--first].id);
    const ownerId = owners.get(b.id);
    // Unlinked but immediately adjacent images are present, not missing.
    const adjacent = blocks[first-1];
    const nearby = asset(adjacent) && !adjacent.captionIds?.length ? adjacent : null;
    groups.push({number:n,blockId:b.id,captionIds,beforeId:blocks[first].id,ownerId,adjacentId:nearby?.id});
  }
  return groups;
}

export function figureDiagnostics(doc) {
  return figureGroups(doc).filter(g => !g.ownerId).map(g => ({
    code:g.adjacentId ? 'FIGURE_CAPTION_UNBOUND' : 'FIGURE_ASSET_MISSING',
    severity:g.adjacentId ? 'warning' : 'error',blockId:g.blockId,
    message:g.adjacentId ? `图${g.number}的图体已存在，请关联题注。` : `图${g.number}只有题注，缺少图体；请补入对应图片。`,
  }));
}
