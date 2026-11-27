'use strict';
const { requireThat: need } = require('../../common/utils');
const validId = id => typeof id === 'string' && id.length >= 1 && id.length <= 64 && id === id.trim();
const validVersion = value => Number.isSafeInteger(value) && value >= 1;

// 业务主键只在Repository边界映射，数据库里用_id。
function createRepository(store, collection, idField, options = {}) {
  const project = row => {
    if (!row) return null;
    const { _id, ...rest } = row; return { ...rest, [idField]: _id };
  };
  return {
    async findById(id, tx = store) { return project(await tx.get(collection, id)); },
    async getByUnique(deterministicId, tx = store) { return project(await tx.get(collection, deterministicId)); },
    async insert(record, tx) {
      need(tx, 'INTERNAL_ERROR', '持久化事务上下文缺失');
      const { [idField]: id, ...rest } = record;
      need(validId(id) && !Object.hasOwn(rest, '_id'), 'VALIDATION_FAILED', '业务主键无效');
      need(!await tx.get(collection, id), 'STATE_CONFLICT', '记录已经存在');
      if (options.validate) await options.validate({ ...rest, _id: id }, tx);
      await tx.set(collection, id, rest);
      return record;
    },
    async updateIfVersion(id, expectedVersion, patch, tx) {
      need(tx, 'INTERNAL_ERROR', '持久化事务上下文缺失');
      need(validVersion(expectedVersion) && expectedVersion < Number.MAX_SAFE_INTEGER, 'VALIDATION_FAILED', '版本号无效');
      const row = await tx.get(collection, id);
      need(row && row.version === expectedVersion, 'STATE_CONFLICT', '状态已更新，请刷新', row ? { current_version: row.version, current_status: row.status } : null);
      need(!['_id', idField, 'version'].some(field => Object.hasOwn(patch, field)), 'VALIDATION_FAILED', '不允许直接修改主键或版本号');
      const next = { ...row, ...patch, version: expectedVersion + 1 };
      if (options.validate) await options.validate(next, tx);
      await tx.set(collection, id, next);
      return project(next);
    },
    async queryPage(filter, page, tx) {
      // 事务中禁止where查询；传入tx时直接拒绝，避免SDK运行时才报错。
      need(!tx, 'VALIDATION_FAILED', '条件分页不能在事务内部执行');
      const query = options.page || require('../../common/bindings').get().page;
      return query(collection, filter, page, collection, project);
    }
  };
}

module.exports = { createRepository, validId, validVersion };
