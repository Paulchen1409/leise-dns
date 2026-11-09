// Short memory for allowed DNS answers. The TTL is the upstream value, never
// longer than maxTtl (kept inside 30–120 seconds). Errors and blocks are not stored.
class DnsCache {
  constructor({ maxEntries = 2048, maxTtl = 60 } = {}) {
    this.maxEntries = maxEntries;
    this.maxTtl = maxTtl;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
    this.now = () => Date.now();
  }
  get size() { return this.map.size; }
  key(question, server) {
    const name = String(question?.name || '').toLowerCase().replace(/\.$/, '');
    return `${server}|${name}|${question?.type || ''}|${question?.class || 'IN'}`;
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit || hit.expires <= this.now()) {
      if (hit) this.map.delete(key);
      this.misses++;
      return null;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    this.hits++;
    return hit.message;
  }
  set(key, message, ttlSeconds) {
    if (this.maxEntries < 1 || !message) return;
    const ttl = Math.min(this.maxTtl, Math.max(0, ttlSeconds | 0));
    if (ttl < 1) return;
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { message: Buffer.from(message), expires: this.now() + ttl * 1000 });
  }
  withId(message, id) {
    const out = Buffer.from(message);
    out.writeUInt16BE(id & 0xffff, 0);
    return out;
  }
  static ttlOf(response) {
    const records = [...(response?.answers || []), ...(response?.authorities || [])];
    let min = Infinity;
    for (const record of records) if (typeof record.ttl === 'number' && record.ttl >= 0 && record.ttl < min) min = record.ttl;
    return min === Infinity ? 0 : min;
  }
}
module.exports = { DnsCache };
