'use strict';
let runtime;
exports.configure = value => { runtime = value; };
exports.get = () => { if (!runtime) throw new Error('Cloud runtime not initialized'); return runtime; };
