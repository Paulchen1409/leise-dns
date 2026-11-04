const { randomUUID } = require('node:crypto');
const { parseList } = require('./domains');
const DAY=86400000, HOUR=3600000;
class Filters {
  constructor(store, changed = () => {}) { this.store=store; this.changed=changed; this.busy=new Set(); this.attempts=new Map(); this.auto=false; }
  list() { return this.store.lists().map(l=>({...l,busy:this.busy.has(l.id)})); }
  add(name, url) {
    name=String(name).trim().slice(0,80); const u=new URL(url);
    if (!name || u.protocol !== 'https:' || u.username || u.password) throw new Error('Bitte einen Namen und eine HTTPS-Adresse ohne Zugangsdaten angeben.');
    if (this.store.lists().some(l=>l.url === u.href)) throw new Error('Diese Filterliste ist bereits vorhanden.');
    this.store.db.prepare('INSERT INTO lists(id,name,url,enabled,preset) VALUES(?,?,?,1,0)').run(randomUUID(),name,u.href); this.changed();
  }
  toggle(id, enabled) { this.store.db.prepare('UPDATE lists SET enabled=? WHERE id=?').run(enabled?1:0,id); this.store.reload(); this.changed(); }
  remove(id) {
    if (this.busy.has(id)) throw new Error('Bitte das laufende Update abwarten.');
    const l=this.store.lists().find(l=>l.id===id); if (!l || l.preset) throw new Error('Vordefinierte Listen lassen sich ausschalten, aber nicht löschen.');
    this.store.db.prepare('DELETE FROM lists WHERE id=?').run(id); this.store.reload(); this.changed();
  }
  // guarded: unattended update. A list that suddenly lost over half its domains is more likely a
  // broken download than a real change; it stays as it is until someone updates it by hand.
  async update(id, {guarded=false}={}) {
    if (this.busy.has(id)) return;
    const l=this.store.lists().find(l=>l.id===id); if (!l) throw new Error('Liste nicht gefunden.');
    this.busy.add(id); this.changed();
    try {
      const response=await fetch(l.url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'LeiseDNS/0.1'}});
      if (!response.ok) throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
      if (!response.url.startsWith('https://')) throw new Error('Die Weiterleitung ist nicht verschlüsselt.');
      const chunks=[]; let size=0;
      for await (const chunk of response.body) { size+=chunk.length; if (size>32*1024*1024) throw new Error('Die Liste ist größer als 32 MB.'); chunks.push(chunk); }
      const result=parseList(Buffer.concat(chunks).toString('utf8'));
      if (!result.domains.length) throw new Error('Keine nutzbaren Domain-Regeln gefunden. Die bisherige Liste bleibt erhalten.');
      if (guarded && l.count>=1000 && result.domains.length<l.count/2) throw new Error(`Die neue Liste ist ungewöhnlich klein (${result.domains.length} statt ${l.count} Domains). Die bisherige Liste bleibt erhalten; „Aktualisieren“ übernimmt sie trotzdem.`);
      if (this.store.writeList(id,result.domains,result.skipped)) await this.store.reloadLists();
    } catch(e) {
      const offline=e.name==='TypeError' || e.name==='TimeoutError';
      const message=offline?'Der Listenserver ist nicht erreichbar. Die bisherige Liste bleibt erhalten.':e.message;
      this.store.db.prepare('UPDATE lists SET error=? WHERE id=?').run(message,id);
      throw offline?new Error(message):e;
    }
    finally { this.busy.delete(id); this.changed(); }
  }
  // Enabled lists older than a day. Based on the stored time, so updates missed while the PC was
  // off are caught up on. After a failed attempt a list waits an hour before the next one.
  due(now=Date.now()) {
    return this.store.lists().filter(l=>l.enabled && !this.busy.has(l.id) && (!l.updated || now-l.updated>=DAY) && now-(this.attempts.get(l.id)||0)>=HOUR);
  }
  async autoUpdate(stop=()=>false) {
    if (this.auto) return;
    this.auto=true;
    try {
      for (const l of this.due()) {
        if (stop()) return;
        this.attempts.set(l.id,Date.now());
        await this.update(l.id,{guarded:true}).catch(()=>{}); // The error is shown at the list.
      }
    } finally { this.auto=false; }
  }
  async updateAll() {
    const results=[];
    for (const l of this.store.lists()) { try { await this.update(l.id); results.push({name:l.name,ok:true}); } catch(e) { results.push({name:l.name,ok:false,error:e.message}); } }
    return results;
  }
}
module.exports={Filters};
