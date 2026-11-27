const { callApi } = require('../shared/api');

module.exports = {
  startReview: (params, context) => callApi('reviews.start', { ...params, ...context }),
  getProgress: applicationId => callApi('reviews.progress', { application_id: applicationId })
};
