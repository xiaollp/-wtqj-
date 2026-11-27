const { apiError, createWriteContext, login, requireCloud } = require('./api');

const MAX_COUNT = 9;
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const MAX_BYTES = 200 * 1024;
const MAX_EDGE = 1280;

function compressOptions(quality, width, height) {
  return { quality, compressedWidth: width, compressedHeight: height };
}

async function prepareImage(filePath) {
  try {
    const fs = wx.getFileSystemManager();
    if (fs.statSync(filePath).size > MAX_ORIGINAL_BYTES) {
      throw apiError('FILE_PROCESSING_FAILED', '', false, '单张原图不能超过 10 MB');
    }
    const info = await wx.getImageInfo({ src: filePath });
    const longest = Math.max(info.width, info.height);
    if (longest <= MAX_EDGE && fs.statSync(filePath).size <= MAX_BYTES && /^(jpeg|jpg|png|webp)$/.test(info.type)) {
      return { path: filePath, extension: info.type === 'jpeg' ? 'jpg' : info.type };
    }

    for (const [edge, quality] of [[1280, 80], [1280, 55], [960, 55], [640, 45]]) {
      const scale = Math.min(1, edge / longest);
      const options = compressOptions(quality, Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)));
      const { tempFilePath } = await wx.compressImage({ src: filePath, ...options });
      const output = await wx.getImageInfo({ src: tempFilePath });
      if (Math.max(output.width, output.height) <= MAX_EDGE && fs.statSync(tempFilePath).size <= MAX_BYTES
          && /^(jpeg|jpg|png|webp)$/.test(output.type)) {
        return { path: tempFilePath, extension: output.type === 'jpeg' ? 'jpg' : output.type };
      }
    }
    throw apiError('FILE_PROCESSING_FAILED', '', false, '这张图片无法压缩到 200 KB，请更换图片');
  } catch (error) {
    if (error && error.code === 'FILE_PROCESSING_FAILED') throw error;
    throw apiError('FILE_PROCESSING_FAILED');
  }
}

async function uploadImage(filePath) {
  const cloud = requireCloud();
  const user = await login();
  const prepared = await prepareImage(filePath);
  const { idempotency_key: name } = createWriteContext();
  let result;
  try {
    result = await cloud.uploadFile({
      cloudPath: 'uploads/' + user.user_id + '/' + name + '.' + prepared.extension,
      filePath: prepared.path
    });
  } catch (_) {
    throw apiError('FILE_UPLOAD_FAILED', '', true);
  }
  if (!result || typeof result.fileID !== 'string' || !result.fileID.startsWith('cloud://')) {
    throw apiError('FILE_UPLOAD_FAILED', '', true);
  }
  return result.fileID;
}

module.exports = { uploadImage, prepareImage, MAX_COUNT };
