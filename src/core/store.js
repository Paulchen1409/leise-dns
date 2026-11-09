const { DatabaseSync } = require('node:sqlite');
const { normalizeDomain, matches } = require('./domains');
const { DomainSet, DomainMap } = require('./domain-set');
// [id, name, url, enabled by default, category]
const PRESETS = [
  ['stevenblack', 'StevenBlack', 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', 1, 'ads'],
  ['easylist', 'EasyList', 'https://easylist.to/easylist/easylist.txt', 0, 'ads'],
  ['easyprivacy', 'EasyPrivacy', 'https://easylist.to/easylist/easyprivacy.txt', 0, 'ads'],
  // URLhaus itself now requires a personal key for downloads; this project republishes its data.
  ['urlhaus', 'URLhaus', 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt', 1, 'malware'],
  ['phishingarmy', 'Phishing Army', 'https://phishing.army/download/phishing_army_blocklist.txt', 1, 'phishing']
];
// Malware and phishing blocks lead to the Leise DNS block page instead of a plain DNS error.
const THREATS = { malware: 'Malware', phishing: 'Phishing' };
class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules (domain TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('white','black')));
      CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, preset INTEGER DEFAULT 0, updated INTEGER, skipped INTEGER DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS list_domains (list_id TEXT REFERENCES lists(id) ON DELETE CASCADE, domain TEXT, PRIMARY KEY(list_id,domain));
      CREATE TABLE IF NOT EXISTS queries (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, domain TEXT NOT NULL, type TEXT, status TEXT NOT NULL, reason TEXT, ms INTEGER);
      CREATE INDEX IF NOT EXISTS query_time ON queries(time);
      CREATE TABLE IF NOT EXISTS hours (time INTEGER PRIMARY KEY, total INTEGER NOT NULL, blocked INTEGER NOT NULL, errors INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS top_domains (day TEXT, domain TEXT, count INTEGER NOT NULL, PRIMARY KEY(day,domain));`);
    if (!this.db.prepare('PRAGMA table_info(lists)').all().some(c => c.name === 'category')) this.db.exec("ALTER TABLE lists ADD COLUMN category TEXT NOT NULL DEFAULT 'ads'");
    for (const column of ['rules', 'used']) {
      if (!this.db.prepare('PRAGMA table_info(lists)').all().some(c => c.name === column)) this.db.exec(`ALTER TABLE lists ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
    const insert = this.db.prepare('INSERT OR IGNORE INTO lists(id,name,url,enabled,preset,category) VALUES(?,?,?,?,1,?)');
    const category = this.db.prepare('UPDATE lists SET category=? WHERE id=? AND preset=1');
    // Existing installations follow a changed address. IGNORE: a custom list may already use it.
    const address = this.db.prepare('UPDATE OR IGNORE lists SET url=? WHERE id=? AND preset=1');
    PRESETS.forEach(row => { insert.run(...row); category.run(row[4], row[0]); address.run(row[2], row[0]); });
    this.reload(); this.prune();
  }
  get(key, fallback) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key, JSON.stringify(value)); }
  transaction(fn) { this.db.exec('BEGIN'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  reload() {
    this.generation = (this.generation || 0) + 1;
    this.white = new Set(); this.black = new Set();
    for (const r of this.db.prepare('SELECT * FROM rules').all()) this[r.kind].add(r.domain);
    this.filtered = new DomainSet();
    for (const r of this.db.prepare('SELECT DISTINCT domain FROM list_domains JOIN lists ON lists.id=list_domains.list_id WHERE enabled=1').all()) this.filtered.add(r.domain);
    this.threats = new DomainMap();
    for (const r of this.db.prepare("SELECT d.domain, l.category, l.name FROM list_domains d JOIN lists l ON l.id=d.list_id WHERE l.enabled=1 AND l.category IN ('malware','phishing') ORDER BY l.category DESC").all()) {
      if (!this.threats.has(r.domain)) this.threats.set(r.domain, { category: r.category, list: r.name });
    }
  }
  // Same result as reload() for the filter lists, in small steps: DNS answers keep flowing because
  // this shares the process with the DNS service. The old sets stay in use until the swap at the end.
  async reloadLists() {
    const generation = this.generation = (this.generation || 0) + 1;
    const pause = () => new Promise(resolve => setImmediate(resolve));
    const stale = () => generation !== this.generation; // A newer reload has fresher data.
    const filtered = new DomainSet(); const threats = new DomainMap(); let n = 0;
    for (const r of this.db.prepare('SELECT domain FROM list_domains JOIN lists ON lists.id=list_domains.list_id WHERE enabled=1').iterate()) {
      filtered.add(r.domain);
      if (++n % 5000 === 0) { await pause(); if (stale()) return; }
    }
    // Phishing first: a domain on both kinds of list counts as phishing, as in reload().
    for (const category of ['phishing', 'malware']) {
      for (const r of this.db.prepare('SELECT d.domain, l.name FROM list_domains d JOIN lists l ON l.id=d.list_id WHERE l.enabled=1 AND l.category=?').iterate(category)) {
        if (!threats.has(r.domain)) threats.set(r.domain, { category, list: r.name });
        if (++n % 5000 === 0) { await pause(); if (stale()) return; }
      }
    }
    if (!stale()) { this.filtered = filtered; this.threats = threats; }
  }
  // Malware/phishing match for a domain (including subdomains), unless it is allowed.
  threat(domain) {
    if (matches(this.white, domain)) return null;
    for (let d = String(domain).toLowerCase().replace(/\.$/, ''); d.includes('.'); d = d.slice(d.indexOf('.') + 1)) {
      const hit = this.threats.get(d);
      if (hit) return { ...hit, label: THREATS[hit.category], matched: d };
    }
    return null;
  }
  reason(domain) {
    if (matches(this.white, domain)) return null;
    if (matches(this.black, domain)) return 'Eigene Sperrliste';
    const threat = this.threat(domain);
    if (threat) return `${threat.label} · ${threat.list}`;
    return matches(this.filtered, domain) ? 'Filterliste' : null;
  }
  rules(kind) { if (!['white','black'].includes(kind)) throw new Error('Ungültige Liste.'); return this.db.prepare('SELECT domain FROM rules WHERE kind=? ORDER BY domain').all(kind).map(r => r.domain); }
  addRule(kind, input) {
    if (!['white','black'].includes(kind)) throw new Error('Ungültige Liste.');
    const domain = normalizeDomain(input);
    this.db.prepare('INSERT OR REPLACE INTO rules VALUES(?,?)').run(domain, kind); this.reload(); return domain;
  }
  removeRule(kind, domain) { this.db.prepare('DELETE FROM rules WHERE domain=? AND kind=?').run(domain,kind); this.reload(); }
  lists() { return this.db.prepare('SELECT lists.*, (SELECT COUNT(*) FROM list_domains WHERE list_id=lists.id) AS count FROM lists ORDER BY preset DESC,name').all(); }
  // Writes only what changed, which keeps the transaction short. Returns whether anything changed.
  // stats may be the old skipped-count or {skipped, total, used}.
  writeList(id, domains, skipped = 0) {
    const stats = skipped && typeof skipped === 'object' ? skipped : { skipped: skipped || 0, total: 0, used: 0 };
    return this.transaction(() => {
      if (!this.db.prepare('SELECT id FROM lists WHERE id=?').get(id)) throw new Error('Liste wurde entfernt.');
      const wanted = new Set(domains);
      const remove = this.db.prepare('DELETE FROM list_domains WHERE list_id=? AND domain=?');
      const insert = this.db.prepare('INSERT OR IGNORE INTO list_domains VALUES(?,?)');
      const present = new Set(); let changed = false;
      for (const { domain } of this.db.prepare('SELECT domain FROM list_domains WHERE list_id=?').all(id)) {
        present.add(domain);
        if (!wanted.has(domain)) { remove.run(id, domain); changed = true; }
      }
      for (const d of wanted) if (!present.has(d)) { insert.run(id, d); changed = true; }
      this.db.prepare('UPDATE lists SET updated=?,skipped=?,rules=?,used=?,error=NULL WHERE id=?').run(Date.now(), stats.skipped || 0, stats.total || 0, stats.used || 0, id);
      return changed;
    });
  }
  replaceList(id, domains, skipped) { this.writeList(id, domains, skipped); this.reload(); }
  log(entry) {
    const now = entry.time || Date.now(); const hour = Math.floor(now / 3600000) * 3600000;
    const d = new Date(now); const day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    this.transaction(() => {
      const row = this.db.prepare('INSERT INTO queries(time,domain,type,status,reason,ms) VALUES(?,?,?,?,?,?)').run(now,entry.domain,entry.type,entry.status,entry.reason || '', entry.ms || 0);
      entry.id = Number(row.lastInsertRowid); entry.time = now;
      this.db.prepare('INSERT INTO hours VALUES(?,?,?,?) ON CONFLICT(time) DO UPDATE SET total=total+excluded.total,blocked=blocked+excluded.blocked,errors=errors+excluded.errors').run(hour,1,Number(entry.status === 'blocked'),Number(entry.status === 'error'));
      if (entry.status === 'blocked') this.db.prepare('INSERT INTO top_domains VALUES(?,?,1) ON CONFLICT(day,domain) DO UPDATE SET count=count+1').run(day,entry.domain);
    });
    return entry;
  }
  queries({search = '', status = 'all', before = null} = {}) {
    const term = String(search).slice(0,253).replace(/[!%_]/g,'!$&');
    return this.db.prepare(`SELECT * FROM queries WHERE domain LIKE ? ESCAPE '!' AND (?='all' OR status=?) AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 200`).all(`%${term}%`,status,status,before,before);
  }
  stats(days = 1) {
    days = [1,7,30].includes(days) ? days : 1;
    const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-days+1);
    const from = start.getTime();
    const totals = this.db.prepare('SELECT COALESCE(SUM(total),0) total,COALESCE(SUM(blocked),0) blocked,COALESCE(SUM(errors),0) errors FROM hours WHERE time>=?').get(from);
    const rows = this.db.prepare('SELECT * FROM hours WHERE time>=? ORDER BY time').all(from);
    const map = new Map(rows.map(r=>[r.time,r])); const history=[];
    for(let t=Math.floor(from/3600000)*3600000;t<=Date.now();t+=3600000) history.push(map.get(t)||{time:t,total:0,blocked:0,errors:0,noData:true}); // No row: the PC or the protection was off, which is not the same as zero queries.
    const day = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
    const top = this.db.prepare('SELECT domain,SUM(count) count FROM top_domains WHERE day>=? GROUP BY domain ORDER BY count DESC LIMIT 8').all(day);
    return {...totals, rate:totals.total ? totals.blocked/totals.total*100 : 0, history, top};
  }
  exportQueries({ search = '', status = 'all' } = {}) {
    const term = String(search).slice(0, 253).replace(/[!%_]/g, '!$&');
    if (!['all', 'allowed', 'blocked', 'error'].includes(status)) throw new Error('Ungültiger Status.');
    return this.db.prepare(`SELECT time,domain,type,status,reason,ms FROM queries WHERE domain LIKE ? ESCAPE '!' AND (?='all' OR status=?) ORDER BY id DESC LIMIT 10000`).all(`%${term}%`, status, status);
  }
  prune() {
    this.db.prepare('DELETE FROM queries WHERE time<? OR id < (SELECT COALESCE(MAX(id),0)-10000 FROM queries)').run(Date.now()-7*86400000);
    this.db.prepare('DELETE FROM hours WHERE time<?').run(Date.now()-90*86400000);
    const limit = new Date(Date.now()-90*86400000).toISOString().slice(0,10);
    this.db.prepare('DELETE FROM top_domains WHERE day<?').run(limit);
  }
  memory() {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss, heapUsed: usage.heapUsed,
      filtered: this.filtered.size, nodes: (this.filtered.nodes || 0) + (this.threats.nodes || 0),
      threats: this.threats.size, rules: this.white.size + this.black.size
    };
  }
  close() { this.db.close(); }
  exportRules() {
    return {
      leise: 1, kind: 'rules', exported: new Date().toISOString(),
      white: this.rules('white'), black: this.rules('black'),
      upstream: this.get('upstream', 'cloudflare'), autoUpdate: this.get('autoUpdate', true)
    };
  }
  // Validates every domain before anything is written. Whitelist wins over blacklist.
  previewRules(data) {
    if (!data || data.kind !== 'rules' || data.leise !== 1) throw new Error('Diese Datei ist keine Leise-DNS-Sicherung.');
    const whiteIn = Array.isArray(data.white) ? data.white : [];
    const blackIn = Array.isArray(data.black) ? data.black : [];
    if (whiteIn.length + blackIn.length > 20000) throw new Error('Die Sicherung enthält zu viele Regeln.');
    return { white: whiteIn.map(domain => normalizeDomain(String(domain))).length, black: blackIn.map(domain => normalizeDomain(String(domain))).length };
  }
  importRules(data, { mode = 'merge' } = {}) {
    if (!data || data.kind !== 'rules' || data.leise !== 1) throw new Error('Diese Datei ist keine Leise-DNS-Sicherung.');
    const whiteIn = Array.isArray(data.white) ? data.white : [];
    const blackIn = Array.isArray(data.black) ? data.black : [];
    if (whiteIn.length + blackIn.length > 20000) throw new Error('Die Sicherung enthält zu viele Regeln.');
    const white = whiteIn.map(domain => normalizeDomain(String(domain)));
    const black = blackIn.map(domain => normalizeDomain(String(domain)));
    this.transaction(() => {
      if (mode === 'replace') this.db.prepare('DELETE FROM rules').run();
      const insert = this.db.prepare('INSERT OR REPLACE INTO rules VALUES(?,?)');
      for (const domain of black) insert.run(domain, 'black');
      for (const domain of white) insert.run(domain, 'white');
      if (['cloudflare', 'google', 'quad9'].includes(data.upstream)) this.set('upstream', data.upstream);
      if (typeof data.autoUpdate === 'boolean') this.set('autoUpdate', data.autoUpdate);
    });
    this.reload();
    return { white: white.length, black: black.length, mode };
  }
}
module.exports = { Store, THREATS };
