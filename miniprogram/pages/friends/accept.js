const { claimInvitation } = require('../../services/friends');
const { runWrite } = require('../../shared/write');
const { invitationView } = require('../../shared/display');

Page({
  data: { available: false, saving: false, writeError: '', requestId: '', invitation: null },
  onLoad(options) {
    this.token = options.token || '';
    this.setData({ available: this.token.length >= 32 && this.token.length <= 128 });
  },
  async claim() {
    if (!this.data.available || this.data.invitation) return;
    await runWrite(this, 'claim', claimInvitation, { token: this.token }, result => {
      this.setData({ invitation: invitationView(result.invitation) });
    });
  }
});
