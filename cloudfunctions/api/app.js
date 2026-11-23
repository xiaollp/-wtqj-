'use strict';
const crypto = require('node:crypto');
const { createServices } = require('./services');
const { fail, toErrorResponse } = require('./common/errors');
const { success } = require('./common/response');
const { validateParams } = require('./common/validation');
const { requireThat: need } = require('./common/utils');
const moduleNames = ['auth', 'friends', 'applications', 'approvals', 'reviews', 'groups'];
function createApi(options) {
  const services = createServices(options), routes = new Map();
  function register(action, schema, handler, flags = {}) {
    if (routes.has(action)) throw new Error('重复的 action: ' + action);
    routes.set(action, { schema, handler, ...flags });
  }
  for (const name of moduleNames) require('./modules/' + name).register(register, services);
  // D 的动作映射由可信服务端代码注入，不允许客户端选择模块路径。
  for (const [action, entry] of Object.entries(options.extensions || {})) {
    if (!/^(comments|statistics|notifications|artifacts)\.[A-Za-z]+$/.test(action)) throw new Error('扩展模块动作不允许: ' + action);
    if (typeof entry === 'function') register(action, null, entry);
    else register(action, entry.schema, entry.handler);
  }
  async function dispatch(event, trustedContext) {
    const requestId = crypto.randomUUID();
    try {
      need(trustedContext && typeof trustedContext.OPENID === 'string' && !!trustedContext.OPENID, 'AUTH_REQUIRED', '请从已登录的小程序调用');
      need(event && typeof event === 'object' && !Array.isArray(event) && Object.keys(event).every(k => ['action', 'params'].includes(k)), 'VALIDATION_FAILED', '请求格式应为action与params');
      need(typeof event.action === 'string' && event.action.length <= 100, 'VALIDATION_FAILED', 'action无效');
      const route = routes.get(event.action); if (!route) fail('VALIDATION_FAILED', '未知接口动作');
      const params = route.schema ? validateParams(event.params ?? {}, route.schema) : event.params ?? {};
      need(params && typeof params === 'object' && !Array.isArray(params), 'VALIDATION_FAILED', 'params必须为对象');
      const ctx = { request_id: requestId, trustedContext };
      if (!route.login) Object.assign(ctx, await services.requireUser(trustedContext, { allowLimitedRead: !Object.hasOwn(route.schema || params, 'idempotency_key') }));
      const data = await route.handler(params, ctx);
      return success(route.login ? data : await services.redactOutput(data, ctx.user_id), requestId);
    } catch (error) {
      if (options.logger) options.logger({ request_id: requestId, action: typeof event?.action === 'string' ? event.action : null,
        code: toErrorResponse(error, requestId).code });
      return toErrorResponse(error, requestId);
    }
  }
  return { dispatch, services, contracts: () => Object.fromEntries([...routes].map(([action, r]) => [action, r.schema])) };
}
module.exports = { createApi };
