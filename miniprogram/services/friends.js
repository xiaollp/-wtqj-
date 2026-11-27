const { callApi } = require('../shared/api');

module.exports = {
  listFriends: params => callApi('friends.list', params),
  listInvitations: params => callApi('friends.invitations', params),
  createInvitation: (_, context) => callApi('friends.createInvitation', context),
  claimInvitation: (params, context) => callApi('friends.claimInvitation', { ...params, ...context }),
  confirmInvitation: (params, context) => callApi('friends.confirmInvitation', { ...params, ...context })
};
