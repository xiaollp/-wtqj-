'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CloudStore, PointTransaction, isMissing } = require('../cloudfunctions/api/infra/cloud-store');
test('云事务适配只按主键读取，读完后统一写入；读取能看到暂存结果', async () => {
  const operations = [], records = new Map([['users/u1', { _id: 'u1', value: 1 }]]);
  const raw = { collection(c) { return { doc(id) { const k = c + '/' + id; return {
    async get() { operations.push('get:' + k); return { data: records.get(k) || null }; },
    async set({ data }) { operations.push('set:' + k); records.set(k, { ...data, _id: id }); }
  }; } }; } };
  const tx = new PointTransaction(raw);
  assert.equal((await tx.get('users', 'u1')).value, 1);
  await tx.set('users', 'u1', { value: 2 });
  assert.equal((await tx.get('users', 'u1')).value, 2);
  await tx.get('applications', 'a'); await tx.flush();
  assert.deepEqual(operations, ['get:users/u1', 'get:applications/a', 'set:users/u1']);
  assert.equal(records.get('users/u1')._id, 'u1');
});
test('云存储事务支持SDK包装返回值，事务冲突给可重试业务错误', async () => {
  const store = new CloudStore({ runTransaction: async fn => ({ result: await fn({}) }) });
  assert.deepEqual(await store.runTransaction(async () => ({ value: 1 })), { value: 1 });
  const conflict = new CloudStore({ runTransaction: async () => { throw { code: 'DATABASE_TRANSACTION_CONFLICT' }; } });
  await assert.rejects(() => conflict.runTransaction(async () => null), e => e.code === 'DEPENDENCY_UNAVAILABLE' && e.retryable);
});
test('缺文档与缺集合不能混淆；网络故障不当作用户不存在', async () => {
  assert.equal(isMissing({ message: 'document with _id x does not exist' }), true);
  assert.equal(isMissing({ message: 'collection users does not exist' }), false);
  assert.equal(isMissing({ code: 'ECONNRESET', message: 'network reset' }), false);
});
test('云扫描生成稳定键集游标条件、排序及分页上限', async () => {
  const commands = [];
  const _ = Object.fromEntries(['all', 'gte', 'lte', 'in', 'and', 'or', 'lt'].map(op => [op, (...args) => ({ op, args })]));
  const query = { where(c) { commands.push(['where', c]); return this; }, orderBy(...a) { commands.push(['order', ...a]); return this; },
    limit(n) { commands.push(['limit', n]); return this; }, async get() { return { data: [{ _id: 'x' }] }; } };
  const store = new CloudStore({ command: _, collection: () => query });
  assert.equal((await store.scan('applications', { where: { owner_id: 'u', created_at: { $gte: 1, $lte: 10 } }, after: { created_at: 5, _id: 'a' }, limit: 21 }))[0]._id, 'x');
  assert.deepEqual(commands.slice(1), [['order', 'created_at', 'desc'], ['order', '_id', 'desc'], ['limit', 21]]);
  assert.equal(commands[0][1].op, 'and');
});
