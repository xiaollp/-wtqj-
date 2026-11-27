# 成员 D 数据库交接

本实现面向微信云开发的文档数据库，保留 C 和 A 已使用的集合与接口。集合清单包含 31 个集合，索引清单包含 39 个索引。好友、申请及小组邀请统一保存于 `invitations`，由 `kind` 区分。拉黑沿用 `blocks`。邀请、好友二元组、拉黑、文件引用及幂等记录的组合唯一性由确定性 `_id` 和事务保证。

## 部署与核对

```powershell
npm run db -- plan
npm install --no-save --package-lock=false @cloudbase/manager-node@5.4.0
npm run db -- check --env TEAM_DEV_ENV_ID
npm run db -- apply --env TEAM_DEV_ENV_ID
```

`plan` 从仓库清单输出目标集合、权限和索引定义，可直接用于控制台核对。`check` 只读检查目标环境。`apply` 补充缺失集合和索引，将清单中集合的客户端权限设为 `ADMINONLY`，然后回读验证。命令退出码为 0 且 `ready` 为 true 表示核对完成。发现同名索引定义冲突时会在写入前报告差异。

`check` 和 `apply` 从当前进程读取 `WTQJ_CLOUDBASE_SECRET_ID`、`WTQJ_CLOUDBASE_SECRET_KEY`。临时凭证另外配置 `WTQJ_CLOUDBASE_SESSION_TOKEN`。需要指定区域时设置 `WTQJ_CLOUDBASE_REGION`。请使用可操作目标开发环境的团队凭证。云端索引创建与集合权限变更集中执行一次即可，遇到部分成功可重新检查并补齐。[CloudBase 管理 SDK](https://docs.cloudbase.net/api-reference/manager/node/database) · [数据库安全规则](https://docs.cloudbase.net/api-reference/manager/node/rule)

部署 `api` 时仍使用服务端 `APP_SECRET`。数据库准备后可用微信两账号联调无图申请、审批和到期更新。部署受控维护函数 `maintenance.main` 并配置 `MAINTENANCE_TOKEN` 后，会分批处理已到期申请及幂等响应压缩。现有结果回放窗口沿用 C 版的 7 天，过期后清除加密响应并保留键摘要。幂等记录的 `expires_at` 是兼容元数据，自动删除旧键的 TTL 索引会破坏重放保护。

## 持久化接口

| 入口 | 约定 |
| --- | --- |
| `infra/db.js` 的 `runTransaction(handler)` | 回调接受 `tx`，按主键读写，异常会回滚。云 SDK 可能重试事务回调。所有外部调用放在事务之外。写冲突可保留原请求参数和幂等键重试。 |
| `infra/idempotency.js` 的 `executeIdempotent(actorId, action, token, params, handler)` | 同键同参回放首次成功结果，同键异参抛 `IDEMPOTENCY_CONFLICT`，结果过期抛 `REQUEST_EXPIRED`。业务写入、Outbox 事件和幂等响应共同提交。 |
| `infra/time.js` 的 `now()` | 返回服务端 UTC 毫秒时间戳。 |
| `services.repositories.users/applications/opinions/reports` | `findById(id, tx?)`、`getByUnique(id, tx?)` 按主键读取。 `insert(record, tx)` 校验重复键。 `updateIfVersion(id, expectedVersion, patch, tx)` 执行条件更新，版本过旧抛 `STATE_CONFLICT`。 `queryPage(filter, { limit, cursor? })` 使用签名游标，只能在事务外执行。 |
| `services.repositories.insertReport(input, tx)` | 接收 `reporter_id`、`opinion_id`、`reason`，校验引用并创建 `PENDING` 举报，同人同意见重复时抛 `STATE_CONFLICT`。调用方先检查对象权限。 |
| `services.repositories.saveSummary(input, tx)` | 按一笔申请一份总结写入，用 `result_version` 保证旧结果无法覆盖新结果。同版本允许从待生成更新为已生成或失败，也允许失败后补充成功。 |

```javascript
const { runTransaction } = require('./infra/db');
const { get } = require('./common/bindings');

const report = await runTransaction(tx => get().repositories.insertReport({
  reporter_id: reporterId, opinion_id: opinionId, reason
}, tx));
```

## Outbox 消费存储

1. 调度器从 `services.outbox.listUntracked(limit)` 读取新事件，根据事件类型选择消费者，调用 `track(eventId, consumers)`。消费者集合一经登记即固定，同一配置重复登记会沿用原记录。
2. 工作者调用 `listDueConsumptions(limit)` 和 `claim(eventId, consumer)`。领取成功返回 30 秒租约、业务事件和尝试次数。重复领取返回空，过期租约可由其他工作者接管。
3. 调用 `finish(eventId, consumer, leaseId, { status, error_code? }, persist?)` 记录 `DONE`、`SKIPPED`、`RETRY` 或 `FAILED`。旧租约返回 `STATE_CONFLICT`，重试使用退避并限制为 5 次领取。可通过 `persist(tx)` 将派生数据库写入与 `DONE` 一同提交。
4. 所有消费者完成或跳过后事件标记 `DONE`。全部消费者结束且存在失败时事件标记 `FAILED`。发送通知等外部操作应在事务外，并在提供方支持时携带稳定的事件去重键。

本次交付了存储和事务接口。通知发送、AI 调用、管理员会话签发、真实存储核验和内容审核由各业务服务接入。当前工作区未绑定团队开发云环境，本地测试使用内存存储、SDK 接口桩以及真实管理 SDK 的离线合约核对。
