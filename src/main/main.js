const {app,BrowserWindow,Tray,Menu,nativeImage,ipcMain,dialog,screen,safeStorage,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {Service}=require('../core/service');
const {helpUrl}=require('../core/help-links');
const {queriesToCsv,queriesToJson}=require('../core/query-export');
let main,popup,tray,service,quitting=false,exitReady=false,pendingRules=null;
const POPUP={width:360,height:492};
const smoke=process.argv.includes('--smoke-test');
// Started by Windows after sign-in: stay in the tray, no window.
const startedAtLogin=process.argv.includes('--autostart');
const smokeRoot=app.isPackaged?path.join(app.getPath('temp'),'leise-dns-smoke'):path.join(__dirname,'../..');
if(smoke)app.disableHardwareAcceleration();
// Test captures must not depend on whether other windows cover this one.
if(smoke){app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-background-timer-throttling');}
if(smoke)app.setPath('userData',path.join(smokeRoot,'.test-data/electron'));
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){app.quit();}else{
  app.on('second-instance',()=>openDashboard());
  app.whenReady().then(start).catch(e=>{if(smoke)console.error(e);else dialog.showErrorBox('Leise DNS konnte nicht starten',e.message);app.exit(1);});
}
function windowOptions(extra={}) {return {backgroundColor:'#0e121a',icon:path.join(__dirname,'../../assets/icon.ico'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true},...extra};}
function protect(win) {win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());}
// Keeps the popup's bottom edge in place while its height follows the content.
function fitPopup(height) {
  const h=Math.round(Math.max(320,Math.min(720,Number(height)||POPUP.height)));if(!popup || h===POPUP.height)return;
  const [x,y]=popup.getPosition();const bottom=y+POPUP.height;POPUP.height=h;
  popup.setBounds({x,y:popup.isVisible()?bottom-h:y,width:POPUP.width,height:h});
}
// Autostart after Windows sign-in (HKCU Run entry managed by Electron).
// The test mode only keeps an in-memory value and never touches the registry.
let smokeAutostart=false;
function loginItem() {return {path:process.execPath,args:app.isPackaged?['--autostart']:[app.getAppPath(),'--autostart']};}
function autostartEnabled() {return smoke?smokeAutostart:app.getLoginItemSettings(loginItem()).openAtLogin;}
function setAutostart(enabled) {if(smoke)smokeAutostart=enabled;else app.setLoginItemSettings({openAtLogin:enabled,...loginItem()});}
function openDashboard() {if(!main)return;popup?.hide();main.show();if(main.isMinimized())main.restore();main.focus();}
// Tray: the app mark in mint while protection is active, graphite otherwise.
// Electron picks the @1.5x/@2x files for higher display scaling automatically.
const trayIcons={};
function icon(active) {
  const name=active?'tray-active':'tray-inactive';
  return trayIcons[name]??=nativeImage.createFromPath(path.join(__dirname,'../../assets',name+'.png'));
}
function updateTray() {
  if(!tray)return;const s=service.status();tray.setImage(icon(s.active));tray.setToolTip(`Leise DNS · ${s.active?'Schutz aktiv':'Schutz nicht aktiv'}`);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Dashboard öffnen',click:openDashboard},{label:s.active?'5 Minuten pausieren':'Schutz einschalten',enabled:!s.busy,click:()=>service.setMode(s.active?'5':'active').catch(e=>dialog.showErrorBox('DNS-Einstellung',e.message))},{type:'separator'},{label:'Beenden und DNS zurücksetzen',click:()=>app.quit()}]));
}
async function start() {
  if(smoke)console.log('Smoke: App bereit');
  const testDns=smoke?{last:{configured:false,partial:false,adapters:[]},task:{state:'missing',error:''},async inspect(){return this.last;},async command(){throw new Error('Im Testmodus sind DNS-Änderungen gesperrt.');},async close(){}}:undefined;
  if(smoke)for(const f of ['leise.sqlite','leise.sqlite-wal','leise.sqlite-shm'])require('node:fs').rmSync(path.join(app.getPath('userData'),f),{force:true});
  // Block page: CA key encrypted with Windows DPAPI via safeStorage. The test mode uses
  // other ports and a certificate store that never installs anything.
  const blockPage={protect:s=>safeStorage.encryptString(s),unprotect:b=>safeStorage.decryptString(b),
    ...(smoke?{ports:{http:15380,https:15443},certStore:{async has(){return false;},async add(){throw new Error('Testmodus');},async remove(){}}}:{})};
  service=new Service(app.getPath('userData'),{port:smoke?15353:53,dns:testDns,blockPage});
  // Hidden title bar: the page header becomes the drag region, Windows keeps its own
  // caption buttons (minimise, maximise with Snap layouts, close) via the overlay.
  main=new BrowserWindow(windowOptions({width:1280,height:900,minWidth:880,minHeight:650,title:'Leise DNS',show:false,titleBarStyle:'hidden',titleBarOverlay:{color:'#00000000',symbolColor:'#e4eaf1',height:48}}));protect(main);
  // Transparent, frameless popup: the rounded glass pane and its shadow are drawn by the page.
  popup=new BrowserWindow(windowOptions({width:POPUP.width,height:POPUP.height,resizable:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,skipTaskbar:true,alwaysOnTop:true,show:false}));protect(popup);
  popup.on('blur',()=>popup.hide());
  ipcMain.handle('leise:call',async(event,action,args)=>{
    if(![main.webContents,popup.webContents].includes(event.sender) || event.senderFrame!==event.sender.mainFrame)return {ok:false,error:'Zugriff verweigert.'};
    try {
      if(action==='window:open'){openDashboard();return {ok:true};}
      if(action==='help:open'){await shell.openExternal(helpUrl(args?.id));return {ok:true};}
      if(action==='update:open'){
        const url=service.updateInfo?.url || service.store.get('updateCheck',null)?.url || '';
        if(!/^https:\/\/github\.com\/Paulchen1409\/leise-dns\/releases\//.test(url))throw new Error('Kein Release-Link.');
        await shell.openExternal(url);return {ok:true};
      }
      if(action==='rules:export'){
        const data=service.store.exportRules();
        const chosen=await dialog.showSaveDialog(main,{defaultPath:'leise-dns-regeln.json',filters:[{name:'JSON',extensions:['json']}]});
        if(chosen.canceled || !chosen.filePath)return {ok:true,value:{canceled:true}};
        fs.writeFileSync(chosen.filePath,JSON.stringify(data,null,2));
        return {ok:true,value:{canceled:false,count:data.white.length+data.black.length}};
      }
      if(action==='rules:pick'){
        const chosen=await dialog.showOpenDialog(main,{filters:[{name:'JSON',extensions:['json']}],properties:['openFile']});
        if(chosen.canceled || !chosen.filePaths?.[0])return {ok:true,value:{canceled:true}};
        let data;try{data=JSON.parse(fs.readFileSync(chosen.filePaths[0],'utf8'));}catch{throw new Error('Die Datei ist kein gültiges JSON.');}
        const preview=service.store.previewRules(data);
        pendingRules=data;
        return {ok:true,value:{canceled:false,white:preview.white,black:preview.black}};
      }
      if(action==='rules:apply'){
        if(!pendingRules)throw new Error('Keine Sicherung ausgewählt.');
        const mode=args?.mode==='replace'?'replace':'merge';
        const result=service.store.importRules(pendingRules,{mode});
        pendingRules=null;service.changed();
        return {ok:true,value:result};
      }
      if(action==='queries:export'){
        const format=args?.format==='csv'?'csv':'json';
        const rows=service.store.exportQueries({search:args?.search||'',status:args?.status||'all'});
        const body=format==='csv'?queriesToCsv(rows):queriesToJson(rows);
        const chosen=await dialog.showSaveDialog(main,{defaultPath:format==='csv'?'leise-dns-anfragen.csv':'leise-dns-anfragen.json',filters:[{name:format.toUpperCase(),extensions:[format]}]});
        if(chosen.canceled || !chosen.filePath)return {ok:true,value:{canceled:true}};
        fs.writeFileSync(chosen.filePath,body);
        return {ok:true,value:{canceled:false,count:rows.length,format}};
      }
      if(action==='app:quit'){app.quit();return {ok:true};}
      if(action==='popup:fit'){if(event.sender!==popup.webContents)throw new Error('Zugriff verweigert.');fitPopup(args.height);return {ok:true};}
      if(action==='blockpage:preview'){
        const page=service.blockPage?.status();if(!page?.running)throw new Error('Die Sperrseite läuft nicht.');
        const port=service.blockPage.ports.http;
        await shell.openExternal(`http://${page.address}${port===80?'':':'+port}/__leise/vorschau?kategorie=${args?.category==='malware'?'malware':'phishing'}`);return {ok:true};
      }
      if(smoke && action==='blockpage:https')throw new Error('Im Testmodus wird kein Zertifikat installiert.');
      if(action==='autostart:set'){setAutostart(args?.enabled===true);service.changed();return {ok:true};}
      if(smoke && action==='mode')throw new Error('Im Testmodus bleibt System-DNS unverändert.');
      const value=await service.invoke(action,args);
      if(action==='snapshot')value.status.autostart=autostartEnabled();
      return {ok:true,value};
    }catch(e){return {ok:false,error:e.message};}
  });
  const send=(event,data)=>{for(const w of [main,popup])if(w && !w.isDestroyed())w.webContents.send(event,data);};
  service.on('changed',()=>{send('leise:changed');updateTray();});
  service.on('query',entry=>send('leise:query',entry));
  if(smoke && (icon(true).isEmpty() || icon(false).isEmpty()))throw new Error('Tray-Symbol fehlt.');
  tray=new Tray(icon(false));tray.on('double-click',openDashboard);
  tray.on('click',()=>{
    if(popup.isVisible()){popup.hide();return;}
    const bounds=tray.getBounds();const area=screen.getDisplayNearestPoint({x:bounds.x,y:bounds.y}).workArea;
    popup.setPosition(Math.max(area.x,Math.min(bounds.x-POPUP.width/2,area.x+area.width-POPUP.width)),Math.max(area.y,area.y+area.height-POPUP.height));popup.show();
  });
  main.on('close',e=>{if(!quitting){e.preventDefault();main.hide();}});
  if(smoke)console.log('Smoke: Dienst starten');
  await service.start({download:!smoke});
  if(smoke)console.log('Smoke: Fenster laden');
  await main.loadFile(path.join(__dirname,'../renderer/index.html'));await popup.loadFile(path.join(__dirname,'../renderer/popup.html'));updateTray();if(!startedAtLogin || smoke)main.show();
  if(smoke) {await require('./smoke').run({main,popup,service,root:smokeRoot});app.quit();}
  else service.resumeSaved().catch(e=>{service.error=e.message;service.changed();});
}
app.on('window-all-closed',()=>{});
app.on('before-quit',event=>{
  if(exitReady || !service)return;event.preventDefault();if(quitting)return;
  if(service.busy){dialog.showMessageBox(main,{type:'info',message:'Bitte die laufende DNS-Änderung abwarten und danach erneut beenden.'});return;}
  quitting=true;
  service.close().then(()=>{exitReady=true;tray?.destroy();app.quit();}).catch(e=>{quitting=false;openDashboard();dialog.showErrorBox('DNS konnte noch nicht zurückgesetzt werden',e.message+'\nDie App bleibt geöffnet, damit dein DNS-Dienst weiterläuft. Bitte erneut versuchen.');});
});
