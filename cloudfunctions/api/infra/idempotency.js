'use strict';
const { hash, key, seal, unseal, requireThat: need } = require('../common/utils');
const DAY = 86400000;
const COLLECTION = 'idempotency_records';
exports.createIdempotency = ({ store, secret, now }) => {
  const info = (actor, action, token, params) => {
    need(typeof token === 'string' && token.length >= 1 && token.length <= 64, 'VALIDATION_FAILED', '幂等键无效');
    const { idempotency_key, ...payload } = params;
    return { rid: key('idem', actor, action, token), digest: hash(payload) };
  };
  const decode = (record, digest) => {
    need(record.payload_hash === digest, 'IDEMPOTENCY_CONFLICT', '同一幂等键的参数已经改变');
    need(record.status === 'SUCCESS' && now() < record.result_expires_at, 'REQUEST_EXPIRED', '请求结果已过保留期，请先查询业务状态');
    return unseal(record.response, secret);
  };
  return {
    async read(actor, action, token, params) {
      const { rid, digest } = info(actor, action, token, params), r = await store.get(COLLECTION, rid);
      return r ? { hit: true, data: decode(r, digest) } : { hit: false };
    },
    async executeIdempotent(actor, action, token, params, handler) {
      const { rid, digest } = info(actor, action, token, params);
      return store.runTransaction(async tx => {
        const previous = await tx.get(COLLECTION, rid); if (previous) return decode(previous, digest);
        const data = await handler(tx);
        const recordedAt = now();
        await tx.set(COLLECTION, rid, { actor_id: actor, action, payload_hash: digest, status: 'SUCCESS',
          response: seal(data, secret), created_at: recordedAt, result_expires_at: recordedAt + 7 * DAY, expires_at: recordedAt + 37 * DAY });
        return data;
      });
    },
    async compactExpired({ batchSize = 50 } = {}) {
      need(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 100, 'VALIDATION_FAILED', '批次大小应为1～100');
      const cutoff = now();
      const rows = await store.scan(COLLECTION, { where: { status: 'SUCCESS', result_expires_at: { $lte: cutoff } },
        order: 'asc', limit: batchSize });
      let compacted = 0;
      for (const row of rows) {
        compacted += await store.runTransaction(async tx => {
          const current = await tx.get(COLLECTION, row._id);
          if (!current || current.status !== 'SUCCESS' || !(current.result_expires_at <= cutoff)) return 0;
          // 摘要保留用于拦截原键重放，只清除过期的加密响应。
          await tx.set(COLLECTION, row._id, { ...current, status: 'EXPIRED', response: null, compacted_at: now() });
          return 1;
        });
      }
      return { scanned: rows.length, compacted };
    }
  };
};
exports.executeIdempotent = (...args) => require('../common/bindings').get().executeIdempotent(...args);
