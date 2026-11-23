'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, pair } = require('./helpers');
const { key, opinionId } = require('../cloudfunctions/api/common/utils');
const { MemoryStore } = require('../cloudfunctions/api/infra/memory-store');
test('可信身份、严格参数校验与并发首次登录', async () => {
  const e = setup();
  assert.equal((await e.api.dispatch({ action: 'auth.login', params: { idempotency_key: 'a' } }, {})).code, 'AUTH_REQUIRED');
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => e.w('owner', 'auth.login', { idempotency_key: 'login_' + i })));
  assert.equal(new Set(responses.map(r => r.user.user_id)).size, 1);
  assert.equal((await e.store.scan('users', { limit: 100 })).length, 1);
  assert.equal((await e.call('owner', 'auth.profile', { idempotency_key: 'x', nickname: '本人', user_id: 'other' })).code, 'VALIDATION_FAILED');
  assert.equal((await e.call('owner', 'auth.login', { idempotency_key: 'x', profile: {} })).code, 'VALIDATION_FAILED');
});
test('未被确认的好友候选不能进入好友列表；邀请不能被第三人抢换', async () => {
  const e = setup(); await e.login('a'); await e.login('b'); await e.login('c');
  const i = await e.w('a', 'friends.createInvitation'), token = i.share_path.split('token=')[1];
  await e.w('b', 'friends.claimInvitation', { token });
  assert.deepEqual((await e.ok('a', 'friends.list')).items, []);
  assert.equal((await e.call('c', 'friends.claimInvitation', { token, idempotency_key: 'steal' })).code, 'INVITATION_INVALID');
  await e.w('a', 'friends.confirmInvitation', { invitation_id: i.invitation_id, decision: 'ACCEPT' });
  assert.equal((await e.ok('a', 'friends.list')).items.length, 1);
  assert.equal((await e.ok('b', 'friends.list')).items.length, 1);
  const raw = JSON.stringify(await e.store.scan('invitations')) + JSON.stringify(await e.store.scan('idempotency_records'));
  assert.equal(raw.includes(token), false, '分享token不能明文落库');
});
test('普通申请：邀请接受前无正文权限，转发不能授权，同意后可查询结果', async () => {
  const e = await pair(); await e.login('stranger'); const app = await e.create('owner');
  const invitation = await e.w('owner', 'applications.share', { application_id: app.application_id, expected_version: 1, receiver_ids: [e.friend] });
  assert.equal((await e.call('friend', 'applications.get', { application_id: app.application_id })).code, 'ACCESS_DENIED');
  const preview = await e.ok('friend', 'applications.getInvitation', { card_id: invitation.card_id });
  assert.equal(preview.can_accept, true); assert.equal(JSON.stringify(preview).includes('学习用键盘'), false);
  assert.equal((await e.call('stranger', 'applications.getInvitation', { card_id: invitation.card_id })).code, 'INVITATION_INVALID');
  assert.equal((await e.ok('friend', 'applications.invitations', { direction: 'RECEIVED' })).items.length, 1);
  await e.w('friend', 'applications.acceptInvitation', { invitation_id: invitation.receiver_status[0].invitation_id });
  assert.equal((await e.get('friend', app)).permissions.can_approve, true);
  await e.approve('friend', app); const result = await e.get('owner', app);
  assert.equal(result.status, 'APPROVED'); assert.equal(result.final_decision, 'APPROVED');
  assert.equal((await e.get('friend', app)).permissions.can_approve, false);
  assert.equal((await e.ok('friend', 'approvals.history')).items.length, 1);
});
test('同键并发只创建一次，同键异参拒绝，写入后重放仍返回原版本', async () => {
  const e = await pair();
  const params = { idempotency_key: 'same', description: '耳机', price_cent: 500, tag: '数码' };
  const [a, b] = await Promise.all([e.ok('owner', 'applications.create', params), e.ok('owner', 'applications.create', params)]);
  assert.deepEqual(a, b); assert.equal((await e.store.scan('applications')).length, 1);
  assert.equal((await e.call('owner', 'applications.create', { ...params, price_cent: 501 })).code, 'IDEMPOTENCY_CONFLICT');
  await e.share('owner', 'friend', e.friend, a);
  const current = await e.get('friend', a), vote = { idempotency_key: 'vote', application_id: a.application_id, expected_version: current.version, decision: 'APPROVE' };
  const first = await e.ok('friend', 'approvals.submit', vote), replay = await e.ok('friend', 'approvals.submit', vote);
  assert.equal(replay.version, first.version);
  assert.equal((await e.call('friend', 'approvals.submit', { ...vote, idempotency_key: 'different' })).code, 'DUPLICATE_OPINION');
  assert.equal((await e.store.scan('opinions')).length, 1);
});
test('审核不可用时不落意见，恢复后原键可以重试；修改正文必须换键', async () => {
  let unavailable = true;
  const { hash } = require('../cloudfunctions/api/common/utils');
  const e = await pair({ adapters: { checkOpinionContent: async ({ text }) => {
    if (unavailable) throw { code: 'CONTENT_CHECK_UNAVAILABLE', message: '稍后重试', retryable: true };
    return { passed: true, content_hash: hash(text), checked_at: Date.now() };
  } } });
  const a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a);
  const c = await e.get('friend', a), p = { idempotency_key: 'retry', application_id: a.application_id, expected_version: c.version, decision: 'REJECT', comment: '已有同类设备' };
  assert.equal((await e.call('friend', 'approvals.submit', p)).code, 'CONTENT_CHECK_UNAVAILABLE');
  assert.equal(await e.store.get('opinions', opinionId(a.application_id, e.friend)), null);
  unavailable = false; assert.equal((await e.ok('friend', 'approvals.submit', p)).application_status, 'REJECTED');
  assert.equal((await e.call('friend', 'approvals.submit', { ...p, comment: '修改了' })).code, 'IDEMPOTENCY_CONFLICT');
});
test('审核等待中到期，事务重新检查截止时间，不落意见', async () => {
  let e;
  e = await pair({ adapters: { checkOpinionContent: async ({ text }) => {
    e.advance(12 * 3600000); return { passed: true, content_hash: require('../cloudfunctions/api/common/utils').hash(text) };
  } } });
  const a = await e.create('owner', { approval_hours: 12 }); await e.share('owner', 'friend', e.friend, a);
  const c = await e.get('friend', a);
  assert.equal((await e.call('friend', 'approvals.submit', { idempotency_key: 'late', application_id: a.application_id, expected_version: c.version, decision: 'REJECT', comment: '暂缓' })).code, 'APPLICATION_CLOSED');
  assert.equal((await e.store.scan('opinions')).length, 0); assert.equal((await e.get('owner', a)).status, 'EXPIRED');
});
test('默认云端适配器没有审核时拒绝锐评；无文件核验时拒绝图片', async () => {
  const content = require('../cloudfunctions/api/infra/adapters/content');
  const e = await pair({ adapters: content }); const a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a);
  const c = await e.get('friend', a);
  assert.equal((await e.call('friend', 'approvals.submit', { idempotency_key: 'no-check', application_id: a.application_id, expected_version: c.version, decision: 'REJECT', comment: '暂缓' })).code, 'CONTENT_CHECK_UNAVAILABLE');
  assert.equal((await e.call('owner', 'applications.create', { idempotency_key: 'no-file', description: 'x', tag: '数码', price_cent: 10, image_ids: ['cloud://not-verified'] })).code, 'DEPENDENCY_UNAVAILABLE');
});
test('撤回和审批竞争仅一个事务成功，事件不重复', async () => {
  const e = await pair(); const a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a);
  const current = await e.get('owner', a);
  const result = await Promise.all([
    e.call('owner', 'applications.withdraw', { idempotency_key: 'withdraw', application_id: a.application_id, expected_version: current.version }),
    e.call('friend', 'approvals.submit', { idempotency_key: 'approve', application_id: a.application_id, expected_version: current.version, decision: 'APPROVE' })
  ]);
  assert.equal(result.filter(r => r.code === 'OK').length, 1);
  assert.ok(['WITHDRAWN', 'APPROVED'].includes((await e.get('owner', a)).status));
  const events = await e.store.scan('outbox_events', { limit: 100 });
  assert.equal(events.filter(ev => ['APPLICATION_RESULT_FINALIZED', 'APPLICATION_WITHDRAWN'].includes(ev.type)).length, 1);
});
for (const rule of ['ALL_APPROVE', 'ONE_VETO']) test('会审聚合规则：' + rule, async () => {
  const e = await pair(); const other = await e.login('other'); await e.connect('owner', 'other');
  const a = await e.create('owner', { mode: 'JOINT', approver_ids: [e.friend, other], review_rule: rule });
  const first = await e.approve('friend', a, { decision: 'REJECT', comment: '暂缓购买' });
  if (rule === 'ONE_VETO') {
    assert.equal(first.application_status, 'REJECTED'); assert.equal((await e.get('other', a)).permissions.can_approve, false);
  } else {
    assert.equal(first.application_status, 'PENDING'); assert.equal((await e.approve('other', a)).application_status, 'REJECTED');
  }
});
test('NORMAL转会审后撤销旧分享资格，不能修改锁定名单', async () => {
  const e = await pair(); const b = await e.login('b'), c = await e.login('c'); await e.connect('owner', 'b'); await e.connect('owner', 'c');
  const a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a);
  const before = await e.get('owner', a);
  await e.w('owner', 'reviews.start', { application_id: a.application_id, expected_version: before.version, approver_ids: [b, c] });
  assert.equal((await e.call('friend', 'applications.get', { application_id: a.application_id })).code, 'ACCESS_DENIED');
  const after = await e.get('owner', a);
  assert.equal((await e.call('owner', 'reviews.start', { idempotency_key: 'again', application_id: a.application_id, expected_version: after.version, approver_ids: [b, c] })).code, 'STATE_CONFLICT');
});
test('B约定：先NORMAL再提交小组；成员快照不包含后来加入者', async () => {
  const e = await pair(); const newcomer = await e.login('new'); await e.connect('owner', 'new');
  const g = await e.w('owner', 'groups.create', { name: '监督一组' });
  const invite = await e.w('owner', 'groups.invite', { group_id: g.group.group_id, invitee_id: e.friend });
  assert.equal((await e.ok('friend', 'groups.getInvitation', { invitation_id: invite.invitation_id })).can_accept, true);
  await e.w('friend', 'groups.acceptInvitation', { invitation_id: invite.invitation_id });
  const a = await e.create('owner');
  const link = await e.w('owner', 'groups.submitApplication', { application_id: a.application_id, group_id: g.group.group_id, expected_version: a.version });
  assert.equal(link.participant_count, 1); assert.equal((await e.get('owner', a)).mode, 'GROUP');
  assert.equal((await e.ok('friend', 'groups.todos', { group_id: g.group.group_id })).items.length, 1);
  const ni = await e.w('owner', 'groups.invite', { group_id: g.group.group_id, invitee_id: newcomer });
  await e.w('new', 'groups.acceptInvitation', { invitation_id: ni.invitation_id });
  assert.equal((await e.ok('new', 'groups.todos', { group_id: g.group.group_id })).items.length, 0);
  assert.equal((await e.call('new', 'applications.get', { application_id: a.application_id })).code, 'ACCESS_DENIED');
  assert.equal((await e.approve('friend', a)).application_status, 'APPROVED');
  assert.equal((await e.ok('friend', 'groups.todos', { group_id: g.group.group_id })).items.length, 0);
});
test('已分享申请不能混入小组，不能直接创建GROUP', async () => {
  const e = await pair(), g = await e.w('owner', 'groups.create', { name: '第二组' });
  const i = await e.w('owner', 'groups.invite', { group_id: g.group.group_id, invitee_id: e.friend }); await e.w('friend', 'groups.acceptInvitation', { invitation_id: i.invitation_id });
  assert.equal((await e.call('owner', 'applications.create', { idempotency_key: 'group', description: 'x', tag: '数码', price_cent: 1, mode: 'GROUP' })).code, 'VALIDATION_FAILED');
  const a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a); const current = await e.get('owner', a);
  assert.equal((await e.call('owner', 'groups.submitApplication', { idempotency_key: 'mixed', application_id: a.application_id, group_id: g.group.group_id, expected_version: current.version })).code, 'STATE_CONFLICT');
});
test('截止边界与消费到期：保留原决定，扫描重复执行不重复产生事件', async () => {
  const e = await pair(), a = await e.create('owner', { approval_hours: 12 }); await e.share('owner', 'friend', e.friend, a); await e.approve('friend', a);
  const c = await e.get('owner', a);
  await e.w('owner', 'applications.setValidity', { application_id: a.application_id, expected_version: c.version, consume_expires_at: e.now() + 100 });
  e.advance(100); assert.equal((await e.api.services.expireApplications()).expired, 1);
  assert.equal((await e.api.services.expireApplications()).expired, 0);
  const final = await e.get('owner', a); assert.equal(final.status, 'EXPIRED'); assert.equal(final.final_decision, 'APPROVED');
  const events = await e.store.scan('outbox_events', { limit: 100 }); assert.equal(events.filter(ev => ev.type === 'APPLICATION_CONSUME_EXPIRED').length, 1);
  const b = await e.create('owner', { approval_hours: 12 }); e.advance(12 * 3600000); assert.equal((await e.get('owner', b)).expire_reason, 'APPROVAL_TIMEOUT');
});
test('正文下架后详情与幂等重放均不泄露原锐评', async () => {
  const e = await pair(), a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a);
  const c = await e.get('friend', a), p = { idempotency_key: 'redact', application_id: a.application_id, expected_version: c.version, decision: 'REJECT', comment: '原始锐评正文' };
  await e.ok('friend', 'approvals.submit', p);
  const oid = opinionId(a.application_id, e.friend), op = await e.store.get('opinions', oid); op.content_status = 'REMOVED'; await e.store.set('opinions', oid, op);
  const replay = await e.ok('friend', 'approvals.submit', p), detail = await e.ok('owner', 'applications.get', { application_id: a.application_id });
  assert.equal(replay.opinion.comment, null); assert.equal(replay.opinion.decision, 'REJECT');
  assert.equal(JSON.stringify([replay, detail]).includes('原始锐评正文'), false);
});
test('分页游标绑定用户及筛选条件；同时间戳数据无重复或漏项', async () => {
  const e = setup(); await e.login('owner'); await e.login('other');
  for (let i = 0; i < 7; i++) await e.create('owner', { description: '记录' + i });
  const ids = []; let cursor;
  do { const page = await e.ok('owner', 'applications.list', { limit: 2, ...(cursor ? { cursor } : {}) }); ids.push(...page.items.map(x => x.application_id)); cursor = page.next_cursor; } while (cursor);
  assert.equal(ids.length, 7); assert.equal(new Set(ids).size, 7);
  const first = await e.ok('owner', 'applications.list', { limit: 2 });
  assert.equal((await e.call('other', 'applications.list', { limit: 2, cursor: first.next_cursor })).code, 'VALIDATION_FAILED');
  assert.equal((await e.call('owner', 'applications.list', { limit: 2, status: 'PENDING', cursor: first.next_cursor })).code, 'VALIDATION_FAILED');
});
test('账号受限在每次写入时重查，禁止本人审批及客户端指定身份', async () => {
  const e = await pair(), a = await e.create('owner');
  assert.equal((await e.call('owner', 'approvals.submit', { idempotency_key: 'self', application_id: a.application_id, expected_version: a.version, decision: 'APPROVE' })).code, 'ACCESS_DENIED');
  const user = await e.store.get('users', e.owner); user.account_status = 'LIMITED'; await e.store.set('users', user._id, user);
  assert.equal((await e.call('owner', 'applications.create', { idempotency_key: 'limited', description: 'x', tag: '数码', price_cent: 1 })).code, 'ACCOUNT_RESTRICTED');
  assert.equal((await e.get('owner', a)).permissions.can_withdraw, false);
  user.account_status = 'BANNED'; await e.store.set('users', user._id, user);
  assert.equal((await e.call('owner', 'applications.get', { application_id: a.application_id })).code, 'ACCOUNT_RESTRICTED');
  assert.equal((await e.w('owner', 'auth.login')).user.account_status, 'BANNED');
});
test('事件写入失败：意见、状态和幂等结果一起回滚，原键可恢复', async () => {
  class FaultStore extends MemoryStore {
    async runTransaction(handler) { return super.runTransaction(async tx => {
      const original = tx.set.bind(tx); tx.set = async (collection, ...args) => {
        if (this.breakEvents && collection === 'outbox_events') throw new Error('simulated persistence error');
        return original(collection, ...args);
      }; return handler(tx);
    }); }
  }
  const store = new FaultStore(), e = await pair({ store }), a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a);
  const c = await e.get('friend', a), p = { idempotency_key: 'atomic', application_id: a.application_id, expected_version: c.version, decision: 'APPROVE' };
  store.breakEvents = true; assert.equal((await e.call('friend', 'approvals.submit', p)).code, 'INTERNAL_ERROR');
  assert.equal(await store.get('opinions', opinionId(a.application_id, e.friend)), null);
  assert.equal((await e.get('owner', a)).status, 'PENDING'); store.breakEvents = false;
  assert.equal((await e.ok('friend', 'approvals.submit', p)).application_status, 'APPROVED');
});
test('没有公开到期入口；未知动作、伪造context与任意文件预览都拒绝', async () => {
  const e = setup(); await e.login('owner');
  assert.equal((await e.call('owner', 'support.expireApplications')).code, 'VALIDATION_FAILED');
  assert.equal((await e.api.dispatch({ action: 'auth.login', params: { idempotency_key: 'x' }, context: { OPENID: 'other' } }, { OPENID: 'owner' })).code, 'VALIDATION_FAILED');
  assert.equal((await e.call('owner', 'support.getFileUrls', { file_ids: ['cloud://unknown'] })).code, 'ACCESS_DENIED');
});
test('幂等过保留期不重新执行业务', async () => {
  const e = setup(); await e.login('owner'); const p = { idempotency_key: 'expires', description: 'x', tag: '数码', price_cent: 100 };
  await e.ok('owner', 'applications.create', p); e.advance(7 * 86400000);
  assert.equal((await e.call('owner', 'applications.create', p)).code, 'REQUEST_EXPIRED');
  assert.equal((await e.store.scan('applications')).length, 1);
});
test('通过核验的图片随申请绑定；授权参与人能预览，第三人不能', async () => {
  const e = await pair({ adapters: {
    verifyImages: async (_, ids) => ids.map(file_id => ({ file_id, width: 800, height: 600, size_bytes: 1024 })),
    getTemporaryUrls: async ids => ids.map(file_id => ({ file_id, url: 'https://preview.invalid/temporary', expires_at: 1795400600000 }))
  } });
  await e.login('outsider'); const fid = 'cloud://verified-image';
  const a = await e.create('owner', { image_ids: [fid] });
  assert.equal((await e.ok('owner', 'support.getFileUrls', { file_ids: [fid] })).items.length, 1);
  assert.equal((await e.call('friend', 'support.getFileUrls', { file_ids: [fid] })).code, 'ACCESS_DENIED');
  await e.share('owner', 'friend', e.friend, a);
  assert.equal((await e.ok('friend', 'support.getFileUrls', { file_ids: [fid] })).items[0].file_id, fid);
  assert.equal((await e.call('outsider', 'support.getFileUrls', { file_ids: [fid] })).code, 'ACCESS_DENIED');
  assert.equal((await e.call('owner', 'applications.create', { idempotency_key: 'reuse-image', description: '另一笔', tag: '数码', price_cent: 100, image_ids: [fid] })).code, 'VALIDATION_FAILED');
});
test('审核挂起超过预算时返回可重试错误，不保存意见', async () => {
  const e = await pair({ adapters: { checkOpinionContent: () => new Promise(() => {}) } });
  const a = await e.create('owner'); await e.share('owner', 'friend', e.friend, a); const c = await e.get('friend', a);
  const r = await e.call('friend', 'approvals.submit', { idempotency_key: 'timeout', application_id: a.application_id, expected_version: c.version, decision: 'REJECT', comment: '暂缓购买' });
  assert.equal(r.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(r.retryable, true);
  assert.equal(await e.store.get('opinions', opinionId(a.application_id, e.friend)), null);
});
test('两名不同审批人并发提交，普通申请只保存一个决定', async () => {
  const e = await pair(), other = await e.login('other'); await e.connect('owner', 'other'); const a = await e.create('owner');
  await e.share('owner', 'friend', e.friend, a); await e.share('owner', 'other', other, a);
  const c = await e.get('owner', a);
  const [r1, r2] = await Promise.all(['friend', 'other'].map(who => e.call(who, 'approvals.submit', {
    idempotency_key: 'vote-' + who, application_id: a.application_id, expected_version: c.version, decision: 'APPROVE'
  })));
  assert.equal([r1, r2].filter(r => r.code === 'OK').length, 1);
  assert.equal((await e.store.scan('opinions')).length, 1); assert.equal((await e.get('owner', a)).status, 'APPROVED');
});
test('小组满员边界：两人并发接受不会超过21名成员', async () => {
  const e = await pair(), group = await e.w('owner', 'groups.create', { name: '人数边界测试组' });
  const join = async who => {
    const uid = await e.login(who); await e.connect('owner', who);
    const invite = await e.w('owner', 'groups.invite', { group_id: group.group.group_id, invitee_id: uid });
    await e.w(who, 'groups.acceptInvitation', { invitation_id: invite.invitation_id });
  };
  for (let i = 0; i < 19; i++) await join('member' + i);
  const invitations = [];
  for (const who of ['lastA', 'lastB']) {
    const uid = await e.login(who); await e.connect('owner', who);
    invitations.push(await e.w('owner', 'groups.invite', { group_id: group.group.group_id, invitee_id: uid }));
  }
  const results = await Promise.all(['lastA', 'lastB'].map((who, i) => e.call(who, 'groups.acceptInvitation', {
    idempotency_key: 'join-last', invitation_id: invitations[i].invitation_id
  })));
  assert.equal(results.filter(r => r.code === 'OK').length, 1);
  assert.equal((await e.ok('owner', 'groups.get', { group_id: group.group.group_id })).members.length, 21);
});
test('会审参与人可预览同一名单的头像，未授权用户仍不可读', async () => {
  const e = await pair({ adapters: { getTemporaryUrls: async ids => ids.map(file_id => ({ file_id, url: 'https://avatar.invalid/temporary', expires_at: 1795400600000 })) } });
  const other = await e.login('other'); await e.login('stranger'); await e.connect('owner', 'other');
  await e.create('owner', { mode: 'JOINT', approver_ids: [e.friend, other] });
  const file = 'cloud://avatar-other'; await e.store.set('file_refs', key('file', file), {
    owner_id: other, application_id: null, kind: 'AVATAR', file_id: file, created_at: e.now()
  });
  assert.equal((await e.ok('friend', 'support.getFileUrls', { file_ids: [file] })).items[0].file_id, file);
  assert.equal((await e.call('stranger', 'support.getFileUrls', { file_ids: [file] })).code, 'ACCESS_DENIED');
});
