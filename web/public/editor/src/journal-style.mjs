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
