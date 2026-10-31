// Image manuscripts exceed localStorage's quota quickly. Keep project drafts
// in IndexedDB, with serialized per-project writes and a one-way legacy import.
function indexedBackend(indexedDB){
 let opened;
 const open=()=>opened||=(new Promise((resolve,reject)=>{
  const request=indexedDB.open('shuye-drafts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onerror=()=>{opened=null;reject(request.error);};
  request.onblocked=()=>{opened=null;reject(Error('草稿数据库被其他页面占用，请关闭旧页面后重试。'));};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
 }));
 async function operation(mode,method,id,value){
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('drafts',mode),store=tx.objectStore('drafts');
   const request=method==='put'?store.put(value,id):store[method](id);
   tx.oncomplete=()=>resolve(request.result);
   tx.onerror=tx.onabort=()=>reject(tx.error||request.error||Error('草稿保存失败'));
  });
 }
 return {get:id=>operation('readonly','get',id),put:(id,value)=>operation('readwrite','put',id,value),delete:id=>operation('readwrite','delete',id)};
}
export function createDraftStore({indexedDB=globalThis.indexedDB,storage,backend}={}){
 if(storage===undefined){try{storage=globalThis.localStorage;}catch{}}
 const key=id=>'shuye-draft-'+id;
 const legacy={get:id=>{const raw=storage?.getItem(key(id));return raw?JSON.parse(raw):undefined;},put:(id,value)=>{if(!storage)throw Error('浏览器草稿存储不可用');storage.setItem(key(id),JSON.stringify(value));},delete:id=>storage?.removeItem(key(id))};
 backend??=indexedDB?indexedBackend(indexedDB):legacy;
 const queues=new Map();
 function serial(id,fn){
  const pending=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(fn);
  queues.set(id,pending);pending.finally(()=>{if(queues.get(id)===pending)queues.delete(id);}).catch(()=>{});
  return pending;
 }
 const read=async id=>{
  const current=await backend.get(id);if(current!==undefined)return current;
  let old;try{old=legacy.get(id);}catch{if(backend===legacy)throw Error('浏览器草稿存储不可用');}
  if(old!==undefined&&backend!==legacy){await backend.put(id,old);try{legacy.delete(id);}catch{}}return old;
 };
 return {
  read:id=>serial(id,()=>read(id)),
  write:(id,value)=>{const snapshot=structuredClone(value);return serial(id,async()=>{await backend.put(id,snapshot);if(backend!==legacy){try{legacy.delete(id);}catch{}}});},
  removeIf:(id,predicate)=>serial(id,async()=>{const current=await read(id);if(current&&predicate(current)){await backend.delete(id);if(backend!==legacy){try{legacy.delete(id);}catch{}}}}),
 };
}
