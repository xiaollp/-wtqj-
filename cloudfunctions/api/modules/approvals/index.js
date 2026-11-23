'use strict';
const { f, W, V, P } = require('../../common/validation');
const { fail } = require('../../common/errors');
const { hash, opinionId, participantId, requireThat: need } = require('../../common/utils');
function evaluateReview(rule, participants, opinions) {
  const decisions = opinions.map(o => o.decision), all = decisions.length === participants.length;
  if (rule === 'ONE_VETO' && decisions.includes('REJECT')) return { result: 'REJECTED', close_remaining: true };
  if (!all) return { result: 'PENDING', close_remaining: false };
  return { result: decisions.every(d => d === 'APPROVE') ? 'APPROVED' : 'REJECTED', close_remaining: true };
}
exports.evaluateReview = evaluateReview;
exports.register = (register, s) => {
  register('approvals.submit', { ...W, ...V, application_id: f.string(), decision: f.enum(['APPROVE', 'REJECT']), comment: f.string(0, 500, { optional: true }) }, async (p, ctx) => {
    need(p.decision === 'REJECT' ? !!p.comment : !p.comment, 'VALIDATION_FAILED', '拒绝时填写锐评，同意时不提交锐评');
    await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW'); await s.expire(p.application_id);
    return s.write(ctx, 'approvals.submit', p, async (tx, uid, checked) => {
      const a = await s.requireApplicationAccess(uid, p.application_id, 'VIEW', tx);
      const oid = opinionId(a._id, uid);
      need(!await tx.get('opinions', oid), 'DUPLICATE_OPINION', '你已审批该申请', { opinion_id: oid });
      s.pending(a); await s.requireApplicationAccess(uid, a._id, 'APPROVE', tx); s.version(a, p);
      if (p.decision === 'REJECT' && !(checked?.passed === true && checked.content_hash === hash(p.comment)
        && Number.isSafeInteger(checked.checked_at) && checked.checked_at >= 0)) fail('CONTENT_CHECK_UNAVAILABLE', '内容审核结果无效', true);
      const op = { _id: oid, application_id: a._id, approver_id: uid, decision: p.decision, comment: p.comment || null,
        content_status: 'VISIBLE', content_hash: p.comment ? hash(p.comment) : null, created_at: s.now() };
      await tx.set('opinions', oid, op); a.opinion_count++;
      const qid = participantId(a._id, uid), q = await tx.get('approval_participants', qid); q.decision = p.decision; await tx.set('approval_participants', qid, q);
      const opinions = [];
      for (const pid of a.participant_ids) { const o = await tx.get('opinions', opinionId(a._id, pid)); if (o) opinions.push(o); }
      const result = a.mode === 'NORMAL' ? (p.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED') : evaluateReview(a.review_rule, a.participant_ids, opinions).result;
      if (result === 'PENDING') await s.saveApp(tx, a); else await s.close(tx, a, result);
      return { opinion: (await s.adapters.filterOpinionViews(uid, [op], tx))[0], application_status: a.status,
        progress: await s.progress(a, uid, tx), version: a.version };
    }, async uid => {
      // 审核在事务外；只有仍有资格且待审批时才调用外部审核。
      const a = await s.requireApplicationAccess(uid, p.application_id, 'VIEW');
      if (await s.store.get('opinions', opinionId(a._id, uid))) need(false, 'DUPLICATE_OPINION', '你已审批该申请');
      s.pending(a); await s.requireApplicationAccess(uid, a._id, 'APPROVE'); s.version(a, p);
      return p.decision === 'REJECT' ? s.adapters.checkOpinionContent({ actor_id: uid, text: p.comment, request_id: ctx.request_id }) : null;
    });
  });
  register('approvals.progress', { application_id: f.string() }, async (p, ctx) => {
    await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW'); await s.expire(p.application_id);
    return s.progress(await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW'), ctx.user_id);
  });
  register('approvals.history', { ...P, from_to: f.array(f.int(0), 2, 2, { optional: true }) }, async (p, ctx) => {
    if (p.from_to) need(p.from_to[0] <= p.from_to[1], 'VALIDATION_FAILED', '开始时间不能晚于结束时间');
    return s.page('opinions', { approver_id: ctx.user_id, ...(p.from_to ? { created_at: { $gte: p.from_to[0], $lte: p.from_to[1] } } : {}) }, p, ctx.user_id,
      async op => {
        await s.expire(op.application_id);
        try { const a = await s.requireApplicationAccess(ctx.user_id, op.application_id, 'VIEW');
          return { application: s.summary(a), opinion: (await s.adapters.filterOpinionViews(ctx.user_id, [op]))[0] };
        } catch (e) { if (e.code === 'ACCESS_DENIED') return null; throw e; }
      });
  });
};
