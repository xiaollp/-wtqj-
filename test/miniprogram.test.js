'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { initCloud, callApi, createWriteContext, login } = require('../miniprogram/shared/api');
const applications = require('../miniprogram/services/applications');
const approvals = require('../miniprogram/services/approvals');
const friends = require('../miniprogram/services/friends');
const { prepareImage, uploadImage } = require('../miniprogram/shared/images');
const { parsePrice } = require('../miniprogram/shared/application-form');

function connectClient(backend, openid, intercept) {
  global.wx = {
    cloud: {
      init: () => {},
      async callFunction({ name, data }) {
        assert.equal(name, 'api');
        const result = await backend.api.dispatch(data, { OPENID: openid });
        if (intercept) intercept(data, result);
        return { result };
      }
    }
  };
  initCloud('local-test');
}

function createPage(modulePath) {
  let definition;
  global.Page = page => { definition = page; };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
}

function query(path, key) {
  return new URL('https://local.invalid' + path).searchParams.get(key);
}

test('客户端按真实云契约完成好友互认、邀请绑定、同意审批和历史查询', async () => {
  const backend = setup();
  connectClient(backend, 'owner');
  const [owner, sameOwner] = await Promise.all([login(), login()]);
  assert.equal(owner.user_id, sameOwner.user_id);
  const friendCard = await friends.createInvitation({}, createWriteContext());

  connectClient(backend, 'friend');
  const recipient = await login();
  const claimed = await friends.claimInvitation({ token: query(friendCard.share_path, 'token') }, createWriteContext());
  assert.equal(claimed.invitation.status, 'CLAIMED');
  assert.deepEqual((await friends.listFriends()).items, []);

  connectClient(backend, 'owner');
  await friends.confirmInvitation({ invitation_id: claimed.invitation.invitation_id, decision: 'ACCEPT' }, createWriteContext());
  const application = await applications.createApplication({
    description: '无图申请', price_cent: 1234, tag: '日用品'
  }, createWriteContext());
  const id = application.application_id;
  const card = await applications.shareApplication({
    application_id: id, expected_version: application.version, receiver_ids: [recipient.user_id]
  }, createWriteContext());

  connectClient(backend, 'other');
  await assert.rejects(applications.getInvitation(card.card_id), { code: 'INVITATION_INVALID' });
  assert.deepEqual((await approvals.listTodos()).items, []);

  connectClient(backend, 'friend');
  const invite = await applications.getInvitation(query(card.share_path, 'card_id'));
  assert.equal(invite.can_accept, true);
  await assert.rejects(applications.getApplication(id), { code: 'ACCESS_DENIED' });
  await applications.acceptInvitation({ invitation_id: invite.invitation.invitation_id }, createWriteContext());
  const detail = (await applications.getApplication(id)).application;
  assert.deepEqual((await approvals.listTodos()).items.map(item => item.application_id), [id]);
  const result = await approvals.submitApproval({ application_id: id, expected_version: detail.version,
    decision: 'APPROVE' }, createWriteContext());
  assert.equal(result.application_status, 'APPROVED');
  assert.deepEqual((await approvals.listTodos()).items, []);
  assert.equal((await approvals.listHistory()).items[0].application.application_id, id);

  connectClient(backend, 'owner');
  const latest = (await applications.getApplication(id)).application;
  await applications.setValidity({ application_id: id, expected_version: latest.version,
    consume_expires_at: backend.now() + 60000 }, createWriteContext());
  assert.equal((await applications.getApplication(id)).application.consume_expires_at, backend.now() + 60000);
});

test('申请提交已落库但响应丢失时，页面保留原幂等键，重试只产生一笔申请', async () => {
  const backend = setup();
  const keys = [];
  connectClient(backend, 'owner', ({ action, params }) => {
    if (action === 'applications.create') {
      keys.push(params.idempotency_key);
      if (keys.length === 1) throw new Error('transport dropped after commit');
    }
  });
  const page = createPage('../miniprogram/pages/applications/create');
  const destinations = [];
  wx.redirectTo = event => destinations.push(event.url);
  page.setData({ description: '纸巾', price: '10.01', tag: '日用品' });
  await page.submit();
  assert.match(page.data.writeError, /结果可能尚未确认/);
  assert.equal(page.data.description, '纸巾');
  await page.submit();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(destinations.length, 1);
  const { items } = await applications.listApplications();
  assert.equal(items.length, 1);
  assert.equal(items[0].price_cent, 1001);
  assert.equal(parsePrice('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(parsePrice('90071992547409.92'), null);
  assert.equal(parsePrice('0.001'), null);
});

test('会审待办只返回具有当前审批资格的未提交任务并排除过期记录', async () => {
  const backend = setup();
  await backend.login('owner');
  const one = await backend.login('one');
  const two = await backend.login('two');
  await backend.connect('owner', 'one');
  await backend.connect('owner', 'two');
  const input = { mode: 'JOINT', approver_ids: [one, two], review_rule: 'ALL_APPROVE' };
  const first = await backend.create('owner', input);
  const second = await backend.create('owner', input);
  const result = await backend.ok('one', 'approvals.todos', { limit: 1 });
  assert.equal(result.items.length, 1);
  assert.ok(result.next_cursor);
  assert.equal((await backend.ok('one', 'approvals.todos', { cursor: result.next_cursor, limit: 1 })).items.length, 1);
  assert.deepEqual((await backend.ok('owner', 'approvals.todos')).items, []);

  await backend.approve('one', first, { decision: 'REJECT', comment: '预算不合适' });
  assert.deepEqual((await backend.ok('one', 'approvals.todos')).items.map(item => item.application_id), [second.application_id]);
  assert.equal((await backend.ok('two', 'approvals.todos')).items.length, 2);
  backend.advance(24 * 60 * 60 * 1000);
  assert.deepEqual((await backend.ok('two', 'approvals.todos')).items, []);
});

test('登录失效后显式重试重新登录，云端内部异常不会进入客户端提示', async () => {
  const backend = setup();
  let loginCount = 0;
  connectClient(backend, 'owner', ({ action }, result) => {
    if (action === 'auth.login') loginCount += 1;
    if (action === 'applications.list' && loginCount === 1) {
      Object.assign(result, { code: 'AUTH_REQUIRED', message: 'internal detail', data: null });
    }
  });
  await assert.rejects(callApi('applications.list'), error =>
    error.code === 'AUTH_REQUIRED' && error.retryable && error.message !== 'internal detail');
  assert.equal(loginCount, 1);
  assert.deepEqual((await callApi('applications.list')).items, []);
  assert.equal(loginCount, 2);
});

test('上传前压缩并验证原图与输出上限，只返回云文件 ID', async () => {
  const backend = setup();
  connectClient(backend, 'owner');
  let uploadCount = 0;
  wx.getFileSystemManager = () => ({ statSync: path => ({ size: { large: 11 * 1024 ** 2, original: 500000, compressed: 180000 }[path] }) });
  wx.getImageInfo = async ({ src }) => src === 'original'
    ? { width: 3200, height: 1600, type: 'jpeg' } : { width: 1280, height: 640, type: 'jpeg' };
  wx.compressImage = async options => {
    assert.equal(options.compressedWidth, 1280);
    assert.equal(options.compressedHeight, 640);
    return { tempFilePath: 'compressed' };
  };
  wx.cloud.uploadFile = async ({ cloudPath, filePath }) => {
    uploadCount += 1;
    assert.match(cloudPath, /^uploads\/user_[^/]+\/[^/]+\.jpg$/);
    assert.equal(filePath, 'compressed');
    return { fileID: 'cloud://test/compressed.jpg' };
  };
  await assert.rejects(prepareImage('large'), { code: 'FILE_PROCESSING_FAILED' });
  assert.equal(await uploadImage('original'), 'cloud://test/compressed.jpg');
  assert.equal(uploadCount, 1);
});
