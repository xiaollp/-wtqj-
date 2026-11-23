'use strict';
const { fail } = require('../../common/errors');
exports.verifyImages = async (actorId, fileIds) => {
  if (!fileIds.length) return [];
  fail('DEPENDENCY_UNAVAILABLE', '文件归属和元数据核验尚未接入', true);
};
exports.verifyAvatar = async () => fail('DEPENDENCY_UNAVAILABLE', '头像文件核验尚未接入', true);
exports.getTemporaryUrls = async () => fail('DEPENDENCY_UNAVAILABLE', '私有文件预览尚未接入', true);
