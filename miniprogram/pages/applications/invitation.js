const { getInvitation, acceptInvitation } = require('../../services/applications');
const { errorMessage } = require('../../shared/api');
const { runWrite } = require('../../shared/write');
const { detailUrl, invitationView } = require('../../shared/display');

Page({
  data: { loading: false, loadError: '', invitation: null, canAccept: false, loaded: false, saving: false,
    writeError: '', requestId: '', acceptedId: '' },
  onLoad(options) {
    this.cardId = options.card_id || '';
    this.load();
  },
  async load() {
    if (this.data.loading) return;
    if (!this.cardId) { this.setData({ loadError: '这条邀请缺少卡片编号' }); return; }
    this.setData({ loading: true, loadError: '' });
    try {
      const data = await getInvitation(this.cardId);
      this.setData({ invitation: data.invitation ? invitationView(data.invitation) : null,
        canAccept: data.can_accept, loaded: true });
    } catch (error) {
      this.setData({ invitation: null, canAccept: false, loadError: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async accept() {
    if (!this.data.canAccept || this.data.loading) return;
    await runWrite(this, 'accept', acceptInvitation, { invitation_id: this.data.invitation.invitation_id }, result => {
      this.setData({ acceptedId: result.application_id, canAccept: false });
      this.openApplication();
    });
  },
  openApplication() {
    const id = this.data.acceptedId || this.data.invitation && this.data.invitation.application_id;
    if (id) wx.redirectTo({ url: detailUrl(id) });
  }
});
