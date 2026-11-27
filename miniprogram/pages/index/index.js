const { login } = require('../../services/auth');
const { errorMessage } = require('../../shared/api');

Page({
  data: { loading: false, user: null, error: '' },
  onShow() { this.loadUser(); },
  async loadUser() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      this.setData({ user: await login() });
    } catch (error) {
      this.setData({ user: null, error: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  }
});
