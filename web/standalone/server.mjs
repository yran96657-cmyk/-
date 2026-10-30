import {createJournalRuntime} from './journal-runtime.mjs';
import {createAgentTasks} from './agent-tasks.mjs';
import {callTool} from '../lib/cloud-tools.mjs';
import {createLayoutAssistant} from './layout-assistant.mjs';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {handle} from '../lib/http.mjs';
import {openStorage} from './storage.mjs';
import {hash,secret,passwordHash,verify,identity} from './auth.mjs';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.wasm':'application/wasm','.json':'application/json'};
export async function startServer({directory,publicDirectory,origin,basePath='/shuye',port=8789,bootstrapPassword,journal,assistant,host='127.0.0.1'}={}){
 if(!/^\/[a-zA-Z0-9_-]+$/.test(basePath))throw Error('INVALID_BASE_PATH');
 const site=new URL(origin);if(!['http:','https:'].includes(site.protocol)||site.pathname!=='/')throw Error('INVALID_ORIGIN');
 const store=await openStorage(directory),sql=store.sql,root=resolve(publicDirectory),secure=site.protocol==='https:';
 if(!sql.prepare('SELECT 1 FROM accounts LIMIT 1').get()){
  if(!bootstrapPassword)throw Error('INITIAL_PASSWORD_REQUIRED');
  sql.prepare('INSERT INTO accounts VALUES (?,?)').run('admin',await passwordHash(bootstrapPassword));
 }
 if(journal)store.JOURNAL_RUNTIME=await createJournalRuntime({engineDirectory:fileURLToPath(new URL(typeof SHUYE_BUNDLED_JOURNAL_PATH==='string'?SHUYE_BUNDLED_JOURNAL_PATH:'../journal-engine/',import.meta.url)),...journal,directory:resolve(directory,'journal-proofs')});
 if(assistant)store.LAYOUT_ASSISTANT=await createLayoutAssistant({...assistant,directory:resolve(directory,'layout-plans')});
 if(journal)store.AGENT_TASKS=await createAgentTasks({directory:resolve(directory,'agent-tasks'),invoke:callTool});
 const attempts=new Map();let activeApi=0;
 const cookie=(token,age=604800)=>`shuye_session=${token}; Path=${basePath}/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
 const brand=`<a class="auth-brand" href="${basePath}/" aria-label="书页 · 项目库"><svg viewBox="0 0 48 48" width="36" height="36" aria-hidden="true" focusable="false"><use href="${basePath}/brand/shuye-mark.svg#mark"/></svg><span>书页</span></a>`;
 function page(title,content){return `<!doctype html><html lang="zh-CN" class="shuye-desktop"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><style media="screen">html.shuye-desktop{color-scheme:dark;background:#232323}</style><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 书页</title><link rel="icon" type="image/svg+xml" href="${basePath}/favicon.svg"><link rel="stylesheet" href="${basePath}/dashboard.css"><link rel="stylesheet" href="${basePath}/brand/brand-colors.css"></head><body><main class="auth-card">${brand}<h1>${title}</h1>${content}</main></body></html>`;}
 const form=(path,content,label)=>`<form method="post" action="${basePath}${path}">${content}<button class="primary">${label}</button></form>`;
 const input=(name,label,type='password')=>`<label>${label}<input name="${name}" type="${type}" required maxlength="256" autocomplete="${name==='newPassword'?'new-password':'current-password'}"></label>`;
 const server=createServer(async(req,res)=>{
  const send=(status,data,type='text/html; charset=utf-8',headers={})=>{res.writeHead(status,{'Content-Type':type,...headers});res.end(req.method==='HEAD'?'':data);};
  const json=(status,data)=>send(status,JSON.stringify(data),'application/json; charset=utf-8');
  const redirect=path=>{res.writeHead(303,{Location:basePath+path});res.end();};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try{
   if(req.headers.host!==site.host){json(400,{error:'HOST_DENIED'});return;}
   const u=new URL(req.url,site),path=u.pathname.slice(basePath.length);
   if(!u.pathname.startsWith(basePath+'/')){if(u.pathname===basePath)redirect('/');else json(404,{error:'NOT_FOUND'});return;}
   if(!['GET','HEAD','POST'].includes(req.method)){json(405,{error:'METHOD_NOT_ALLOWED'});return;}
   if(req.headers.origin&&req.headers.origin!==site.origin){json(403,{error:'ORIGIN_DENIED'});return;}
   const owner=identity(req,sql),bearer=!!req.headers.authorization;
   if(req.method==='POST'&&!bearer&&req.headers.origin!==site.origin){json(403,{error:'ORIGIN_REQUIRED'});return;}
   let data;
   const body=async(limit=30*1024*1024)=>{if(data)return data;let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>limit)throw Error('REQUEST_TOO_LARGE');chunks.push(c);}data=Buffer.concat(chunks);return data;};
   if(path==='/healthz'){json(200,{status:'ok',version:'0.7.0',storage:'sqlite-files'});return;}
   if(path==='/config.js'){send(200,`globalThis.__SHUYE_BASE__=${JSON.stringify(basePath)};`,'text/javascript');return;}
   if(path==='/api/session'){json(200,{user:owner||null});return;}
   if(path==='/signin-with-chatgpt'||path==='/login'){
    if(req.method!=='POST'){send(200,page('登录',form('/login',input('password','管理员密码'),'登录')+'<p>使用本站独立账号，无需 ChatGPT 登录。</p>'));return;}
    // Forwarding headers are attacker-controlled unless a separately configured
    // trusted proxy strips them. Keep the budget on the actual connection peer.
    const ip=req.socket.remoteAddress;
    const now=Date.now();for(const [key,a] of attempts)if(now-a.start>900000)attempts.delete(key);
    const attempt=attempts.get(ip)||{start:now,count:0};if(attempt.count>=10||attempts.size>10000){json(429,{error:'LOGIN_RATE_LIMIT'});return;}attempt.count++;attempts.set(ip,attempt);
    const fields=new URLSearchParams((await body(4096)).toString());
    if(!await verify(fields.get('password'),sql.prepare('SELECT password FROM accounts WHERE id=?').get('admin').password)){send(401,page('登录未成功','<p>密码不正确。</p><a href="'+basePath+'/login">返回登录</a>'));return;}
    attempts.delete(ip);sql.prepare('DELETE FROM sessions WHERE expires<?').run(now);const token=secret();sql.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),'admin',now+604800000);res.setHeader('Set-Cookie',cookie(token));redirect('/');return;
   }
   if(path==='/signout-with-chatgpt'){if(req.method==='POST'){const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('shuye_session='))?.slice(14);if(value)sql.prepare('DELETE FROM sessions WHERE hash=?').run(hash(value));res.setHeader('Set-Cookie',cookie('',0));redirect('/');}else send(200,page('退出登录',form('/signout-with-chatgpt','','确认退出')));return;}
   if(path==='/account'||path.startsWith('/account/')){
    if(!owner||bearer){redirect('/login');return;}
    if(path==='/account/password'&&req.method==='POST'){
     const f=new URLSearchParams((await body(4096)).toString());if(!await verify(f.get('password'),sql.prepare('SELECT password FROM accounts WHERE id=?').get(owner).password)){json(403,{error:'PASSWORD_INCORRECT'});return;}
     const next=await passwordHash(f.get('newPassword'));sql.exec('BEGIN IMMEDIATE');try{sql.prepare('UPDATE accounts SET password=? WHERE id=?').run(next,owner);sql.prepare('DELETE FROM sessions WHERE owner=?').run(owner);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}res.setHeader('Set-Cookie',cookie('',0));redirect('/login');return;
    }
    if(path==='/account/token'&&req.method==='POST'){if(sql.prepare('SELECT count(*) AS n FROM tokens WHERE owner=?').get(owner).n>=20){json(400,{error:'TOKEN_LIMIT_20'});return;}const token=secret();sql.prepare('INSERT INTO tokens VALUES (?,?,?,?)').run(hash(token),owner,'Agent',new Date().toISOString());send(200,page('MCP 令牌已创建',`<p>请立即复制，离开后不会再次显示。</p><pre>${token}</pre><p>端点：${escape(site.origin+basePath+'/mcp')}</p><p>请求头：Authorization: Bearer 上面的令牌</p><a href="${basePath}/account">返回设置</a>`));return;}
    if(path==='/account/revoke'&&req.method==='POST'){const f=new URLSearchParams((await body(4096)).toString());sql.prepare('DELETE FROM tokens WHERE owner=? AND hash=?').run(owner,f.get('id'));redirect('/account');return;}
    const tokens=sql.prepare('SELECT hash,created FROM tokens WHERE owner=?').all(owner);
    send(200,page('账号与 MCP',`<h2>修改密码</h2>${form('/account/password',input('password','当前密码')+input('newPassword','新密码（12–256 字符）'),'保存新密码')}<h2>MCP 访问令牌</h2><p>端点：${escape(site.origin+basePath+'/mcp')}</p>${form('/account/token','','创建令牌')}${tokens.map(t=>form('/account/revoke',`<p>${escape(t.created)}</p><input type="hidden" name="id" value="${t.hash}">`,'撤销令牌')).join('')}`));return;
   }
   if(path==='/mcp'||path==='/api/mcp-projects'){
    if(!owner){json(401,{error:'UNAUTHENTICATED'});return;}
    if(req.method!=='POST'){json(405,{error:'METHOD_NOT_ALLOWED'});return;}
    if(activeApi>=4){json(503,{error:'SERVER_BUSY_RETRY'});return;}activeApi++;
    try{const headers=new Headers({'content-type':'application/json','oai-authenticated-user-id':owner});if(req.headers.origin)headers.set('origin',req.headers.origin);const r=await handle(new Request(u,{method:'POST',headers,body:await body()}),store,path==='/mcp');send(r.status,Buffer.from(await r.arrayBuffer()),r.headers.get('content-type')||'application/json');}finally{activeApi--;}return;
   }
   if(req.method==='POST'){json(404,{error:'NOT_FOUND'});return;}
   if(path==='/'||path==='/index.html'){send(200,page('我的出版项目',`<div id="root"></div><script src="${basePath}/config.js"></script><script type="module" src="${basePath}/dashboard.js"></script>`).replace('<main class="auth-card">','<main>').replace('<h1>我的出版项目</h1>','').replace(brand,''));return;}
   const decoded=decodeURIComponent(path);if(decoded.includes('\0')||decoded.split('/').some(v=>v==='..'||v.startsWith('.'))||decoded.includes('\\')){json(404,{error:'NOT_FOUND'});return;}
   const target=resolve(root,'.'+decoded);if(!target.startsWith(root+sep)){json(404,{error:'NOT_FOUND'});return;}
   const info=await stat(target);if(!info.isFile())throw Object.assign(Error('not found'),{code:'ENOENT'});
   let content=await readFile(target);
   if(path==='/editor/index.html')content=Buffer.from(content.toString().replace('<head>',`<head><script src="${basePath}/config.js"></script>`).replace('class="back-library" href="/"',`class="back-library" href="${basePath}/"`));
   send(200,content,types[extname(target)]||'application/octet-stream');
  }catch(e){if(!res.headersSent)json(e.code==='ENOENT'?404:e.message==='REQUEST_TOO_LARGE'?413:400,{error:e.code==='ENOENT'?'NOT_FOUND':e.message});else res.end();}
 });
 server.requestTimeout=120000;server.headersTimeout=15000;
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,host,ok)});
 return {server,store,close:async()=>{await store.AGENT_TASKS?.close();await store.LAYOUT_ASSISTANT?.close();await store.JOURNAL_RUNTIME?.close();await new Promise(r=>server.close(r));store.close();}};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const config=JSON.parse(await readFile(process.env.SHUYE_CONFIG||'/etc/shuye/config.json','utf8'));
 const app=await startServer(config);console.log('Shuye standalone listening on loopback');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0)});
}
