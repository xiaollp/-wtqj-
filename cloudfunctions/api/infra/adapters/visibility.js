'use strict';
const { key } = require('../../common/utils');
// D可替换此工厂；使用当前下架/拉黑/账号数据，包含幂等响应重放。
exports.createVisibility = store => async (viewerId, opinions, tx = store) => {
  const result = [];
  for (const opinion of opinions) {
    const user = await tx.get('users', opinion.approver_id);
    const block = await tx.get('blocks', key('block', viewerId, opinion.approver_id));
    const removed = opinion.content_status !== 'VISIBLE' || !user || user.account_status !== 'NORMAL';
    const blocked = !!block && block.active !== false;
    const visible = opinion.decision === 'REJECT' && !removed && !blocked;
    result.push({ opinion_id: opinion._id, application_id: opinion.application_id, approver_id: opinion.approver_id,
      decision: opinion.decision, comment: visible ? opinion.comment : null, comment_visible: visible,
      hidden_reason: opinion.decision === 'REJECT' ? (removed ? 'REMOVED' : blocked ? 'BLOCKED' : null) : null,
      created_at: opinion.created_at });
  }
  return result;
};
