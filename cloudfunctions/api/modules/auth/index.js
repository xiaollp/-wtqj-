'use strict';
const { f, W } = require('../../common/validation');
const { key, requireThat: need } = require('../../common/utils');
exports.register = (register, s) => {
  register('auth.login', W, async (p, ctx) => s.write(ctx, 'auth.login', p, async tx => {
    const uid = key('user', ctx.trustedContext.OPENID); let user = await tx.get('users', uid);
    if (!user) {
      user = { _id: uid, openid: ctx.trustedContext.OPENID, nickname: null, avatar_file_id: null,
        account_status: 'NORMAL', violation_count: 0, created_at: s.now(), updated_at: s.now() };
      const { _id, ...record } = user;
      await s.repositories.users.insert({ ...record, user_id: _id }, tx);
    }
    return { user: s.self(user) };
  }, undefined, true), { login: true });
  register('auth.profile', { ...W, nickname: f.string(1, 64, { optional: true }), avatar_file_id: f.string(1, 256, { optional: true }) }, async (p, ctx) => {
    need(p.nickname !== undefined || p.avatar_file_id !== undefined, 'VALIDATION_FAILED', '请提供昵称或头像');
    return s.write(ctx, 'auth.profile', p, async (tx, uid) => {
      const user = await tx.get('users', uid);
      for (const k of ['nickname', 'avatar_file_id']) if (p[k] !== undefined) user[k] = p[k];
      user.updated_at = s.now(); await tx.set('users', uid, user); return { user: s.self(user) };
    }, async uid => p.avatar_file_id ? s.adapters.verifyAvatar(uid, p.avatar_file_id) : null);
  });
};
