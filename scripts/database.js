'use strict';
const { collections, cloud_acl: acl } = require('../database/collections.json');
const { indexes, default_direction: defaultDirection } = require('../database/indexes.json');

const namePattern = /^[a-z][a-z0-9_]{0,62}$/;
const directionCode = { asc: '1', desc: '-1' };
class SchemaError extends Error {}

function loadSchema() {
  if (!Array.isArray(collections) || new Set(collections).size !== collections.length
      || !collections.every(name => namePattern.test(name)) || acl !== 'ADMINONLY') {
    throw new SchemaError('集合清单无效');
  }

  const schema = new Map(collections.map(name => [name, { collection: name, acl, indexes: [] }]));
  for (const entry of indexes) {
    const { collection, name, fields, unique = false, direction = defaultDirection } = entry;
    const target = schema.get(collection);
    if (!target || !namePattern.test(name) || !Array.isArray(fields) || !fields.length
        || !fields.every(field => namePattern.test(field) || field === '_id')
        || new Set(fields).size !== fields.length || typeof unique !== 'boolean'
        || !Object.hasOwn(directionCode, direction) || target.indexes.some(index => index.IndexName === name)) {
      throw new SchemaError('索引清单无效');
    }
    target.indexes.push({
      IndexName: name, MgoKeySchema: { MgoIsUnique: unique,
        MgoIndexKeys: fields.map(field => ({ Name: field, Direction: directionCode[direction] })) }
    });
  }
  return [...schema.values()];
}

function matchesIndex(actual, desired) {
  const { MgoIsUnique: unique, MgoIndexKeys: keys } = desired.MgoKeySchema;
  const recognizedUnique = unique ? ['true', '1'] : ['false', '0'];
  return recognizedUnique.includes(String(actual.Unique).toLowerCase())
    && (actual.ExpireAfterSeconds == null || String(actual.ExpireAfterSeconds) === '-1')
    && Array.isArray(actual.Keys) && actual.Keys.length === keys.length
    && actual.Keys.every((key, i) => key.Name === keys[i].Name && String(key.Direction) === keys[i].Direction);
}

function changesForIndexes(actual, desired) {
  const create = [], conflicts = [];
  for (const index of desired) {
    const named = actual.find(item => item.Name === index.IndexName);
    if (named && !matchesIndex(named, index)) {
      conflicts.push(index.IndexName);
    } else if (!actual.some(item => matchesIndex(item, index))) {
      create.push(index);
    }
  }
  return { create, conflicts };
}

async function inspectCollection(db, call, envId, entry, exists) {
  const { collection, acl: expectedAcl, indexes: wanted } = entry;
  if (!exists) return { collection, createCollection: true, acl: expectedAcl, indexes: wanted, conflicts: [] };

  const { Indexes } = await db.describeCollection(collection);
  if (!Array.isArray(Indexes)) throw new SchemaError('无法确认索引状态 ' + collection);
  const { AclTag } = await call('DescribeSafeRule', { EnvId: envId, CollectionName: collection });
  if (typeof AclTag !== 'string') throw new SchemaError('无法确认权限状态 ' + collection);
  const { create, conflicts } = changesForIndexes(Indexes, wanted);
  return { collection, createCollection: false, acl: AclTag === expectedAcl ? null : expectedAcl, indexes: create, conflicts };
}

async function inspectDatabase(db, call, envId, schema) {
  // 部分 SDK 版本的 checkCollectionExists 会把网络和权限错误转成 Exists:false。
  const names = new Set();
  let offset = 0;
  while (true) {
    const { Collections, Pager } = await db.listCollections({ MgoOffset: offset, MgoLimit: 50 });
    if (!Array.isArray(Collections) || !Collections.every(item => typeof item.CollectionName === 'string')
      || !Number.isSafeInteger(Pager?.Total) || Pager.Total < 0) throw new SchemaError('无法确认远端集合清单');
    for (const item of Collections) names.add(item.CollectionName);
    offset += Collections.length;
    if (offset >= Pager.Total) break;
    if (!Collections.length) throw new SchemaError('远端集合分页不完整');
  }

  const pending = [];
  for (const entry of schema) {
    const result = await inspectCollection(db, call, envId, entry, names.has(entry.collection));
    if (result.createCollection || result.acl || result.indexes.length || result.conflicts.length) pending.push(result);
  }
  return pending;
}

async function reconcileDatabase({ manager, envId, apply = false, schema = loadSchema() }) {
  const db = manager.database, common = manager.commonService();
  const call = (Action, Param) => common.call({ Action, Param });
  const pending = await inspectDatabase(db, call, envId, schema);
  if (!apply || pending.some(entry => entry.conflicts.length)) return pending;

  for (const entry of pending) {
    const { collection } = entry;
    try {
      if (entry.createCollection) await db.createCollection(collection);
      if (entry.acl) await call('ModifySafeRule', { EnvId: envId, CollectionName: collection, AclTag: entry.acl });
      if (entry.indexes.length) {
        // 同名建索引可能触发平台重建。实际写入前再次检查，支持失败后安全重跑。
        const { Indexes } = await db.describeCollection(collection);
        if (!Array.isArray(Indexes)) throw new SchemaError('索引状态无效');
        const { create, conflicts } = changesForIndexes(Indexes, entry.indexes);
        if (conflicts.length) throw new SchemaError('索引出现同名冲突');
        if (create.length) await db.updateCollection(collection, { CreateIndexes: create });
      }
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Za-z0-9._-]+$/.test(error.code) ? ' (' + error.code + ')' : '';
      throw new SchemaError('集合 ' + collection + ' 同步失败，请重新运行 check 确认已应用的条目' + code);
    }
  }

  return pending.length ? inspectDatabase(db, call, envId, schema) : [];
}

async function main([command = 'plan', flag, envId, ...extra]) {
  if (command === 'plan' && !flag) {
    console.log(JSON.stringify(loadSchema(), null, 2));
    return;
  }
  if (!['check', 'apply'].includes(command) || flag !== '--env' || !envId || extra.length) {
    throw new SchemaError('用法 node scripts/database.js plan | check --env 环境ID | apply --env 环境ID');
  }
  const { WTQJ_CLOUDBASE_SECRET_ID: secretId, WTQJ_CLOUDBASE_SECRET_KEY: secretKey,
    WTQJ_CLOUDBASE_SESSION_TOKEN: token, WTQJ_CLOUDBASE_REGION: region } = process.env;
  if (!secretId || !secretKey) throw new SchemaError('请在本机配置 WTQJ_CLOUDBASE_SECRET_ID 和 WTQJ_CLOUDBASE_SECRET_KEY');
  const CloudBase = require('@cloudbase/manager-node');
  const manager = new CloudBase({ envId, secretId, secretKey, ...(token ? { token } : {}), ...(region ? { region } : {}) });
  const differences = await reconcileDatabase({ manager, envId, apply: command === 'apply' });
  console.log(JSON.stringify({ envId, ready: differences.length === 0, differences }, null, 2));
  if (differences.length) process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // SDK 错误可能带有服务响应或授权信息，只输出自有错误及平台错误码。
  const code = typeof error.code === 'string' && /^[A-Za-z0-9._-]+$/.test(error.code) ? error.code : null;
  console.error(error instanceof SchemaError ? error.message : '数据库操作失败' + (code ? ' (' + code + ')' : ''));
  process.exitCode = 1;
});

module.exports = { loadSchema, reconcileDatabase };
