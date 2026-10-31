// Shared by the library and editor so importing never requires a sample project.
export async function journalFileArguments(file,revisionPolicy='require-clean'){
 if(!file||! /\.docx?$/i.test(file.name))throw Error('请选择 .doc 或 .docx 原稿。');
 if(!file.size)throw Error('原稿为空，请重新选择。');
 if(file.size>20*1024*1024)throw Error('Word 原稿不得超过 20 MB。');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {title:file.name.replace(/\.docx?$/i,''),base64:btoa(binary),revisionPolicy};
}
