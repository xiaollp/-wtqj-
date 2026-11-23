'use strict';
// 仅供受控触发器使用的独立入口；没有注册公开action。
// 在云控制台为同一代码包配置维护函数，入口设为 maintenance.main。
const { createServices } = require('./services');
const { CloudStore } = require('./infra/cloud-store');
const crypto = require('node:crypto');
const { fail } = require('./common/errors');
exports.main = async (event = {}) => {
  const configured = process.env.MAINTENANCE_TOKEN, supplied = event.maintenance_token;
  if (typeof configured !== 'string' || configured.length < 32 || typeof supplied !== 'string'
    || Buffer.byteLength(supplied) !== Buffer.byteLength(configured)
    || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured)))
    fail('AUTH_REQUIRED', '仅允许受控维护任务调用');
  const cloud = require('wx-server-sdk'); cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const s = createServices({ store: new CloudStore(cloud.database({ throwOnNotFound: false })), secret: process.env.APP_SECRET });
  return s.expireApplications({ batchSize: 100 });
};
