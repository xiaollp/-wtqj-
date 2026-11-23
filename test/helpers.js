'use strict';
const assert = require('node:assert/strict');
const { createApi } = require('../cloudfunctions/api/app');
const { MemoryStore } = require('../cloudfunctions/api/infra/memory-store');
const { hash } = require('../cloudfunctions/api/common/utils');
function setup(options = {}) {
  let now = 1795400000000, sequence = 0;
  const store = options.store || new MemoryStore();
  const api = createApi({ store, secret: 'local-tests-only-do-not-use-in-cloud-123456', clock: () => now,
    adapters: { checkOpinionContent: async ({ text }) => ({ passed: true, content_hash: hash(text), checked_at: now }), ...options.adapters } });
  const call = (who, action, params = {}) => api.dispatch({ action, params }, { OPENID: who });
  const ok = async (who, action, params = {}) => {
    const response = await call(who, action, params);
    assert.equal(response.code, 'OK', action + ': ' + JSON.stringify(response)); return response.data;
  };
  const w = (who, action, params = {}) => ok(who, action, { idempotency_key: 'test_' + (++sequence), ...params });
  const login = async who => (await w(who, 'auth.login')).user.user_id;
  const connect = async (a, b) => {
    const invitation = await w(a, 'friends.createInvitation');
    const token = new URL('https://local.invalid' + invitation.share_path).searchParams.get('token');
    await w(b, 'friends.claimInvitation', { token });
    await w(a, 'friends.confirmInvitation', { invitation_id: invitation.invitation_id, decision: 'ACCEPT' });
  };
  const create = (who, extra = {}) => w(who, 'applications.create', { description: '学习用键盘', price_cent: 19900, tag: '数码', ...extra });
  const get = async (who, app) => (await ok(who, 'applications.get', { application_id: typeof app === 'string' ? app : app.application_id })).application;
  const share = async (owner, approver, uid, app) => {
    const current = await get(owner, app);
    const invitation = await w(owner, 'applications.share', { application_id: current.application_id, expected_version: current.version, receiver_ids: [uid] });
    await w(approver, 'applications.acceptInvitation', { invitation_id: invitation.receiver_status[0].invitation_id });
    return invitation;
  };
  const approve = async (who, app, extra = {}) => {
    const current = await get(who, app);
    return w(who, 'approvals.submit', { application_id: current.application_id, expected_version: current.version, decision: 'APPROVE', ...extra });
  };
  return { api, store, call, ok, w, login, connect, create, get, share, approve,
    advance: ms => { now += ms; }, now: () => now };
}
async function pair(options) {
  const e = setup(options); e.owner = await e.login('owner'); e.friend = await e.login('friend');
  await e.connect('owner', 'friend'); return e;
}
module.exports = { setup, pair };
