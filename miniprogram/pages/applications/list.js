const applications = require('../../services/applications');
const approvals = require('../../services/approvals');
const { applicationView, invitationView, detailUrl, decisionLabels, statusLabels } = require('../../shared/display');
const { loadPage } = require('../../shared/page-list');
const { runWrite } = require('../../shared/write');

const tabs = [
  { id: 'mine', label: '我的申请' }, { id: 'todo', label: '待我审批' },
  { id: 'invitations', label: '审批邀请' }, { id: 'history', label: '审批历史' }
];
const filters = [{ id: '', label: '全部状态' }, ...Object.keys(statusLabels).map(id => ({ id, label: statusLabels[id] }))];

Page({
  data: { tab: 'mine', tabs, status: '', filters, filterIndex: 0, items: [], cursor: null,
    loading: false, error: '', saving: false, writeError: '', requestId: '' },
  onLoad(options) {
    if (tabs.some(tab => tab.id === options.tab)) this.setData({ tab: options.tab });
  },
  onShow() { this.reload(); },
  onPullDownRefresh() {
    return this.reload().finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() { this.more(); },
  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (this.data.tab === tab || this.data.saving) return;
    this.setData({ tab, writeError: '' });
    this.reload();
  },
  setFilter(event) {
    const filterIndex = Number(event.detail.value);
    this.setData({ filterIndex, status: filters[filterIndex].id });
    this.reload();
  },
  reload() { return this.read(true); },
  more() { return this.read(false); },
  retry() { return this.data.cursor ? this.more() : this.reload(); },
  read(reset) {
    if (this.data.saving) return Promise.resolve();
    const { tab, status } = this.data;
    if (tab === 'mine') return loadPage(this, params => applications.listApplications(status ? { ...params, status } : params), applicationView, reset);
    if (tab === 'todo') return loadPage(this, approvals.listTodos, applicationView, reset);
    if (tab === 'invitations') return loadPage(this, params => applications.listInvitations({ ...params, direction: 'RECEIVED' }), invitationView, reset);
    return loadPage(this, approvals.listHistory, item => ({ ...applicationView(item.application),
      myDecision: decisionLabels[item.opinion.decision] }), reset);
  },
  openApplication(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: detailUrl(id) });
  },
  async accept(event) {
    await runWrite(this, 'accept', applications.acceptInvitation, { invitation_id: event.currentTarget.dataset.id }, result => {
      wx.navigateTo({ url: detailUrl(result.application_id) });
    });
  }
});
