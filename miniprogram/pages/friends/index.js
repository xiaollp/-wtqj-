const friends = require('../../services/friends');
const { invitationView } = require('../../shared/display');
const { loadPage } = require('../../shared/page-list');
const { runWrite } = require('../../shared/write');

Page({
  data: {
    tab: 'friends', items: [], cursor: null, loading: false, error: '', saving: false,
    writeError: '', requestId: '', card: null, tabs: [
      { id: 'friends', label: '已确认好友' }, { id: 'SENT', label: '我发出的' }, { id: 'RECEIVED', label: '我收到的' }
    ]
  },
  onShow() { this.reload(); },
  onPullDownRefresh() {
    return this.reload().finally(() => wx.stopPullDownRefresh());
  },
  switchTab(event) {
    if (this.data.saving || this.data.tab === event.currentTarget.dataset.tab) return;
    this.setData({ tab: event.currentTarget.dataset.tab, writeError: '' });
    this.reload();
  },
  async create() {
    await runWrite(this, 'create', friends.createInvitation, {}, card => {
      this.setData({ card });
      if (this.data.tab === 'SENT') return this.reload();
    });
  },
  async confirm(event) {
    const { id, decision } = event.currentTarget.dataset;
    await runWrite(this, 'confirm', friends.confirmInvitation, { invitation_id: id, decision }, () => this.reload());
  },
  reload() { return this.read(true); },
  more() { return this.read(false); },
  retry() { return this.data.cursor ? this.more() : this.reload(); },
  read(reset) {
    const { tab } = this.data;
    if (tab === 'friends') return loadPage(this, friends.listFriends, item => item, reset);
    return loadPage(this, params => friends.listInvitations({ ...params, direction: tab }), invitationView, reset);
  },
  onShareAppMessage() {
    const card = this.data.card;
    if (card && Date.now() < card.expires_at) return { title: '邀请你成为消费审批好友', path: card.share_path };
    return { title: '消费审批', path: '/pages/index/index' };
  }
});
