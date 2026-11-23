'use strict';
exports.runTransaction = handler => require('../common/bindings').get().store.runTransaction(handler);
