const { login, updateProfile } = require('../../services/auth');
const { getFileUrls } = require('../../services/applications');
const { errorMessage } = require('../../shared/api');
const { uploadImage } = require('../../shared/images');
const { runWrite, forgetWrite } = require('../../shared/write');

Page({
  data: { loading: false, ready: false, saving: false, uploading: false, loadError: '', writeError: '',
    requestId: '', nickname: '', avatarUrl: '', avatarPath: '', avatarFileId: '', success: '' },
  onLoad() { this.load(); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, loadError: '' });
    try {
      const user = await login();
      this.profile = user;
      this.setData({ nickname: user.nickname || '', ready: true });
      await this.previewSavedAvatar(user.avatar_file_id);
    } catch (error) {
      this.setData({ loadError: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async previewSavedAvatar(fileId) {
    if (!fileId) return;
    try {
      const { items } = await getFileUrls([fileId]);
      this.setData({ avatarUrl: items.length ? items[0].url : '' });
    } catch (_) {
      this.setData({ avatarUrl: '' });
    }
  },
  changeNickname(event) {
    forgetWrite(this, 'profile');
    this.setData({ nickname: event.detail.value, writeError: '', success: '' });
  },
  chooseAvatar(event) {
    const path = event.detail.avatarUrl;
    if (!path || this.data.saving || this.data.uploading) return;
    forgetWrite(this, 'profile');
    this.setData({ avatarPath: path, avatarFileId: '', writeError: '', success: '' });
  },
  removeAvatarSelection() {
    forgetWrite(this, 'profile');
    this.setData({ avatarPath: '', avatarFileId: '', writeError: '', success: '' });
  },
  async save() {
    if (this.data.saving || this.data.loading || this.data.uploading || !this.profile) return;
    const nickname = this.data.nickname.trim();
    const fields = {};
    if (nickname !== (this.profile.nickname || '')) {
      if (!nickname || nickname.length > 64) {
        this.setData({ writeError: '请输入 1～64 个字符的昵称' });
        return;
      }
      fields.nickname = nickname;
    }
    if (this.data.avatarPath) {
      this.setData({ uploading: true, writeError: '', success: '' });
      try {
        const avatarFileId = this.data.avatarFileId || await uploadImage(this.data.avatarPath);
        this.setData({ avatarFileId });
        fields.avatar_file_id = avatarFileId;
      } catch (error) {
        this.setData({ writeError: errorMessage(error) });
        return;
      } finally {
        this.setData({ uploading: false });
      }
    }
    if (!Object.keys(fields).length) {
      this.setData({ success: '资料未修改' });
      return;
    }
    await runWrite(this, 'profile', updateProfile, fields, async ({ user }) => {
      this.profile = user;
      this.setData({ nickname: user.nickname || '', avatarUrl: this.data.avatarPath || this.data.avatarUrl,
        avatarFileId: '', avatarPath: '', success: '资料已保存' });
    });
  }
});
