'use strict';
class BusinessError extends Error {
  constructor(code, message, retryable = false, data = null) {
    super(message); Object.assign(this, { code, retryable, data });
  }
}
function fail(code, message, retryable = false, data = null) {
  throw new BusinessError(code, message, retryable, data);
}
function toErrorResponse(error, requestId) {
  // 也接受 D 按通知约定抛出的结构化错误；未知异常不外泄。
  const known = error && typeof error.code === 'string' && /^[A-Z][A-Z_]+$/.test(error.code)
    && typeof error.message === 'string' && typeof error.retryable === 'boolean';
  return { code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : '服务暂不可用，请提供请求编号以便排查',
    request_id: requestId, data: known ? (error.data ?? null) : null,
    retryable: known ? error.retryable : false };
}
module.exports = { BusinessError, fail, toErrorResponse };
