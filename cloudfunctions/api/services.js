'use strict';
const crypto = require('node:crypto');
const { fail } = require('./common/errors');
const { buildAuth } = require('./common/auth');
const { key, hash, canonical, participantId, opinionId, requireThat: need } = require('./common/utils');
const { createIdempotency } = require('./infra/idempotency');
const { createBusinessRepositories } = require('./infra/repositories/business');
const { createOutboxRepository } = require('./infra/repositories/outbox');
const content = require('./infra/adapters/content');
const files = require('./infra/adapters/files');
const { createVisibility } = require('./infra/adapters/visibility');
const DAY = 86400000;
const summaryFields = ['description', 'price_cent', 'tag', 'status', 'mode', 'version', 'created_at', 'approval_deadline'];
const summary = a => ({ application_id: a._id, ...Object.fromEntries(summaryFields.map(k => [k, a[k]])) });
const brief = u => ({ user_id: u._id, nickname: u.nickname, avatar_file_id: u.avatar_file_id });
const self = u => ({ ...brief(u), account_status: u.account_status, created_at: u.created_at, updated_at: u.updated_at });
function createServices({ store, secret, clock = Date.now, adapters = {} }) {
  if (!store || typeof secret !== 'string' || secret.length < 32) throw new Error('store and secret (>=32 chars) required');
  const s = { store, secret, now: clock, adapters: { ...content, ...files, filterOpinionViews: createVisibility(store), ...adapters },
    requireUser: buildAuth(store), summary, brief, self };
  const contentCheck = s.adapters.checkOpinionContent;
  s.adapters.checkOpinionContent = async input => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(() => contentCheck(input)), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('审核暂不可用，请稍后重试'), {
        code: 'CONTENT_CHECK_UNAVAILABLE', retryable: true })), 1000);
    })]); } finally { clearTimeout(timer); }
  };
  s.userBrief = async (userId, tx = store) => {
    const u = await tx.get('users', userId); need(u, 'ACCESS_DENIED', '用户不可用'); return brief(u);
  };
  s.normalUser = async (userId, tx) => {
    const u = await tx.get('users', userId); need(u && u.account_status === 'NORMAL', 'VALIDATION_FAILED', '目标用户不可用'); return u;
  };
  s.requireApplicationAccess = async (userId, appId, operation, tx = store) => {
    const u = await tx.get('users', userId);
    need(u && u.account_status !== 'BANNED', 'ACCOUNT_RESTRICTED', '账号受限');
    const a = await tx.get('applications', appId);
    need(a, 'ACCESS_DENIED', '无权限查看或操作');
    const q = await tx.get('approval_participants', participantId(appId, userId));
    const owner = a.owner_id === userId;
    need(owner || (q && q.qualification_status !== 'REVOKED'), 'ACCESS_DENIED', '无权限查看或操作');
    if (operation !== 'VIEW') {
      need(u.account_status === 'NORMAL', 'ACCOUNT_RESTRICTED', '账号受限');
      if (operation === 'APPROVE') need(!owner && q && q.qualification_status === 'ACTIVE', 'ACCESS_DENIED', '没有审批资格');
      else need(owner && ['WITHDRAW', 'SET_VALIDITY', 'START_REVIEW'].includes(operation), 'ACCESS_DENIED', '无权限执行此操作');
    }
    return a;
  };
  s.version = (a, p) => need(a.version === p.expected_version, 'STATE_CONFLICT', '状态已更新，请刷新', { current_version: a.version, current_status: a.status });
  s.pending = a => need(a.status === 'PENDING' && clock() < a.approval_deadline, 'APPLICATION_CLOSED', '申请已结束或已到期');
  s.saveApp = async (tx, a) => {
    const { _id, version, ...fields } = a;
    const saved = await s.repositories.applications.updateIfVersion(_id, version, { ...fields, updated_at: clock() }, tx);
    a.version = saved.version;
    a.updated_at = saved.updated_at;
  };
  s.event = async (tx, a, type, participantIds = a.participant_ids) => {
    const eventId = key('event', a._id, a.version, type);
    if (await tx.get('outbox_events', eventId)) return;
    await tx.set('outbox_events', eventId, { type, aggregate_id: a._id, version: a.version, schema_version: 1,
      payload: { application_id: a._id, owner_id: a.owner_id, participant_ids: participantIds,
        status: a.status, final_decision: a.final_decision, expire_reason: a.expire_reason },
      status: 'PENDING', attempts: 0, next_retry_at: clock(), created_at: clock() });
  };
  s.close = async (tx, a, status, reason = null) => {
    const prior = a.status;
    a.status = status; a.expire_reason = reason;
    if (status === 'APPROVED' || status === 'REJECTED') a.final_decision = status;
    if (prior === 'PENDING') a.closed_at = clock();
    if (status === 'EXPIRED') a.expired_at = clock();
    for (const uid of a.participant_ids) {
      const qid = participantId(a._id, uid), q = await tx.get('approval_participants', qid);
      if (q && q.qualification_status === 'ACTIVE') { q.qualification_status = 'CLOSED'; await tx.set('approval_participants', qid, q); }
    }
    for (const iid of a.invitation_ids) {
      const invite = await tx.get('invitations', iid);
      if (invite && invite.status === 'PENDING') { invite.status = 'CLOSED'; await tx.set('invitations', iid, invite); }
    }
    await s.saveApp(tx, a);
    const type = status === 'WITHDRAWN' ? 'APPLICATION_WITHDRAWN' : prior === 'APPROVED' ? 'APPLICATION_CONSUME_EXPIRED' : 'APPLICATION_RESULT_FINALIZED';
    await s.event(tx, a, type);
  };
  s.expire = async appId => store.runTransaction(async tx => {
    const a = await tx.get('applications', appId); if (!a) return false;
    if (a.status === 'PENDING' && clock() >= a.approval_deadline) { await s.close(tx, a, 'EXPIRED', 'APPROVAL_TIMEOUT'); return true; }
    if (a.status === 'APPROVED' && a.consume_expires_at !== null && clock() >= a.consume_expires_at) {
      await s.close(tx, a, 'EXPIRED', 'CONSUME_TIMEOUT'); return true;
    }
    return false;
  });
  s.addParticipant = async (tx, a, uid, sourceType, sourceId, groupId = null) => {
    const qid = participantId(a._id, uid), old = await tx.get('approval_participants', qid);
    await tx.set('approval_participants', qid, { application_id: a._id, user_id: uid,
      source_type: sourceType, source_id: sourceId, group_id: groupId, decision: old?.decision || 'PENDING',
      qualification_status: 'ACTIVE', locked_at: clock(), created_at: old?.created_at ?? clock() });
    if (!a.participant_ids.includes(uid)) a.participant_ids.push(uid);
  };
  s.progress = async (a, viewer, tx = store) => {
    const participants = []; let approved = 0, rejected = 0;
    for (const uid of a.participant_ids) {
      const q = await tx.get('approval_participants', participantId(a._id, uid));
      if (!q || q.qualification_status === 'REVOKED') continue;
      const op = await tx.get('opinions', opinionId(a._id, uid));
      if (op?.decision === 'APPROVE') approved++; if (op?.decision === 'REJECT') rejected++;
      participants.push({ user: await s.userBrief(uid, tx), source_type: q.source_type,
        qualification_status: q.qualification_status, decision: op?.decision || 'PENDING',
        opinion: op ? (await s.adapters.filterOpinionViews(viewer, [op], tx))[0] : null });
    }
    return { approved_count: approved, rejected_count: rejected, pending_count: participants.length - approved - rejected,
      participants, application_status: a.status, version: a.version };
  };
  s.detail = async (a, viewer) => {
    const q = await store.get('approval_participants', participantId(a._id, viewer)), u = await store.get('users', viewer);
    const owner = viewer === a.owner_id, active = a.status === 'PENDING' && clock() < a.approval_deadline && u.account_status === 'NORMAL';
    return { ...summary(a), owner: await s.userBrief(a.owner_id), image_ids: a.image_ids, review_rule: a.review_rule,
      consume_expires_at: a.consume_expires_at, final_decision: a.final_decision, closed_at: a.closed_at,
      expired_at: a.expired_at, expire_reason: a.expire_reason, permissions: { can_view: true,
        can_approve: active && !owner && q?.qualification_status === 'ACTIVE' && q.decision === 'PENDING',
        can_withdraw: active && owner, can_start_review: active && owner && a.mode === 'NORMAL' && !a.opinion_count,
        can_set_validity: owner && u.account_status === 'NORMAL' && a.status === 'APPROVED' } };
  };
  s.invitation = async (i, viewer) => ({ invitation_id: i._id, kind: i.kind,
    status: ['CREATED', 'CLAIMED', 'PENDING'].includes(i.status) && clock() >= i.expires_at ? 'EXPIRED' : i.status,
    inviter: await s.userBrief(i.inviter_id), invitee: i.invitee_id ? await s.userBrief(i.invitee_id) : null,
    expires_at: i.expires_at, application_id: i.application_id || null, group_id: i.group_id || null });
  const idempotency = createIdempotency({ store, secret, now: clock });
  s.executeIdempotent = idempotency.executeIdempotent;
  s.compactIdempotency = idempotency.compactExpired;
  s.write = async (ctx, action, params, handler, prepare = async () => null, bootstrap = false) => {
    const identity = bootstrap ? { user_id: key('login', ctx.trustedContext.OPENID) } : await s.requireUser(ctx.trustedContext);
    const token = params.idempotency_key;
    const previous = await idempotency.read(identity.user_id, action, token, params);
    if (previous.hit) return previous.data;
    const prepared = await prepare(identity.user_id);
    return s.executeIdempotent(identity.user_id, action, token, params, async tx => {
      if (!bootstrap) await s.requireUser(ctx.trustedContext, { tx });
      return handler(tx, identity.user_id, prepared);
    });
  };
  s.page = async (collection, where, params, scope, transform = async r => r) => {
    const bound = hash({ collection, where, scope }); let after = null;
    if (params.cursor) {
      try {
        const [body, sig, extra] = params.cursor.split('.');
        const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
        need(!extra && sig?.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)), 'VALIDATION_FAILED', '分页游标无效');
        const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        need(decoded.scope === bound && Number.isSafeInteger(decoded.after.created_at) && typeof decoded.after._id === 'string', 'VALIDATION_FAILED', '分页游标无效'); after = decoded.after;
      } catch (_) { fail('VALIDATION_FAILED', '分页游标无效'); }
    }
    const rows = await store.scan(collection, { where, after, limit: params.limit + 1 });
    const visible = rows.slice(0, params.limit), items = [];
    for (const r of visible) { const item = await transform(r); if (item !== null) items.push(item); }
    let next = null;
    if (rows.length > params.limit) {
      const last = visible.at(-1), body = Buffer.from(canonical({ scope: bound, after: { _id: last._id, created_at: last.created_at } })).toString('base64url');
      next = body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
    }
    return { items, next_cursor: next };
  };
  s.redactOutput = async (value, userId) => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Promise.all(value.map(v => s.redactOutput(v, userId)));
    // 邀请预览只含受控元数据，接受前尚无正文读取资格。
    if (value.application_id && !value.kind) await s.requireApplicationAccess(userId, value.application_id, 'VIEW');
    if (value.opinion_id) {
      const op = await store.get('opinions', value.opinion_id);
      return op ? (await s.adapters.filterOpinionViews(userId, [op]))[0] : { ...value, comment: null, comment_visible: false, hidden_reason: 'REMOVED' };
    }
    const result = {};
    for (const [k, v] of Object.entries(value)) result[k] = await s.redactOutput(v, userId);
    return result;
  };
  s.expireApplications = async ({ batchSize = 100 } = {}) => {
    need(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 100, 'VALIDATION_FAILED', '批次大小应为1～100');
    const pending = await store.scan('applications', { where: { status: 'PENDING', approval_deadline: { $lte: clock() } }, order: 'asc', limit: batchSize });
    const approved = await store.scan('applications', { where: { status: 'APPROVED', consume_expires_at: { $gte: 1, $lte: clock() } },
      order: 'asc', limit: batchSize });
    let expired = 0;
    for (const a of [...pending, ...approved]) if (await s.expire(a._id)) expired++;
    return { scanned: pending.length + approved.length, expired };
  };
  s.repositories = createBusinessRepositories({ store, page: s.page, now: clock });
  s.outbox = createOutboxRepository({ store, now: clock });
  return s;
}
module.exports = { createServices, DAY, summary, brief, self };
