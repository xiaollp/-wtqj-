'use strict';
const { requireThat: need } = require('../../common/utils');
// 业务主键只在Repository边界映射，数据库里用_id。
exports.createRepository = (store, collection, idField) => {
  const project = row => {
    if (!row) return null;
    const { _id, ...rest } = row; return { [idField]: _id, ...rest };
  };
  return {
    async findById(id, tx = store) { return project(await tx.get(collection, id)); },
    async getByUnique(deterministicId, tx = store) { return project(await tx.get(collection, deterministicId)); },
    async insert(record, tx) {
      need(tx, 'INTERNAL_ERROR', '持久化事务上下文缺失');
      const { [idField]: id, ...rest } = record; need(typeof id === 'string', 'VALIDATION_FAILED', '主键缺失');
      need(!await tx.get(collection, id), 'STATE_CONFLICT', '记录已经存在'); await tx.set(collection, id, rest); return record;
    },
    async updateIfVersion(id, expectedVersion, patch, tx) {
      need(tx, 'INTERNAL_ERROR', '持久化事务上下文缺失'); const row = await tx.get(collection, id);
      need(row && row.version === expectedVersion, 'STATE_CONFLICT', '状态已更新，请刷新', row ? { current_version: row.version, current_status: row.status } : null);
      need(!Object.hasOwn(patch, '_id') && !Object.hasOwn(patch, idField), 'VALIDATION_FAILED', '不允许修改主键');
      const next = { ...row, ...patch, version: expectedVersion + 1 }; await tx.set(collection, id, next); return project(next);
    },
    async queryPage(filter, page, tx) {
      // 事务中禁止where查询；传入tx时直接拒绝，避免SDK运行时才报错。
      need(!tx, 'VALIDATION_FAILED', '条件分页不能在事务内部执行');
      return require('../../common/bindings').get().page(collection, filter, page, collection, async r => project(r));
    }
  };
};
