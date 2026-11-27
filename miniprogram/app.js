const { cloudEnv } = require('./config');
const { initCloud } = require('./shared/api');

App({
  onLaunch() {
    initCloud(cloudEnv);
  }
});
