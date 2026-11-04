const {EventEmitter}=require('node:events');
const path=require('node:path');
const fs=require('node:fs');
const {Store}=require('./store');
const {DnsProxy,UPSTREAMS}=require('./dns-proxy');
const {Filters}=require('./filters');
const {BlockPage}=require('./block-page');
const {WindowsDns}=require('../platform/windows-dns');
class Service extends EventEmitter {
  // blockPage: options for the local block page (off unless given, e.g. in tests).
  constructor(dataPath,{port=53,dns,blockPage=null}={}) {
    super();fs.mkdirSync(dataPath,{recursive:true});this.store=new Store(path.join(dataPath,'leise.sqlite'));
    this.dns=dns || new WindowsDns(dataPath,{remember:()=>this.store.get('rememberApproval',true)});this.proxy=new DnsProxy({store:this.store,port});this.error='';this.busy=false;this.closing=false;
    this.mode=this.store.get('mode',{kind:'active'});
    if(this.mode.kind==='restart' || (this.mode.kind==='timed' && this.mode.until<=Date.now()))this.mode={kind:'active'};
    this.proxy.active=()=>this.mode.kind==='active';
    this.blockPage=blockPage?new BlockPage({store:this.store,dataPath,...blockPage}):null;
    this.proxy.blockPage=()=>this.blockPage?.available() || null;
    this.proxy.on('query',entry=>this.emit('query',entry));
    this.proxy.on('fault',e=>{this.error=e.message;this.changed();});
    this.filters=new Filters(this.store,()=>this.changed());
  }
  changed() {this.emit('changed',this.status());}
  status() {
    // helper: the elevated DNS helper is running, i.e. no Windows approval prompt is pending.
    return {mode:this.mode,dns:this.dns.last,running:this.proxy.running,busy:this.busy || this.dns.busy,error:this.error,helper:this.dns.started===true,
      active:this.proxy.running && this.dns.last.configured && this.dns.started!==false && this.mode.kind==='active',
      domainCount:this.store.filtered.size,
      blockPage:this.blockPage?.status() || null,
      approval:{remember:this.store.get('rememberApproval',true),task:this.dns.task?.state || 'unknown',error:this.dns.task?.error || ''},upstream:this.store.get('upstream','cloudflare'),port:this.proxy.port};
  }
  async start({download=true}={}) {
    try{await this.proxy.start();}catch(e){this.error=e.message;}
    try{await this.dns.inspect();}catch(e){this.error=e.message;}
    await this.blockPage?.start();
    this.dns.refreshTask?.().then(()=>this.changed()).catch(()=>{});
    this.timer=setInterval(()=>{
      if(this.mode.kind==='timed' && this.mode.until<=Date.now() && !this.busy) {
        this.setMode('active').catch(e=>{this.mode={kind:'off'};this.store.set('mode',this.mode);this.error='Die Pause ist beendet, aber das Einschalten ist fehlgeschlagen: '+e.message;this.changed();});
      }
    },1000);
    this.inspector=setInterval(()=>{if(!this.busy)this.dns.inspect().then(()=>this.changed()).catch(()=>{});},15000);
    this.pruner=setInterval(()=>this.store.prune(),60000);
    this.changed();
    if(download)for(const l of this.store.lists().filter(l=>l.enabled && !l.updated))this.filters.update(l.id).catch(()=>{});
  }
  async setMode(kind) {
    if(this.busy || this.closing)throw new Error('Bitte kurz warten, die Einstellung wird gerade geändert.');
    if(!['active','5','30','restart','off'].includes(kind))throw new Error('Ungültige Pause.');
    this.busy=true;this.error='';this.changed();
    try {
      if(kind==='active') {
        if(!this.proxy.running)await this.proxy.start();
        await this.proxy.probe();await this.dns.command('activate');this.mode={kind:'active'};this.store.set('configuredOnce',true);
      } else {
        await this.dns.command('deactivate');
        this.mode=['5','30'].includes(kind)?{kind:'timed',until:Date.now()+Number(kind)*60000}:{kind};
      }
      this.store.set('mode',this.mode);
    }catch(e){this.error=e.message;throw e;}
    finally{this.busy=false;this.changed();}
  }
  async resumeSaved() {
    if(this.mode.kind==='active' && this.store.get('configuredOnce',false))await this.setMode('active');
    else if(this.dns.last.backup && this.dns.launch) {this.busy=true;this.changed();try{await this.dns.launch();await this.dns.inspect();}finally{this.busy=false;this.changed();}}
  }
  async invoke(action,args={}) {
    if(!args || typeof args!=='object')throw new Error('Ungültige Eingabe.');
    switch(action) {
      case 'snapshot':return {status:this.status(),stats:this.store.stats(args.days),lists:this.filters.list(),white:this.store.rules('white'),black:this.store.rules('black')};
      case 'mode':return this.setMode(args.kind);
      case 'queries':return this.store.queries(args);
      case 'rule:add': {const domain=this.store.addRule(args.kind,args.domain);this.changed();return domain;}
      case 'rule:remove':this.store.removeRule(args.kind,args.domain);this.changed();return;
      case 'list:add':this.filters.add(args.name,args.url);return;
      case 'list:toggle':this.filters.toggle(args.id,args.enabled);return;
      case 'list:remove':this.filters.remove(args.id);return;
      case 'list:update':return this.filters.update(args.id);
      case 'list:updateAll':return this.filters.updateAll();
      case 'upstream':if(!Object.hasOwn(UPSTREAMS,args.value))throw new Error('Unbekannter DNS-Anbieter.');this.store.set('upstream',args.value);this.changed();return;
      case 'approval:set': {
        if(typeof args.remember!=='boolean')throw new Error('Ungültige Einstellung.');
        this.store.set('rememberApproval',args.remember);
        // Switching off removes the Windows task (once DNS no longer points to the local service).
        if(!args.remember && this.dns.forget) {
          if(this.busy)throw new Error('Bitte kurz warten, die Einstellung wird gerade geändert.');
          this.busy=true;this.changed();
          try{await this.dns.forget();}finally{this.busy=false;this.changed();}
        }
        this.changed();return;
      }
      case 'blockpage:https': {
        if(!this.blockPage)throw new Error('Die Sperrseite ist nicht verfügbar.');
        if(typeof args.enabled!=='boolean')throw new Error('Ungültige Einstellung.');
        const task=args.enabled?this.blockPage.enableHttps():this.blockPage.disableHttps();
        this.changed();
        try{await task;}finally{this.changed();}
        return;
      }
      case 'dns:inspect':await this.dns.inspect();this.changed();return;
      default:throw new Error('Unbekannte Aktion.');
    }
  }
  async close() {
    this.closing=true;
    try {await this.dns.close();}catch(e){this.closing=false;throw e;}
    clearInterval(this.timer);clearInterval(this.inspector);clearInterval(this.pruner);
    await this.proxy.stop();
    await this.blockPage?.stop();
    // Pending filter downloads can still finish. SQLite is checkpointed by each committed transaction.
    if(!this.filters.busy.size)this.store.close();
  }
}
module.exports={Service};
