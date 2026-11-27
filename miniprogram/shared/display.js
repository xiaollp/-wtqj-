const statusLabels = { PENDING: '待审批', APPROVED: '已同意', REJECTED: '已拒绝', WITHDRAWN: '已撤回', EXPIRED: '已失效' };
const modeLabels = { NORMAL: '普通审批', JOINT: '多人会审', GROUP: '小组审批' };
const decisionLabels = { PENDING: '待处理', APPROVE: '同意', REJECT: '拒绝' };
const invitationLabels = {
  CREATED: '待领取', CLAIMED: '待确认', CONFIRMED: '已成为好友', REJECTED: '已拒绝',
  PENDING: '待接受', ACCEPTED: '已接受', CLOSED: '已关闭', EXPIRED: '已失效'
};

function timeLabel(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function priceLabel(cents) {
  const digits = String(cents).padStart(3, '0');
  return '¥' + digits.slice(0, -2) + '.' + digits.slice(-2);
}

function applicationView(record) {
  return { ...record, priceLabel: priceLabel(record.price_cent), statusLabel: statusLabels[record.status],
    modeLabel: modeLabels[record.mode], deadlineLabel: timeLabel(record.approval_deadline),
    validityLabel: timeLabel(record.consume_expires_at), finalLabel: statusLabels[record.final_decision] };
}

function invitationView(record) {
  return { ...record, statusLabel: invitationLabels[record.status], expiry: timeLabel(record.expires_at) };
}

function detailUrl(applicationId) {
  return '/pages/applications/detail?application_id=' + encodeURIComponent(applicationId);
}

module.exports = { applicationView, invitationView, detailUrl, timeLabel, priceLabel, statusLabels, decisionLabels };
