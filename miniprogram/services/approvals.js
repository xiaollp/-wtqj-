const { callApi } = require('../shared/api');

module.exports = {
  submitApproval: (params, context) => callApi('approvals.submit', { ...params, ...context }),
  listTodos: params => callApi('approvals.todos', params),
  listHistory: params => callApi('approvals.history', params),
  getProgress: applicationId => callApi('approvals.progress', { application_id: applicationId })
};
