const { createApplication } = require('../../services/applications');
const { largePurchaseCent } = require('../../config');
const { parsePrice, suggestTag, tags } = require('../../shared/application-form');
const { uploadImage, MAX_COUNT } = require('../../shared/images');
const { runWrite, forgetWrite } = require('../../shared/write');
const { errorMessage } = require('../../shared/api');
const { detailUrl, priceLabel } = require('../../shared/display');

Page({
  data: {
    description: '', price: '', tag: '', suggestedTag: '', tags, large: false,
    threshold: priceLabel(largePurchaseCent), hours: [12, 24, 72], approvalHours: 24, mode: 'NORMAL',
    approverIds: [], reviewRule: 'ALL_APPROVE', images: [], busyImages: false, maxImages: MAX_COUNT,
    saving: false, writeError: '', requestId: '', formErrors: {}
  },
  edit(event) {
    if (this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.change(field, value);
    if (field === 'description') this.setData({ suggestedTag: suggestTag(value) });
    if (field === 'price') this.setData({ large: parsePrice(value) >= largePurchaseCent });
  },
  select(event) {
    if (this.data.saving) return;
    const { field, value } = event.currentTarget.dataset;
    this.change(field, value);
  },
  change(field, value) {
    this.setData({ [field]: value, ['formErrors.' + field]: '', writeError: '', requestId: '' });
    forgetWrite(this, 'create');
  },
  selectFriends(event) {
    this.change('approverIds', event.detail.ids);
  },
  async chooseImages() {
    const count = MAX_COUNT - this.data.images.length;
    if (this.data.saving || this.data.busyImages || count < 1) return;
    this.setData({ busyImages: true });
    try {
      let result;
      try {
        result = await wx.chooseImage({ count, sizeType: ['original'], sourceType: ['album', 'camera'] });
      } catch (error) {
        if (!/cancel/i.test(error && error.errMsg || '')) {
          this.setData({ 'formErrors.images': '无法打开相册或相机，请重试' });
        }
        return;
      }
      const added = result.tempFilePaths.slice(0, count).map(path => ({ path, status: 'uploading', fileId: '', error: '' }));
      const start = this.data.images.length;
      this.change('images', this.data.images.concat(added));
      for (let index = start; index < start + added.length; index += 1) await this.upload(index);
    } finally {
      this.setData({ busyImages: false });
    }
  },
  async upload(index) {
    try {
      const fileId = await uploadImage(this.data.images[index].path);
      this.setData({ ['images[' + index + '].fileId']: fileId, ['images[' + index + '].status']: 'ready' });
    } catch (error) {
      this.setData({ ['images[' + index + '].status']: 'error',
        ['images[' + index + '].error']: error.code === 'FILE_PROCESSING_FAILED' ? error.message : errorMessage(error) });
    }
  },
  async retryImage(event) {
    if (this.data.saving || this.data.busyImages) return;
    const index = event.currentTarget.dataset.index;
    this.setData({ busyImages: true, ['images[' + index + '].status']: 'uploading' });
    forgetWrite(this, 'create');
    try {
      await this.upload(index);
      this.setData({ 'formErrors.images': '' });
    } finally {
      this.setData({ busyImages: false });
    }
  },
  removeImage(event) {
    if (this.data.saving || this.data.busyImages) return;
    const index = event.currentTarget.dataset.index;
    this.change('images', this.data.images.filter((_, position) => position !== index));
  },
  async submit() {
    if (this.data.saving || this.data.busyImages) return;
    const { description, price, tag, images, approvalHours, mode, approverIds, reviewRule } = this.data;
    const priceCent = parsePrice(price);
    const formErrors = {};
    if (!description.trim()) formErrors.description = '请填写物品描述';
    if (priceCent === null) formErrors.price = '请输入大于 0 且最多有两位小数的金额';
    if (!tag) formErrors.tag = '请选择或确认标签';
    if (images.some(image => image.status !== 'ready')) formErrors.images = '请重试或移除上传失败的图片';
    if (mode === 'JOINT' && (approverIds.length < 2 || approverIds.length > 3)) formErrors.approverIds = '请选择 2～3 位好友';
    this.setData({ formErrors });
    if (Object.keys(formErrors).length) return;

    const params = { description: description.trim(), price_cent: priceCent, tag, image_ids: images.map(image => image.fileId),
      approval_hours: approvalHours, mode };
    if (mode === 'JOINT') Object.assign(params, { approver_ids: approverIds.slice().sort(), review_rule: reviewRule });
    await runWrite(this, 'create', createApplication, params, result => {
      this.setData({ createdId: result.application_id });
      this.openCreated();
    });
  },
  openCreated() {
    if (this.data.createdId) wx.redirectTo({ url: detailUrl(this.data.createdId) });
  }
});
