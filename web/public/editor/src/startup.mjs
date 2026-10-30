// Keep the server-rendered dark surface until the workbench and its project
// connection are ready. A failed module load must expose a way to recover.
const startup=document.getElementById('workbenchStartup');
try{
 await import('./app.mjs');
 document.body.removeAttribute('data-starting');
 startup?.remove();
}catch(error){
 console.error('Workbench startup failed',error);
 if(startup){
  startup.setAttribute('role','alert');
  startup.querySelector('.startup-message').textContent='工作区未能打开，请重新加载。';
  startup.querySelector('nav').hidden=false;
 }
}
