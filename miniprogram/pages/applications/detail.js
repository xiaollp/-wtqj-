const applications = require('../../services/applications');
const approvals = require('../../services/approvals');
const reviews = require('../../services/reviews');
const { callApi, errorMessage } = require('../../shared/api');
const { applicationView, detailUrl, decisionLabels, timeLabel } = require('../../shared/display');
const { runWrite, forgetWrite } = require('../../shared/write');

const refreshCodes = ['STATE_CONFLICT', 'APPLICATION_CLOSED', 'DUPLICATE_OPINION', 'ACCESS_DENIED'];
const sourceActions = { templates: 'comments.templates', favorites: 'comments.favorites' };

Page({
  data: {
    application: null, progress: null, loading: false, loadError: '', saving: false,
    writeError: '', requestId: '', panel: '', selected: [], rule: 'ALL_APPROVE', shareCard: null,
    comment: '', commentError: '', source: '', sources: [], sourcesLoading: false,
    sourceCursor: null, sourceError: '', photos: [], photoError: '', endDate: '', endTime: '', validityError: ''
  },
  onLoad(options) {
    this.applicationId = options.application_id || '';
    this.load();
  },
  onPullDownRefresh() {
    return this.refresh().finally(() => wx.stopPullDownRefresh());
  },
  async refresh() {
    if (this.data.saving) return;
    await this.load();
  },
  async load() {
    if (this.data.loading) return;
    if (!this.applicationId) {
      this.setData({ loadError: '缺少申请编号，请从申请列表打开' });
      return;
    }

    this.setData({ loading: true, loadError: '' });
    try {
      const data = await applications.getApplication(this.applicationId);
      const application = applicationView(data.application);
      const progress = { ...data.progress, participants: data.progress.participants.map(participant => ({
        ...participant,
        userId: participant.user.user_id,
        decisionLabel: participant.decision === 'PENDING' && participant.qualification_status === 'CLOSED'
          ? '未提交' : decisionLabels[participant.decision]
      })) };
      const changes = { application, progress, photos: [], photoError: '' };
      if (application.mode !== 'NORMAL' || application.status !== 'PENDING') changes.shareCard = null;
      this.setData(changes);
      if (application.image_ids.length) {
        try {
          const { items } = await applications.getFileUrls(application.image_ids);
          this.setData({ photos: items });
        } catch (error) {
          this.setData({ photoError: errorMessage(error) });
        }
      }
    } catch (error) {
      this.setData({ application: null, progress: null, photos: [], shareCard: null, loadError: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  openPanel(event) {
    if (this.data.saving || this.data.loading) return;
    const panel = event.currentTarget.dataset.panel;
    if (this.data.panel !== panel) {
      this.setData({ panel, writeError: '', requestId: '' });
    }
  },
  selectFriends(event) {
    forgetWrite(this, this.data.panel);
    this.setData({ selected: event.detail.ids, shareCard: null, writeError: '' });
  },
  selectPanel(event) {
    if (this.data.saving || this.data.loading) return;
    if (this.data.panel !== event.currentTarget.dataset.panel) this.setData({ selected: [] });
    this.openPanel(event);
  },
  selectRule(event) {
    if (this.data.saving) return;
    forgetWrite(this, 'review');
    this.setData({ rule: event.currentTarget.dataset.rule, writeError: '' });
  },
  preview(event) {
    wx.previewImage({ current: event.currentTarget.dataset.url, urls: this.data.photos.map(photo => photo.url) });
  },
  onShareAppMessage(event) {
    const { shareCard } = this.data;
    if (event && event.target && event.target.dataset.kind === 'review') {
      return { title: '请查看你的会审任务', path: detailUrl(this.applicationId) };
    }
    if (shareCard && shareCard.expires_at > Date.now()) {
      return { title: '你收到一份消费审批邀请', path: shareCard.share_path };
    }
    return { title: '消费审批', path: '/pages/index/index' };
  },
  async write(action, service, fields = {}, afterSuccess) {
    const application = this.data.application;
    if (this.data.saving || this.data.loading || !application) return;
    const params = { application_id: application.application_id, expected_version: application.version, ...fields };
    await runWrite(this, action, service, params, async result => {
      if (afterSuccess) afterSuccess(result);
      else this.setData({ panel: '' });
      await this.load();
    }, async error => {
      if (refreshCodes.includes(error.code)) await this.load();
    });
  },
  share() {
    if (!this.data.selected.length) {
      this.setData({ writeError: '请至少选择一位好友' });
      return;
    }
    return this.write('share', applications.shareApplication, { receiver_ids: this.data.selected.slice().sort() }, card => {
      this.setData({ shareCard: { ...card, expiry: timeLabel(card.expires_at) } });
    });
  },
  startReview() {
    const { selected, rule } = this.data;
    if (selected.length < 2 || selected.length > 3) {
      this.setData({ writeError: '请选择 2～3 位好友' });
      return;
    }
    return this.write('review', reviews.startReview, { approver_ids: selected.slice().sort(), rule });
  },
  async withdraw() {
    if (this.data.saving || this.data.loading || this.confirming) return;
    this.confirming = true;
    try {
      const result = await wx.showModal({ title: '撤回申请', content: '撤回后好友将无法继续审批。', confirmText: '撤回' });
      if (result.confirm) await this.write('withdraw', applications.withdrawApplication);
    } finally {
      this.confirming = false;
    }
  },
  approve() {
    return this.write('approve', approvals.submitApproval, { decision: 'APPROVE' });
  },
  editComment(event) {
    forgetWrite(this, 'reject');
    this.setData({ comment: event.detail.value, commentError: '', writeError: '' });
  },
  reject() {
    const comment = this.data.comment.trim();
    if (!comment) {
      this.setData({ commentError: '请填写拒绝理由' });
      return;
    }
    return this.write('reject', approvals.submitApproval, { decision: 'REJECT', comment });
  },
  selectSource(event) {
    const source = event.currentTarget.dataset.source;
    this.setData({ source, sources: [], sourceCursor: null, sourceError: '', sourcesLoading: false });
    this.loadSources();
  },
  async loadSources() {
    const { source, sourceCursor, sourcesLoading } = this.data;
    if (!sourceActions[source] || sourcesLoading) return;
    const request = (this.sourceRequest || 0) + 1;
    this.sourceRequest = request;
    this.setData({ sourcesLoading: true, sourceError: '' });
    try {
      const data = await callApi(sourceActions[source], sourceCursor ? { cursor: sourceCursor } : {});
      if (request !== this.sourceRequest) return;
      const choices = data.items.filter(item => item.available !== false && typeof item.content === 'string')
        .map(item => ({ id: item.template_id || item.opinion_id, content: item.content }));
      this.setData({ sources: sourceCursor ? this.data.sources.concat(choices) : choices, sourceCursor: data.next_cursor || null });
    } catch (error) {
      if (request === this.sourceRequest) {
        this.setData({ sourceError: error.code === 'VALIDATION_FAILED' ? '此文案来源暂未开放，可直接输入锐评。' : errorMessage(error) });
      }
    } finally {
      if (request === this.sourceRequest) this.setData({ sourcesLoading: false });
    }
  },
  applySource(event) {
    if (this.data.saving) return;
    this.editComment({ detail: { value: event.currentTarget.dataset.content.slice(0, 500) } });
  },
  pickValidity(event) {
    forgetWrite(this, 'validity');
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, validityError: '', writeError: '' });
  },
  setValidity() {
    const { endDate, endTime } = this.data;
    const end = endDate && endTime ? new Date(endDate + 'T' + endTime + ':00').getTime() : 0;
    if (!Number.isFinite(end) || end <= Date.now()) {
      this.setData({ validityError: '请选择未来的日期和时间' });
      return;
    }
    return this.write('validity', applications.setValidity, { consume_expires_at: end });
  }
});
