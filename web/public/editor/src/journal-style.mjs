// Explicit editor/agent overrides survive template normalization. Imported
// character styles remain separate, so old manuscripts do not change silently.
export function setJournalBlockStyle(block,patch){
 if(!block.role)return;
 const keys=['fontSize','fontFamily','bold','align'];
 for(const key of keys)if(Object.hasOwn(patch,key)){
  block.journalStyle??={};
  if(patch[key]===undefined)delete block.journalStyle[key];else block.journalStyle[key]=patch[key];
 }
}

// Changing a role's size in the template dialog must not be shadowed by a
// previous agent's explicit size on every reference block. Keep other overrides.
export function resetChangedAnnotationSizes(document,previous,roleStyles){
 for(const [role,fallback] of [['article-note',6.9],['reference',6.94]]){
  if(roleStyles[role]?.fontSize===undefined||roleStyles[role].fontSize===(previous.roleStyles?.[role]?.fontSize??fallback))continue;
  for(const block of document.blocks)if(block.role===role&&block.journalStyle)delete block.journalStyle.fontSize;
 }
}
