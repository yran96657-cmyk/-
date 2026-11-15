// Explicit, content-bound PDF line endings. Offsets use the same UTF-16 model
// as marks. Editing the source invalidates the hints instead of moving them to
// unrelated text. Clearing uses null at the API boundary.
export function validatedReferenceBreaks(block){
 const value=block.referenceBreaks;
 if(value==null)return undefined;
 if(block.role!=='reference'||!['paragraph','heading'].includes(block.type)||block.inlineMath?.length||block.ruby?.length)throw Error('参考文献断行仅支持不含行内公式或注音的参考文献段落。');
 if(typeof value!=='object'||Array.isArray(value)||typeof value.sourceText!=='string'||!Array.isArray(value.breaks)||value.breaks.length>5000||Object.keys(value).some(k=>!['sourceText','breaks'].includes(k)))throw Error('参考文献断行格式无效。');
 if(value.sourceText!==block.text)return undefined;
 let previous=0;
 const prefix=/^(?:\[\d+\]|［\d+］)\s*/.exec(block.text)?.[0].length;
 if(prefix===undefined)throw Error('参考文献断行需要原始文献编号。');
 const atoms=[...block.text.matchAll(/[［\[](?:(?:J|M|C|D|N|R|S|P|EB|DB|CP)(?:\/(?:OL|CD|DK))?|\d+)[］\]]/g)];
 const breaks=value.breaks.map(point=>{
  const offset=point?.offset;
  if(!point||Object.keys(point).some(k=>!['offset','hyphen'].includes(k))||!Number.isInteger(offset)||offset<=Math.max(previous,prefix)||offset>=block.text.length||typeof point.hyphen!=='boolean'||/[\uD800-\uDBFF]/.test(block.text[offset-1])||atoms.some(m=>m.index<offset&&offset<m.index+m[0].length))throw Error('参考文献断行位置无效。');
  if(point.hyphen&&!(/[A-Za-z]/.test(block.text[offset-1])&&/[A-Za-z]/.test(block.text[offset])))throw Error('断词连字符只能位于英文单词内部。');
  previous=offset;return {offset,hyphen:point.hyphen};
 });
 return {sourceText:value.sourceText,breaks};
}
