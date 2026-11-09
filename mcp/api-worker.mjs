// Run on the machine that can access the private model gateway. Only outbound
// HTTPS is needed. Secrets are read from environment/local files, never logged.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {requestChat} from '../web/standalone/api-model.mjs';
const config=JSON.parse(await readFile(process.env.SHUYE_WORKER_CONFIG||process.argv[2],'utf8'));
const url=new URL(config.mcpUrl);
if(!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))||url.username||url.password||url.search||url.hash)throw Error('INVALID_MCP_ENDPOINT');
const token=(config.tokenFile?await readFile(config.tokenFile,'utf8'):process.env.SHUYE_MCP_TOKEN)?.trim();if(!token)throw Error('MCP_TOKEN_REQUIRED');
const workerId=randomUUID(),modelMap=config.modelMap||{},models=Object.keys(modelMap);if(!models.length)throw Error('MODEL_MAP_REQUIRED');
let id=0,stopping=false,busy=false,current;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(name,args){
 const r=await fetch(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('MCP_HTTP_'+r.status);const data=await r.json();if(data.error||data.result?.isError)throw Error(data.error?.message||data.result.content?.[0]?.text||'MCP_ERROR');return data.result.structuredContent??JSON.parse(data.result.content[0].text);
}
async function online(){
 const u=new URL(config.url);if(u.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('MODEL_ENDPOINT_REQUIRES_HTTPS_OR_LOOPBACK');
 // A heartbeat proves the connector process is live. Model requests themselves
 // remain the authoritative availability check; some providers omit /models.
 return call('poll_api_model_request',{workerId,models,busy});
}
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{stopping=true;current?.abort();});
const heartbeat=setInterval(()=>{if(busy)online().catch(()=>{});},10000);
console.log(JSON.stringify({event:'connector-started',models}));
try{while(!stopping){
 try{
  const {request}=await online();if(!request){await sleep(1500);continue;}
  busy=true;current=new AbortController();let completion;
  try{const response=await requestChat(config,{...request.payload,model:modelMap[request.model]},current.signal);completion={workerId,requestId:request.requestId,response};}
  catch(e){completion={workerId,requestId:request.requestId,error:true};console.log(JSON.stringify({event:'model-error',code:e.name==='TimeoutError'?'MODEL_TIMEOUT':/^MODEL_[A-Z_0-9]+$/.test(e.message)?e.message:'MODEL_CONNECTION_FAILED'}));}
  for(let attempt=0;attempt<3;attempt++){try{await call('complete_api_model_request',completion);break;}catch(e){if(attempt===2)throw e;await sleep(1000);}}
  console.log(JSON.stringify({event:'request-complete',requestId:request.requestId,error:!!completion.error}));
 }catch(e){console.log(JSON.stringify({event:'connector-retry',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'CONNECTION_FAILED'}));await sleep(5000);}
 finally{busy=false;current=undefined;}
}}finally{clearInterval(heartbeat);}
