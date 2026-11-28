const notifications = require('../../services/notifications');
const { notificationTemplateIds } = require('../../config');
const { errorMessage } = require('../../shared/api');
const { runWrite } = require('../../shared/write');
const { timeLabel } = require('../../shared/display');
const descriptions = {
  RESULT: { title: '审批结果', description: '申请结束后提醒你查看审批结果。' },
  GROUP_TODO: { title: '小组待办', description: '有新的小组申请需要你审批时提醒。' }
};
const authLabels = { ACCEPT: '最近一次接受授权', REJECT: '最近一次拒绝授权', BAN: '最近一次禁止授权' };
Page({
  data: {
    mock: notifications.isMock, items: [], loading: false, error: '',
    saving: false, authorizing: false, writeError: '', pending: false, notice: ''
  },
  onLoad() { this.load(); },
  async onPullDownRefresh() {
    try { if (!this.data.saving && !this.data.authorizing) await this.load(); }
    finally { wx.stopPullDownRefresh(); }
  },
  showPreferences(preferences) {
    this.setData({ items: Object.keys(descriptions).map(type => {
      const item = preferences.find(p => p.type === type);
      if (!item) throw new Error('Missing notification preference');
      return { ...item, ...descriptions[type], authLabel: authLabels[item.last_auth_result] || '尚无授权记录', updatedLabel: timeLabel(item.updated_at) };
    }) });
  },
  async load() {
    if (this.data.loading || this.data.saving || this.data.authorizing) return;
    this.setData({ loading: true, error: '' });
    try {
      const result = await notifications.getPreferences();
      this.showPreferences(result.preferences);
    } catch (error) {
      this.setData({ items: [], error: errorMessage(error) });
    } finally { this.setData({ loading: false }); }
  },
  async enable(event) {
    if (this.data.loading || this.data.saving || this.data.authorizing || this.data.pending) return;
    const type = event.currentTarget.dataset.type;
    if (!descriptions[type]) return;
    this.setData({ authorizing: true, writeError: '', notice: '' });
    try {
      let result;
      if (notifications.isMock) {
        const choice = await new Promise((resolve, reject) => wx.showActionSheet({
          itemList: ['演示接受授权', '演示拒绝授权', '演示禁止授权'],
          success: resolve,
          fail: error => error.errMsg && error.errMsg.includes('cancel') ? resolve(null) : reject(error)
        }));
        if (!choice) return;
        result = ['ACCEPT', 'REJECT', 'BAN'][choice.tapIndex];
      } else {
        const templateId = notificationTemplateIds && notificationTemplateIds[type];
        if (!templateId) {
          this.setData({ writeError: '尚未配置该类微信订阅模板，请与 D 确认模板 ID。' });
          return;
        }
        const authorization = await new Promise((resolve, reject) => wx.requestSubscribeMessage({ tmplIds: [templateId], success: resolve, fail: reject }));
        result = { accept: 'ACCEPT', reject: 'REJECT', ban: 'BAN' }[authorization[templateId]];
        if (!result) throw new Error('Unexpected authorization result');
      }
      this.pendingParams = { type, enabled: result === 'ACCEPT', auth_result: result };
      this.setData({ pending: true });
      await this.savePending();
    } catch (_) {
      this.setData({ writeError: '授权未完成，原设置保持不变，请稍后重试。' });
    } finally { this.setData({ authorizing: false }); }
  },
  disable(event) {
    if (this.data.loading || this.data.saving || this.data.authorizing || this.data.pending) return;
    this.pendingParams = { type: event.currentTarget.dataset.type, enabled: false };
    this.setData({ pending: true, notice: '' });
    return this.savePending();
  },
  savePending() {
    if (!this.pendingParams || this.data.saving) return;
    return runWrite(this, 'notificationPreference', notifications.updatePreferences, this.pendingParams, async result => {
      const params = this.pendingParams;
      this.showPreferences(result.preferences);
      this.pendingParams = null;
      this.setData({ pending: false, notice: params.auth_result === 'REJECT' || params.auth_result === 'BAN'
        ? '本次未取得授权，该类提醒保持关闭。' : params.enabled ? '提醒偏好已开启，实际投递仍取决于微信可用授权。' : '已关闭提醒，仍可在应用内查看结果和待办。' });
    }, async error => {
      if (!error.retryable) {
        this.pendingParams = null;
        this.setData({ pending: false });
      }
    });
  }
});
