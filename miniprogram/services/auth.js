const { callApi, login, updateCurrentUser } = require('../shared/api');

async function updateProfile(params, context) {
  const data = await callApi('auth.profile', { ...params, ...context });
  updateCurrentUser(data.user);
  return data;
}

module.exports = { login, updateProfile };
