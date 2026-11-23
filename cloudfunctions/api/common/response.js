'use strict';
exports.success = (data, requestId) => ({ code: 'OK', message: '成功', request_id: requestId, data, retryable: false });
