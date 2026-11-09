import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export async function requestChat(config,payload,signal,fetcher=fetch){
 try{return await requestChatOnce(config,payload,signal,fetcher);}catch(e){
  if(signal?.aborted)throw Error('MODEL_CANCELLED');
  if(e.name==='TimeoutError'||e.name==='AbortError')throw Error('MODEL_TIMEOUT');
  if(e.name==='TypeError'&&/fetch|network/i.test(e.message))throw Error('MODEL_CONNECTION_FAILED');
  throw e;
 }
}
async function requestChatOnce(config,payload,signal,fetcher){
 const url=new URL(config.url);if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('MODEL_ENDPOINT_REQUIRES_HTTPS_OR_LOOPBACK');
 const key=config.keyFile?(await readFile(config.keyFile,'utf8')).trim():config.keyEnv?process.env[config.keyEnv]:undefined;
 if((config.keyFile||config.keyEnv)&&!key)throw Error('MODEL_API_KEY_MISSING');
 const response=await fetcher(url.toString().replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(config.timeoutMs||120000)]),headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})},body:JSON.stringify({...payload,stream:false})});
 if(!response.ok){await response.body?.cancel();throw Error('MODEL_HTTP_'+response.status);}
 const reader=response.body.getReader();let size=0,parts=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('MODEL_RESPONSE_LIMIT');}parts.push(value);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('MODEL_INVALID_JSON');}
}

// An outbound connector can reach a private desktop model without exposing a
// local port or putting the provider API key in a browser/server job record.
export function createModelBroker(config={}){
 const models=config.models||[],workers=new Map(),pending=new Map(),completed=new Map();let closed=false;
 if(!Array.isArray(models)||!models.length||models.length>8||models.some(m=>!m||typeof m.id!=='string'||!/^[\w-]{1,40}$/.test(m.id)||typeof m.model!=='string'||!m.model||m.model.length>200||m.label!==undefined&&(typeof m.label!=='string'||m.label.length>100))||new Set(models.map(m=>m.id)).size!==models.length)throw Error('INVALID_API_MODELS');
 if(config.timeoutMs!==undefined&&(!Number.isInteger(config.timeoutMs)||config.timeoutMs<1||config.timeoutMs>600000))throw Error('INVALID_API_TIMEOUT');
 const workerKey=(owner,id)=>JSON.stringify([owner,id]);
 const select=id=>{const m=models.find(m=>m.id===(id||models[0].id));if(!m)throw Error('API_MODEL_NOT_CONFIGURED');return m;};
 const api={
  models:models.map(({id,label,model})=>({id,label:label||id,model})),
  status(owner){return {enabled:true,transport:config.url?'direct':'connector',models:api.models.map(m=>({...m,ready:!!config.url||[...workers.values()].some(w=>w.owner===owner&&w.until>Date.now()&&w.models.includes(m.model))})),usageSource:'provider-response',contentScope:'bounded-structure-and-layout'};},
  async poll(owner,{workerId,models:available,busy=false}){
   for(const [key,w] of workers)if(w.until<Date.now())workers.delete(key);
   if(closed)throw Error('API_CLOSING');if(workers.size>100&&!workers.has(workerKey(owner,workerId)))throw Error('WORKER_LIMIT');
   const names=available.filter(n=>models.some(m=>m.model===n));workers.set(workerKey(owner,workerId),{owner,models:names,until:Date.now()+30000});
   if(busy)return {request:null,pollAfterMs:1500};
   const p=[...pending.values()].find(p=>p.owner===owner&&!p.workerId&&names.includes(p.model));
   if(!p)return {request:null,pollAfterMs:1500};p.workerId=workerId;
   return {request:{requestId:p.id,model:p.model,payload:p.payload,expiresAt:p.expiresAt}};
  },
  complete(owner,{workerId,requestId,response,error}){
   const key=JSON.stringify([owner,workerId,requestId]);if(completed.has(key))return {accepted:true,duplicate:true};
   const p=pending.get(requestId);if(!p||p.owner!==owner||p.workerId!==workerId)throw Error('MODEL_REQUEST_NOT_FOUND');
   if(JSON.stringify(response||{}).length>2*1024*1024)throw Error('MODEL_RESPONSE_LIMIT');
   if(error)p.reject(Error('MODEL_CONNECTOR_ERROR'));else p.resolve(response);
   completed.set(key,Date.now());for(const [k,v] of completed)if(Date.now()-v>300000)completed.delete(k);
   return {accepted:true};
  },
  async request(owner,id,payload,signal){
   if(closed)throw Error('API_CLOSING');const model=select(id),body={...payload,model:model.model};
   if(config.url)return requestChat(config,body,signal);
   if(!api.status(owner).models.find(m=>m.id===model.id)?.ready)throw Error('MODEL_CONNECTOR_OFFLINE');
   const requestId=randomUUID(),expiresAt=Date.now()+(config.timeoutMs||120000);
   return new Promise((resolve,reject)=>{
    const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(requestId);fn(value);};
    const abort=()=>finish(reject,Error('MODEL_CANCELLED'));
    const timer=setTimeout(()=>finish(reject,Error('MODEL_TIMEOUT')),expiresAt-Date.now());
    pending.set(requestId,{id:requestId,owner,model:model.model,payload:body,expiresAt,resolve:v=>finish(resolve,v),reject:e=>finish(reject,e)});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   });
  },
  close(){closed=true;for(const p of pending.values())p.reject(Error('MODEL_INTERRUPTED'));workers.clear();completed.clear();}
 };return api;
}
