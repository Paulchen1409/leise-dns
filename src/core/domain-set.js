// Reversed-label trie. Shared suffixes (".com", ".example") keep large blocklists
// smaller than a set of full domain strings, and lookup stays exact.
function labelsOf(domain) {
  return String(domain).toLowerCase().replace(/\.$/, '').split('.');
}
function descend(root, domain, create, counter) {
  const labels = labelsOf(domain);
  let node = root;
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    let next = node[label];
    if (!next) {
      if (!create) return null;
      next = Object.create(null);
      node[label] = next;
      counter.nodes++;
    }
    node = next;
  }
  return node;
}
function* walk(node, suffix) {
  if ('$' in node) yield [suffix.length ? suffix.slice().reverse().join('.') : '', node.$];
  for (const label of Object.keys(node)) {
    if (label === '$') continue;
    suffix.push(label);
    yield* walk(node[label], suffix);
    suffix.pop();
  }
}
class DomainSet {
  constructor() { this.root = Object.create(null); this.size = 0; this.nodes = 1; }
  add(domain) {
    const node = descend(this.root, domain, true, this);
    if (!('$' in node)) { node.$ = 1; this.size++; }
  }
  has(domain) {
    const node = descend(this.root, domain, false, this);
    return !!node && ('$' in node);
  }
  *entries() { yield* walk(this.root, []); }
  *[Symbol.iterator]() { for (const [domain] of this.entries()) yield domain; }
}
class DomainMap {
  constructor() { this.root = Object.create(null); this.size = 0; this.nodes = 1; }
  set(domain, value) {
    const node = descend(this.root, domain, true, this);
    if (!('$' in node)) this.size++;
    node.$ = value;
  }
  get(domain) {
    const node = descend(this.root, domain, false, this);
    return node && ('$' in node) ? node.$ : undefined;
  }
  has(domain) { return this.get(domain) !== undefined; }
  *entries() { yield* walk(this.root, []); }
}
module.exports = { DomainSet, DomainMap };
