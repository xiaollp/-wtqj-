const { callApi } = require('../shared/api');
const { notificationsMock } = require('../config');
function invoke(action, params) {
  return notificationsMock
    ? require('../mocks/notifications').request(action, params)
    : callApi(action, params);
}
module.exports = {
  isMock: notificationsMock === true,
  getPreferences: () => invoke('notifications.preferences.get', {}),
  updatePreferences: (params, context) => invoke('notifications.preferences.update', { ...params, ...context })
};
