const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const {execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {WindowsDns,launchCommand,HELPER_VERSION}=require('../src/platform/windows-dns');
const windows={skip:process.platform!=='win32'};
const progress='#< CLIXML\r\n<Objs><Obj S="progress"><MS><PR><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>';
const helperSource=fs.readFileSync(path.join(__dirname,'../src/platform/dns-helper.ps1'),'utf8');
function hostPowershell() {
  if (process.platform==='win32') return path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const found=spawnSync('pwsh',['-NoProfile','-Command','exit 0'],{stdio:'ignore',timeout:15000});
  return found.status===0 ? 'pwsh' : null;
}
const hostPs=hostPowershell();
test('Windows PowerShell 5.1 stellt IPv4 und IPv6 als separate Einträge wieder her',{skip:hostPs?false:'Kein PowerShell-Host'},()=>{
  const output=execFileSync(hostPs,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'restore-dns.ps1')],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.match(output,/PASS: IPv4, IPv6/);
});
test('Boot-Wiederherstellung mit simulierten Adaptern',{skip:hostPs?false:'Kein PowerShell-Host'},()=>{
  const output=execFileSync(hostPs,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'recovery-boot.ps1')],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.match(output,/PASS: boot recovery/);
});
test('Neue Adapter werden übernommen, VPN-DNS begrenzt zurückgesetzt, IPv6-Split-DNS',{skip:hostPs?false:'Kein PowerShell-Host'},()=>{
  const output=execFileSync(hostPs,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'adopt-adapters.ps1')],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/PASS: adoption/);
});

// Fake Windows commands: whoami and schtasks. Nothing here touches real tasks.
function fakeRun(dns,{taskExists=false,onRun=()=>{}}={}) {
  const calls=[];
  const run=async(file,args)=>{
    calls.push([path.basename(file),...args]);
    if(file.endsWith('whoami.exe'))return {stdout:'"pc\\paul","S-1-5-21-1-2-3-1001"\r\n'};
    if(args[0]==='/Query'){if(taskExists)return {stdout:''};throw new Error('not found');}
    if(args[0]==='/Run'){setTimeout(()=>onRun(dns()),20);return {stdout:''};}
    throw new Error('unexpected '+file);
  };
  return {run,calls};
}
function harness(onSpawn,{remember=false,taskExists=false,onRun,timeouts}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-handshake-'));
  let dns;const spawned=[];
  const fake=fakeRun(()=>dns,{taskExists,onRun});
  dns=new WindowsDns(dir,{storageRoot:path.join(dir,'store'),remember:()=>remember,run:fake.run,timeouts,spawnProcess:(exe,args)=>{
    spawned.push(Buffer.from(args.at(-1),'base64').toString('utf16le'));
    const child=new EventEmitter();child.stderr=new EventEmitter();
    setTimeout(()=>onSpawn(child,dns),10);return child;
  }});
  dns.inspect=async()=>dns.last;
  fs.mkdirSync(dns.storage,{recursive:true});
  return {dns,spawned,calls:fake.calls,command:()=>JSON.parse(fs.readFileSync(dns.commandPath,'utf8')),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const ready=(dns,extra={})=>fs.writeFileSync(dns.statePath,JSON.stringify({phase:'ready',session:dns.session,seq:0,version:HELPER_VERSION,error:'',...extra}));

test('PowerShell-Launcher unterdrückt Fortschritt und reicht den echten Exitcode weiter',()=>{
  const cmd=launchCommand('test');
  assert.match(cmd,/\$ProgressPreference='SilentlyContinue'/);
  assert.match(cmd,/-Wait -PassThru/);
  assert.match(cmd,/exit \$helper.ExitCode/);
});
test('UAC-Handshake: CLIXML-Fortschritt auf stderr ist kein Startfehler',windows,async()=>{
  const h=harness((child,dns)=>{child.stderr.emit('data',Buffer.from(progress));ready(dns);});
  try {
    await h.dns.launch();assert.equal(h.dns.started,true);
    assert.deepEqual([h.command().action,h.command().via,h.command().pid],['attach','uac',process.pid]);
    assert.match(h.spawned[0],/-Verb RunAs/);assert.match(h.spawned[0],new RegExp(`-Session ${h.dns.session}`));
    assert.doesNotMatch(h.spawned[0],/-Register/);
  } finally {h.cleanup();}
});
test('Antworten einer früheren Sitzung werden ignoriert',windows,async()=>{
  const h=harness((child,dns)=>{
    fs.writeFileSync(dns.statePath,JSON.stringify({phase:'ready',session:'00000000-0000-0000-0000-000000000000',seq:0,version:HELPER_VERSION}));
    setTimeout(()=>ready(dns),300);
  });
  try {const t=Date.now();await h.dns.launch();assert.ok(Date.now()-t>=250);} finally {h.cleanup();}
});
test('Abgebrochene Admin-Freigabe meldet echten Fehler und beendet verspätete Helfer',windows,async()=>{
  const h=harness(child=>{child.stderr.emit('data',Buffer.from('Der Vorgang wurde vom Benutzer abgebrochen.'));child.emit('exit',1);});
  try {await assert.rejects(h.dns.launch(),/vom Benutzer abgebrochen/);assert.equal(h.dns.started,false);assert.equal(h.command().action,'stop');}
  finally {h.cleanup();}
});
test('Vorzeitig beendeter Hilfsprozess verursacht keine zweiminütige Wartezeit',windows,async()=>{
  const h=harness((child,dns)=>{ready(dns,{phase:'stopped'});child.emit('exit',0);});
  try {await assert.rejects(h.dns.launch(),/vorzeitig beendet/);assert.equal(h.dns.started,false);}
  finally {h.cleanup();}
});
test('Gemerkte Freigabe: Start über die Windows-Aufgabe ohne Windows-Abfrage',windows,async()=>{
  const h=harness(()=>assert.fail('UAC darf nicht gestartet werden'),{remember:true,taskExists:true,onRun:dns=>ready(dns)});
  try {
    await h.dns.launch();
    assert.equal(h.dns.started,true);assert.equal(h.spawned.length,0);assert.equal(h.dns.task.state,'registered');
    assert.equal(h.command().via,'task');
    assert.ok(h.calls.some(c=>c[0]==='schtasks.exe' && c[1]==='/Run' && /^LeiseDNS-Helper-[0-9a-f]{12}$/.test(c[3])));
  } finally {h.cleanup();}
});
test('Erste Freigabe legt die Aufgabe über die Windows-Abfrage an',windows,async()=>{
  const h=harness((child,dns)=>ready(dns,{task:'registered'}),{remember:true,taskExists:false});
  try {
    await h.dns.launch();
    assert.match(h.spawned[0],/-Register/);assert.match(h.spawned[0],new RegExp(`-TaskName ${h.dns.taskName}`));
    assert.equal(h.dns.task.state,'registered');
  } finally {h.cleanup();}
});
test('Veraltete oder stumme Aufgabe fällt auf die Windows-Abfrage zurück und erneuert sie',windows,async()=>{
  const h=harness((child,dns)=>ready(dns,{task:'registered'}),{remember:true,taskExists:true,timeouts:{task:600},onRun:dns=>ready(dns,{version:1})});
  try {
    await h.dns.launch();
    assert.equal(h.spawned.length,1);assert.match(h.spawned[0],/-Register/);
    assert.equal(h.command().via,'uac');assert.equal(h.dns.task.state,'registered');
  } finally {h.cleanup();}
});
test('Ohne „Freigabe merken“ wird keine Aufgabe gestartet oder angelegt',windows,async()=>{
  const h=harness((child,dns)=>ready(dns),{remember:false,taskExists:true});
  try {
    await h.dns.launch();
    assert.equal(h.calls.some(c=>c[0]==='schtasks.exe'),false);assert.doesNotMatch(h.spawned[0],/-Register/);
  } finally {h.cleanup();}
});
test('Freigabe zurücknehmen ohne vorhandene Aufgabe startet nichts',windows,async()=>{
  const h=harness(()=>assert.fail('UAC darf nicht gestartet werden'),{taskExists:false});
  try {await h.dns.forget();assert.equal(h.dns.task.state,'missing');assert.equal(h.spawned.length,0);} finally {h.cleanup();}
});
test('Freigabe zurücknehmen startet den Helfer über die Aufgabe und lässt ihn sie entfernen',windows,async()=>{
  const h=harness(()=>assert.fail('UAC darf nicht gestartet werden'),{taskExists:true,onRun:dns=>{
    ready(dns);
    const timer=setInterval(()=>{let c;try{c=JSON.parse(fs.readFileSync(dns.commandPath,'utf8'));}catch{return;}
      if(c.action==='forget'){clearInterval(timer);fs.writeFileSync(dns.statePath,JSON.stringify({phase:'stopped',session:dns.session,seq:c.seq,version:HELPER_VERSION,task:'removed'}));}},50);
  }});
  try {await h.dns.forget();assert.equal(h.dns.task.state,'missing');assert.equal(h.dns.started,false);} finally {h.cleanup();}
});

test('Boot-Wiederherstellung: Sicherung vor der Aufgabe, Warten, Protokoll, Start und Anmeldung',()=>{
  const start=helperSource.indexOf('function Enable-LocalDns');
  const end=helperSource.indexOf("if ($Channel -notmatch");
  const body=helperSource.slice(start,end);
  const save=body.indexOf('Save-Backup $rows');
  const task=body.indexOf('Register-RecoveryTask');
  const netsh=body.indexOf('Invoke-Netsh');
  assert.ok(save!==-1 && save<task && task<netsh,'Sicherung, danach Boot-Aufgabe, danach DNS-Änderung');
  assert.match(helperSource,/if \(\$RecoverOnly\) \{ Invoke-Recovery; exit \}/);
  assert.match(helperSource,/-AtStartup/);
  assert.match(helperSource,/-AtLogOn/);
  assert.match(helperSource,/recovery\.log/);
  assert.match(helperSource,/-RestartCount 5/);
  assert.match(helperSource,/if \(\$StorageRoot\) \{ return \}/);
  assert.match(helperSource,/PT45S/);
});

test('Hilfsskript: erhöhter Code nutzt keine vom Benutzer änderbaren Umgebungspfade',()=>{
  assert.doesNotMatch(helperSource,/\$env:(ProgramData|SystemRoot|windir)/i);
  assert.match(helperSource,/GetFolderPath\('CommonApplicationData'\)/);
  assert.match(helperSource,new RegExp(`\\$HelperVersion = ${HELPER_VERSION}`));
  // Task: fixed protected script, highest privileges of the own account, no parallel instances.
  assert.match(helperSource,/function Register-HelperTask[\s\S]*Install-HelperScript[\s\S]*-RunLevel Highest/);
  assert.match(helperSource,/-MultipleInstances IgnoreNew/);
  assert.match(helperSource,/Im Testmodus wird keine Windows-Aufgabe angelegt/);
  // State is only written through fresh files inside the protected folder.
  assert.match(helperSource,/\[IO\.FileMode\]::CreateNew/);
  assert.match(helperSource,/Test-TrustedOwner \$storage/);
});

async function realHelper(remember) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-real-helper-'));
  let child;
  const dns=new WindowsDns(dir,{storageRoot:path.join(dir,'LeiseDNS'),remember:()=>remember,spawnProcess:(exe,args,options)=>{
    // Real launcher/helper protocol without UAC, with an isolated storage folder.
    const patched=[...args];patched[patched.length-1]=Buffer.from(Buffer.from(patched.at(-1),'base64').toString('utf16le').replace(' -Verb RunAs',''),'utf16le').toString('base64');
    child=spawn(exe,patched,options);return child;
  }});
  dns.inspect=async()=>dns.last;
  return {dns,child:()=>child,dir};
}
test('Echter PowerShell-Hilfsprozess erreicht ready und bestätigt stop ohne DNS-Änderung',windows,async()=>{
  const {dns,child,dir}=await realHelper(false);
  try {
    await dns.launch();assert.equal(dns.readState().phase,'ready');assert.equal(dns.readState().version,HELPER_VERSION);
    await dns.command('stop');assert.equal(dns.readState().phase,'stopped');
    assert.equal(fs.existsSync(path.join(dir,'LeiseDNS','dns-backup.json')),false);
    if(child().exitCode===null)await new Promise(resolve=>child().once('exit',resolve));
  } finally {child()?.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Echter Hilfsprozess legt im Testmodus keine Windows-Aufgabe an',windows,async()=>{
  const {dns,child,dir}=await realHelper(true);
  try {
    await dns.launch();
    assert.equal(dns.task.state,'failed');assert.match(dns.task.error,/Testmodus/);
    assert.equal(await dns.taskExists(),false);
    await dns.command('stop');
    if(child().exitCode===null)await new Promise(resolve=>child().once('exit',resolve));
  } finally {child()?.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Echter Hilfsprozess endet, wenn eine neue App-Sitzung übernimmt',windows,async()=>{
  const {dns,child,dir}=await realHelper(false);
  try {
    await dns.launch();const old=dns.session;
    // A second app instance announces itself; the old helper hands DNS back and stops.
    dns.session='00000000-0000-4000-8000-000000000001';dns.writeCommand('attach');
    if(child().exitCode===null)await new Promise(resolve=>child().once('exit',resolve));
    const state=dns.readState();assert.equal(state.session,old);assert.equal(state.phase,'stopped');
  } finally {child()?.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
