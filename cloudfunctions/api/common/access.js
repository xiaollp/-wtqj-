'use strict';
exports.requireApplicationAccess = (...args) => require('./bindings').get().requireApplicationAccess(...args);
