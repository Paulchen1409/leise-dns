// UI smoke test and visual review. Runs only with --smoke-test, against the
// isolated test data folder, port 15353 and a simulated DNS adapter service.
// Nothing here touches the user's database or Windows DNS settings.
const fs=require('node:fs');
const path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const {BrowserWindow}=require('electron');

// The native caption buttons (Window Controls Overlay) are not part of the web
// page, so the whole window is captured through Windows' PrintWindow API.
function captureWindow(win,file) {
  if(process.platform!=='win32')return Promise.resolve('skipped');
  const hwnd=win.getNativeWindowHandle();const handle=hwnd.length>=8?hwnd.readBigUInt64LE(0):BigInt(hwnd.readUInt32LE(0));
  const script=`Add-Type -AssemblyName System.Drawing;Add-Type 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr d,uint f);[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);public struct R{public int L,T,Ri,B;}}';$h=[IntPtr]${handle};$r=New-Object W+R;[W]::GetWindowRect($h,[ref]$r)|Out-Null;$b=New-Object System.Drawing.Bitmap ($r.Ri-$r.L),($r.B-$r.T);$g=[System.Drawing.Graphics]::FromImage($b);$d=$g.GetHdc();[W]::PrintWindow($h,$d,2)|Out-Null;$g.ReleaseHdc($d);$b.Save('${file.replace(/'/g,"''")}')`;
  return new Promise(r=>require('node:child_process').execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:20000},e=>r(e?e.message:'ok')));
}

const ALLOWED=['www.wikipedia.org','api.github.com','fonts.gstatic.com','outlook.office365.com','www.heise.de','login.microsoftonline.com','cdn.jsdelivr.net','www.tagesschau.de','weather.example.org','updates.example.com'];
const BLOCKED=['pagead2.googlesyndication.com','googleads.g.doubleclick.net','www.google-analytics.com','connect.facebook.net','bat.bing.com','sb.scorecardresearch.com','app-measurement.com','ads.linkedin.com','telemetry.example.net','tracker.example.com'];
const FAILED=['printer.fritz.box','intranet.corp.example'];

// Synthetic traffic for the review screenshots, written only to the test database.
function seed(service) {
  const {store,filters}=service;
  const now=Date.now();let n=0;
  const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-6);
  for(let t=start.getTime();t<now;t+=3600000) {
    const hour=new Date(t).getHours();const today=t>=now-(new Date().getHours()+1)*3600000;
    const load=Math.round((hour>=8 && hour<=23?1:0.25)*(today?34:12)*(0.6+((hour*7919+t/3600000)%10)/12));
    for(let i=0;i<load;i++) {
      const r=(n++*2654435761>>>0)%100;
      const status=r<27?'blocked':r<29?'error':'allowed';
      const list=status==='blocked'?BLOCKED:status==='error'?FAILED:ALLOWED;
      const domain=list[(n*31+(status==='blocked'?Math.floor(r/3):r))%list.length];
      store.log({time:Math.min(now-1000,t+Math.floor(i*3600000/Math.max(load,1))),domain,type:i%4?'A':'AAAA',status,reason:status==='blocked'?(i%9?'Filterliste':'Eigene Sperrliste'):status==='error'?'Zeitüberschreitung':'',ms:12+i%40});
    }
  }
  store.replaceList('stevenblack',Array.from({length:1840},(_,i)=>`ads${i}.review.invalid`),37);
  store.replaceList('easyprivacy',Array.from({length:620},(_,i)=>`track${i}.review.invalid`),4211);
  store.db.prepare('UPDATE lists SET error=? WHERE id=?').run('Download fehlgeschlagen (HTTP 503). Die bisherige Liste bleibt erhalten.','easylist');
  filters.add('Eigene Testliste','https://example.com/review-domains.txt');
  // Isolated sample threats (reserved .example names) for the block page review.
  store.replaceList('phishingarmy',['konto-sicherheit-login.example','paket-zustellung-info.example'],0);
  store.replaceList('urlhaus',['gratis-update-download.example'],0);
  ['konto-sicherheit-login.example','gratis-update-download.example','paket-zustellung-info.example'].forEach((domain,i)=>
    store.log({time:now-(i+1)*240000,domain,type:'A',status:'blocked',reason:store.reason(domain),ms:2}));
  for(const d of ['wikipedia.org','heise.de','login.microsoftonline.com'])store.addRule('white',d);
  for(const d of ['telemetry.example.net','tracker.example.com'])store.addRule('black',d);
}

const STATES=(()=>{
  const base={mode:{kind:'active'},dns:{configured:false,partial:false,adapters:[]},running:true,busy:false,error:'',helper:false,active:false,domainCount:2460,upstream:'cloudflare'};
  const on={...base,dns:{configured:true,partial:false,adapters:[]}};
  return {
    setup:base,
    active:{...on,active:true},
    'paused-timed':{...base,mode:{kind:'timed',until:Date.now()+4*60000+5000}},
    'paused-restart':{...base,mode:{kind:'restart'}},
    off:{...base,mode:{kind:'off'}},
    activating:{...base,busy:true,helper:true},
    approval:{...base,busy:true,helper:false},
    unreachable:{...base,running:false,error:'listen EACCES: permission denied 127.0.0.1:53'},
    failed:{...base,error:'DNS-Hilfsdienst wurde vorzeitig beendet (Code 1). Die Windows-Freigabe wurde abgebrochen oder der Hilfsprozess konnte nicht starten.'},
    'restore-failed':{...base,mode:{kind:'off'},error:'Netzwerkadapter „Ethernet“ ist nicht verfügbar. Die Sicherung bleibt erhalten und wird beim nächsten Versuch verwendet.'}
  };
})();

// Collects clipped controls and horizontal overflow on the visible page.
const AUDIT=`(()=>{const d=document.documentElement,issues=[];
  if(d.scrollWidth>d.clientWidth+1)issues.push('horizontal overflow '+d.scrollWidth+'>'+d.clientWidth);
  for(const el of document.querySelectorAll('.btn,.segmented button,.nav a,.status-pill,.tag,.metric-value,.hero-copy h2,.topbar h1,.legend-item,.filter-title h3')){
    if(!el.offsetParent)continue;const r=el.getBoundingClientRect();if(!r.width)continue;
    if(el.scrollWidth>el.clientWidth+1 && getComputedStyle(el).textOverflow!=='ellipsis')issues.push('clipped: '+el.className+' '+el.textContent.trim().slice(0,40));
    if(r.right>d.clientWidth+1)issues.push('outside viewport: '+el.className+' '+el.textContent.trim().slice(0,30));
  }
  return issues;})()`;

async function checkBlockPage(service) {
  const packet=require('dns-packet');const dgram=require('node:dgram');const http=require('node:http');
  const status=service.blockPage?.status();
  const dns=await new Promise(resolve=>{const s=dgram.createSocket('udp4');let timer;const done=v=>{if(!timer)return;clearTimeout(timer);timer=null;s.close();resolve(v);};
    s.on('message',m=>done(packet.decode(m).answers.find(a=>a.type==='A')?.data || 'NXDOMAIN'));timer=setTimeout(()=>done('timeout'),3000);
    s.send(packet.encode({type:'query',id:9,flags:packet.RECURSION_DESIRED,questions:[{name:'konto-sicherheit-login.example',type:'A'}]}),15353,'127.0.0.1');});
  const page=await new Promise(resolve=>http.get({host:'127.53.0.1',port:15380,path:'/',headers:{Host:'konto-sicherheit-login.example'}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>resolve({status:res.statusCode,body:b}));}).on('error',e=>resolve({status:0,body:e.message})));
  return {running:status?.running,error:status?.error,dns,status:page.status,reason:/Grund: Phishing/.test(page.body)};
}

async function run({main,popup,service,root}) {
  const out=path.join(root,'artifacts');const shots=path.join(out,'screens');
  fs.rmSync(shots,{recursive:true,force:true});fs.mkdirSync(shots,{recursive:true});
  const js=(code,win=main)=>win.webContents.executeJavaScript(code);
  const shot=async(name,win=main,rect)=>fs.writeFileSync(path.join(shots,name+'.png'),(await win.webContents.capturePage(rect)).toPNG());
  const go=async(hash,ms=500)=>{await js(`location.hash=${JSON.stringify(hash)};window.scrollTo(0,0)`);await wait(ms);};
  const size=async(w,h)=>{main.webContents.setZoomFactor(1);main.setSize(w,h);await wait(450);};
  await wait(1500);

  // 1. Bridge, Chart.js, no script errors
  const result=await js(`({title:document.title,bridge:!!window.leise,chart:!!window.Chart,status:document.querySelector('#status-title').textContent,errors:window.__errors||[],lens:document.querySelectorAll('.lens-defs filter').length,refraction:getComputedStyle(document.querySelector('#status-pill')).backdropFilter})`);
  if(!result.bridge || !result.chart || result.errors.length)throw new Error('Oberflächentest fehlgeschlagen: '+JSON.stringify(result));
  await size(1280,900);await shot('01-dashboard-empty');
  const frame=await captureWindow(main,path.join(shots,'window-frame-1280x900.png'));
  await go('queries');await shot('02-queries-empty');
  await go('dashboard');

  // 2. Form actions against the real IPC interface
  const ui=await js(`(async()=>{
    location.hash='white'; await new Promise(r=>setTimeout(r,150));
    const form=document.querySelector('#add-white');form.elements.domain.value='ui-test.example.com';form.requestSubmit();
    await new Promise(r=>setTimeout(r,500));
    const added=document.querySelector('#rules-white').textContent.includes('ui-test.example.com');
    const highlighted=!!document.querySelector('#rules-white .rule-item.is-new');
    document.querySelector('#search-white').value='no-match';document.querySelector('#search-white').dispatchEvent(new Event('input'));
    const searched=document.querySelector('#rules-white').textContent.includes('Keine passende Domain');
    document.querySelector('#search-white').value='';document.querySelector('#search-white').dispatchEvent(new Event('input'));
    await window.leise.call('rule:remove',{kind:'white',domain:'ui-test.example.com'});
    const listForm=document.querySelector('#add-list');listForm.elements.name.value='X';listForm.elements.url.value='http://insecure.example';listForm.requestSubmit();
    const validation=!document.querySelector('#list-error').hidden;listForm.reset();document.querySelector('#list-error').hidden=true;
    location.hash='filters';await new Promise(r=>setTimeout(r,250));
    const lists=document.querySelectorAll('.filter-card').length;
    return {added,highlighted,searched,validation,lists};
  })()`);
  if(!ui.added || !ui.searched || !ui.validation || ui.lists<3)throw new Error('Bedientest fehlgeschlagen: '+JSON.stringify(ui));
  // Autostart switch round trip (main process keeps it in memory in test mode).
  ui.autostart=await js(`(async()=>{location.hash='settings';await new Promise(r=>setTimeout(r,250));const t=document.querySelector('#autostart-toggle');t.click();await new Promise(r=>setTimeout(r,1200));const on=t.getAttribute('aria-checked');t.click();await new Promise(r=>setTimeout(r,1200));return on+'/'+t.getAttribute('aria-checked');})()`);
  if(ui.autostart!=='true/false')throw new Error('Autostart-Schalter fehlgeschlagen: '+ui.autostart);
  ui.approval=await js(`(async()=>{const t=document.querySelector('#approval-toggle');const before=t.getAttribute('aria-checked');t.click();await new Promise(r=>setTimeout(r,1200));const off=t.getAttribute('aria-checked')+':'+document.querySelector('#approval-status-text').textContent;t.click();await new Promise(r=>setTimeout(r,1200));return before+'/'+off+'/'+t.getAttribute('aria-checked');})()`);
  if(!/^true\/false:Aus\..*\/true$/.test(ui.approval))throw new Error('Freigabe-Schalter fehlgeschlagen: '+ui.approval);

  // 3. Isolated review data
  seed(service);service.changed();await wait(1800);
  const audits={};
  const pages=['dashboard','queries','filters','white','black','settings'];
  for(const [w,h] of [[1280,900],[1440,900],[880,650]]) {
    await size(w,h);
    for(const p of pages){await go(p,p==='dashboard'?700:450);await shot(`${p}-${w}x${h}`);audits[`${p}-${w}x${h}`]=await js(AUDIT);}
  }
  // Enlarged Windows display scaling: 125 % and 150 % at common window sizes
  for(const [w,h,zoom] of [[1280,900,1.25],[1440,900,1.5]]) {
    await size(w,h);main.webContents.setZoomFactor(zoom);await wait(400);
    for(const p of ['dashboard','queries','filters']){await go(p);await shot(`${p}-${w}x${h}-zoom${zoom*100}`);audits[`${p}-${w}x${h}-zoom${zoom*100}`]=await js(AUDIT);}
    main.webContents.setZoomFactor(1);
  }

  await size(1280,900);await go('dashboard');await js(`document.querySelector('[data-days="7"]').click()`);await wait(900);
  await shot('dashboard-7days');await js(`window.scrollTo(0,560)`);await wait(300);await shot('dashboard-7days-scrolled');
  await js(`document.querySelector('[data-days="1"]').click();window.scrollTo(0,0)`);await wait(600);

  // Block page: real DNS answer and the page served for a blocked phishing domain.
  const blockpage=await checkBlockPage(service);
  if(!blockpage.running || blockpage.dns!=='127.53.0.1' || blockpage.status!==403 || !blockpage.reason)throw new Error('Sperrseite fehlgeschlagen: '+JSON.stringify(blockpage));
  const viewer=new BrowserWindow({width:1100,height:860,show:true,webPreferences:{sandbox:true,contextIsolation:true}});
  for(const [name,url,w,h] of [['blockpage-phishing','/__leise/vorschau?kategorie=phishing',1100,860],['blockpage-malware','/__leise/vorschau?kategorie=malware',1100,860],['blockpage-narrow','/__leise/vorschau?kategorie=phishing',420,860]]) {
    viewer.setSize(w,h);await viewer.loadURL(`http://127.53.0.1:15380${url}`);await wait(500);
    fs.writeFileSync(path.join(shots,name+'.png'),(await viewer.webContents.capturePage()).toPNG());
  }
  viewer.destroy();
  await size(1280,900);await go('settings');await js(`document.querySelector('#blockpage-https-toggle').closest('article').scrollIntoView({block:'center'})`);await wait(400);await shot('settings-blockpage');
  await go('queries');await shot('queries-threats');

  // 4. Log while reading: new rows must not move the visible rows
  await size(1280,900);await go('queries');
  const anchoring=await js(`(async()=>{window.scrollTo(0,420);await new Promise(r=>setTimeout(r,200));
    const probe=[...document.querySelectorAll('#query-table tbody tr')].find(r=>r.getBoundingClientRect().top>300);const before=probe.getBoundingClientRect().top;
    window.__probe=probe;return before;})()`);
  for(let i=0;i<6;i++)service.proxy.emit('query',service.store.log({domain:BLOCKED[i],type:'A',status:'blocked',reason:'Filterliste',ms:3}));
  await wait(900);
  const after=await js(`window.__probe.getBoundingClientRect().top`);
  await shot('queries-reading-new-entries');
  await js('window.scrollTo(0,0)');await wait(300);

  // 5. Every protection state on the dashboard and in the popup
  await go('dashboard',600);
  const hero=await js(`(()=>{const r=document.querySelector('#status-card').getBoundingClientRect();return {x:Math.floor(r.x)-24,y:Math.floor(r.y)-24,width:Math.ceil(r.width)+48,height:Math.ceil(r.height)+120};})()`);
  popup.setPosition(40,40);popup.showInactive();await wait(700);
  await shot('popup-live',popup);const popupSize=popup.getSize();
  for(const [name,s] of Object.entries(STATES)) {
    await js(`renderStatus(${JSON.stringify(s)})`);await js(`render(${JSON.stringify(s)})`,popup);await wait(420);
    const box=await js(`(()=>{const r=document.querySelector('#status-card').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x)-24),y:Math.max(0,Math.floor(r.y)-24),width:Math.ceil(r.width)+48,height:Math.ceil(r.height)+120};})()`);
    await shot(`state-${name}`,main,box);await shot(`popup-${name}`,popup);
  }
  // Full window in the active state (rendered from the status model; real activation is blocked in test mode).
  await js(`renderStatus(${JSON.stringify(STATES.active)})`);await wait(450);await shot('dashboard-state-active');
  popup.hide();

  // 6. Reduced transparency and reduced motion
  await js(`window.LeiseUI.prefs.set('transparency','reduce')`);await wait(400);
  await go('dashboard',600);await shot('dashboard-reduced-transparency');
  await go('queries');await shot('queries-reduced-transparency');
  await js(`window.LeiseUI.prefs.set('transparency','auto');window.LeiseUI.prefs.set('motion','reduce')`);
  const motion=await js(`(async()=>{location.hash='filters';await new Promise(r=>setTimeout(r,60));const d=getComputedStyle(document.querySelector('.nav-indicator')).transitionDuration;const reduced=document.documentElement.dataset.motion;return {reduced,duration:d};})()`);
  await js(`window.LeiseUI.prefs.set('motion','auto')`);
  // Keyboard focus ring
  await go('filters');main.webContents.focus();await js(`document.querySelector('#update-all').focus()`);
  for(const modifiers of [[],['shift']])main.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers}),main.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers});
  await wait(300);await shot('focus-visible');

  const report={...result,ui,hero,popupSize,frame,blockpage,anchoring:{before:anchoring,after,stable:Math.abs(anchoring-after)<2},motion,audits};
  fs.writeFileSync(path.join(out,'smoke.json'),JSON.stringify(report,null,2));
  fs.copyFileSync(path.join(shots,'dashboard-1280x900.png'),path.join(out,'dashboard.png'));
  fs.copyFileSync(path.join(shots,'filters-1280x900.png'),path.join(out,'filters.png'));
  fs.copyFileSync(path.join(shots,'queries-1280x900.png'),path.join(out,'queries.png'));
  const problems=Object.entries(audits).filter(([,v])=>v.length);
  console.log('Smoke: fertig',JSON.stringify({ui,anchoring:report.anchoring,motion,lens:result.lens,popupSize,refraction:result.refraction,layoutProblems:problems.length}));
  if(problems.length)console.log('Smoke: Layouthinweise',JSON.stringify(Object.fromEntries(problems),null,1));
}
module.exports={run};
