// Preserve binary sources through edits/round trips. The native PDF backend
// additionally verifies their hashes before rendering.
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const data=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&s.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(s);
const path=s=>typeof s==='string'&&s.length>0&&s.length<=2000;
export function legacySource(s){
 if(!s||s.format!=='mtef5'||!data(s.data,2800000)||!hash(s.sha256)||!hash(s.mtefSha256)||!path(s.sourceAsset)||typeof s.originalTex!=='string'||s.originalTex.length>20000||typeof s.empty!=='boolean'||!Number.isInteger(s.characters)||s.characters<0||s.characters>20000||!Number.isInteger(s.structures)||s.structures<0||s.structures>20000)throw Error('旧式公式来源无效。');
 const result=Object.fromEntries(['format','data','sha256','mtefSha256','sourceAsset','originalTex','empty','characters','structures'].map(k=>[k,s[k]]));
 if(s.preview!==undefined){const p=s.preview;if(!p||!data(p.data,2800000)||!hash(p.sha256)||!path(p.sourceAsset))throw Error('旧式公式原预览无效。');result.preview={data:p.data,sha256:p.sha256,sourceAsset:p.sourceAsset};}
 return result;
}
export function vectorSource(s){
 if(!s||s.format!=='emf'||!data(s.data,7000000)||!data(s.pdf,7000000)||!['sha256','pdfSha256','previewSha256','renderedEmfSha256'].every(k=>hash(s[k]))||!path(s.sourceAsset)||typeof s.text!=='string'||s.text.length>100000||typeof s.converter!=='string'||s.converter.length>500||!Array.isArray(s.fonts)||s.fonts.length>100||s.fonts.some(f=>typeof f!=='string'||f.length>200)||!Array.isArray(s.normalizations)||s.normalizations.length>10000)throw Error('EMF 矢量来源无效。');
 const result=Object.fromEntries(['format','data','pdf','sha256','pdfSha256','previewSha256','renderedEmfSha256','sourceAsset','text','converter'].map(k=>[k,s[k]]));
 result.fonts=[...s.fonts];result.normalizations=s.normalizations.map(n=>{if(!n||!Number.isInteger(n.offset)||n.offset<0||typeof n.from!=='string'||!['（','）'].includes(n.from)||n.to!==(n.from==='（'?'(':')'))throw Error('EMF 字形转换记录无效。');return {offset:n.offset,from:n.from,to:n.to};});
 return result;
}
