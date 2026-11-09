import {writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Windows scanners/readers can briefly deny replacement of an existing file.
// Retry only that replacement, never the operation that produced the record.
export async function atomicJson(path,value,{replace=rename,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});
  for(let attempt=0;;attempt++){
   try{await replace(temporary,path);return;}
   catch(error){if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await delay(20*2**attempt);}
  }
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
