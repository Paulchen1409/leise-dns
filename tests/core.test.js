const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const dgram=require('node:dgram');const net=require('node:net');
const packet=require('dns-packet');
const {Store}=require('../src/core/store');const {normalizeDomain,parseList}=require('../src/core/domains');const {Filters}=require('../src/core/filters');const {DnsProxy,forward}=require('../src/core/dns-proxy');const {Service}=require('../src/core/service');

test('Domain-Eingaben werden normalisiert; URLs und ungültige Namen abgelehnt',()=>{
  assert.equal(normalizeDomain(' BÜCHER.de. '),'xn--bcher-kva.de');
  for(const d of ['https://example.com','example.com/ads','*.example.com','127.0.0.1','a..de','-bad.de','test.de:53'])assert.throws(()=>normalizeDomain(d));
});
test('Filterparser akzeptiert nur sichere ganze Domainregeln',()=>{
  const result=parseList('# Kommentar\n0.0.0.0 ads.example.com tracker.example.com\n||ad.example.org^\nplain.example.com\n||ads.example.com^\n@@||allowed.example.com^\n||unsafe.example.com^$third-party\nexample.com##.ad\nlocalhost\n');
  assert.deepEqual(result.domains.sort(),['ad.example.org','ads.example.com','plain.example.com','tracker.example.com']);assert.equal(result.skipped,4);
  assert.throws(()=>parseList('<!DOCTYPE html><html>'),/Webseite/);
});
test('Whitelist hat Vorrang, Domains matchen nur an Labelgrenzen; Daten bleiben gespeichert',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-test-'));const file=path.join(dir,'db.sqlite');let store=new Store(file);
  try{
    store.replaceList('stevenblack',['ads.example.com'],2);store.addRule('black','manual.example.com');
    assert.equal(store.reason('sub.ads.example.com'),'Filterliste');assert.equal(store.reason('badads.example.com'),null);
    store.addRule('white','example.com');assert.equal(store.reason('manual.example.com'),null);
    store.removeRule('white','example.com');assert.equal(store.reason('manual.example.com'),'Eigene Sperrliste');
    store.addRule('white','manual.example.com');assert.deepEqual(store.rules('black'),[]);
    store.log({domain:'ads.example.com',status:'blocked',type:'A'});store.log({domain:'good.example.com',status:'allowed',type:'AAAA'});
    assert.equal(store.stats().rate,50);assert.equal(store.queries({status:'blocked'})[0].domain,'ads.example.com');assert.equal(store.queries({search:'%'}).length,0);
    store.close();store=new Store(file);assert.equal(store.reason('ads.example.com'),'Filterliste');assert.equal(store.stats().total,2);assert.equal(store.stats().top[0].count,1);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Fehlgeschlagene Listenupdates erhalten die letzte funktionierende Version',async()=>{
  const store=new Store(':memory:');const filters=new Filters(store);const original=global.fetch;
  try {
    store.replaceList('stevenblack',['ads.example.com'],0);
    global.fetch=async()=>({ok:true,url:'https://example.com',body:(async function*(){yield Buffer.from('<html>error</html>');})()});
    await assert.rejects(filters.update('stevenblack'));assert.equal(store.reason('ads.example.com'),'Filterliste');assert.ok(store.lists().find(l=>l.id==='stevenblack').error);assert.equal(filters.busy.size,0);
    global.fetch=async()=>({ok:true,url:'https://example.com',body:(async function*(){yield Buffer.from('new.example.com\n');})()});
    await filters.update('stevenblack');assert.equal(store.reason('new.example.com'),'Filterliste');assert.equal(store.reason('ads.example.com'),null);
    filters.toggle('stevenblack',false);assert.equal(store.reason('new.example.com'),null);
    assert.throws(()=>filters.add('test','http://example.com'),/HTTPS/);
  }finally{global.fetch=original;store.close();}
});
async function mockUpstream() {
  const udp=dgram.createSocket('udp4');await new Promise(r=>udp.bind(0,'127.0.0.1',r));const port=udp.address().port;let calls=0;
  function response(raw,tcp){calls++;const q=packet.decode(raw);const name=q.questions[0].name;
    if(name==='timeout.example.com')return null;
    const answers=name==='alias.example.com'?[{name,type:'CNAME',ttl:30,data:'ads.example.com'}]:[{name,type:'A',ttl:30,data:'203.0.113.10'}];
    return packet.encode({type:'response',id:q.id,flags:packet.RECURSION_AVAILABLE|((name==='truncated.example.com' && !tcp)?packet.TRUNCATED_RESPONSE:0),questions:q.questions,answers: name==='truncated.example.com' && !tcp?[]:answers});
  }
  udp.on('message',(raw,r)=>{const data=response(raw,false);if(data)udp.send(data,r.port,r.address);});
  const sockets=new Set();const tcp=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));let b=Buffer.alloc(0);s.on('error',()=>{});s.on('data',c=>{b=Buffer.concat([b,c]);if(b.length>=2 && b.length>=b.readUInt16BE(0)+2){const out=response(b.subarray(2,b.readUInt16BE(0)+2),true);if(out){const h=Buffer.alloc(2);h.writeUInt16BE(out.length);s.end(Buffer.concat([h,out]));}}});});
  await new Promise(r=>tcp.listen(port,'127.0.0.1',r));return {port,get calls(){return calls;},async close(){for(const s of sockets)s.destroy();await Promise.all([new Promise(r=>udp.close(r)),new Promise(r=>tcp.close(r))]);}};
}
test('Autoupdate: täglich fällig, holt Verpasstes nach, wartet nach Fehlern und schützt vor kaputten Listen',async()=>{
  const store=new Store(':memory:');const filters=new Filters(store);const original=global.fetch;
  const serve=text=>{global.fetch=async url=>{fetched.push(url);return {ok:true,url:'https://example.com',body:(async function*(){yield Buffer.from(text);})()};};};
  let fetched=[];
  const updated=(id,t)=>store.db.prepare('UPDATE lists SET updated=? WHERE id=?').run(t,id);
  const now=Date.now();
  try {
    // Only enabled lists; easylist/easyprivacy are off by default.
    assert.deepEqual(filters.due(now).map(l=>l.id).sort(),['phishingarmy','stevenblack','urlhaus']);
    updated('stevenblack',now-3600000);updated('urlhaus',now-21*86400000);updated('phishingarmy',now-86400000);
    assert.deepEqual(filters.due(now).map(l=>l.id).sort(),['phishingarmy','urlhaus']);
    filters.toggle('urlhaus',false);filters.toggle('phishingarmy',false);
    assert.deepEqual(filters.due(now),[]);
    filters.toggle('urlhaus',true);
    // Failure: reported at the list in plain words, no new attempt within the hour, one after it.
    global.fetch=async()=>{throw new TypeError('fetch failed');};
    await filters.autoUpdate();
    assert.match(store.lists().find(l=>l.id==='urlhaus').error,/nicht erreichbar/);
    assert.deepEqual(filters.due(),[]);
    assert.deepEqual(filters.due(Date.now()+3600001).map(l=>l.id),['urlhaus']);
    filters.attempts.clear();
    // Success clears the error, and the new domain counts right after the update.
    serve('neu.example.com\n');
    await filters.autoUpdate();
    assert.deepEqual(fetched.length,1);
    assert.equal(store.lists().find(l=>l.id==='urlhaus').error,null);
    assert.equal(store.reason('neu.example.com'),'Malware · URLhaus');
    assert.deepEqual(filters.due(),[]);
    // Stopping (app closes, switch off) ends the run before the next list.
    updated('stevenblack',0);updated('urlhaus',0);filters.attempts.clear();fetched=[];
    await filters.autoUpdate(()=>true);
    assert.equal(fetched.length,0);
    // A broken download must not silently remove protection; by hand it can still be applied.
    const big=Array.from({length:2000},(_,i)=>`d${i}.example.com`);
    store.replaceList('stevenblack',big,0);updated('stevenblack',0);
    serve('nur.example.com\n');
    await filters.update('stevenblack',{guarded:true}).then(()=>assert.fail('muss abgelehnt werden'),e=>assert.match(e.message,/ungewöhnlich klein/));
    assert.equal(store.reason('d5.example.com'),'Filterliste');
    assert.equal(store.lists().find(l=>l.id==='stevenblack').count,2000);
    await filters.update('stevenblack');
    assert.equal(store.lists().find(l=>l.id==='stevenblack').count,1);
    assert.equal(store.reason('d5.example.com'),null);
  }finally{global.fetch=original;store.close();}
});
test('Bestehende Installationen übernehmen eine geänderte Adresse einer vordefinierten Liste',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-preset-'));const file=path.join(dir,'x.sqlite');
  const old='https://urlhaus.abuse.ch/downloads/hostfile/';
  const urlhaus=s=>s.lists().find(l=>l.id==='urlhaus');
  let store=new Store(file);
  try {
    const current=urlhaus(store).url;assert.notEqual(current,old);
    // State of an older version: old address, downloaded domains, switched off by the user.
    store.db.prepare('UPDATE lists SET url=?,enabled=0 WHERE id=?').run(old,'urlhaus');
    store.writeList('urlhaus',['bleibt.example.com'],0);store.close();
    store=new Store(file);
    assert.equal(urlhaus(store).url,current);assert.equal(urlhaus(store).count,1);assert.equal(urlhaus(store).enabled,0);
    // A custom list already using the new address must not stop the app from starting.
    store.db.prepare('UPDATE lists SET url=? WHERE id=?').run(old,'urlhaus');
    store.db.prepare('INSERT INTO lists(id,name,url,enabled,preset) VALUES(?,?,?,1,0)').run('eigen','Eigene',current);store.close();
    store=new Store(file);
    assert.equal(urlhaus(store).url,old);assert.equal(store.lists().find(l=>l.id==='eigen').url,current);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Listen-Update schreibt nur Änderungen und liefert dasselbe Ergebnis wie ein volles Neuladen',async()=>{
  const store=new Store(':memory:');
  try {
    assert.equal(store.writeList('stevenblack',['a.example.com','b.example.com'],0),true);
    assert.equal(store.writeList('stevenblack',['b.example.com','a.example.com'],3),false);
    assert.equal(store.lists().find(l=>l.id==='stevenblack').skipped,3);
    assert.equal(store.writeList('stevenblack',['b.example.com','c.example.com'],0),true);
    store.writeList('phishingarmy',['both.example.com','p.example.com'],0);
    store.writeList('urlhaus',['both.example.com','m.example.com'],0);
    store.writeList('easylist',['off.example.com'],0);
    await store.reloadLists();
    const asyncResult={filtered:[...store.filtered].sort(),threats:[...store.threats.entries()].sort()};
    store.reload();
    assert.deepEqual({filtered:[...store.filtered].sort(),threats:[...store.threats.entries()].sort()},asyncResult);
    assert.equal(store.threats.get('both.example.com').category,'phishing');
    assert.equal(store.filtered.has('off.example.com'),false);assert.equal(store.filtered.has('a.example.com'),false);
    // A rule change during a slow reload wins; the older reload must not overwrite newer data.
    store.writeList('stevenblack',Array.from({length:12000},(_,i)=>`x${i}.example.com`),0);
    const pending=store.reloadLists();
    store.writeList('stevenblack',['neuer.example.com'],0);store.reload();
    await pending;
    assert.equal(store.filtered.has('neuer.example.com'),true);assert.equal(store.filtered.has('x5.example.com'),false);
  }finally{store.close();}
});
test('Split-DNS: Namen unter dem VPN-Suffix gehen an den VPN-Server, Sperren gelten weiter',async()=>{
  const upstream=await mockUpstream();const store=new Store(':memory:');store.addRule('black','ads.corp.example');
  const proxy=new DnsProxy({store,port:0,hosts:['127.0.0.1'],upstreamPort:upstream.port,timeout:100});
  // The normal provider is unreachable here, so an answer can only come through the VPN route.
  proxy.upstream=()=>'192.0.2.1';proxy.splitDns=()=>[{suffix:'corp.example',servers:['127.0.0.1']}];
  const ask=async name=>packet.decode(await proxy.handle(packet.encode({type:'query',id:9,flags:packet.RECURSION_DESIRED,questions:[{name,type:'A'}]})));
  try {
    assert.equal(proxy.serverFor('intranet.corp.example'),'127.0.0.1');
    assert.equal(proxy.serverFor('corp.example'),'127.0.0.1');
    assert.equal(proxy.serverFor('notcorp.example'),'192.0.2.1');
    assert.equal((await ask('intranet.corp.example')).answers[0].data,'203.0.113.10');
    assert.equal(upstream.calls,1);
    assert.equal((await ask('ads.corp.example')).rcode,'NXDOMAIN');assert.equal(upstream.calls,1);
    assert.equal((await ask('example.org')).rcode,'SERVFAIL');assert.equal(upstream.calls,1);
    // The longest suffix wins.
    proxy.splitDns=()=>[{suffix:'example',servers:['192.0.2.2']},{suffix:'corp.example',servers:['192.0.2.3']}];
    assert.equal(proxy.serverFor('a.corp.example'),'192.0.2.3');
    assert.equal(proxy.serverFor('b.example'),'192.0.2.2');
  }finally{await upstream.close();store.close();}
});
test('Statistik: Stunden ohne Aufzeichnung sind keine Nullen',()=>{
  const store=new Store(':memory:');
  try {
    const now=Date.now();const hour=Math.floor(now/3600000)*3600000;
    const earlier=hour-2*3600000;
    store.log({time:earlier,domain:'a.example',type:'A',status:'blocked'});store.log({time:now,domain:'b.example',type:'A',status:'allowed'});
    const history=store.stats(7).history;
    const at=t=>history.find(r=>r.time===t);
    assert.equal(at(earlier).blocked,1);assert.ok(!at(earlier).noData);
    assert.equal(at(hour-3600000).noData,true);assert.equal(at(hour).noData,undefined);
    const {chartGroups,gapRanges}=require('../src/renderer/ui.js');
    const row=(noData,blocked=0)=>({time:0,total:blocked,blocked,errors:0,...(noData?{noData:true}:{})});
    // A group with one recorded hour counts as data, also when its value is a real zero.
    const groups=chartGroups([row(true),row(true),row(false,2),row(true),row(true),row(true),row(false,0)],3);
    assert.deepEqual(groups.map(g=>[g.noData,g.blocked]),[[false,2],[true,0],[false,0]]);
    assert.deepEqual(gapRanges(chartGroups([row(true),row(false),row(true),row(true),row(false)])),[[0,0],[2,3]]);
    assert.deepEqual(gapRanges(chartGroups([row(false)])),[]);
  }finally{store.close();}
});
test('DNS: UDP/TCP, Sperren, CNAME, Pausen, TCP-Fallback und SERVFAIL',async()=>{
  const upstream=await mockUpstream();const store=new Store(':memory:');store.addRule('black','ads.example.com');
  const proxy=new DnsProxy({store,port:0,hosts:['127.0.0.1'],upstreamPort:upstream.port,timeout:100});proxy.upstream=()=> '127.0.0.1';
  // Port zero assigns separate local UDP/TCP ports; production binds both to 53.
  await proxy.start();const udpPort=proxy.servers[0].server.address().port,tcpPort=proxy.servers[1].server.address().port;
  const query=async(name,tcp=false)=>packet.decode(await forward(packet.encode({type:'query',id:345,flags:packet.RECURSION_DESIRED,questions:[{name,type:'A'}]}),'127.0.0.1',tcp,tcp?tcpPort:udpPort,1000));
  try{
    let answer=await query('ads.example.com');assert.equal(answer.rcode,'NXDOMAIN');assert.equal(answer.id,345);assert.equal(upstream.calls,0);
    answer=await query('allowed.example.com');assert.equal(answer.answers[0].data,'203.0.113.10');
    answer=await query('allowed.example.com',true);assert.equal(answer.rcode,'NOERROR');
    assert.equal((await query('alias.example.com')).rcode,'NXDOMAIN');
    store.addRule('white','alias.example.com');assert.equal((await query('alias.example.com')).answers[0].type,'CNAME');
    assert.equal((await query('truncated.example.com')).answers[0].data,'203.0.113.10');
    assert.equal((await query('timeout.example.com')).rcode,'SERVFAIL');
    proxy.active=()=>false;assert.equal((await query('ads.example.com')).rcode,'NOERROR');
    assert.equal(await proxy.handle(Buffer.from([1,2,3])),null);
    assert.equal(packet.decode(await proxy.handle(packet.encode({type:'query',id:2,questions:[{name:'one.example.com',type:'A'},{name:'two.example.com',type:'A'}]}))).rcode,'NOTIMP');
    assert.equal(store.stats().blocked,2);assert.equal(store.stats().errors,1);assert.equal(store.stats().total,8);
  }finally{await proxy.stop();await upstream.close();store.close();}
});
test('Dienst: Aktivierung, Pause und Wiederaufnahme sichern den DNS-Lebenszyklus',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-service-'));const calls=[];
  const dns={last:{configured:false,adapters:[]},async inspect(){return this.last;},async command(action){calls.push(action);this.last.configured=action==='activate';},async close(){calls.push('stop');}};
  const service=new Service(dir,{port:0,dns});service.proxy.probe=async()=>{};
  try {await service.start({download:false});await service.setMode('active');assert.equal(service.status().active,true);await service.setMode('5');assert.equal(service.status().active,false);assert.equal(service.mode.kind,'timed');assert.ok(service.mode.until>Date.now()+290000);await service.setMode('active');await service.setMode('off');assert.deepEqual(calls,['activate','deactivate','activate','deactivate']);assert.equal(service.store.get('mode').kind,'off');}
  finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Abgelaufene Pause startet erneut; fehlgeschlagene Rücksetzung schaltet nicht still aus',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leise-timer-'));let fail=false;
  const dns={last:{configured:false,adapters:[]},async inspect(){return this.last;},async command(action){if(fail && action==='deactivate')throw new Error('Rücksetzung fehlgeschlagen');this.last.configured=action==='activate';},async close(){}};
  const service=new Service(dir,{port:0,dns});service.proxy.probe=async()=>{};
  try{
    await service.start({download:false});await service.setMode('active');fail=true;
    await assert.rejects(service.setMode('off'),/Rücksetzung/);assert.equal(service.mode.kind,'active');assert.ok(service.status().error);
    fail=false;await service.setMode('5');service.mode.until=Date.now()-1;
    await new Promise(r=>setTimeout(r,1200));assert.equal(service.mode.kind,'active');assert.equal(service.status().active,true);
    await service.setMode('restart');
  }finally{await service.close();}
  const reopened=new Service(dir,{port:0,dns});assert.equal(reopened.mode.kind,'active');assert.equal(reopened.store.get('configuredOnce'),true);await reopened.close();fs.rmSync(dir,{recursive:true,force:true});
});
