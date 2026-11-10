// Local block page for malware and phishing domains.
// DNS points those domains to a dedicated loopback address. The HTTP server
// answers there; the HTTPS server only runs after the user installed the
// Leise DNS root certificate and only presents certificates for domains that
// are currently blocked as malware or phishing.
const http=require('node:http');
const https=require('node:https');
const tls=require('node:tls');
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {LocalCA}=require('./local-ca');
const run=promisify(execFile);
const DEFAULT_ADDRESS='127.53.0.1';

// What to do when 80 or 443 is already taken. The summary is the status line;
// the steps are shown as a list in the settings.
function portConflict(port, code) {
  const kind = Number(port) === 443 ? 'https' : 'http';
  const shown = code ? ` (${code})` : '';
  return {
    port: Number(port), code: code || '',
    summary: `Port ${port} ist belegt${shown}. Die ${kind}-Sperrseite läuft nicht. Gefährliche Seiten werden trotzdem blockiert, nur ohne diese Hinweisseite.`,
    steps: [
      `Finde das Programm: Windows-Taste drücken, „resmon“ eingeben, oder eine Eingabeaufforderung als Administrator öffnen und netstat -abn ausführen. Suche nach :${port}.`,
      'Häufig sind das IIS (World Wide Web Publishing), Skype, ein lokaler Webserver oder eine andere Sicherheitssoftware. Beende das Programm oder stell seinen Port um.',
      'Starte Leise DNS danach neu. Port 80 und Port 443 sind unabhängig: fällt nur einer aus, kann der andere die Hinweisseite weiter anzeigen.'
    ]
  };
}

// Current user's "Trusted Root" store. Adding and removing shows a Windows confirmation.
function windowsCertStore() {
  const certutil=path.join(process.env.SystemRoot || 'C:\\Windows','System32','certutil.exe');
  const opts=timeout=>({windowsHide:true,timeout});
  return {
    async has(thumbprint){try{await run(certutil,['-user','-store','Root',thumbprint],opts(20000));return true;}catch{return false;}},
    async add(file){await run(certutil,['-user','-addstore','Root',file],opts(300000));},
    async remove(thumbprint){await run(certutil,['-user','-delstore','Root',thumbprint],opts(300000));}
  };
}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The page follows the language chosen in the app (German by default).
const PAGE={
  de:{
    phishing:['Phishing','Diese Adresse steht auf einer Liste bekannter Phishing-Seiten. Solche Seiten geben sich zum Beispiel als Bank, Paketdienst oder Online-Shop aus, um Passwörter, Codes oder Zahlungsdaten abzugreifen.'],
    malware:['Malware','Diese Adresse steht auf einer Liste von Seiten, die Schadsoftware verbreiten. Schon das Öffnen oder ein Download kann deinen PC mit Viren, Erpressungs- oder Spionagesoftware infizieren.'],
    preview:'Vorschau · ',kicker:'Leise DNS hat diese Seite gesperrt',heading:'Diese Seite wurde gesperrt',reason:'Grund',
    source:list=>`Quelle: Filterliste „${list}“`,matched:entry=>` · Eintrag „${entry}“ gilt auch für Unterdomains`,
    whyTitle:'Warum siehst du diese Seite?',
    why:'Leise DNS schützt diesen PC, indem es jede Adresse prüft, bevor dein Browser eine Verbindung aufbaut. Diese Adresse ist als gefährlich bekannt. Deshalb hat Leise DNS die Anfrage zu dieser Hinweisseite auf deinem eigenen PC umgeleitet. Die eigentliche Seite wurde nicht geladen und hat keine Daten von dir erhalten.',
    nextTitle:'Was du jetzt tun kannst',
    next:['Schließe diesen Tab oder gehe zurück. Gib auf keinen Fall Passwörter oder Zahlungsdaten ein, falls du über einen Link hierher gekommen bist.',
      'Kam der Link per E-Mail oder Nachricht, war er vermutlich gefälscht. Rufe die echte Seite lieber direkt über die Adresszeile oder ein Lesezeichen auf.',
      'Hältst du die Sperre für einen Fehler? Öffne Leise DNS → <b>Anfragen</b> und wähle bei dieser Domain <b>Erlauben</b>. Aus Sicherheitsgründen lässt sich die Sperre nicht hier auf der Seite aufheben.'],
    notBlocked:'Diese Adresse ist nicht gesperrt',
    notBlockedText:domain=>`„${domain}“ wird von Leise DNS nicht (mehr) als gefährlich eingestuft. Lade die Seite in etwa einer Minute neu.`,
    local:'Dies ist die lokale Hinweisseite von Leise DNS auf diesem PC.',
    blocked:'Gesperrt',
    footer:'Leise DNS · Lokaler DNS-Schutz nur auf diesem PC. Diese Seite stammt von deinem eigenen Computer, nicht aus dem Internet.'
  },
  en:{
    phishing:['Phishing','This address is on a list of known phishing sites. Such sites pose as a bank, a parcel service or an online shop, for example, to steal passwords, codes or payment details.'],
    malware:['Malware','This address is on a list of sites that spread malicious software. Just opening it or downloading something can infect your PC with viruses, ransomware or spyware.'],
    preview:'Preview · ',kicker:'Leise DNS blocked this site',heading:'This site was blocked',reason:'Reason',
    source:list=>`Source: filter list “${list}”`,matched:entry=>` · the entry “${entry}” also covers subdomains`,
    whyTitle:'Why are you seeing this page?',
    why:'Leise DNS protects this PC by checking every address before your browser connects. This address is known to be dangerous, so Leise DNS redirected the request to this notice page on your own PC. The actual site was not loaded and has not received any data from you.',
    nextTitle:'What you can do now',
    next:['Close this tab or go back. Do not enter any passwords or payment details if a link brought you here.',
      'If the link came by email or message, it was probably fake. Open the real site directly from the address bar or a bookmark instead.',
      'Think the block is a mistake? Open Leise DNS → <b>Queries</b> and choose <b>Allow</b> for this domain. For safety reasons the block cannot be lifted from this page.'],
    notBlocked:'This address is not blocked',
    notBlockedText:domain=>`Leise DNS does not (or no longer) consider “${domain}” dangerous. Reload the page in about a minute.`,
    local:'This is the local Leise DNS notice page on this PC.',
    blocked:'Blocked',
    footer:'Leise DNS · Local DNS protection on this PC only. This page comes from your own computer, not from the internet.'
  }
};

function renderPage({domain,threat,preview=false,lang='de'}) {
  const L=PAGE[lang==='en'?'en':'de'];
  const [title,detail]=threat?L[threat.category]:['',''];
  const shield='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19 6v5.6c0 4.5-3 7.8-7 9.2-4-1.4-7-4.7-7-9.2V6z"/><path d="M12 8.3v4.4M12 15.7v.02"/></svg>';
  const body=threat?`
    <div class="symbol">${shield}</div>
    <p class="kicker">${preview?L.preview:''}${L.kicker}</p>
    <h1>${L.heading}</h1>
    <p class="domain">${esc(domain)}</p>
    <section class="reason"><span class="tag">${L.reason}: ${title}</span><p>${detail}</p><p class="source">${L.source(esc(threat.list))}${threat.matched!==domain?L.matched(esc(threat.matched)):''}</p></section>
    <h2>${L.whyTitle}</h2>
    <p>${L.why}</p>
    <h2>${L.nextTitle}</h2>
    <ul>${L.next.map(item=>`<li>${item}</li>`).join('\n    ')}</ul>`:`
    <div class="symbol neutral">${shield}</div>
    <p class="kicker">Leise DNS</p>
    <h1>${L.notBlocked}</h1>
    <p>${domain?L.notBlockedText(esc(domain)):L.local}</p>`;
  return `<!doctype html><html lang="${lang==='en'?'en':'de'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${threat?L.blocked:'Leise DNS'} · Leise DNS</title><style>
:root{color-scheme:dark;--red:#f0918f;--text:#f2f5f9;--text2:rgba(226,233,242,.76);--text3:rgba(214,223,234,.6)}
*{box-sizing:border-box}html{min-height:100%;background:#0f141d}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px;color:var(--text);font:15px/1.6 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;
background:radial-gradient(60vw 50vh at 10% 0%,rgba(78,116,190,.4),transparent 70%),radial-gradient(50vw 60vh at 100% 30%,rgba(32,122,132,.32),transparent 70%),radial-gradient(40vw 40vh at 50% 20%,rgba(242,118,118,.22),transparent 70%),linear-gradient(162deg,#111722,#0f141d 46%,#0a0d13)}
main{position:relative;width:min(680px,100%);padding:40px 44px 36px;border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.02) 40%),rgba(32,40,56,.62);backdrop-filter:blur(28px) saturate(170%);
box-shadow:inset 0 1px .5px rgba(255,255,255,.16),inset 0 0 0 .5px rgba(255,255,255,.08),0 0 0 .5px rgba(0,0,0,.5),0 30px 80px -30px rgba(0,0,0,.75)}
.symbol{display:grid;place-items:center;width:64px;height:64px;border-radius:20px;margin-bottom:20px;color:#fff;background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.06) 50%,rgba(255,255,255,0) 51%),linear-gradient(160deg,#f4a3a1,#c2505a);box-shadow:inset 0 1px .5px rgba(255,255,255,.6),0 10px 26px -10px rgba(210,90,95,.7)}
.symbol.neutral{background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.06) 50%,rgba(255,255,255,0) 51%),linear-gradient(160deg,#7e8ba0,#4c5668);box-shadow:inset 0 1px .5px rgba(255,255,255,.6)}
.symbol svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.kicker{margin:0;font-size:13px;font-weight:600;color:var(--red)}
h1{margin:4px 0 0;font:650 30px/1.2 "Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;letter-spacing:-.02em}
.domain{margin:10px 0 0;font:600 17px/1.4 "Cascadia Mono",Consolas,monospace;color:var(--text);overflow-wrap:anywhere}
.reason{margin:24px 0 8px;padding:16px 18px;border-radius:16px;background:linear-gradient(0deg,rgba(240,145,143,.1),rgba(240,145,143,.1)),rgba(28,20,24,.6);box-shadow:inset 0 0 0 .5px rgba(240,145,143,.4)}
.reason p{margin:8px 0 0;color:#ffd9d7}.reason .source{font-size:13px;color:var(--text3)}
.tag{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;color:#fff;background:rgba(240,145,143,.28)}
h2{margin:26px 0 4px;font:600 17px/1.3 "Segoe UI Variable Display","Segoe UI",system-ui,sans-serif}
p,li{color:var(--text2)}ul{margin:6px 0 0;padding-left:20px}li{margin:6px 0}b{color:var(--text)}
footer{margin-top:28px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font-size:13px;color:var(--text3)}
@media(max-width:520px){main{padding:28px 22px}h1{font-size:25px}}
</style></head><body><main>${body}<footer>${L.footer}</footer></main></body></html>`;
}

class BlockPage {
  constructor({store,dataPath,address=DEFAULT_ADDRESS,ports={http:80,https:443},protect=null,unprotect=null,certStore=windowsCertStore()}) {
    Object.assign(this,{store,address,ports,protect,unprotect,certStore});
    this.file=dataPath?path.join(dataPath,'blockpage-ca.json'):null;
    this.ca=null;this.httpServer=null;this.tlsServer=null;this.contexts=new Map();
    this.error='';this.httpsError='';this.installed=false;this.busy=false;this.conflict=null;this.httpsConflict=null;
  }
  available() {return this.httpServer?this.address:null;}
  status() {
    return {running:!!this.httpServer,address:this.address,error:this.error,conflict:this.conflict,
      https:{enabled:!!this.tlsServer,installed:this.installed,busy:this.busy,error:this.httpsError,expires:this.ca?.expires || null,conflict:this.httpsConflict}};
  }
  handle(req,res) {
    const url=new URL(req.url || '/','http://leise.invalid');
    const host=String(req.socket.servername || req.headers.host || '').toLowerCase().replace(/:\d+$/,'').replace(/\.$/,'').slice(0,253);
    let threat=null,domain=host,preview=false;
    if(host===this.address && url.pathname==='/__leise/vorschau') {
      // Fixed example for the preview button in the app; never reflects request data.
      preview=true;domain='konto-bestaetigen.beispiel.invalid';
      threat={category:url.searchParams.get('kategorie')==='malware'?'malware':'phishing',list:url.searchParams.get('kategorie')==='malware'?'URLhaus':'Phishing Army',matched:domain};
    } else if(host!==this.address && /^[a-z0-9.-]+$/.test(host)) threat=this.store.threat(host);
    if(!threat && host===this.address)domain='';
    if(!/^[a-z0-9.-]*$/.test(domain))domain='';
    let lang='de';try{lang=this.store.get?.('lang','de')==='en'?'en':'de';}catch{/* German */}
    const html=renderPage({domain,threat,preview,lang});
    res.writeHead(threat && !preview?403:200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:html);
  }
  harden(server) {server.headersTimeout=10000;server.requestTimeout=10000;server.keepAliveTimeout=5000;server.maxConnections=64;server.maxHeadersCount=50;return server;}
  listen(server,port) {
    return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,this.address,()=>{server.removeListener('error',reject);resolve();});});
  }
  async start() {
    try {
      const server=this.harden(http.createServer((req,res)=>this.handle(req,res)));
      await this.listen(server,this.ports.http);
      server.on('error',()=>{});this.httpServer=server;this.error='';this.conflict=null;
    } catch(e) {
      const taken=e.code==='EADDRINUSE'||e.code==='EACCES';
      this.conflict=taken?portConflict(this.ports.http,e.code):null;
      this.error=this.conflict?this.conflict.summary:`Die Sperrseite konnte nicht starten (${e.code || e.message}). Gefährliche Seiten werden trotzdem blockiert, nur ohne Hinweisseite.`;
    }
    await this.loadCa().catch(e=>{this.httpsError=e.message;});
  }
  async loadCa() {
    if(!this.file || !fs.existsSync(this.file) || !this.unprotect)return;
    const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
    this.ca=LocalCA.load({cert:saved.cert,key:this.unprotect(Buffer.from(saved.key,'base64'))});
    this.installed=await this.certStore.has(this.ca.thumbprint);
    if(this.installed && this.ca.expires>Date.now())await this.startTls();
    else if(!this.installed)this.httpsError='Das Zertifikat ist nicht mehr installiert. Schalte die Option aus und wieder ein.';
    else this.httpsError='Das Zertifikat ist abgelaufen. Schalte die Option aus und wieder ein.';
  }
  context(name) {
    let entry=this.contexts.get(name);
    if(!entry || entry.until<Date.now()) {
      if(this.contexts.size>500)this.contexts.clear();
      entry={until:Date.now()+86400000,context:tls.createSecureContext(this.ca.issue(name))};this.contexts.set(name,entry);
    }
    return entry.context;
  }
  async startTls() {
    if(this.tlsServer || !this.ca)return;
    const server=this.harden(https.createServer({minVersion:'TLSv1.2',SNICallback:(servername,cb)=>{
      const name=String(servername || '').toLowerCase();
      // Certificates only for host names that are blocked as malware/phishing right now.
      if(!/^[a-z0-9.-]{1,253}$/.test(name) || !this.store.threat(name))return cb(new Error('Keine Sperrseite für diesen Namen.'));
      try{cb(null,this.context(name));}catch(e){cb(e);}
    }},(req,res)=>this.handle(req,res)));
    server.on('tlsClientError',()=>{});
    try{await this.listen(server,this.ports.https);server.on('error',()=>{});this.tlsServer=server;this.httpsError='';this.httpsConflict=null;}
    catch(e){
      const taken=e.code==='EADDRINUSE'||e.code==='EACCES';
      this.httpsConflict=taken?portConflict(this.ports.https,e.code):null;
      this.httpsError=this.httpsConflict?this.httpsConflict.summary:`Port ${this.ports.https} ist belegt (${e.code || e.message}).`;
    }
  }
  async enableHttps() {
    if(this.busy)throw new Error('Bitte kurz warten.');
    if(!this.protect || !this.file)throw new Error('Auf diesem System ist keine sichere Ablage für den Schlüssel verfügbar.');
    this.busy=true;
    try {
      if(this.ca && this.installed){await this.startTls();return;}
      const ca=LocalCA.create();
      const cer=path.join(path.dirname(this.file),'Leise-DNS-Sperrseite.cer');
      fs.writeFileSync(cer,ca.der);
      try{await this.certStore.add(cer);}catch{/* cancelled; checked below */}
      finally{fs.rmSync(cer,{force:true});}
      if(!(await this.certStore.has(ca.thumbprint)))throw new Error('Das Zertifikat wurde nicht installiert. Die Windows-Abfrage wurde vermutlich abgebrochen.');
      const saved=ca.export();
      fs.writeFileSync(this.file,JSON.stringify({cert:saved.cert,key:this.protect(saved.key).toString('base64')}));
      this.ca=ca;this.installed=true;this.contexts.clear();
      await this.startTls();
    } catch(e) {this.httpsError=e.message;throw e;}
    finally {this.busy=false;}
  }
  async disableHttps() {
    if(this.busy)throw new Error('Bitte kurz warten.');
    this.busy=true;
    try {
      if(this.ca && await this.certStore.has(this.ca.thumbprint)) {
        try{await this.certStore.remove(this.ca.thumbprint);}catch{/* cancelled; checked below */}
        if(await this.certStore.has(this.ca.thumbprint))throw new Error('Das Zertifikat ist noch installiert. Die Windows-Abfrage zum Entfernen wurde vermutlich abgebrochen.');
      }
      await new Promise(r=>this.tlsServer?this.tlsServer.close(()=>r()):r());
      this.tlsServer=null;this.ca=null;this.installed=false;this.httpsError='';this.contexts.clear();
      if(this.file)fs.rmSync(this.file,{force:true});
    } catch(e) {this.httpsError=e.message;throw e;}
    finally {this.busy=false;}
  }
  async stop() {
    for(const key of ['httpServer','tlsServer']) {const s=this[key];this[key]=null;if(s){s.closeAllConnections?.();await new Promise(r=>s.close(()=>r()));}}
  }
}
module.exports={BlockPage,renderPage,DEFAULT_ADDRESS,portConflict};
