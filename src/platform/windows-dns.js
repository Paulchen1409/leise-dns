const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const execFileAsync=promisify(execFile);
const HELPER_VERSION=4;
const system32=path.join(process.env.SystemRoot || 'C:\\Windows','System32');
const powershell=path.join(system32,'WindowsPowerShell','v1.0','powershell.exe');
const script=path.join(__dirname,'dns-helper.ps1').replace('app.asar','app.asar.unpacked');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const psQuote=s=>String(s).replace(/'/g,"''");
function launchCommand(argumentList) {
  // EncodedCommand can put non-error CLIXML progress records on stderr.
  // Only the helper handshake and process exit status determine success.
  return `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; try { $helper = Start-Process -FilePath '${psQuote(powershell)}' -Verb RunAs -WindowStyle Hidden -ArgumentList '${psQuote(argumentList)}' -Wait -PassThru; exit $helper.ExitCode } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
}
// Protocol: the app writes {session, via, pid, seq, action} to <userData>/helper/command.json;
// the elevated helper only reads it and answers in ProgramData\LeiseDNS\helper-<SID>.state.json.
// After a one-time UAC approval ("remember"), a per-user task starts the helper without a prompt.
class WindowsDns {
  constructor(dataPath,{spawnProcess=spawn,run=execFileAsync,storageRoot,remember=()=>false,timeouts={}}={}) {
    this.spawnProcess=spawnProcess;this.run=run;this.remember=remember;this.storageRoot=storageRoot;
    this.dataPath=dataPath;this.seq=0;this.started=false;this.busy=false;this.session=null;this.via=null;
    this.storage=storageRoot || path.join(process.env.ProgramData || 'C:\\ProgramData','LeiseDNS');
    this.channel=path.join(dataPath,'helper');this.commandPath=path.join(this.channel,'command.json');
    this.timeouts={uac:120000,task:20000,...timeouts};
    this.task={state:'unknown',error:''};
    this.last={configured:false,partial:false,adapters:[]};
  }
  async identity() {
    if(!this.sid) {
      const {stdout}=await this.run(path.join(system32,'whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true,timeout:10000});
      const sid=String(stdout).trim().split(',').pop().replace(/"/g,'').trim();
      if(!/^S-1-5-[0-9-]+$/.test(sid))throw new Error('Das Windows-Konto konnte nicht ermittelt werden.');
      this.sid=sid;
    }
    this.statePath=path.join(this.storage,`helper-${this.sid}.state.json`);
    this.taskName='LeiseDNS-Helper-'+createHash('sha256').update(this.sid+'|'+this.channel.toLowerCase()).digest('hex').slice(0,12);
  }
  async inspect() {
    if(process.platform!=='win32')return {...this.last,unsupported:true};
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Inspect'];
    if(this.storageRoot)args.push('-StorageRoot',this.storage);
    const {stdout}=await execFileAsync(powershell,args,{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
    this.last=JSON.parse(stdout.replace(/^\uFEFF/,''));
    this.last.adapterError=this.current()?.adapterError || '';
    return this.last;
  }
  readState() {try{return JSON.parse(fs.readFileSync(this.statePath,'utf8').replace(/^\uFEFF/,''));}catch{return null;}}
  // Only answers for this app session count; older sessions may have left a state behind.
  current() {const s=this.readState();return s && this.session && s.session===this.session?s:null;}
  alive() {const s=this.current();return !!s && s.phase!=='stopped';}
  writeCommand(action) {
    const seq=action==='attach'?(this.seq=0):++this.seq;
    fs.mkdirSync(this.channel,{recursive:true});
    fs.writeFileSync(this.commandPath+'.tmp',JSON.stringify({session:this.session,via:this.via,pid:process.pid,seq,action}));
    fs.renameSync(this.commandPath+'.tmp',this.commandPath);return seq;
  }
  newSession(via) {this.session=randomUUID();this.via=via;this.writeCommand('attach');}
  async taskExists() {
    try {await this.run(path.join(system32,'schtasks.exe'),['/Query','/TN',this.taskName],{windowsHide:true,timeout:15000});return true;}
    catch {return false;}
  }
  async refreshTask() {
    if(process.platform!=='win32')return this.task;
    await this.identity();
    const exists=await this.taskExists();
    if(!(exists && this.task.state==='removing'))this.task={state:exists?'registered':'missing',error:exists?'':this.task.error};
    return this.task;
  }
  async launch({useTask=this.remember()}={}) {
    if(process.platform!=='win32')throw new Error('Die automatische DNS-Einrichtung ist für Windows verfügbar.');
    if(this.started && this.alive())return;
    this.started=false;
    await this.identity();
    if(useTask && await this.taskExists()) {
      try {await this.startViaTask();return;}
      catch(e) {
        // Fall back to the normal Windows prompt; that also renews the task.
        this.task={state:'failed',error:e.message};this.writeCommand('stop');
      }
    }
    await this.startViaUac({register:this.remember()});
  }
  async startViaTask() {
    this.newSession('task');
    const schtasks=path.join(system32,'schtasks.exe');
    await this.run(schtasks,['/Run','/TN',this.taskName],{windowsHide:true,timeout:15000});
    const begin=Date.now();let retried=false;
    while(Date.now()-begin<this.timeouts.task) {
      const state=this.current();
      if(state?.phase==='ready' || state?.phase==='active') {
        if(state.version!==HELPER_VERSION)throw new Error('Die gespeicherte Freigabe gehört zu einer älteren Version und wird erneuert.');
        this.started=true;this.task={state:'registered',error:''};return;
      }
      if(state?.phase==='error' || state?.phase==='stopped')throw new Error(state.error || 'Der DNS-Hilfsdienst wurde beendet.');
      // A helper from the previous app session may still be closing; the task ignores parallel starts.
      if(!retried && Date.now()-begin>3000){retried=true;await this.run(schtasks,['/Run','/TN',this.taskName],{windowsHide:true,timeout:15000}).catch(()=>{});}
      await delay(150);
    }
    throw new Error('Der DNS-Hilfsdienst hat über die Windows-Aufgabe nicht geantwortet.');
  }
  async startViaUac({register}) {
    this.newSession('uac');
    const args=[`-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}"`,`-Channel "${this.channel}"`,`-UserSid ${this.sid}`,`-Session ${this.session}`,`-TaskName ${this.taskName}`];
    if(register)args.push('-Register');
    if(this.storageRoot)args.push(`-StorageRoot "${this.storage}"`);
    const encoded=Buffer.from(launchCommand(args.join(' ')),'utf16le').toString('base64');
    const child=this.spawnProcess(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let failure,stderr='',exited=false,exitCode;
    child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-16000);});
    child.on('error',e=>{failure=e.message;});
    child.on('exit',code=>{exited=true;exitCode=code;});
    try {
      const begin=Date.now();
      while(Date.now()-begin<this.timeouts.uac) {
        const state=this.current();
        if(state?.phase==='error')throw new Error(state.error);
        if(failure)throw new Error('DNS-Hilfsdienst konnte nicht starten: '+failure);
        if(exited || state?.phase==='stopped')throw new Error('DNS-Hilfsdienst wurde vorzeitig beendet'+(exitCode!=null?` (Code ${exitCode})`:'')+'. '+(stderr.trim() || 'Die Windows-Freigabe wurde abgebrochen oder der Hilfsprozess konnte nicht starten.'));
        if(state?.phase==='ready') {
          this.started=true;
          if(register)this.task=state.task==='registered'?{state:'registered',error:''}:{state:'failed',error:state.taskError || 'Die Windows-Aufgabe konnte nicht angelegt werden.'};
          return;
        }
        await delay(200);
      }
      throw new Error('Die Windows-Freigabe hat zu lange gedauert. Bitte erneut versuchen.');
    } catch(e) {
      // Stop any helper that starts late after a cancelled/failed attempt.
      this.writeCommand('stop');throw e;
    }
  }
  async command(action) {
    if(this.busy)throw new Error('Die DNS-Einstellung wird gerade geändert. Bitte kurz warten.');
    this.busy=true;
    try {
      if(action==='activate')await this.launch();
      if(action==='forget' && !(this.started && this.alive())) {
        await this.identity();
        if(!(await this.taskExists())){this.task={state:'missing',error:''};return;}
        await this.launch({useTask:true});
      }
      if(!this.started || !this.alive()) {
        this.started=false;
        if(action==='stop' || action==='deactivate')return;
        throw new Error('DNS-Hilfsdienst ist nicht gestartet.');
      }
      const seq=this.writeCommand(action);
      for(let i=0;i<450;i++) {
        const state=this.current();
        if(state?.seq===seq) {
          if(state.phase==='stopped')this.started=false;
          if(state.task==='removing')this.task={state:'removing',error:''};
          if(state.task==='removed')this.task={state:'missing',error:''};
          await this.inspect();
          if(state.phase==='error')throw new Error(state.error);
          return;
        }
        if(state?.phase==='stopped') {this.started=false;if(action==='stop')return;throw new Error('Der DNS-Hilfsdienst wurde beendet. Bitte den Schutz erneut einschalten.');}
        await delay(200);
      }
      // A late elevation/operation must not activate DNS after we report failure.
      this.writeCommand('deactivate');
      throw new Error('Windows hat nicht rechtzeitig geantwortet. Die Rücksetzung wurde angefordert; bitte Status prüfen.');
    } finally {this.busy=false;}
  }
  forget() {return this.command('forget');}
  async close() {
    if(this.last.backup && !this.started)await this.launch();
    if(this.started)await this.command('stop');
    try{fs.unlinkSync(this.commandPath);}catch{}
  }
}
module.exports={WindowsDns,launchCommand,HELPER_VERSION};
