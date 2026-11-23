'use strict';
const { hash, key, seal, unseal, requireThat: need } = require('../common/utils');
const DAY = 86400000;
exports.createIdempotency = ({ store, secret, now }) => {
  const info = (actor, action, token, params) => {
    const { idempotency_key, ...payload } = params;
    return { rid: key('idem', actor, action, token), digest: hash(payload) };
  };
  const decode = (record, digest) => {
    need(record.payload_hash === digest, 'IDEMPOTENCY_CONFLICT', '同一幂等键的参数已经改变');
    need(now() < record.result_expires_at, 'REQUEST_EXPIRED', '请求结果已过保留期，请先查询业务状态');
    return unseal(record.response, secret);
  };
  return {
    async read(actor, action, token, params) {
      const { rid, digest } = info(actor, action, token, params), r = await store.get('idempotency_records', rid);
      return r ? { hit: true, data: decode(r, digest) } : { hit: false };
    },
    async executeIdempotent(actor, action, token, params, handler) {
      need(typeof token === 'string' && token.length >= 1 && token.length <= 64, 'VALIDATION_FAILED', '幂等键无效');
      const { rid, digest } = info(actor, action, token, params);
      return store.runTransaction(async tx => {
        const previous = await tx.get('idempotency_records', rid); if (previous) return decode(previous, digest);
        const data = await handler(tx);
        await tx.set('idempotency_records', rid, { actor_id: actor, action, payload_hash: digest, status: 'SUCCESS',
          response: seal(data, secret), created_at: now(), result_expires_at: now() + 7 * DAY, expires_at: now() + 37 * DAY });
        return data;
      });
    }
  };
};
exports.executeIdempotent = (...args) => require('../common/bindings').get().executeIdempotent(...args);
