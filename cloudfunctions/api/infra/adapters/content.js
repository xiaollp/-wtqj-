'use strict';
const { fail } = require('../../common/errors');
// D 在此接入真实审核；未接入时拒绝提交，不能伪造 passed=true。
exports.checkOpinionContent = async () => fail('CONTENT_CHECK_UNAVAILABLE', '内容审核尚未接入，请稍后重试', true);
