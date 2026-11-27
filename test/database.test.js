'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, pair } = require('./helpers');
const { key } = require('../cloudfunctions/api/common/utils');
const { loadSchema, reconcileDatabase } = require('../scripts/database');

const DAY = 86400000;

test('Repository 分页绑定当前存储，版本条件更新拒绝无效金额并回滚', async () => {
  const backend = setup();
  const owner = await backend.login('repo-owner');
  const { application_id: id } = await backend.create('repo-owner');
  const repo = backend.api.services.repositories.applications;
  const { items } = await repo.queryPage({ owner_id: owner }, { limit: 10 });
  assert.deepEqual(items.map(item => item.application_id), [id]);
  assert.equal(Object.hasOwn(items[0], '_id'), false);
  await assert.rejects(backend.store.runTransaction(tx => repo.updateIfVersion(id, 1, { price_cent: 12.5 }, tx)),
    { code: 'VALIDATION_FAILED' });
  await assert.rejects(backend.store.runTransaction(tx => repo.updateIfVersion(id, 2, { price_cent: 123 }, tx)),
    { code: 'STATE_CONFLICT' });
  assert.equal((await repo.findById(id)).version, 1);
  assert.equal((await repo.findById(id)).price_cent, 19900);
});

test('举报 Repository 检查引用并保证同一用户对同一意见只写入一条', async () => {
  const backend = await pair();
  const application = await backend.create('owner');
  await backend.share('owner', 'friend', backend.friend, application);
  const { opinion } = await backend.approve('friend', application, { decision: 'REJECT', comment: '预算不够' });
  const repo = backend.api.services.repositories;
  const data = { reporter_id: backend.owner, opinion_id: opinion.opinion_id, reason: '  举报原因  ' };
  const first = await backend.store.runTransaction(tx => repo.insertReport(data, tx));
  assert.equal(first.reason, '举报原因');
  assert.equal((await repo.reports.findById(first.report_id)).status, 'PENDING');
  await assert.rejects(backend.store.runTransaction(tx => repo.insertReport(data, tx)), { code: 'STATE_CONFLICT' });
  await assert.rejects(backend.store.runTransaction(tx => repo.insertReport({ ...data, reporter_id: 'unknown' }, tx)),
    { code: 'VALIDATION_FAILED' });
});

test('过期幂等响应被压缩，原键及不同参数重放仍受保护', async () => {
  const backend = setup();
  const actor = await backend.login('owner'), action = 'applications.create', token = 'stable-key';
  const params = { idempotency_key: token, description: '截图记录', price_cent: 10, tag: '数码' };
  const first = await backend.ok('owner', action, params);
  const idem = key('idem', actor, action, token);
  assert.ok((await backend.store.get('idempotency_records', idem)).response.data);
  const compact = backend.api.services.compactIdempotency;
  backend.advance(7 * DAY - 1);
  assert.equal((await compact()).compacted, 0);
  assert.equal((await backend.ok('owner', action, params)).application_id, first.application_id);
  backend.advance(1);
  const cleanups = await Promise.all([compact(), compact()]);
  assert.equal(cleanups.reduce((total, item) => total + item.compacted, 0), 2); // 登录和申请各压缩一次
  const record = await backend.store.get('idempotency_records', idem);
  assert.equal(record.status, 'EXPIRED');
  assert.equal(record.response, null);
  assert.equal(record.payload_hash.length, 64);
  backend.advance(31 * DAY);
  assert.equal((await backend.call('owner', action, params)).code, 'REQUEST_EXPIRED');
  assert.equal((await backend.call('owner', action, { ...params, price_cent: 99 })).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await backend.store.scan('applications')).length, 1);
});

async function finalizedApplication() {
  const backend = await pair();
  const application = await backend.create('owner');
  await backend.share('owner', 'friend', backend.friend, application);
  await backend.approve('friend', application);
  const stored = await backend.get('owner', application);
  const outbox = backend.api.services.outbox;
  const event = (await outbox.listUntracked()).find(item => item.type === 'APPLICATION_RESULT_FINALIZED');
  return { backend, stored, outbox, event };
}

test('事件消费双领取、租约回收和提交回调均在事务中校验', async () => {
  const { backend, stored, outbox, event } = await finalizedApplication();
  const eventId = event._id;
  assert.equal(await outbox.track(eventId, ['summary', 'notice']), true);
  assert.equal(await outbox.track(eventId, ['notice', 'summary']), false);
  await assert.rejects(outbox.track(eventId, ['summary']), { code: 'STATE_CONFLICT' });
  assert.equal((await outbox.listDueConsumptions()).length, 2);
  const claims = await Promise.all([outbox.claim(eventId, 'summary'), outbox.claim(eventId, 'summary')]);
  assert.equal(claims.filter(Boolean).length, 1);
  const original = claims.find(Boolean);
  backend.advance(30000);
  const latest = await outbox.claim(eventId, 'summary');
  assert.equal(latest.attempts, 2);
  assert.notEqual(original.lease_id, latest.lease_id);
  await assert.rejects(outbox.finish(eventId, 'summary', original.lease_id, { status: 'DONE' }), { code: 'STATE_CONFLICT' });

  const repo = backend.api.services.repositories;
  const input = { application_id: stored.application_id, result_version: stored.version,
    item_info: { description: stored.description, price_cent: stored.price_cent }, comments: [],
    result: 'APPROVED', ai_status: 'PENDING' };
  await assert.rejects(outbox.finish(eventId, 'summary', latest.lease_id, { status: 'DONE' }, async tx => {
    await repo.saveSummary(input, tx);
    throw new Error('worker failure before commit');
  }), /worker failure/);
  assert.equal((await backend.store.scan('summary_documents')).length, 0);
  await outbox.finish(eventId, 'summary', latest.lease_id, { status: 'DONE' }, tx => repo.saveSummary(input, tx));
  assert.equal((await backend.store.scan('summary_documents')).length, 1);
  assert.equal((await backend.store.get('outbox_events', eventId)).status, 'PROCESSING');
  const notice = await outbox.claim(eventId, 'notice');
  await outbox.finish(eventId, 'notice', notice.lease_id, { status: 'SKIPPED' });
  assert.equal((await backend.store.get('outbox_events', eventId)).status, 'DONE');

  await backend.store.runTransaction(tx => repo.saveSummary({ ...input, ai_status: 'READY', purchase_advice: '可以考虑购买' }, tx));
  const stale = await backend.store.runTransaction(tx => repo.saveSummary({ ...input, result_version: stored.version - 1 }, tx));
  assert.equal(stale.written, false);
  assert.equal((await backend.store.get('summary_documents', stale.summary_id)).purchase_advice, '可以考虑购买');
});

test('消费者按退避时间重试，耗尽重试后保留失败记录', async () => {
  const { backend, outbox, event } = await finalizedApplication();
  await outbox.track(event._id, ['notice']);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const lease = await outbox.claim(event._id, 'notice');
    assert.equal(lease.attempts, attempt);
    await outbox.finish(event._id, 'notice', lease.lease_id, { status: 'RETRY', error_code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(await outbox.claim(event._id, 'notice'), null);
    backend.advance(60 * 60000);
  }
  const [record] = await backend.store.scan('event_consumptions');
  assert.equal(record.status, 'FAILED');
  assert.equal(record.error_code, 'PROVIDER_UNAVAILABLE');
  assert.equal((await backend.store.get('outbox_events', event._id)).status, 'FAILED');
  assert.deepEqual(await outbox.listDueConsumptions(), []);
});

function fakeManager(initial = {}) {
  const log = [];
  const state = new Map(Object.entries(initial));
  const manager = {
    database: {
      async listCollections({ MgoOffset, MgoLimit }) {
        // 分页上限更小的环境也应该读到后续集合。
        const data = [...state.keys()].slice(MgoOffset, MgoOffset + Math.min(1, MgoLimit));
        return { Collections: data.map(CollectionName => ({ CollectionName })), Pager: { Total: state.size } };
      },
      async describeCollection(name) { return { Indexes: state.get(name).indexes }; },
      async createCollection(name) { log.push('create:' + name); state.set(name, { acl: 'READONLY', indexes: [] }); },
      async updateCollection(name, options) {
        log.push('index:' + name);
        assert.deepEqual(Object.keys(options), ['CreateIndexes']);
        for (const item of options.CreateIndexes) state.get(name).indexes.push({ Name: item.IndexName,
          Keys: item.MgoKeySchema.MgoIndexKeys, Unique: String(item.MgoKeySchema.MgoIsUnique) });
      }
    },
    commonService() {
      return { async call({ Action, Param }) {
        assert.equal(Param.EnvId, 'team-dev');
        const row = state.get(Param.CollectionName);
        if (Action === 'DescribeSafeRule') return { AclTag: row.acl };
        assert.equal(Action, 'ModifySafeRule');
        assert.equal(Param.AclTag, 'ADMINONLY');
        log.push('acl:' + Param.CollectionName);
        row.acl = Param.AclTag;
      } };
    }
  };
  return { manager, log };
}

test('部署工具只读检查，重复部署收敛且复用同定义旧索引', async () => {
  const schema = loadSchema().filter(item => ['users', 'applications'].includes(item.collection));
  const { manager, log } = fakeManager({ users: { acl: 'READONLY', indexes: [
    { Name: 'existing_openid', Keys: [{ Name: 'openid', Direction: -1 }], Unique: true }
  ] } });
  const opts = { manager, envId: 'team-dev', schema };
  const diff = await reconcileDatabase(opts);
  assert.equal(diff.length, 2);
  assert.equal(diff[0].indexes.length, 0);
  assert.deepEqual(log, []);
  assert.deepEqual(await reconcileDatabase({ ...opts, apply: true }), []);
  assert.deepEqual(log, ['acl:users', 'create:applications', 'acl:applications', 'index:applications']);
  assert.deepEqual(await reconcileDatabase({ ...opts, apply: true }), []);
  assert.equal(log.length, 4);
});

test('部署工具检测同名索引定义漂移，停止写入并保留已有数据', async () => {
  const schema = loadSchema().filter(item => ['users', 'applications'].includes(item.collection));
  const { manager, log } = fakeManager({ users: { acl: 'READONLY', indexes: [
    { Name: 'openid_u', Keys: [{ Name: 'openid', Direction: -1 }], Unique: false }
  ] } });
  const diff = await reconcileDatabase({ manager, envId: 'team-dev', schema, apply: true });
  assert.deepEqual(diff[0].conflicts, ['openid_u']);
  assert.deepEqual(log, []);
});

test('集合列表读取失败不会误判为新环境或开始部署', async () => {
  const { manager, log } = fakeManager();
  manager.database.listCollections = async () => { throw Object.assign(new Error('permission denied'), { code: 'AuthFailure' }); };
  await assert.rejects(reconcileDatabase({ manager, envId: 'team-dev', apply: true }), { code: 'AuthFailure' });
  assert.deepEqual(log, []);
});
