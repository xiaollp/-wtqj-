'use strict';
const { f, W, V } = require('../../common/validation');
const { pairId, participantId, requireThat: need } = require('../../common/utils');
exports.register = (register, s) => {
  register('reviews.start', { ...W, ...V, application_id: f.string(), approver_ids: f.array(f.string(), 2, 3, { unique: true, sorted: true }),
    rule: f.enum(['ALL_APPROVE', 'ONE_VETO'], { default: 'ALL_APPROVE' }) }, async (p, ctx) => {
    await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW'); await s.expire(p.application_id);
    return s.write(ctx, 'reviews.start', p, async (tx, uid) => {
      const a = await s.requireApplicationAccess(uid, p.application_id, 'START_REVIEW', tx); s.pending(a); s.version(a, p);
      need(a.mode === 'NORMAL' && a.opinion_count === 0, 'STATE_CONFLICT', '申请不能切换为会审');
      for (const friendId of p.approver_ids) {
        need(friendId !== uid && (await tx.get('user_connections', pairId(uid, friendId)))?.status === 'CONFIRMED', 'VALIDATION_FAILED', '请仅选择已确认好友');
        await s.normalUser(friendId, tx);
      }
      for (const oldUid of a.participant_ids) {
        const qid = participantId(a._id, oldUid), q = await tx.get('approval_participants', qid);
        q.qualification_status = 'REVOKED'; await tx.set('approval_participants', qid, q);
      }
      for (const iid of a.invitation_ids) {
        const i = await tx.get('invitations', iid);
        if (i.status === 'PENDING') { i.status = 'CLOSED'; await tx.set('invitations', iid, i); }
      }
      a.mode = 'JOINT'; a.review_rule = p.rule; a.participant_ids = [];
      for (const uid of p.approver_ids) await s.addParticipant(tx, a, uid, 'JOINT', a._id);
      await s.saveApp(tx, a); await s.event(tx, a, 'APPLICATION_PARTICIPANTS_READY');
      return { application_id: a._id, rule: a.review_rule, approver_ids: a.participant_ids, status: a.status, version: a.version };
    });
  });
  register('reviews.progress', { application_id: f.string() }, async (p, ctx) => {
    const a = await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW');
    need(a.mode === 'JOINT', 'VALIDATION_FAILED', '此申请不是多人会审'); await s.expire(a._id);
    return s.progress(await s.requireApplicationAccess(ctx.user_id, a._id, 'VIEW'), ctx.user_id);
  });
};
