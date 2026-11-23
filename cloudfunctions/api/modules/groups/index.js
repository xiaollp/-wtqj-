'use strict';
const { f, W, V, P } = require('../../common/validation');
const { id, key, pairId, requireThat: need } = require('../../common/utils');
const { DAY } = require('../../services');
const groupBrief = g => ({ group_id: g._id, name: g.name, creator_id: g.creator_id, member_count: g.member_ids.length, created_at: g.created_at });
exports.register = (register, s) => {
  const member = async (tx, groupId, uid) => {
    const group = await tx.get('groups', groupId);
    need(group && group.member_ids.includes(uid), 'ACCESS_DENIED', '你不是该小组成员'); return group;
  };
  register('groups.create', { ...W, name: f.string(1, 64) }, async (p, ctx) => {
    p.name = p.name.normalize('NFKC').trim(); need(p.name.length > 0 && p.name.length <= 64, 'VALIDATION_FAILED', '小组名称无效');
    return s.write(ctx, 'groups.create', p, async (tx, uid) => {
      const nameId = key('groupname', p.name); need(!await tx.get('unique_keys', nameId), 'VALIDATION_FAILED', '小组名称已经存在');
      const gid = id('group'), group = { _id: gid, name: p.name, creator_id: uid, member_ids: [uid], created_at: s.now(), updated_at: s.now() };
      await tx.set('unique_keys', nameId, { group_id: gid, created_at: s.now() });
      await tx.set('groups', gid, group);
      await tx.set('group_members', key('member', gid, uid), { group_id: gid, user_id: uid, status: 'ACTIVE', created_at: s.now() });
      return { group: groupBrief(group), members: [await s.userBrief(uid, tx)] };
    });
  });
  register('groups.list', P, async (p, ctx) => s.page('groups', { member_ids: { $contains: ctx.user_id } }, p, ctx.user_id, async g => groupBrief(g)));
  register('groups.get', { group_id: f.string() }, async (p, ctx) => {
    const g = await member(s.store, p.group_id, ctx.user_id);
    return { group: groupBrief(g), members: await Promise.all(g.member_ids.map(uid => s.userBrief(uid))) };
  });
  register('groups.invite', { ...W, group_id: f.string(), invitee_id: f.string() }, async (p, ctx) => s.write(ctx, 'groups.invite', p, async (tx, uid) => {
    const g = await member(tx, p.group_id, uid);
    if (g.member_ids.includes(p.invitee_id)) return { invitation_id: null, status: 'ACCEPTED', expires_at: null, joined: true, share_path: null };
    need(g.member_ids.length < 21, 'VALIDATION_FAILED', '小组已达到21人上限');
    need((await tx.get('user_connections', pairId(uid, p.invitee_id)))?.status === 'CONFIRMED', 'VALIDATION_FAILED', '请仅邀请已确认好友');
    await s.normalUser(p.invitee_id, tx);
    const iid = key('groupinvite', g._id, p.invitee_id); let invite = await tx.get('invitations', iid);
    if (!invite) {
      invite = { _id: iid, kind: 'GROUP', inviter_id: uid, invitee_id: p.invitee_id, group_id: g._id,
        status: 'PENDING', expires_at: s.now() + DAY, created_at: s.now(), updated_at: s.now() };
      await tx.set('invitations', iid, invite);
    }
    need(invite.status === 'PENDING' && s.now() < invite.expires_at, 'INVITATION_INVALID', '已有邀请已失效');
    return { invitation_id: iid, status: invite.status, expires_at: invite.expires_at, joined: false,
      share_path: '/pages/groups/invitation?invitation_id=' + iid };
  }));
  register('groups.getInvitation', { invitation_id: f.string() }, async (p, ctx) => {
    const i = await s.store.get('invitations', p.invitation_id);
    need(i && i.kind === 'GROUP' && [i.inviter_id, i.invitee_id].includes(ctx.user_id), 'INVITATION_INVALID', '邀请无效');
    const group = await s.store.get('groups', i.group_id); need(group, 'INVITATION_INVALID', '小组不可用');
    const inviter = await s.store.get('users', i.inviter_id);
    return { invitation: await s.invitation(i, ctx.user_id), group_name: group.name,
      can_accept: ctx.account_status === 'NORMAL' && inviter?.account_status === 'NORMAL' && group.member_ids.includes(i.inviter_id)
        && i.invitee_id === ctx.user_id && i.status === 'PENDING' && s.now() < i.expires_at && group.member_ids.length < 21 };
  });
  register('groups.acceptInvitation', { ...W, invitation_id: f.string() }, async (p, ctx) => s.write(ctx, 'groups.acceptInvitation', p, async (tx, uid) => {
    const i = await tx.get('invitations', p.invitation_id);
    need(i && i.kind === 'GROUP' && i.invitee_id === uid, 'INVITATION_INVALID', '邀请无效');
    const g = await tx.get('groups', i.group_id); need(g, 'INVITATION_INVALID', '小组不可用');
    if (!g.member_ids.includes(uid)) {
      need(i.status === 'PENDING' && s.now() < i.expires_at && g.member_ids.includes(i.inviter_id), 'INVITATION_INVALID', '邀请已过期或关闭');
      await s.normalUser(i.inviter_id, tx); need(g.member_ids.length < 21, 'VALIDATION_FAILED', '小组人数已满');
      g.member_ids.push(uid); g.updated_at = s.now(); await tx.set('groups', g._id, g);
      await tx.set('group_members', key('member', g._id, uid), { group_id: g._id, user_id: uid, status: 'ACTIVE', created_at: s.now() });
    }
    i.status = 'ACCEPTED'; i.updated_at = s.now(); await tx.set('invitations', i._id, i);
    return { invitation_id: i._id, status: i.status, expires_at: i.expires_at, joined: true, group_id: g._id };
  }));
  register('groups.invitations', { ...P, direction: f.enum(['SENT', 'RECEIVED']) }, async (p, ctx) => s.page('invitations', {
    kind: 'GROUP', [p.direction === 'SENT' ? 'inviter_id' : 'invitee_id']: ctx.user_id }, p, ctx.user_id, i => s.invitation(i, ctx.user_id)));
  register('groups.submitApplication', { ...W, ...V, group_id: f.string(), application_id: f.string() }, async (p, ctx) => {
    await s.requireApplicationAccess(ctx.user_id, p.application_id, 'VIEW'); await s.expire(p.application_id);
    return s.write(ctx, 'groups.submitApplication', p, async (tx, uid) => {
      const g = await member(tx, p.group_id, uid), a = await s.requireApplicationAccess(uid, p.application_id, 'WITHDRAW', tx);
      s.pending(a); s.version(a, p);
      need(a.mode === 'NORMAL' && !a.group_id && !a.opinion_count && !a.participant_ids.length && !a.invitation_ids.length,
        'STATE_CONFLICT', '只允许未分享、未审批的普通申请转入小组');
      const groupLinkId = key('grouplink', a._id); need(!await tx.get('group_applications', groupLinkId), 'STATE_CONFLICT', '申请已经绑定小组');
      const participants = g.member_ids.filter(memberId => memberId !== uid);
      need(participants.length >= 1 && participants.length <= 20, 'VALIDATION_FAILED', '至少需要1名、最多20名其他成员');
      a.mode = 'GROUP'; a.group_id = g._id; a.review_rule = 'ALL_APPROVE';
      for (const memberId of participants) { await s.normalUser(memberId, tx); await s.addParticipant(tx, a, memberId, 'GROUP', groupLinkId, g._id); }
      await tx.set('group_applications', groupLinkId, { group_id: g._id, application_id: a._id, participant_ids: participants, created_at: s.now() });
      await s.saveApp(tx, a); await s.event(tx, a, 'APPLICATION_PARTICIPANTS_READY');
      return { link_id: groupLinkId, application_id: a._id, group_id: g._id, todo_created: true, participant_count: participants.length, version: a.version };
    });
  });
  register('groups.todos', { ...P, group_id: f.string() }, async (p, ctx) => {
    await member(s.store, p.group_id, ctx.user_id);
    return s.page('approval_participants', { group_id: p.group_id, user_id: ctx.user_id, qualification_status: 'ACTIVE' }, p, ctx.user_id, async q => {
      await s.expire(q.application_id); const a = await s.store.get('applications', q.application_id);
      if (!a || a.status !== 'PENDING') return null;
      await s.requireApplicationAccess(ctx.user_id, a._id, 'VIEW');
      return { application: s.summary(a), my_decision: q.decision, can_approve: q.decision === 'PENDING' && ctx.account_status === 'NORMAL' };
    });
  });
};
