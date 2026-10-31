import {validateDocument} from './model.mjs';
import {referenceDiagnostics} from './references.mjs';

export const blockLabel = block => ({paragraph:'正文',heading:'标题',image:'图片',table:'表格',equation:'公式',pageBreak:'分页符',toc:'目录',index:'索引'}[block?.type] || '组件');

// Manual editing retains related content and removes only ownership/position
// links. Agent operations still require explicit relation updates atomically.
export function removeBlockComponents(doc, ids) {
  const removed = new Set(ids);
  for (const id of removed) if (!doc.blocks.some(b => b.id === id)) throw Error('BLOCK_NOT_FOUND: ' + id);
  doc.blocks = doc.blocks.filter(b => !removed.has(b.id));
  for (const b of doc.blocks) {
    if (b.captionIds) b.captionIds = b.captionIds.filter(id => !removed.has(id));
    if (b.cellImages) {
      b.cellImages = b.cellImages.filter(c => !removed.has(c.imageId));
      if (!b.cellImages.length) delete b.captionPosition;
    }
    if (removed.has(b.anchor?.targetId) || b.sideTextIds?.some(id => removed.has(id))) {
      delete b.anchor;
      delete b.sideTextIds;
      if (b.type === 'image') b.wrap = 'none';
    }
  }
  doc.comments = (doc.comments || []).filter(c => !removed.has(c.blockId));
  doc.bookmarks = (doc.bookmarks || []).filter(c => !removed.has(c.blockId));
}

export function blockDeletion(input, id, {includeCaptions = false} = {}) {
  const block = input.blocks.find(b => b.id === id);
  if (!block) throw Error('请先选择要删除的组件。');
  const ids = [id, ...(includeCaptions ? block.captionIds || [] : [])];
  const doc = structuredClone(input);
  removeBlockComponents(doc, ids);
  const references = referenceDiagnostics(doc).filter(d => ids.includes(d.targetId));
  if (references.length) {
    const source = input.blocks.find(b => references[0].location === b.id || references[0].location.startsWith(b.id + '['));
    const label = source?.text.replace(/\[\[ref:([-\w]+)\]\]/g,(_match,id)=>input.blocks.find(b=>b.id===id)?.text||'该组件').slice(0,32);
    const error = Error(`无法删除：${source ? '“' + (label||blockLabel(source)) + '”' : '注释'}仍引用此组件。请先修改引用。`);
    error.blockId = source?.id;
    throw error;
  }
  const index = input.blocks.findIndex(b => b.id === id);
  return {document: validateDocument(doc), deletedIds: ids, selected: doc.blocks[Math.min(index, doc.blocks.length - 1)]?.id};
}

export function isBlockDeleteKey(e) {
  return (e.key === 'Delete' || e.key === 'Backspace') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing && !e.repeat;
}
