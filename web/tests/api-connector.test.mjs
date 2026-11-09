import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createModelBroker} from '../standalone/api-model.mjs';
import {callTool} from '../lib/cloud-tools.mjs';

test('outbound CLI connector maps a model and completes a real MCP registry request without logging secrets',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'shuye-connector-')),token='test-token-kept-out-of-logs',broker=createModelBroker({models:[{id:'deepseek',model:'group/deepseek'}],timeoutMs:10000});
 let child,log='';
 const provider=createServer(async(req,res)=>{let s='';for await(const p of req)s+=p;const b=JSON.parse(s);assert.equal(req.url,'/v1/chat/completions');assert.equal(b.model,'private-route/deepseek');assert.equal(b.stream,false);res.end(JSON.stringify({model:'DeepSeek-test',choices:[{message:{content:'Layout done'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:4,total_tokens:24}}));});
 const mcp=createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,'Bearer '+token);let s='';for await(const p of req)s+=p;const r=JSON.parse(s),v=await callTool({owner:'alice',apiModels:broker},r.params.name,r.params.arguments);res.end(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{structuredContent:v,content:[]}}));}catch{res.writeHead(400);res.end('{}');}});
 try{
  await Promise.all([new Promise(r=>provider.listen(0,'127.0.0.1',r)),new Promise(r=>mcp.listen(0,'127.0.0.1',r))]);
  await writeFile(join(folder,'token'),token);await writeFile(join(folder,'config.json'),JSON.stringify({mcpUrl:'http://127.0.0.1:'+mcp.address().port+'/mcp',tokenFile:join(folder,'token'),url:'http://127.0.0.1:'+provider.address().port+'/v1',modelMap:{'group/deepseek':'private-route/deepseek'}}));
  child=spawn(process.execPath,[fileURLToPath(new URL('../../mcp/api-worker.mjs',import.meta.url)),join(folder,'config.json')],{windowsHide:true});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const end=Date.now()+10000;while(!broker.status('alice').models[0].ready&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
  assert.equal(broker.status('alice').models[0].ready,true,log);
  const result=await broker.request('alice','deepseek',{messages:[{role:'user',content:'Layout this'}]});assert.equal(result.choices[0].message.content,'Layout done');assert.equal(result.usage.total_tokens,24);
  assert.ok(!log.includes(token));assert.ok(!log.includes('Layout this'));
 }finally{
  if(child&&!child.killed){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
  broker.close();provider.closeAllConnections();mcp.closeAllConnections();await Promise.all([new Promise(r=>provider.close(r)),new Promise(r=>mcp.close(r))]);await rm(folder,{recursive:true,force:true});
 }
});
