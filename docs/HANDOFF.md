# A B D 代码对接说明

对应当前代码。旧通知的“小组先创建GROUP”已改为NORMAL转GROUP；参数以同目录api-contracts.json为准。部署和环境状态见README。

## 给 A

调用云函数api，请求 `{action,params}`，接收 `{code,message,request_id,data,retryable}`。你提供callApi、createWriteContext、showError、上传及业务services。成功取data，失败抛统一错误；页面决定提示时机。小程序页面仍由你实现。

| action | 成功data |
|---|---|
| auth.login / auth.profile | `{user:{user_id,nickname,avatar_file_id,account_status,created_at,updated_at}}` |
| friends.createInvitation | `{invitation_id,share_path,expires_at}` |
| friends.claimInvitation | `{invitation}`，CLAIMED仍不是好友 |
| friends.confirmInvitation | `{invitation_id,status,friend}`，接受后CONFIRMED |
| friends.list / friends.invitations | `{items,next_cursor}` |
| applications.create | `{application_id,status,version,approval_deadline,share_info:null}` |
| applications.list | `{items,next_cursor}`，本人发起 |
| applications.get | `{application,progress}` |
| applications.share | `{card_id,share_path,expires_at,receiver_status,version}` |
| applications.getInvitation | `{card_id,invitation,can_accept}` |
| applications.acceptInvitation | `{invitation_id,status,application_id,version}`，不传expected_version |
| applications.invitations | `{items,next_cursor}` |
| applications.withdraw | `{application_id,status,version}` |
| applications.setValidity | `{application_id,status,consume_expires_at,version}` |
| approvals.submit | `{opinion,application_status,progress,version}` |
| approvals.progress / reviews.progress | `{approved_count,rejected_count,pending_count,participants,application_status,version}` |
| approvals.history | `{items:[{application,opinion}],next_cursor}` |
| reviews.start | `{application_id,rule,approver_ids,status,version}` |
| support.getFileUrls | `{items:[{file_id,url,expires_at}]}` |

NORMAL首个有效意见结案；ALL_APPROVE收齐意见才结案；ONE_VETO首个拒绝即结案。普通邀请每次最多10人、累计20人，会审仍为2～3人。同键成功重试保留原业务结果，但按当前下架/拉黑状态过滤正文；不要用旧写响应覆盖后续查询到的新状态。

按钮使用application.permissions，整体状态使用服务端结果。正文隐藏时保留decision，comment=null、comment_visible=false。CLOSED资格可查看结果，REVOKED不可读。

分享路径目前指向以下待A/B实现的页面，原示例没有这些页面；可与A/B实际目录同步修改返回路径，参数名不变：

- `/pages/friends/accept?token=...`
- `/pages/applications/invitation?card_id=...`
- `/pages/groups/invitation?invitation_id=...`

登录→好友双方确认→创建→定向分享→接收人接受→审批→查结果。拿到链接本身不会授权读取正文。

## 给 B

groups.create/list/get/invite/getInvitation/acceptInvitation/invitations/submitApplication/todos已实现，字段保持先前通知：

- create/get返回 `{group,members}`，list/invitations返回 `{items,next_cursor}`。
- invite返回 `{invitation_id,status,expires_at,joined,share_path}`；已是成员时joined=true、status=ACCEPTED，三个邀请相关字段为null。
- getInvitation返回 `{invitation,group_name,can_accept}`；acceptInvitation返回 `{invitation_id,status,expires_at,joined:true,group_id}`。
- submitApplication传 `{group_id,application_id,expected_version,idempotency_key}`，收 `{link_id,application_id,group_id,todo_created:true,participant_count,version}`。
- todos返回 `{items:[{application,my_decision,can_approve}],next_cursor}`；只返回本人有资格且整体PENDING的申请。

先筛选本人NORMAL、PENDING申请，后端再判断完整转换条件。已有普通分享邀请或资格时不混入小组，需要另建申请。绑定时锁定成员快照，新成员看不到旧申请；ALL_APPROVE收齐才结案。最多21名成员，本期无退出/解散/踢人接口。

你回传页面路由、services/groups.js映射、与A的跳转方式和联调入口即可。锐评模板等D模块尚未实现，未知action返回VALIDATION_FAILED，不伪装成功。

## 给 D

数据库部署与现行 Repository、Outbox 接口见 [成员 D 数据库交接](D-DATABASE.md)。

### C已提供的公共函数

路径相对cloudfunctions/api。直接导出函数在api入口初始化后可用；独立管理函数应显式创建对应服务，不依赖api进程状态。

- common/auth.js：`requireUser(trustedContext,{allowLimitedRead?,tx?})` → `{user_id,account_status}`。
- common/access.js：`requireApplicationAccess(userId,applicationId,operation,tx?)` → 内部申请记录（主键_id）。
- common/validation.js：`validateParams(params,schema)`；schema用导出的f构造，示例见各业务模块。
- common/response.js：`success(data,requestId)`；common/errors.js：`toErrorResponse(error,requestId)`。
- infra/db.js：`runTransaction(handler)`。
- infra/idempotency.js：`executeIdempotent(actorId,action,key,params,handler)`，handler(tx)内保存业务和事件；不得嵌套事务或调用外部API。你的handler仍需校验业务权限。
- infra/time.js：`now()`。
- infra/repositories/index.js：`createRepository(store,collection,idField)`，提供findById/getByUnique/insert/updateIfVersion/queryPage。getByUnique接收确定性主键；queryPage不接受事务；权限由业务调用方负责。

可替换存储提供get(collection,id)、scan(collection,{where,after,limit})、runTransaction(handler)；tx只有get/set，按主键访问。当前CloudStore为真实SDK适配，MemoryStore仅供测试。

### 需要D补齐的适配器

content.js的 `checkOpinionContent({actor_id,text,request_id})` 返回 `{passed:true,content_hash,checked_at}`。content_hash为规范化正文UTF-8的SHA256十六进制；违规抛CONTENT_REJECTED，依赖故障抛CONTENT_CHECK_UNAVAILABLE且retryable=true。C额外限制等待1000ms。

files.js的接口：

- verifyImages(actorId,fileIds) → 按输入顺序的 `[{file_id,width,height,size_bytes}]`。核验真实归属、存在、图片类型及≤1280px/200KB，不能相信客户端元数据。
- verifyAvatar(actorId,fileId) → `{file_id}`，核验本人图片。头像归属服务维护file_refs供预览鉴权。
- getTemporaryUrls(fileIds) → `[{file_id,url,expires_at}]`，有效期≤10分钟。C已检查对象权限；不要把该内部函数直接对外开放。

C随创建申请事务绑定application_images/file_refs；一张原上传文件只绑定一笔申请，重用需重新上传。file_refs主键为common/utils.js导出的 `key('file',file_id)`；字段至少owner_id、application_id、kind、file_id、created_at；头像application_id=null、kind=AVATAR。

visibility.js已有投影：opinions.content_status=VISIBLE才展示；下架写REMOVED。拉黑集合blocks，主键 `key('block',viewerId,targetId)`，active=true；取消时false。属主账号非NORMAL或未知内容状态隐藏正文。不要改审批决定。要调整字段时同步适配器。

### 数据库和事件

业务集合沿用，新增unique_keys（组名占位）、file_refs、blocks、invitations。确定性_id保证组合唯一性。ApplicationRecord的participant_ids/invitation_ids是最多20人的有界索引，不替代独立集合；GroupRecord的member_ids最多21个，成员关系仍单独持久化。

幂等成功加密结果保留 7 天，受控维护任务随后压缩过期响应并保留键摘要以阻止重放。APP_SECRET 长期稳定，日志需脱敏。集合与索引清单见 database 目录。

C同事务写outbox_events，数据库_id映射为event_id后由D消费：

```javascript
const event = {...record, event_id: record._id};
// {event_id,type,aggregate_id,version,payload,status,attempts,next_retry_at,created_at}
```

type为APPLICATION_PARTICIPANTS_READY、APPLICATION_RESULT_FINALIZED、APPLICATION_WITHDRAWN、APPLICATION_VALIDITY_CHANGED、APPLICATION_CONSUME_EXPIRED；payload含application_id、owner_id、participant_ids、status、final_decision、expire_reason。

数据库层按 event_id 与 consumer 去重，保存租约及有限重试状态，并在必需消费者均完成或明确跳过时设为 DONE。旧版本不能覆盖新总结。通知和总结业务处理通过这些接口接入，撤回不生成总结，消费失效保留原决定。

普通业务动作映射合并到modules/extensions.js，处理器 `(params,ctx)=>data`；ctx含request_id、trustedContext、user_id、account_status。也可用 `{schema,handler}`描述项统一参数校验。普通函数形式需自行validateParams和写权限检查；管理员走独立保护入口。

## 联调顺序

1. A双账号登录并确认好友。
2. 无图申请、分享、接受、同意、查结果。
3. B建组邀请，A建NORMAL，B提交小组，成员待办和审批。
4. D接审核，验证拒绝通过、违规拦截、超时。
5. D接私有文件、下架拉黑、事件消费和维护扫描。

定位问题发action、request_id及脱敏业务ID，不发送邀请token、管理员凭据或完整敏感正文。
