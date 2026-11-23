'use strict';
const { fail } = require('./errors');
const f = {
  string: (min = 1, max = 64, extra = {}) => ({ type: 'string', min, max, ...extra }),
  int: (min = 1, max = Number.MAX_SAFE_INTEGER, extra = {}) => ({ type: 'int', min, max, ...extra }),
  enum: (values, extra = {}) => ({ type: 'enum', values, ...extra }),
  array: (item, min, max, extra = {}) => ({ type: 'array', item, min, max, ...extra })
};
function validateParams(params, schema) {
  const bad = field => fail('VALIDATION_FAILED', '请检查字段：' + field, false, { field_errors: [field] });
  if (!params || typeof params !== 'object' || Array.isArray(params)) bad('params');
  for (const name of Object.keys(params)) if (!Object.hasOwn(schema, name)) bad(name);
  function check(value, rule, name) {
    if (rule.type === 'string') {
      if (typeof value !== 'string') bad(name);
      value = value.trim();
      if (value.length < rule.min || value.length > rule.max) bad(name);
    } else if (rule.type === 'int') {
      if (!Number.isSafeInteger(value) || value < rule.min || value > rule.max) bad(name);
    } else if (rule.type === 'enum') {
      if (!rule.values.includes(value)) bad(name);
    } else if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length < rule.min || value.length > rule.max) bad(name);
      value = value.map((v, i) => check(v, rule.item, `${name}[${i}]`));
      if (rule.unique && new Set(value).size !== value.length) bad(name);
      if (rule.sorted) value.sort();
    } else bad(name);
    return value;
  }
  const result = {};
  for (const [name, rule] of Object.entries(schema)) {
    if (params[name] === undefined) {
      if (Object.hasOwn(rule, 'default')) result[name] = structuredClone(rule.default);
      else if (!rule.optional) bad(name);
    } else result[name] = check(params[name], rule, name);
  }
  return result;
}
const W = { idempotency_key: f.string() }, V = { expected_version: f.int() };
const P = { cursor: f.string(1, 4096, { optional: true }), limit: f.int(1, 50, { default: 20 }) };
module.exports = { f, W, V, P, validateParams };
