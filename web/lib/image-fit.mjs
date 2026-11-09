import {imagePixels} from './journal-plan.mjs';

// Shrink only. Never resample a source bitmap or claim that upsampling adds
// detail. Conservative cell measures omit TeX padding, so actual DPI is higher.
export function imageFit(document,minDpi=300){
 const l=document.layout,body=l.width-l.inner-l.outer,columns=l.columns||1;
 const column=(body-(l.gap||8)*(columns-1))/columns,owners=new Map();
 for(const t of document.blocks)for(const c of t.cellImages||[])owners.set(c.imageId,{t,c});
 return document.blocks.filter(b=>b.type==='image').map(b=>{
  let measure=b.placement==='full-width'?body:column;
  const owner=owners.get(b.id);
  if(owner){
   const {t,c}=owner,n=t.rows[0].length,weights=t.columnWidths||Array(n).fill(1);
   const span=t.merges?.find(m=>m.row===c.row&&m.col===c.col)?.colspan||1;
   const inColumn=columns>1&&(t.placement==='column'||(t.placement||'auto')==='auto'&&t.rows.length<=10&&n<=4);
   measure=(inColumn?column:body)*(document.journal?.tableWidthPercent||100)/100*weights.slice(c.col,c.col+span).reduce((a,b)=>a+b,0)/weights.reduce((a,b)=>a+b,0);
  }
  const pixels=imagePixels(b.src),currentWidth=b.width??(owner?100:80);
  const maximumWidth=pixels?Math.floor(Math.min(100,pixels.width/minDpi*25.4/measure*100)*100)/100:null;
  const width=maximumWidth===null?currentWidth:Math.max(10,Math.min(currentWidth,maximumWidth));
  return {blockId:b.id,pixels,measureMm:Math.round(measure*100)/100,currentWidth,width,minDpi,estimatedDpi:pixels?Math.floor(pixels.width/(measure*width/100)*25.4):null,issue:maximumWidth===null?'IMAGE_DIMENSIONS_UNKNOWN':maximumWidth<10?'IMAGE_TOO_SMALL':null};
 });
}
