// API/UI responses stay unchanged. MCP callers can opt into compact metadata
// and read individual components with list_components instead of image blobs.
export function mcpResult(value,mode='full'){
 if(!['full','summary'].includes(mode))throw Error('INVALID_RESPONSE_MODE');
 let result=value;
 if(mode==='summary'&&value&&typeof value==='object'){
  result={...value};
  if(value.document){
   const {blocks,composition,...metadata}=value.document;
   result.documentSummary={...metadata,blockCount:blocks?.length||0,componentTypes:Object.fromEntries([...new Set((blocks||[]).map(b=>b.type))].map(type=>[type,blocks.filter(b=>b.type===type).length])),hasComposition:!!composition};
   delete result.document;result.responseMode='summary';
  }
  if(typeof result.base64==='string'){result.binaryBytesApprox=Math.floor(result.base64.length*3/4);delete result.base64;result.responseMode='summary';result.downloadInstruction='要取得实际文件，请用 responseMode="full" 调用同一个下载工具；由客户端保存 base64，不把二进制放入模型上下文。';}
 }
 const serialized=JSON.stringify(result);
 // Never duplicate multi-megabyte images/PDFs in both MCP result channels.
 return {content:[{type:'text',text:serialized.length<=65536?serialized:'Large result returned in structuredContent. Use responseMode="summary" and list_components for agent inspection.'}],structuredContent:result,isError:false};
}
