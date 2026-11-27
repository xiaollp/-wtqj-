'use strict';
const { randomUUID } = require('node:crypto');
const { key, requireThat: need } = require('../../common/utils');
const { validId } = require('./index');

const EVENTS = 'outbox_events';
const CONSUMPTIONS = 'event_consumptions';
const ACTIVE = ['PENDING', 'PROCESSING'];
const LEASE_MS = 30000;
const ATTEMPTS = 5;
const consumptionId = (eventId, consumer) => key('consumption', eventId, consumer);

function createOutboxRepository({ store, now }) {
  async function updateEvent(tx, event) {
    const records = [];
    for (const consumer of event.consumers) records.push(await tx.get(CONSUMPTIONS, consumptionId(event._id, consumer)));
    const unfinished = records.filter(record => ACTIVE.includes(record.status));
    const status = unfinished.length ? 'PROCESSING' : records.some(record => record.status === 'FAILED') ? 'FAILED' : 'DONE';
    await tx.set(EVENTS, event._id, { ...event, status, updated_at: now(),
      attempts: records.reduce((total, record) => total + record.attempts, 0),
      next_retry_at: unfinished.length ? Math.min(...unfinished.map(record => record.next_retry_at)) : null });
  }

  function listDue(collection, statuses, limit) {
    need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'VALIDATION_FAILED', '批次大小应为1～100');
    return store.scan(collection, {
      where: { status: statuses, next_retry_at: { $lte: now() } }, order: 'asc', limit
    });
  }

  function mark(record, status, at, nextRetryAt = null, errorCode = null) {
    return { ...record, status, lease_id: null, lease_until: null, updated_at: at,
      next_retry_at: nextRetryAt, error_code: errorCode };
  }

  return {
    listUntracked(limit = 50) { return listDue(EVENTS, 'PENDING', limit); },
    listDueConsumptions(limit = 50) { return listDue(CONSUMPTIONS, { $in: ACTIVE }, limit); },

    async track(eventId, requiredConsumers) {
      need(validId(eventId) && Array.isArray(requiredConsumers) && requiredConsumers.every(validId),
        'VALIDATION_FAILED', '事件或消费者标识无效');
      const consumers = [...new Set(requiredConsumers)].sort();
      need(consumers.length === requiredConsumers.length, 'VALIDATION_FAILED', '消费者不可重复');
      return store.runTransaction(async tx => {
        const event = await tx.get(EVENTS, eventId);
        need(event, 'STATE_CONFLICT', '事件不存在');
        if (event.consumers) {
          need(JSON.stringify(event.consumers) === JSON.stringify(consumers), 'STATE_CONFLICT', '事件消费者已经锁定');
          return false;
        }
        need(event.status === 'PENDING', 'STATE_CONFLICT', '事件已结束或领取');
        const at = now();
        for (const consumer of consumers) {
          await tx.set(CONSUMPTIONS, consumptionId(eventId, consumer), { event_id: eventId, consumer, status: 'PENDING',
            attempts: 0, lease_id: null, lease_until: null, next_retry_at: at, error_code: null, created_at: at, updated_at: at });
        }
        await tx.set(EVENTS, eventId, { ...event, consumers, status: consumers.length ? 'PROCESSING' : 'DONE',
          next_retry_at: consumers.length ? at : null, updated_at: at });
        return true;
      });
    },

    async claim(eventId, consumer) {
      return store.runTransaction(async tx => {
        const event = await tx.get(EVENTS, eventId);
        if (event?.status !== 'PROCESSING' || !event.consumers.includes(consumer)) return null;
        const id = consumptionId(eventId, consumer);
        const record = await tx.get(CONSUMPTIONS, id);
        const at = now();
        if (!record || !ACTIVE.includes(record.status) || record.next_retry_at > at) return null;

        if (record.attempts >= ATTEMPTS) {
          await tx.set(CONSUMPTIONS, id, mark(record, 'FAILED', at, null, 'LEASE_EXPIRED'));
          await updateEvent(tx, event);
          return null;
        }
        const leaseId = randomUUID();
        const leaseUntil = at + LEASE_MS;
        await tx.set(CONSUMPTIONS, id, { ...record, status: 'PROCESSING', attempts: record.attempts + 1,
          lease_id: leaseId, lease_until: leaseUntil, next_retry_at: leaseUntil, updated_at: at });
        await updateEvent(tx, event);
        return { event_id: eventId, consumer, lease_id: leaseId, lease_until: leaseUntil, attempts: record.attempts + 1,
          event: { event_id: eventId, type: event.type, aggregate_id: event.aggregate_id, version: event.version,
            schema_version: event.schema_version ?? 1, payload: event.payload, created_at: event.created_at } };
      });
    },

    async finish(eventId, consumer, leaseId, outcome, persist) {
      const { status, error_code = null } = outcome;
      need(['DONE', 'SKIPPED', 'RETRY', 'FAILED'].includes(status)
        && (error_code === null || /^[A-Z][A-Z0-9_]{0,63}$/.test(error_code))
        && (!persist || (status === 'DONE' && typeof persist === 'function')), 'VALIDATION_FAILED', '消费结果无效');
      return store.runTransaction(async tx => {
        const event = await tx.get(EVENTS, eventId);
        const id = consumptionId(eventId, consumer);
        const record = await tx.get(CONSUMPTIONS, id);
        const at = now();
        need(event?.status === 'PROCESSING' && record?.status === 'PROCESSING'
          && typeof leaseId === 'string' && record.lease_id === leaseId && at < record.lease_until,
        'STATE_CONFLICT', '消费租约已失效');
        if (persist) {
          await persist(tx);
          need(now() < record.lease_until, 'STATE_CONFLICT', '消费租约已失效');
        }

        if (status === 'RETRY' && record.attempts < ATTEMPTS) {
          const retryAt = at + 60000 * 2 ** (record.attempts - 1);
          await tx.set(CONSUMPTIONS, id, mark(record, 'PENDING', at, retryAt, error_code));
        } else {
          await tx.set(CONSUMPTIONS, id, mark(record, status === 'RETRY' ? 'FAILED' : status, at, null, error_code));
        }
        await updateEvent(tx, event);
      });
    }
  };
}

module.exports = { createOutboxRepository };
