'use strict';
const { createRepository, validId, validVersion } = require('./index');
const { key, opinionId, participantId, requireThat: need } = require('../../common/utils');

const isTime = value => Number.isSafeInteger(value) && value >= 0;
const validList = (value, limit, validItem) => Array.isArray(value) && value.length <= limit
  && value.every(validItem) && new Set(value).size === value.length;
const closedResults = ['APPROVED', 'REJECTED', 'EXPIRED'];

async function validateApplication(row, tx) {
  need(validId(row.owner_id) && await tx.get('users', row.owner_id), 'VALIDATION_FAILED', '申请人不存在');
  need(validVersion(row.version) && Number.isSafeInteger(row.price_cent) && row.price_cent > 0,
    'VALIDATION_FAILED', '申请版本或金额无效');
  need(isTime(row.created_at) && isTime(row.updated_at) && isTime(row.approval_deadline)
    && row.approval_deadline > row.created_at && (row.consume_expires_at == null || isTime(row.consume_expires_at)),
    'VALIDATION_FAILED', '申请时间字段无效');
  need(validList(row.image_ids, 9, id => typeof id === 'string' && id.length > 0 && id.length <= 256)
    && validList(row.participant_ids, 20, id => validId(id) && id !== row.owner_id)
    && validList(row.invitation_ids, 20, validId), 'VALIDATION_FAILED', '申请关联数量或标识无效');
}

async function validateOpinion(row, tx) {
  const { application_id: appId, approver_id: approverId } = row;
  need(validId(appId) && validId(approverId) && row._id === opinionId(appId, approverId),
    'VALIDATION_FAILED', '审批意见关联键无效');
  const application = await tx.get('applications', appId);
  const participant = await tx.get('approval_participants', participantId(appId, approverId));
  need(application && application.owner_id !== approverId
    && participant?.application_id === appId && participant.user_id === approverId
    && participant.qualification_status === 'ACTIVE', 'ACCESS_DENIED', '没有有效审批资格');
}

function createBusinessRepositories({ store, page, now }) {
  const users = createRepository(store, 'users', 'user_id', { page });
  const applications = createRepository(store, 'applications', 'application_id', { page, validate: validateApplication });
  const opinions = createRepository(store, 'opinions', 'opinion_id', { page, validate: validateOpinion });
  const reports = createRepository(store, 'reports', 'report_id', { page });

  async function insertReport({ reporter_id, opinion_id, reason }, tx) {
    need(tx, 'INTERNAL_ERROR', '持久化事务上下文缺失');
    const text = typeof reason === 'string' ? reason.trim() : '';
    need(validId(reporter_id) && validId(opinion_id) && text && [...text].length <= 500,
      'VALIDATION_FAILED', '举报人、意见或举报理由无效');
    need(await users.findById(reporter_id, tx) && await opinions.findById(opinion_id, tx), 'VALIDATION_FAILED', '举报关联对象不存在');
    return reports.insert({ report_id: key('report', reporter_id, opinion_id), reporter_id, opinion_id,
      reason: text, status: 'PENDING', reviewed_at: null, created_at: now() }, tx);
  }

  async function saveSummary(input, tx) {
    need(tx, 'INTERNAL_ERROR', '持久化事务上下文缺失');
    const { application_id, result_version, item_info, comments, result, purchase_advice = null, ai_status } = input;
    need(validId(application_id) && validVersion(result_version) && closedResults.includes(result)
      && item_info && typeof item_info === 'object' && !Array.isArray(item_info) && Array.isArray(comments)
      && ['PENDING', 'READY', 'FAILED'].includes(ai_status)
      && (purchase_advice === null || (typeof purchase_advice === 'string' && [...purchase_advice].length <= 2000)),
    'VALIDATION_FAILED', '总结字段无效');

    const application = await applications.findById(application_id, tx);
    need(application && closedResults.includes(application.status) && result_version <= application.version,
      'STATE_CONFLICT', '申请状态或结案版本无效');
    const summaryId = key('summary', application_id);
    const previous = await tx.get('summary_documents', summaryId);
    const allowSameVersion = previous && (previous.ai_status === 'PENDING' && ai_status !== 'PENDING'
      || previous.ai_status === 'FAILED' && ai_status === 'READY');
    if (previous && (previous.result_version > result_version
      || (previous.result_version === result_version && !allowSameVersion))) return { written: false, summary_id: summaryId };

    const at = now();
    await tx.set('summary_documents', summaryId, { application_id, result_version, item_info, comments, result, purchase_advice,
      ai_status, created_at: previous?.created_at ?? at, updated_at: at });
    return { written: true, summary_id: summaryId };
  }

  return { users, applications, opinions, reports, insertReport, saveSummary };
}

module.exports = { createBusinessRepositories };
