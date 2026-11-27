const { callApi } = require('../shared/api');

module.exports = {
  createApplication: (params, context) => callApi('applications.create', { ...params, ...context }),
  listApplications: params => callApi('applications.list', params),
  getApplication: applicationId => callApi('applications.get', { application_id: applicationId }),
  shareApplication: (params, context) => callApi('applications.share', { ...params, ...context }),
  getInvitation: cardId => callApi('applications.getInvitation', { card_id: cardId }),
  listInvitations: params => callApi('applications.invitations', params),
  acceptInvitation: (params, context) => callApi('applications.acceptInvitation', { ...params, ...context }),
  withdrawApplication: (params, context) => callApi('applications.withdraw', { ...params, ...context }),
  setValidity: (params, context) => callApi('applications.setValidity', { ...params, ...context }),
  getFileUrls: fileIds => callApi('support.getFileUrls', { file_ids: fileIds })
};
