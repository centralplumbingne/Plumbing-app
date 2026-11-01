// Central Plumbing service worker.
// 1) Push notifications (unchanged behaviour).
// 2) Fast launch: the app shell and the Firebase SDK files are kept in a local cache, so opening the app
//    does not wait on the network. The page is served from the cache right away and refreshed in the
//    background; when a new version is found it is saved for the next launch and open copies are told
//    (they show "New version ready - tap to update").
// Only GET requests for our own shell files and the pinned Firebase SDK on www.gstatic.com are cached.
// Firestore / sign-in traffic is never touched.
const VERSION='cp-shell-v1';               // bump on any sw.js change; old caches are deleted on activate
const APP=new URL('./',self.location).href; // https://centralplumbingne.github.io/Plumbing-app/
const PAGE=APP+'index.html';
const SHELL=[PAGE,APP+'manifest.json',APP+'logo.png',APP+'logo-mono-white.png',APP+'icon-180.png',APP+'icon-192.png'];
const SDK='https://www.gstatic.com/firebasejs/10.12.2/';
const SDK_FILES=['firebase-app.js','firebase-auth.js','firebase-firestore.js'].map(f=>SDK+f);
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(VERSION);
  await c.addAll(SHELL.map(u=>new Request(u,{cache:'no-cache'})));
  await Promise.all(SDK_FILES.map(u=>c.add(new Request(u,{mode:'cors',cache:'no-cache'})).catch(()=>{}))); // SDK is optional at install
  await self.skipWaiting()})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==VERSION)await caches.delete(k);await self.clients.claim()})()));

async function tell(msg){for(const c of await self.clients.matchAll({type:'window',includeUncontrolled:true}))c.postMessage(msg)}
const sig=r=>r&&(r.headers.get('etag')||r.headers.get('last-modified')||'')+'|'+(r.headers.get('content-length')||'');
// background refresh of the page: store the new copy and tell open windows if it changed
let lastChange=0; // when a newer page was last saved (lets a window that opened meanwhile ask)
async function refreshPage(cache,old){try{const r=await fetch(PAGE,{cache:'no-cache'});if(!r.ok)return r;
  const fresh=r.clone();let changed=!old;
  if(old){const a=sig(old),b=sig(r);changed=(a!==b||a==='|')?((await old.text())!==(await r.clone().text())):false}
  if(changed){await cache.put(PAGE,fresh);if(old){lastChange=Date.now();tell({type:'cp-update'})}}return r}catch(e){console.warn('sw refresh',e);return null}}
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET')return;const u=new URL(q.url);
  if(q.mode==='navigate'&&q.url.startsWith(APP)&&(u.pathname.endsWith('/')||u.pathname.endsWith('/index.html'))){
    e.respondWith((async()=>{const c=await caches.open(VERSION);const old=await c.match(PAGE);const net=refreshPage(c,old&&old.clone());
      if(old){e.waitUntil(net);return old}const r=await net;return r||Response.error()})());return}
  const shell=SHELL.includes(u.origin+u.pathname),sdk=q.url.startsWith(SDK);
  if(shell||sdk){e.respondWith((async()=>{const c=await caches.open(VERSION);const hit=await c.match(q,{ignoreSearch:true});
    if(hit){if(shell)e.waitUntil(fetch(q,{cache:'no-cache'}).then(r=>r.ok&&c.put(q,r)).catch(()=>{}));return hit} // SDK URLs are versioned: never change
    const r=await fetch(q);if(r.ok)c.put(q,r.clone()).catch(()=>{});return r})())}});
self.addEventListener('message',e=>{const d=e.data||{};if(d.type==='cp-ask'&&lastChange&&lastChange>=d.since-5000&&e.source)e.source.postMessage({type:'cp-update'})});

self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'Central Plumbing',{body:d.body||'',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||undefined,data:{job:d.jobId||'',tab:d.tab||''}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const dt=e.notification.data||{},job=dt.job||'',tab=dt.tab||'';const url=APP+(job?'?job='+encodeURIComponent(job):tab?'?tab='+encodeURIComponent(tab):'');
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if(c.url.startsWith(APP)&&'focus' in c){if(job)c.postMessage({job});else if(tab)c.postMessage({tab});return c.focus()}}
    return self.clients.openWindow(url)}))});
