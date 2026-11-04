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
