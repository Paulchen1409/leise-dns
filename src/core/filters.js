const { randomUUID } = require('node:crypto');
const { parseList } = require('./domains');
class Filters {
  constructor(store, changed = () => {}) { this.store=store; this.changed=changed; this.busy=new Set(); }
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
  async update(id) {
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
      this.store.replaceList(id,result.domains,result.skipped);
    } catch(e) { this.store.db.prepare('UPDATE lists SET error=? WHERE id=?').run(e.message,id); throw e; }
    finally { this.busy.delete(id); this.changed(); }
  }
  async updateAll() {
    const results=[];
    for (const l of this.store.lists()) { try { await this.update(l.id); results.push({name:l.name,ok:true}); } catch(e) { results.push({name:l.name,ok:false,error:e.message}); } }
    return results;
  }
}
module.exports={Filters};
