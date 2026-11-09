// Mirrors journal-engine/journal.py ROLE_STYLE for structural editing.
// The browser still does not certify XeLaTeX pagination or anchor placement.
export function previewHeader(layout,journal,pageNumber){
 const side=pageNumber%2===0?'headerEven':'headerOdd';
 if(!journal)return (pageNumber%2===0?layout.headerEven??layout.header:layout.header)??'';
 const placeholder='书页 · 开源排版';
 if(['header','headerEven','headerOdd'].some(k=>layout[k]!==undefined&&layout[k]!==placeholder)){
  const value=layout[side]??layout.header??'';
  return value===placeholder?(layout.header??''):value;
 }
 return journal.name||layout.header||'';
}
const roles={
 'title-zh':[15,19,'center',true],'authors-zh':[8.6,12,'center',false],
 'affiliation-zh':[7,10,'center',false],'abstract-zh':[6.9,12.2,'justify',false],
 'keywords-zh':[6.9,12.2,'justify',false],'classification':[6.9,11,'left',false],
 'title-en':[9.3,12,'center',true],'authors-en':[8,11,'center',false],
 'affiliation-en':[6.9,10,'center',false],'abstract-en':[6.9,11.6,'justify',false],
 'keywords-en':[6.9,11.6,'justify',false],'citation':[6.9,11.5,'left',false],
 'article-note':[6.9,8,'left',false],'reference':[6.94,8.5,'justify',false]
};
export function journalPreviewStyle(block,journal){
 const base=journal&&roles[block.role];if(!base)return null;
 const [size,leading,align,bold]=base,custom={...journal.roleStyles?.[block.role],...block.journalStyle},fontSize=custom.fontSize??size;
 return {fontSize:`${fontSize}pt`,lineHeight:String((custom.leading??Math.max(leading,fontSize*1.2))/fontSize),fontWeight:(custom.bold??bold)?'700':'400',textAlign:custom.align??align,textIndent:/^(abstract|keywords)-/.test(block.role)?'13.8pt':'0',paddingTop:`${custom.spaceBefore??(block.role.startsWith('title')?4:0)}pt`,paddingBottom:`${custom.spaceAfter??0}pt`,fontFamily:custom.fontFamily||'serif'};
}

// A contiguous, ordinary front matter band can span the text columns. Oversized
// or footnoted bands fall back to the regular paginator without losing content.
export function journalFrontMatter(doc,measure,maxHeight){
 if(!doc.journal||doc.layout.columns<2||doc.layout.writingMode==='vertical-rl')return {parts:[],height:0};
 const blocks=[];
 for(const block of doc.blocks){
  if(!['paragraph','heading'].includes(block.type)||!roles[block.role]||['reference','article-note'].includes(block.role))break;
  blocks.push(block);
 }
 if(blocks.some(b=>/\[\^/.test(b.text)))return {parts:[],height:0};
 const parts=blocks.map(block=>({block,text:block.text,start:0,end:block.text.length,height:measure(block),fullWidth:true}));
 const height=parts.reduce((sum,part)=>sum+part.height,0);
 return height>0&&Number.isFinite(height)&&height<=maxHeight?{parts,height}:{parts:[],height:0};
}
