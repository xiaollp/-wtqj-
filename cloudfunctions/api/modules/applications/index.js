'use strict';
const { f, W, V, P } = require('../../common/validation');
const { id, key, pairId, requireThat: need } = require('../../common/utils');
const { DAY } = require('../../services');
const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];
exports.register = (register, s) => {
  const prepareApp = async (ctx, appId) => { await s.requireApplicationAccess(ctx.user_id, appId, 'VIEW'); await s.expire(appId); };
  register('applications.create', { ...W, description: f.string(1, 1000), price_cent: f.int(),
    tag: f.enum(['数码', '服饰', '零食', '游戏', '日用品']), image_ids: f.array(f.string(1, 256), 0, 9, { default: [], unique: true }),
    approval_hours: f.enum([12, 24, 72], { default: 24 }), mode: f.enum(['NORMAL', 'JOINT'], { default: 'NORMAL' }),
    approver_ids: f.array(f.string(), 2, 3, { optional: true, unique: true, sorted: true }),
    review_rule: f.enum(['ALL_APPROVE', 'ONE_VETO'], { optional: true }) }, async (p, ctx) => {
    need(p.mode === 'JOINT' ? !!p.approver_ids : p.approver_ids === undefined && p.review_rule === undefined,
      'VALIDATION_FAILED', '会审名单和规则必须与申请模式一致');
    if (p.mode === 'JOINT' && !p.review_rule) p.review_rule = 'ALL_APPROVE';
    return s.write(ctx, 'applications.create', p, async (tx, uid, refs) => {
      const appId = id('app'), at = s.now();
      const a = { _id: appId, owner_id: uid, description: p.description, price_cent: p.price_cent, tag: p.tag,
        image_ids: p.image_ids, approval_hours: p.approval_hours, approval_deadline: at + p.approval_hours * 3600000,
        mode: p.mode, review_rule: p.review_rule || null, group_id: null, status: 'PENDING', version: 1,
        participant_ids: [], invitation_ids: [], opinion_count: 0, consume_expires_at: null, final_decision: null,
        closed_at: null, expired_at: null, expire_reason: null, created_at: at, updated_at: at };
      for (const [i, ref] of refs.entries()) {
        const fid = key('file', ref.file_id), old = await tx.get('file_refs', fid);
        need(!old || (old.owner_id === uid && !old.application_id), 'VALIDATION_FAILED', '图片已绑定其他申请或归属不符');
        await tx.set('application_images', key('image', appId, ref.file_id), {
          ...ref, application_id: appId, owner_id: uid, position: i + 1, created_at: at });
        await tx.set('file_refs', fid, { ...ref, owner_id: uid, application_id: appId, kind: 'APPLICATION_IMAGE', created_at: old?.created_at ?? at });
      }
      if (p.mode === 'JOINT') for (const friendId of p.approver_ids) {
        need(friendId !== uid && (await tx.get('user_connections', pairId(uid, friendId)))?.status === 'CONFIRMED', 'VALIDATION_FAILED', '请仅选择已确认好友且不能选择本人');
        await s.normalUser(friendId, tx); await s.addParticipant(tx, a, friendId, 'JOINT', appId);
      }
      const { _id, ...record } = a;
      await s.repositories.applications.insert({ ...record, application_id: _id }, tx);
      if (a.mode === 'JOINT') await s.event(tx, a, 'APPLICATION_PARTICIPANTS_READY');
      return { application_id: appId, status: a.status, version: a.version, approval_deadline: a.approval_deadline, share_info: null };
    }, async uid => {
      const refs = await s.adapters.verifyImages(uid, p.image_ids);
      need(Array.isArray(refs) && refs.length === p.image_ids.length && refs.every((r, i) => r.file_id === p.image_ids[i]
        && Number.isSafeInteger(r.size_bytes) && r.size_bytes > 0 && r.size_bytes <= 200 * 1024
        && Number.isSafeInteger(r.width) && Number.isSafeInteger(r.height) && r.width > 0 && r.height > 0 && Math.max(r.width, r.height) <= 1280),
      'DEPENDENCY_UNAVAILABLE', '图片核验结果无效');
      return refs;
    });
  });
  register('applications.list', { ...P, status: f.enum(statuses, { optional: true }) }, async (p, ctx) => s.page('applications', {
    owner_id: ctx.user_id, ...(p.status ? { status: p.status } : {}) }, p, ctx.user_id, async r => {
    await s.expire(r._id); const a = await s.store.get('applications', r._id);
    return !p.status || a.status === p.status ? s.summary(a) : null;
  }));
  register('applications.get', { application_id: f.string() }, async (p, ctx) => {
    await prepareApp(ctx, p.application_id);
    const a = await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW');
    return { application: await s.detail(a, ctx.user_id), progress: await s.progress(a, ctx.user_id) };
  });
  register('applications.share', { ...W, ...V, application_id: f.string(), receiver_ids: f.array(f.string(), 1, 10, { unique: true, sorted: true }) }, async (p, ctx) => {
    await prepareApp(ctx, p.application_id);
    return s.write(ctx, 'applications.share', p, async (tx, uid) => {
      const a = await s.requireApplicationAccess(uid, p.application_id, 'WITHDRAW', tx); s.pending(a); s.version(a, p);
      need(a.mode === 'NORMAL', 'VALIDATION_FAILED', '仅普通申请可定向分享');
      const cardId = id('card'), expires = Math.min(s.now() + DAY, a.approval_deadline), receiverStatus = []; let changed = false;
      for (const receiver of p.receiver_ids) {
        need(receiver !== uid && (await tx.get('user_connections', pairId(uid, receiver)))?.status === 'CONFIRMED', 'VALIDATION_FAILED', '请仅邀请已确认好友');
        await s.normalUser(receiver, tx);
        const iid = key('approvalinvite', a._id, receiver); let i = await tx.get('invitations', iid);
        if (!i) {
          need(a.invitation_ids.length < 20, 'VALIDATION_FAILED', '每笔普通申请最多邀请20人');
          i = { _id: iid, kind: 'APPROVAL', inviter_id: uid, invitee_id: receiver, application_id: a._id,
            status: 'PENDING', expires_at: expires, created_at: s.now(), updated_at: s.now() };
          a.invitation_ids.push(iid); await tx.set('invitations', iid, i); changed = true;
        }
        need(s.now() < i.expires_at && ['PENDING', 'ACCEPTED'].includes(i.status), 'INVITATION_INVALID', '已有邀请已关闭或过期，请重新创建申请');
        await tx.set('share_receivers', key('receiver', cardId, receiver), { card_id: cardId, user_id: receiver, invitation_id: iid, created_at: s.now() });
        receiverStatus.push({ user_id: receiver, invitation_id: iid, status: i.status });
      }
      await tx.set('share_cards', cardId, { application_id: a._id, sharer_id: uid, receiver_ids: p.receiver_ids, expires_at: expires, created_at: s.now() });
      if (changed) await s.saveApp(tx, a);
      return { card_id: cardId, share_path: '/pages/applications/invitation?card_id=' + cardId, expires_at: expires, receiver_status: receiverStatus, version: a.version };
    });
  });
  register('applications.getInvitation', { card_id: f.string() }, async (p, ctx) => {
    const c = await s.store.get('share_cards', p.card_id);
    need(c && (c.sharer_id === ctx.user_id || c.receiver_ids.includes(ctx.user_id)), 'INVITATION_INVALID', '邀请无效');
    if (c.sharer_id === ctx.user_id) return { card_id: c._id, invitation: null, can_accept: false };
    const i = await s.store.get('invitations', key('approvalinvite', c.application_id, ctx.user_id));
    need(i, 'INVITATION_INVALID', '邀请无效'); await s.expire(c.application_id);
    const a = await s.store.get('applications', c.application_id), fresh = await s.store.get('invitations', i._id);
    const inviter = await s.store.get('users', fresh.inviter_id);
    return { card_id: c._id, invitation: await s.invitation(fresh, ctx.user_id),
      can_accept: ctx.account_status === 'NORMAL' && inviter?.account_status === 'NORMAL'
        && fresh.status === 'PENDING' && s.now() < Math.min(c.expires_at, fresh.expires_at) && a.status === 'PENDING' };
  });
  register('applications.acceptInvitation', { ...W, invitation_id: f.string() }, async (p, ctx) => {
    const invitation = await s.store.get('invitations', p.invitation_id);
    need(invitation && invitation.kind === 'APPROVAL' && invitation.invitee_id === ctx.user_id, 'INVITATION_INVALID', '邀请无效');
    await s.expire(invitation.application_id);
    return s.write(ctx, 'applications.acceptInvitation', p, async (tx, uid) => {
      const i = await tx.get('invitations', p.invitation_id), a = await tx.get('applications', i.application_id);
      if (i.status === 'ACCEPTED') return { invitation_id: i._id, status: i.status, application_id: a._id, version: a.version };
      need(i.status === 'PENDING' && s.now() < i.expires_at && a.mode === 'NORMAL', 'INVITATION_INVALID', '邀请已关闭或过期');
      s.pending(a); await s.normalUser(i.inviter_id, tx);
      need((await tx.get('user_connections', pairId(uid, i.inviter_id)))?.status === 'CONFIRMED', 'INVITATION_INVALID', '好友关系不可用');
      i.status = 'ACCEPTED'; i.updated_at = s.now(); await tx.set('invitations', i._id, i);
      await s.addParticipant(tx, a, uid, 'SHARE', i._id); await s.saveApp(tx, a);
      await s.event(tx, a, 'APPLICATION_PARTICIPANTS_READY', [uid]);
      return { invitation_id: i._id, status: i.status, application_id: a._id, version: a.version };
    });
  });
  register('applications.invitations', { ...P, direction: f.enum(['SENT', 'RECEIVED']), status: f.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'CLOSED'], { optional: true }) },
    async (p, ctx) => s.page('invitations', { kind: 'APPROVAL', [p.direction === 'SENT' ? 'inviter_id' : 'invitee_id']: ctx.user_id }, p, ctx.user_id,
      async i => {
        await s.expire(i.application_id); const view = await s.invitation(await s.store.get('invitations', i._id), ctx.user_id);
        return !p.status || view.status === p.status ? view : null;
      }));
  register('applications.withdraw', { ...W, ...V, application_id: f.string() }, async (p, ctx) => {
    await prepareApp(ctx, p.application_id);
    return s.write(ctx, 'applications.withdraw', p, async (tx, uid) => {
      const a = await s.requireApplicationAccess(uid, p.application_id, 'WITHDRAW', tx); s.pending(a); s.version(a, p);
      await s.close(tx, a, 'WITHDRAWN'); return { application_id: a._id, status: a.status, version: a.version };
    });
  });
  register('applications.setValidity', { ...W, ...V, application_id: f.string(), consume_expires_at: f.int() }, async (p, ctx) => {
    await prepareApp(ctx, p.application_id);
    return s.write(ctx, 'applications.setValidity', p, async (tx, uid) => {
      const a = await s.requireApplicationAccess(uid, p.application_id, 'SET_VALIDITY', tx);
      need(a.status === 'APPROVED' && (!a.consume_expires_at || s.now() < a.consume_expires_at), 'APPLICATION_CLOSED', '申请已结束或失效');
      s.version(a, p); need(p.consume_expires_at > s.now(), 'VALIDATION_FAILED', '有效期必须晚于当前时间');
      a.consume_expires_at = p.consume_expires_at; await s.saveApp(tx, a); await s.event(tx, a, 'APPLICATION_VALIDITY_CHANGED');
      return { application_id: a._id, status: a.status, consume_expires_at: a.consume_expires_at, version: a.version };
    });
  });
  register('support.getFileUrls', { file_ids: f.array(f.string(1, 256), 1, 9, { unique: true }) }, async (p, ctx) => {
    // file_refs 由 D 的上传归属服务创建，避免按任意 file_id 获得临时地址。
    for (const fid of p.file_ids) {
      const ref = await s.store.get('file_refs', key('file', fid)); need(ref, 'ACCESS_DENIED', '无权限预览该文件');
      if (ref.application_id) await s.requireApplicationAccess(ctx.user_id, ref.application_id, 'VIEW');
      else {
        let allowed = ref.owner_id === ctx.user_id;
        if (!allowed && ref.kind === 'AVATAR') {
          allowed = (await s.store.get('user_connections', pairId(ctx.user_id, ref.owner_id)))?.status === 'CONFIRMED';
          if (!allowed) allowed = (await s.store.scan('groups', { where: { member_ids: { $all: [ctx.user_id, ref.owner_id] } }, limit: 1 })).length > 0;
          if (!allowed) allowed = (await s.store.scan('applications', { where: { participant_ids: { $all: [ctx.user_id, ref.owner_id] } }, limit: 1 })).length > 0;
        }
        need(allowed, 'ACCESS_DENIED', '无权限预览该文件');
      }
    }
    return { items: await s.adapters.getTemporaryUrls(p.file_ids) };
  });
};
