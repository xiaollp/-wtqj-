// 模拟偏好不触发微信授权或真实消息发送。
const KEY = 'b.notifications.preferences.v1';
const types = ['RESULT', 'GROUP_TODO'];
function fail(message) {
  throw { code: 'VALIDATION_FAILED', message, retryable: false };
}
async function request(action, params) {
  const state = wx.getStorageSync(KEY) || {
    preferences: types.map(type => ({ type, enabled: false, last_auth_result: null, updated_at: Date.now() })),
    writes: {}
  };
  if (action === 'notifications.preferences.get') return { preferences: state.preferences };
  if (action !== 'notifications.preferences.update') fail('未知操作');
  if (!types.includes(params.type) || typeof params.enabled !== 'boolean' || !params.idempotency_key) fail('通知参数不合法');
  if (params.auth_result !== undefined && !['ACCEPT', 'REJECT', 'BAN'].includes(params.auth_result)) fail('授权结果不合法');
  if (params.enabled && params.auth_result !== 'ACCEPT') fail('开启提醒需要有效授权');
  const signature = JSON.stringify(params);
  const prior = state.writes[params.idempotency_key];
  if (prior) {
    if (prior.signature !== signature) throw { code: 'IDEMPOTENCY_CONFLICT', retryable: false };
    return prior.result;
  }
  const preference = state.preferences.find(item => item.type === params.type);
  preference.enabled = params.enabled;
  if (params.auth_result !== undefined) preference.last_auth_result = params.auth_result;
  preference.updated_at = Date.now();
  const result = { preferences: state.preferences.map(item => ({ ...item })) };
  state.writes[params.idempotency_key] = { signature, result };
  wx.setStorageSync(KEY, state);
  return result;
}
module.exports = { request };
