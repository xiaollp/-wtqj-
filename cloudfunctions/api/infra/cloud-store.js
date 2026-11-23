'use strict';
// 事务只按主键读取；所有写入暂存到回调结束后再刷新，避免读写顺序依赖。
const { fail } = require('../common/errors');
function isMissing(error) {
  return ['DOCUMENT_NOT_EXIST', 'DATABASE_DOCUMENT_NOT_EXIST'].includes(error.code)
    || /document\b.*(?:does not exist|not exist|not found)/i.test(error.errMsg || error.message || '');
}
class PointTransaction {
  constructor(raw) { this.raw = raw; this.cache = new Map(); this.writes = new Map(); }
  async get(collection, id) {
    const k = collection + '/' + id;
    if (this.writes.has(k)) return structuredClone(this.writes.get(k).record);
    if (!this.cache.has(k)) {
      let data;
      try { data = (await this.raw.collection(collection).doc(id).get()).data; }
      catch (e) { if (!isMissing(e)) throw e; data = null; }
      this.cache.set(k, Array.isArray(data) ? (data[0] ?? null) : (data ?? null));
    }
    return structuredClone(this.cache.get(k));
  }
  async set(collection, id, record) { this.writes.set(collection + '/' + id, { collection, id, record: structuredClone({ ...record, _id: id }) }); }
  async flush() {
    for (const { collection, id, record } of this.writes.values()) {
      const { _id, ...data } = record;
      await this.raw.collection(collection).doc(id).set({ data });
    }
  }
}
class CloudStore {
  constructor(db) { this.db = db; }
  async get(collection, id) { return new PointTransaction(this.db).get(collection, id); }
  async scan(collection, { where = {}, after = null, limit = 21 } = {}) {
    const _ = this.db.command;
    const filter = {};
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object') {
        const parts = Object.entries(v).map(([op, n]) => {
          if (op === '$contains') return _.all([n]);
          if (op === '$all') return _.all(n);
          if (op === '$gte') return _.gte(n);
          if (op === '$lte') return _.lte(n);
          if (op === '$in') return _.in(n);
          throw new Error('Unknown predicate');
        });
        filter[k] = parts.length === 1 ? parts[0] : _.and(parts);
      } else filter[k] = v;
    }
    const condition = after ? _.and([filter, _.or([
      { created_at: _.lt(after.created_at) },
      { created_at: after.created_at, _id: _.lt(after._id) }
    ])]) : filter;
    return (await this.db.collection(collection).where(condition).orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(limit).get()).data;
  }
  async runTransaction(handler) {
    try {
      // 不依赖不同SDK对runTransaction返回值的包装差异。
      let value;
      await this.db.runTransaction(async raw => {
        const tx = new PointTransaction(raw); value = await handler(tx); await tx.flush();
      });
      return value;
    } catch (e) {
      if (/TRANSACTION_CONFLICT/.test(e.code || '') || /transaction.*conflict/i.test(e.message || ''))
        fail('DEPENDENCY_UNAVAILABLE', '数据正在更新，请使用原请求重试', true);
      throw e;
    }
  }
}
module.exports = { CloudStore, PointTransaction, isMissing };
