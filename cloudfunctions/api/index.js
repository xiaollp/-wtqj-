'use strict';
const crypto = require('node:crypto');
const { createApi } = require('./app');
const { CloudStore } = require('./infra/cloud-store');
const { configure } = require('./common/bindings');
const { toErrorResponse } = require('./common/errors');
let runtime, cloud;
exports.main = async event => {
  try {
    if (!runtime) {
      cloud = require('wx-server-sdk'); cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      runtime = createApi({ store: new CloudStore(cloud.database({ throwOnNotFound: false })), secret: process.env.APP_SECRET,
        extensions: require('./modules/extensions'), logger: value => console.error(JSON.stringify(value)) });
      configure(runtime.services);
    }
    // 可信身份来自SDK，不接收event.user_id / event.context。
    return await runtime.dispatch(event, cloud.getWXContext());
  } catch (_) {
    return toErrorResponse(new Error('Initialization failed'), crypto.randomUUID());
  }
};
