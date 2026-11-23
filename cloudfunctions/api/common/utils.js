'use strict';
const crypto = require('node:crypto');
const { fail } = require('./errors');
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const key = (prefix, ...parts) => prefix + '_' + hash(parts).slice(0, 40);
const id = prefix => prefix + '_' + crypto.randomBytes(16).toString('hex');
const pairId = (a, b) => key('friend', ...[a, b].sort());
const participantId = (app, user) => key('participant', app, user);
const opinionId = (app, user) => key('opinion', app, user);
const requireThat = (condition, code, message, data) => { if (!condition) fail(code, message, false, data); };
function seal(value, secret) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(hash(secret), 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unseal(value, secret) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hash(secret), 'hex'), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
}
module.exports = { canonical, hash, key, id, pairId, participantId, opinionId, requireThat, seal, unseal };
