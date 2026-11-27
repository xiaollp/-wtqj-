# 成员 A 交接

在本地 `member-a` 分支开发，以成员 C 的 `b00dc97` 为基线。小程序首页为 `pages/index/index`。小程序展示和业务服务均使用原生微信小程序框架。

## 公共入口

| 导入位置 | 调用约定 |
| --- | --- |
| `miniprogram/shared/api.js` | `callApi(action, params, options)` 调用云函数 `api`。默认先从可信微信上下文登录。成功返回 `data`，失败抛出含 `code`、`message`、`request_id`、`retryable` 的 Error。可用 `{ requireLogin: false }` 跳过先行登录。 |
| 同上 | `createWriteContext()` 返回 `{ idempotency_key }`。同一次提交若结果不确定，沿用原参数和原 context。修改输入后创建新 context。 |
| 同上 | `showError(error)` 显示统一提示。页面也可用 `errorMessage(error)` 渲染行内错误。 |
| `miniprogram/shared/images.js` | `uploadImage(filePath)` 返回云存储 `file_id` 字符串。先检查原图大小，再压缩并验证输出尺寸与体积。 |
| `miniprogram/services/` | `auth.js`、`friends.js`、`applications.js`、`approvals.js`、`reviews.js` 对接对应模块。写服务签名为 `(params, context)`。 |

```js
const { createWriteContext, showError } = require('../../shared/api');
const { createApplication } = require('../../services/applications');

const context = createWriteContext();
const params = {
  description: '学习用键盘', price_cent: 19900, tag: '数码',
  image_ids: [], approval_hours: 24, mode: 'NORMAL'
};

async function submit() {
  try {
    return await createApplication(params, context);
  } catch (error) {
    showError(error);
    throw error;
  }
}
```

页面可复用 `shared/write.js` 的 `runWrite` 防止并发点击，对可重试失败保留该页面的上下文。收到 `AUTH_REQUIRED` 后，下次显式请求会重新登录。遇到版本冲突时，详情会重新查询，用户确认后再提交。状态和权限以查询结果为准。

## 路由及联调

- 好友卡片 `/pages/friends/accept?token=...`。接收人领取后，发起人在「好友和好友邀请 → 我发出的」确认。
- 普通审批卡片 `/pages/applications/invitation?card_id=...`。指定好友接受后打开详情。未接受的邀请只显示元数据。
- 申请、审批和会审详情共用 `/pages/applications/detail?application_id=...`。成员 B 的小组待办可跳转此路由。会审人也可从首页「待我审批」打开。
- `/pages/applications/list?tab=mine|todo|invitations|history` 对应我的申请、待我审批、审批邀请、审批历史。
- 新增 `approvals.todos` 接收 `cursor`、`limit`，返回 `{ items: ApplicationSummary[], next_cursor }`。云端需使用本分支的 `api` 和 `database/indexes.json` 中的申请参与人、状态联合索引。

## 云端部署和契约差异

1. 在微信开发者工具导入此仓库，使用团队 AppID。在 `miniprogram/config.js` 填团队开发环境 ID。留空时使用微信关联的默认环境。
2. 按 C 的 [部署说明](../README.md#部署到团队开发环境) 准备集合、索引、环境变量并部署 `api`。写操作由服务端验证身份、对象权限和版本。
3. 两个微信账号按「登录 → 确认好友 → 创建无图申请 → 定向分享 → 接受 → 同意 → 查看结果」联调。再用三位账号验证两种会审规则，并在「待我审批」确认各自的任务。
4. 商品截图和头像上传至 `uploads/<user_id>/`。文件归属按平台记录核验，路径只用于组织对象。接入 D 的私有存储核验和临时地址适配器后，再验证带图申请和头像。未绑定的临时上传由云端按团队存储策略回收。
5. 拒绝意见待 D 配置真实内容审核后可提交。模板和收藏入口等待对应查询接口；选中文案只填入输入框，收藏复用计数需要后端接入来源字段。

C 的现行契约要求 `auth.login` 携带幂等键，并使用三步好友确认。标签预判和大额提示由客户端规则提供，阈值在 `miniprogram/config.js` 配置。开启既有申请的会审遵循 C 的实现，可能关闭原普通邀请。管理端、小组管理、锐评管理、统计、通知和纪念各由对应成员继续接入。

本地运行 `npm test` 可验证服务调用、分享绑定、待办权限、提交幂等及文件限制。真实微信账号、团队云环境和 D 的外部依赖需要在开发环境联调。
