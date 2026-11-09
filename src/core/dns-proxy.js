const dgram = require('node:dgram');
const net = require('node:net');
const { randomInt } = require('node:crypto');
const { EventEmitter } = require('node:events');
const packet = require('dns-packet');
const { matches } = require('./domains');
const { DnsCache } = require('./dns-cache');
const UPSTREAMS = { cloudflare: '1.1.1.1', google: '8.8.8.8', quad9: '9.9.9.9' };

function reply(query, rcode) {
  return packet.encode({type:'response',id:query.id,flags:(query.flags & packet.RECURSION_DESIRED) | packet.RECURSION_AVAILABLE | rcode,questions:query.questions,answers:[]});
}
// Answer for malware/phishing: A record pointing to the local block page; other types stay empty
// (NOERROR without data), so browsers fall back to IPv4. A short TTL keeps exceptions quick.
function blockPageReply(query, address) {
  const q = query.questions[0];
  const answers = q.type === 'A' ? [{ type: 'A', class: 'IN', name: q.name, ttl: 60, data: address }] : [];
  return packet.encode({type:'response',id:query.id,flags:(query.flags & packet.RECURSION_DESIRED) | packet.RECURSION_AVAILABLE,questions:query.questions,answers});
}
function forward(raw, server, tcp = false, port = 53, timeout = 4000) {
  return new Promise((resolve,reject) => {
    const id=randomInt(65536); const outgoing=Buffer.from(raw); outgoing.writeUInt16BE(id,0);
    let socket, timer, done=false;
    const finish=(err,data)=> { if(done)return; done=true; clearTimeout(timer); if(tcp)socket.destroy(); else socket.close(); err?reject(err):resolve(data); };
    const accept=data=> {
      try {
        const decoded=packet.decode(data); const sent=packet.decode(outgoing);
        if(decoded.id!==id || decoded.type!=='response' || decoded.questions.length!==sent.questions.length || decoded.questions.some((q,i)=>q.name.toLowerCase()!==sent.questions[i].name.toLowerCase() || q.type!==sent.questions[i].type || q.class!==sent.questions[i].class)) return;
        const result=Buffer.from(data); result.writeUInt16BE(raw.readUInt16BE(0),0); finish(null,result);
      } catch { /* Ignore malformed or unrelated upstream responses. */ }
    };
    timer=setTimeout(()=>finish(new Error('Der DNS-Anbieter antwortet nicht.')),timeout);
    if(tcp) {
      socket=net.createConnection({host:server,port}); let buffer=Buffer.alloc(0);
      socket.on('connect',()=>{const header=Buffer.alloc(2);header.writeUInt16BE(outgoing.length);socket.write(Buffer.concat([header,outgoing]));});
      socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>=2 && buffer.length>=buffer.readUInt16BE(0)+2)accept(buffer.subarray(2,buffer.readUInt16BE(0)+2));});
      socket.on('end',()=>finish(new Error('DNS-Verbindung vorzeitig geschlossen.')));
    } else {
      socket=dgram.createSocket(net.isIP(server)===6?'udp6':'udp4'); socket.on('message',(data,remote)=>{if(remote.address===server && remote.port===port)accept(data);});
      socket.send(outgoing,port,server,err=>{if(err)finish(err);});
    }
    socket.on('error',err=>finish(err));
  });
}

class DnsProxy extends EventEmitter {
  constructor({store,port=53,hosts=['127.0.0.1','::1'],upstreamPort=53,timeout=4000,cache}={}) {
    super(); Object.assign(this,{store,port,hosts,upstreamPort,timeout}); this.servers=[];this.connections=new Set();this.inflight=0;this.running=false;
    this.cache=new DnsCache(cache);
    this.active=()=>true;this.blockPage=()=>null;this.upstream=()=>UPSTREAMS[this.store.get('upstream','cloudflare')] || UPSTREAMS.cloudflare;
    this.splitDns=()=>[];
  }
  // VPN split DNS: names under a VPN adapter's DNS suffix go to that VPN's own DNS server,
  // everything else to the chosen provider. The longest matching suffix wins.
  serverFor(domain) {
    const route=this.splitDns().filter(r=>domain===r.suffix || domain.endsWith('.'+r.suffix)).sort((a,b)=>b.suffix.length-a.suffix.length)[0];
    return route?.servers[0] || this.upstream();
  }
  async handle(raw,tcp=false) {
    let query; const started=Date.now();
    try {query=packet.decode(raw);}catch{return null;}
    if(query.type!=='query')return null;
    if(query.questions.length!==1 || (query.flags & 0x7800))return reply(query,4);
    if(this.inflight>=256)return reply(query,2);
    this.inflight++;
    const q=query.questions[0]; const domain=q.name.toLowerCase().replace(/\.$/,'');let status='allowed',reason='Erlaubt';
    try {
      let result; const block=this.active() ? this.store.reason(domain) : null;
      if(block) {
        status='blocked';reason=block;
        const page=this.store.threat?.(domain) ? this.blockPage() : null;
        result=page?blockPageReply(query,page):reply(query,3);
      }
      else {
        const server=this.serverFor(domain);
        const key=this.cache.key(q,server);
        const hit=this.cache.get(key);
        if(hit) result=this.cache.withId(hit,query.id);
        else {
          result=await forward(raw,server,tcp,this.upstreamPort,this.timeout);
          let response=packet.decode(result);
          if(response.flag_tc && !tcp) { result=await forward(raw,server,true,this.upstreamPort,this.timeout);response=packet.decode(result); }
          if(this.active() && !matches(this.store.white,domain) && response.answers.some(a=>a.type==='CNAME' && this.store.reason(a.data))) {
            status='blocked';reason='Weiterleitung auf gesperrte Domain';result=reply(query,3);
          } else if (['SERVFAIL','REFUSED'].includes(response.rcode)) {status='error';reason='DNS-Anbieter: '+response.rcode;}
          else if(!response.flag_tc && status==='allowed') this.cache.set(key,result,DnsCache.ttlOf(response));
        }
        // A large TCP fallback must not be sent as an oversized UDP response.
        const size=Math.min(4096,Math.max(512,query.additionals.find(a=>a.type==='OPT')?.udpPayloadSize || 512));
        if(!tcp && result.length>size) result=packet.encode({type:'response',id:query.id,flags:packet.TRUNCATED_RESPONSE | packet.RECURSION_AVAILABLE | (query.flags & packet.RECURSION_DESIRED),questions:query.questions});
      }
      return result;
    } catch(e) {status='error';reason=e.message;return reply(query,2);}
    finally {
      this.inflight--;
      try {const entry=this.store.log({domain,type:q.type,status,reason,ms:Date.now()-started});this.emit('query',entry);}catch(e){this.emit('fault',e);}
    }
  }
  async start() {
    if(this.running)return;
    try {
      for(const host of this.hosts) {
        const udp=dgram.createSocket(host.includes(':')?'udp6':'udp4'); this.servers.push({kind:'udp',server:udp});
        udp.on('message',(raw,remote)=>{this.handle(raw).then(response=>{if(response && this.running)udp.send(response,remote.port,remote.address,()=>{});}).catch(e=>this.emit('fault',e));});
        await new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(this.port,host,()=>{udp.removeListener('error',reject);resolve();});});
        udp.on('error',e=>this.emit('fault',e));
        const tcp=net.createServer(socket=>{
          if(this.connections.size>=64){socket.destroy();return;}
          this.connections.add(socket);let buffer=Buffer.alloc(0),queue=Promise.resolve(),pending=0;
          socket.setTimeout(10000,()=>socket.destroy());socket.on('error',()=>{});socket.on('close',()=>this.connections.delete(socket));
          socket.on('data',chunk=>{
            buffer=Buffer.concat([buffer,chunk]);if(buffer.length>131074){socket.destroy();return;}
            while(buffer.length>=2 && buffer.length>=buffer.readUInt16BE(0)+2) {
              const length=buffer.readUInt16BE(0);if(length<12 || ++pending>64){socket.destroy();return;}
              const raw=Buffer.from(buffer.subarray(2,length+2));buffer=buffer.subarray(length+2);
              queue=queue.then(async()=>{if(socket.destroyed)return;const response=await this.handle(raw,true);if(response && !socket.destroyed){const header=Buffer.alloc(2);header.writeUInt16BE(response.length);socket.write(Buffer.concat([header,response]));}}).catch(()=>socket.destroy()).finally(()=>pending--);
            }
          });
        });this.servers.push({kind:'tcp',server:tcp});
        await new Promise((resolve,reject)=>{tcp.once('error',reject);tcp.listen({port:this.port,host,ipv6Only:host.includes(':')},()=>{tcp.removeListener('error',reject);resolve();});});
        tcp.on('error',e=>this.emit('fault',e));
      }
      this.running=true;
    } catch(e) {await this.stop();throw new Error(`DNS-Dienst konnte Port ${this.port} nicht öffnen (${e.code || e.message}). Läuft bereits ein anderer DNS-Dienst?`);}
  }
  async stop() {
    this.running=false;for(const c of this.connections)c.destroy();
    await Promise.all(this.servers.splice(0).map(({server})=>new Promise(resolve=>{try{server.close(()=>resolve());}catch{resolve();}})));
    while(this.inflight) await new Promise(r=>setTimeout(r,20));
  }
  async probe() {
    const raw=packet.encode({type:'query',id:123,flags:packet.RECURSION_DESIRED,questions:[{name:'example.com',type:'A'}]});
    const data=await forward(raw,'127.0.0.1',false,this.port,this.timeout+1000);
    if (packet.decode(data).rcode !== 'NOERROR') throw new Error('Der Verbindungstest ist fehlgeschlagen. Bitte einen anderen DNS-Anbieter wählen.');
  }
}
module.exports={DnsProxy,UPSTREAMS,forward,DnsCache};
