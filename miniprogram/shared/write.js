const { createWriteContext, errorMessage } = require('./api');

function forgetWrite(page, action) {
  if (page.writeAttempts) delete page.writeAttempts[action];
}

async function runWrite(page, action, service, params, onSuccess, onFailure) {
  if (page.data.saving) return;
  const attempts = page.writeAttempts || (page.writeAttempts = {});
  const signature = JSON.stringify(params);
  if (!attempts[action] || attempts[action].signature !== signature) {
    attempts[action] = { signature, context: createWriteContext() };
  }

  page.setData({ saving: true, writeError: '', requestId: '' });
  try {
    let result;
    try {
      result = await service(params, attempts[action].context);
    } catch (error) {
      if (!error.retryable) forgetWrite(page, action);
      page.setData({ writeError: errorMessage(error), requestId: error.request_id || '' });
      if (onFailure) await onFailure(error);
      return;
    }
    forgetWrite(page, action);
    await onSuccess(result);
  } finally {
    page.setData({ saving: false });
  }
}

module.exports = { runWrite, forgetWrite };
