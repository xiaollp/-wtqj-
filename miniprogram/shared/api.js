const MESSAGES = {
  AUTH_REQUIRED: '登录状态已失效，请重试',
  ACCESS_DENIED: '你没有权限查看或操作这条记录',
  ACCOUNT_RESTRICTED: '当前账号无法执行此操作',
  APPLICATION_CLOSED: '申请已结束或失效',
  STATE_CONFLICT: '申请状态已更新，请查看最新结果',
  DUPLICATE_OPINION: '你已审批这笔申请',
  IDEMPOTENCY_CONFLICT: '提交内容已变化，请重新操作',
  INVITATION_INVALID: '邀请已失效或无法接受',
  CONTENT_REJECTED: '锐评未通过审核，请修改后重试',
  CONTENT_CHECK_UNAVAILABLE: '锐评审核暂不可用，请稍后重试',
  DEPENDENCY_UNAVAILABLE: '相关服务暂不可用，请稍后重试',
  FILE_UPLOAD_FAILED: '图片上传失败，请重试',
  FILE_PROCESSING_FAILED: '图片处理失败，请更换图片后重试',
  CLOUD_UNAVAILABLE: '微信云开发暂不可用，请检查基础库和环境配置',
  NETWORK_ERROR: '连接失败，提交结果可能尚未确认，请重试',
  INVALID_RESPONSE: '服务响应异常，请重试',
  INTERNAL_ERROR: '服务暂不可用，请稍后重试',
  VALIDATION_FAILED: '请检查输入内容'
};

let ready = false;
let user = null;
let loginTask = null;
let loginContext = null;
let sequence = 0;

function apiError(code, requestId = '', retryable = false, message) {
  return Object.assign(new Error(message || MESSAGES[code] || '操作未完成，请稍后重试'), {
    code, request_id: requestId, retryable
  });
}

function createWriteContext() {
  sequence += 1;
  const random = () => Math.random().toString(36).slice(2, 13);
  return { idempotency_key: [Date.now().toString(36), sequence.toString(36), random(), random()].join('-') };
}

function initCloud(env) {
  ready = false;
  invalidateLogin();
  try {
    if (wx.cloud) {
      wx.cloud.init(env ? { env, traceUser: true } : { traceUser: true });
      ready = true;
    }
  } catch (_) {
    // 请求入口会将初始化失败转换成可显示的错误。
  }
}

function requireCloud() {
  if (!ready) throw apiError('CLOUD_UNAVAILABLE');
  return wx.cloud;
}

async function request(action, params) {
  const cloud = requireCloud();
  let response;
  try {
    response = await cloud.callFunction({ name: 'api', data: { action, params } });
  } catch (error) {
    throw apiError('NETWORK_ERROR', error && (error.requestID || error.requestId) || '', true);
  }

  const result = response && response.result;
  const requestId = result && typeof result.request_id === 'string' ? result.request_id : response && response.requestID;
  if (!result || typeof result.code !== 'string' || typeof result.message !== 'string'
      || typeof result.request_id !== 'string' || typeof result.retryable !== 'boolean'
      || !Object.prototype.hasOwnProperty.call(result, 'data')) {
    throw apiError('INVALID_RESPONSE', requestId, true);
  }
  if (result.code !== 'OK') throw apiError(result.code, requestId, result.retryable);
  return result.data;
}

function invalidateLogin() {
  user = null;
  loginContext = null;
  loginTask = null;
}

function login() {
  if (user) return Promise.resolve(user);
  if (loginTask) return loginTask;
  const context = loginContext || createWriteContext();
  loginContext = context;
  const task = request('auth.login', context).then(data => {
    if (!data || !data.user || typeof data.user.user_id !== 'string') {
      throw apiError('INVALID_RESPONSE', '', true);
    }
    if (loginTask === task) user = data.user;
    return data.user;
  }).catch(error => {
    if (loginTask === task && !error.retryable) loginContext = null;
    throw error;
  }).finally(() => {
    if (loginTask === task) loginTask = null;
  });
  loginTask = task;
  return task;
}

async function callApi(action, params = {}, options = {}) {
  const authenticated = options.requireLogin !== false;
  const actingUser = authenticated ? await login() : null;
  try {
    return await request(action, params);
  } catch (error) {
    if (authenticated && error.code === 'AUTH_REQUIRED') {
      if (user && user.user_id === actingUser.user_id) invalidateLogin();
      // 业务请求留给页面重试，沿用原参数和幂等键。
      throw apiError(error.code, error.request_id, true);
    }
    throw error;
  }
}

function updateCurrentUser(profile) {
  if (user && user.user_id === profile.user_id) user = profile;
}

function errorMessage(error) {
  return error && error.code && MESSAGES[error.code] || '操作未完成，请稍后重试';
}

function showError(error) {
  wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2500 });
}

module.exports = {
  initCloud, requireCloud, callApi, createWriteContext, showError, apiError,
  errorMessage, login, updateCurrentUser
};
