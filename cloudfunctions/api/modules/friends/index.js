'use strict';
const crypto = require('node:crypto');
const { f, W, P } = require('../../common/validation');
const { key, hash, pairId, requireThat: need } = require('../../common/utils');
const { DAY } = require('../../services');
exports.register = (register, s) => {
  register('friends.createInvitation', W, async (p, ctx) => s.write(ctx, 'friends.createInvitation', p, async (tx, uid) => {
    const token = crypto.randomBytes(24).toString('hex'), iid = key('friendinvite', token), expires = s.now() + DAY;
    await tx.set('invitations', iid, { kind: 'FRIEND', inviter_id: uid, invitee_id: null, token_hash: hash(token),
      status: 'CREATED', expires_at: expires, created_at: s.now(), updated_at: s.now() });
    return { invitation_id: iid, share_path: '/pages/friends/accept?token=' + token, expires_at: expires };
  }));
  register('friends.claimInvitation', { ...W, token: f.string(32, 128) }, async (p, ctx) => s.write(ctx, 'friends.claimInvitation', p, async (tx, uid) => {
    const iid = key('friendinvite', p.token), i = await tx.get('invitations', iid);
    need(i && i.kind === 'FRIEND' && i.token_hash === hash(p.token) && s.now() < i.expires_at && i.inviter_id !== uid
      && ['CREATED', 'CLAIMED'].includes(i.status) && (!i.invitee_id || i.invitee_id === uid), 'INVITATION_INVALID', '邀请无效或已经被领取');
    await s.normalUser(i.inviter_id, tx); i.invitee_id = uid; i.status = 'CLAIMED'; i.updated_at = s.now();
    await tx.set('invitations', iid, i);
    return { invitation: await s.invitation(i, uid) };
  }));
  register('friends.confirmInvitation', { ...W, invitation_id: f.string(), decision: f.enum(['ACCEPT', 'REJECT']) }, async (p, ctx) => s.write(ctx, 'friends.confirmInvitation', p, async (tx, uid) => {
    const i = await tx.get('invitations', p.invitation_id);
    need(i && i.kind === 'FRIEND' && i.inviter_id === uid && i.status === 'CLAIMED' && s.now() < i.expires_at,
      'INVITATION_INVALID', '邀请无效或状态已经变化');
    if (p.decision === 'ACCEPT') {
      await s.normalUser(i.invitee_id, tx);
      const cid = pairId(uid, i.invitee_id);
      if (!await tx.get('user_connections', cid)) await tx.set('user_connections', cid, {
        user_ids: [uid, i.invitee_id].sort(), status: 'CONFIRMED', pk_authorized: false, created_at: s.now() });
      i.status = 'CONFIRMED';
    } else i.status = 'REJECTED';
    i.updated_at = s.now(); await tx.set('invitations', i._id, i);
    return { invitation_id: i._id, status: i.status, friend: p.decision === 'ACCEPT' ? await s.userBrief(i.invitee_id, tx) : null };
  }));
  register('friends.list', P, async (p, ctx) => s.page('user_connections', { user_ids: { $contains: ctx.user_id }, status: 'CONFIRMED' }, p, ctx.user_id,
    async r => s.userBrief(r.user_ids.find(uid => uid !== ctx.user_id))));
  register('friends.invitations', { ...P, direction: f.enum(['SENT', 'RECEIVED']) }, async (p, ctx) => s.page('invitations', {
    kind: 'FRIEND', [p.direction === 'SENT' ? 'inviter_id' : 'invitee_id']: ctx.user_id }, p, ctx.user_id, r => s.invitation(r, ctx.user_id)));
};
