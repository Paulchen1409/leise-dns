const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const http=require('node:http');const https=require('node:https');const crypto=require('node:crypto');
const packet=require('dns-packet');
const {Store}=require('../src/core/store');
const {DnsProxy}=require('../src/core/dns-proxy');
const {BlockPage,portConflict}=require('../src/core/block-page');
const {LocalCA}=require('../src/core/local-ca');

function threatStore() {
  const store=new Store(':memory:');
  store.replaceList('phishingarmy',['phish.example.com'],0);
  store.replaceList('urlhaus',['malware.example.net'],0);
  store.replaceList('stevenblack',['ads.example.org'],0);
  return store;
}
// Fake "Trusted Root" store: never touches Windows.
function fakeCertStore() {
  const installed=new Set();const calls=[];
  return {installed,calls,
    async has(t){return installed.has(t);},
    async add(file){calls.push('add');const der=fs.readFileSync(file);installed.add(new crypto.X509Certificate(der).fingerprint.replace(/:/g,''));},
    async remove(t){calls.push('remove');installed.delete(t);}};
}
function get(port,host,pathName='/') {
  return new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:pathName,headers:{Host:host}},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}).on('error',reject));
}
function getTls(port,servername,ca) {
  return new Promise((resolve,reject)=>https.get({host:'127.0.0.1',port,servername,ca,headers:{Host:servername},agent:false},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,body,authorized:res.socket.authorized}));}).on('error',reject));
}

test('Malware- und Phishing-Listen haben eigene Kategorien; erlaubte Domains haben Vorrang',()=>{
  const store=threatStore();
  try {
    const lists=Object.fromEntries(store.lists().map(l=>[l.id,l]));
    assert.equal(lists.urlhaus.category,'malware');assert.equal(lists.phishingarmy.category,'phishing');assert.equal(lists.stevenblack.category,'ads');
    assert.equal(lists.urlhaus.enabled,1);assert.equal(lists.phishingarmy.enabled,1);
    assert.deepEqual(store.threat('login.phish.example.com'),{category:'phishing',list:'Phishing Army',label:'Phishing',matched:'phish.example.com'});
    assert.equal(store.reason('malware.example.net'),'Malware · URLhaus');
    assert.equal(store.threat('ads.example.org'),null);assert.equal(store.reason('ads.example.org'),'Filterliste');
    store.addRule('white','phish.example.com');assert.equal(store.threat('phish.example.com'),null);
  } finally {store.close();}
});

test('DNS: gefährliche Domains zeigen auf die Sperrseite, Werbung bleibt NXDOMAIN',async()=>{
  const store=threatStore();
  try {
    const proxy=new DnsProxy({store,port:0});let page='127.53.0.1';proxy.blockPage=()=>page;
    const ask=async(name,type='A')=>packet.decode(await proxy.handle(packet.encode({type:'query',id:7,flags:packet.RECURSION_DESIRED,questions:[{name,type}]})));
    const a=await ask('phish.example.com');
    assert.equal(a.rcode,'NOERROR');assert.deepEqual(a.answers.map(x=>[x.type,x.data,x.ttl]),[['A','127.53.0.1',60]]);
    const aaaa=await ask('malware.example.net','AAAA');assert.equal(aaaa.rcode,'NOERROR');assert.equal(aaaa.answers.length,0);
    assert.equal((await ask('ads.example.org')).rcode,'NXDOMAIN');
    page=null;assert.equal((await ask('phish.example.com')).rcode,'NXDOMAIN');
    assert.equal(store.queries({status:'blocked'})[0].reason,'Phishing · Phishing Army');
  } finally {store.close();}
});

test('Sperrseite: Grund, Liste und Erklärung; sicher gegen eingeschleuste Inhalte',async()=>{
  const store=threatStore();const page=new BlockPage({store,address:'127.0.0.1',ports:{http:0,https:0},certStore:fakeCertStore()});
  try {
    await page.start();const port=page.httpServer.address().port;
    const hit=await get(port,'www.phish.example.com');
    assert.equal(hit.status,403);assert.match(hit.body,/Diese Seite wurde gesperrt/);assert.match(hit.body,/Grund: Phishing/);
    assert.match(hit.body,/Phishing Army/);assert.match(hit.body,/Warum siehst du diese Seite/);assert.doesNotMatch(hit.body,/<script/i);
    assert.match(hit.headers['content-security-policy'],/default-src 'none'/);assert.equal(hit.headers['cache-control'],'no-store');
    const other=await get(port,'harmless.example');assert.equal(other.status,200);assert.match(other.body,/nicht gesperrt/);
    const evil=await get(port,'"><script>alert(1)</script>');assert.doesNotMatch(evil.body,/<script>alert/);
    const preview=await get(port,'127.0.0.1','/__leise/vorschau?kategorie=malware');assert.match(preview.body,/Grund: Malware/);assert.match(preview.body,/Vorschau/);
  } finally {await page.stop();store.close();}
});

test('HTTPS-Sperrseite: Zertifikat nur nach Installation und nur für gesperrte Domains',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-blockpage-'));
  const store=threatStore();const certStore=fakeCertStore();
  const protect=s=>Buffer.from('enc:'+s);const unprotect=b=>{const t=b.toString();assert.ok(t.startsWith('enc:'));return t.slice(4);};
  const options={store,dataPath:dir,address:'127.0.0.1',ports:{http:0,https:0},certStore,protect,unprotect};
  let page=new BlockPage(options),reloaded;
  try {
    await page.start();assert.equal(page.tlsServer,null);assert.equal(page.status().https.enabled,false);
    await page.enableHttps();assert.deepEqual(certStore.calls,['add']);assert.equal(page.status().https.enabled,true);
    const saved=JSON.parse(fs.readFileSync(path.join(dir,'blockpage-ca.json'),'utf8'));
    assert.ok(Buffer.from(saved.key,'base64').toString().startsWith('enc:'),'Schlüssel wird nur geschützt gespeichert');
    const port=page.tlsServer.address().port;
    const ok=await getTls(port,'login.phish.example.com',page.ca.pem);
    assert.equal(ok.authorized,true);assert.equal(ok.status,403);assert.match(ok.body,/Grund: Phishing/);
    await assert.rejects(getTls(port,'www.bank.example',page.ca.pem));
    // After a restart the encrypted CA is loaded again while it is installed.
    await page.stop();reloaded=new BlockPage(options);await reloaded.start();
    assert.equal(reloaded.status().https.enabled,true);assert.equal(reloaded.ca.thumbprint,page.ca.thumbprint);
    await reloaded.disableHttps();assert.deepEqual(certStore.calls,['add','remove']);
    assert.equal(fs.existsSync(path.join(dir,'blockpage-ca.json')),false);assert.equal(reloaded.status().https.enabled,false);
  } finally {await page.stop();await reloaded?.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Abgebrochene Windows-Abfrage installiert nichts und speichert keinen Schlüssel',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-blockpage-'));
  const store=threatStore();
  const certStore={async has(){return false;},async add(){throw new Error('cancelled');},async remove(){}};
  const page=new BlockPage({store,dataPath:dir,address:'127.0.0.1',ports:{http:0,https:0},certStore,protect:s=>Buffer.from(s),unprotect:b=>b.toString()});
  try {
    await page.start();
    await assert.rejects(page.enableHttps(),/nicht installiert/);
    assert.equal(fs.existsSync(path.join(dir,'blockpage-ca.json')),false);assert.equal(page.tlsServer,null);
    assert.equal(fs.readdirSync(dir).length,0);
  } finally {await page.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Belegter Port nennt das Programm und was zu tun ist',async()=>{
  const info=portConflict(443,'EADDRINUSE');
  assert.match(info.summary,/Port 443 ist belegt/);
  assert.match(info.steps.join('\n'),/netstat -abn/);
  assert.match(info.steps.join('\n'),/unabhängig/);
  const blocker=http.createServer();
  await new Promise(r=>blocker.listen(0,'127.0.0.1',r));
  const port=blocker.address().port;
  const store=new Store(':memory:');
  const page=new BlockPage({store,address:'127.0.0.1',ports:{http:port,https:0},certStore:{async has(){return false;},async add(){},async remove(){}}});
  try {
    await page.start();
    const status=page.status();
    assert.equal(status.running,false);
    assert.equal(status.conflict.code,'EADDRINUSE');
    assert.equal(status.conflict.steps.length,3);
    assert.match(status.error,/trotzdem blockiert/);
  } finally { await page.stop(); await new Promise(r=>blocker.close(r)); store.close(); }
});

test('Lokale Zertifizierungsstelle: CA ohne Unter-CAs, kurzlebige Zertifikate je Domain',()=>{
  const ca=LocalCA.create();const leaf=new crypto.X509Certificate(ca.issue('phish.example.com').cert);
  assert.equal(ca.x509.ca,true);assert.equal(leaf.ca,false);assert.ok(leaf.checkIssued(ca.x509));assert.ok(leaf.verify(ca.x509.publicKey));
  assert.equal(leaf.subjectAltName,'DNS:phish.example.com');assert.equal(leaf.checkHost('other.example.com'),undefined);
  assert.ok(new Date(leaf.validTo)-Date.now()<=7*86400000+1000);
  assert.throws(()=>ca.issue('evil"name'),/Ungültig/);
});
