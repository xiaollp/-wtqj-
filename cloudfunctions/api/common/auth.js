'use strict';
const { key, requireThat } = require('./utils');
exports.buildAuth = store => async function requireUser(context, options = {}) {
  requireThat(context && typeof context.OPENID === 'string' && context.OPENID.length > 0, 'AUTH_REQUIRED', '请先登录');
  const user = await (options.tx || store).get('users', key('user', context.OPENID));
  requireThat(user, 'AUTH_REQUIRED', '请先调用登录接口');
  requireThat(user.account_status !== 'BANNED' && (user.account_status === 'NORMAL' || options.allowLimitedRead), 'ACCOUNT_RESTRICTED', '账号受限');
  return { user_id: user._id, account_status: user.account_status };
};
exports.requireUser = (...args) => require('./bindings').get().requireUser(...args);
