'use strict';
// 仅供本地测试，云函数入口从不加载此存储。
function matches(row, where) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object') return Object.entries(v).every(([op, n]) => {
      if (op === '$contains') return Array.isArray(row[k]) && row[k].includes(n);
      if (op === '$all') return Array.isArray(row[k]) && n.every(v => row[k].includes(v));
      if (op === '$gte') return row[k] >= n;
      if (op === '$lte') return row[k] <= n;
      if (op === '$in') return n.includes(row[k]);
      throw new Error('Unknown predicate ' + op);
    });
    return row[k] === v;
  });
}
class MemoryStore {
  constructor() { this.data = new Map(); this.tail = Promise.resolve(); }
  async get(collection, id) { return structuredClone(this.data.get(collection)?.get(id) ?? null); }
  async set(collection, id, record) {
    if (!this.data.has(collection)) this.data.set(collection, new Map());
    this.data.get(collection).set(id, structuredClone({ ...record, _id: id }));
  }
  async scan(collection, { where = {}, after = null, limit = 21, order = 'desc' } = {}) {
    const compare = (left, right) => {
      const byKey = left.created_at - right.created_at || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
      return order === 'asc' ? byKey : -byKey;
    };
    return [...(this.data.get(collection)?.values() ?? [])].filter(r => matches(r, where))
      .filter(r => !after || compare(r, after) > 0)
      .sort(compare)
      .slice(0, limit).map(r => structuredClone(r));
  }
  async runTransaction(handler) {
    const preceding = this.tail; let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await preceding;
    const tx = new MemoryStore(); tx.data = structuredClone(this.data);
    try { const result = await handler(tx); this.data = tx.data; return result; }
    finally { release(); }
  }
}
module.exports = { MemoryStore };
