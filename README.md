# 消费审批微信小程序

本分支为成员 B 的前端交付，基于 A 的小程序、C 的核心业务和 D 的数据库实现开发。使用原生微信小程序、JavaScript / CommonJS 和 Node.js 云函数。

**当前状态：B 的前端第一版已提交，默认使用分模块模拟数据。真实云环境、扩展业务接口、管理员会话和多账号联调仍待团队完成。** 本地测试通过不代表真实微信部署已验收。

成员 A 的小程序页面、服务签名、路由和联调入口见 [成员 A 交接](docs/A-HANDOFF.md)。
成员 D 的集合、索引同步命令和事务接口见 [成员 D 数据库交接](docs/D-DATABASE.md)。
成员 B 的页面、模拟开关和接入要求见 [B 前端交付](docs/B-DELIVERY.md)，实际验证情况见 [B 测试记录](docs/B-TEST-RECORD.md)。[待讨论事项](docs/B-DISCUSSION-2026-11-29.md)记录统计时间口径及公开举报范围。

## 体验 B 的小程序页面

1. 下载或拉取 `member-b`，用微信开发者工具导入包含 `project.config.json` 的项目根目录。
2. 本机演示可使用开发工具允许的测试号。真实云调用需要团队 AppID、开发者权限和已部署的云环境，仓库中原模板 AppID 不代表团队拥有它。
3. 保留 `miniprogram/config.js` 的模拟开关为 `true`，编译后从首页进入 B 的功能。原首页登录仍连接云端，未配置云环境时可能显示连接失败，B 的模拟入口可独立使用。

| 功能 | 体验入口与说明 |
| --- | --- |
| 消费监督小组 | 创建、成员、邀请、接受邀请、待办、普通申请转入小组。邀请记录可生成收到的演示邀请。 |
| 锐评模板 | 新增、编辑、删除个人模板，分类筛选、复制。系统模板只读。 |
| 匿名榜单与收藏 | 收藏、取消收藏、复制；收到锐评后的举报与拉黑采用独立演示入口。 |
| 消费统计 | 月份和标签筛选、趋势、分类与好友 PK；当前月截止设备当前时间，可信时间口径待与 D 确认。 |
| 消息设置 | 审批结果、小组待办偏好，模拟接受、拒绝和禁止授权，不发送微信消息。 |
| 纪念与总结 | 通过、拒绝、失效三种示例；整张小票出票动画、静态好友留言、Canvas 图片生成和保存。 |

纪念状态采用同意绿、拒绝红、失效灰。长留言在页面完整展示；导出图片超出高度时明确标注节选。图片保存不包含出票动画，实际 Canvas 和相册权限需在微信开发者工具或真机验收。

模拟数据按模块保存在本机，与真实数据库及其他模块的模拟记录独立。模拟权限和审核仅供交互演示，不代表真实业务已通过审核。

## 体验管理后台

在项目根目录运行，要求 Node.js 18 或以上：

```powershell
node scripts/serve-admin.cjs
```

浏览器打开 <http://127.0.0.1:4173>。默认演示账号 `demo`，密码 `demo123`，支持举报查询、复核、账号限制、禁用与恢复。演示操作保存在当前浏览器，管理后台与小程序模拟举报各自独立，登录密码不保存。

也可直接打开 `admin/index.html` 体验模拟模式。真实模式需要 D 确认接口地址、Cookie、CSRF、权限名称和嵌套返回结构，再调整 `admin/config.js`；`contractConfirmed` 默认关闭。

## 接入真实接口

- `miniprogram/config.js` 分别控制 `groupsMock`、`commentsMock`、`statisticsMock`、`notificationsMock`、`artifactsMock`。只对已部署并完成契约核对的模块设置为 `false`，真实请求失败不会回退到模拟数据。
- 填写团队 `cloudEnv` 和真实 AppID。订阅消息还需要配置 `notificationTemplateIds`，真实授权通过微信完成，偏好开启不代表永久消息额度。
- A、B 需对齐模板选用事件、收藏来源、接收者举报入口和页面跳转。D 需提供扩展业务、文件核验、统计、通知、AI 及管理员会话。具体边界见 [B 前端交付](docs/B-DELIVERY.md)。

## C 核心业务与 D 持久化基础

原核心业务包含登录资料、好友、申请、审批资格、普通审批、多人会审、小组及文件预览入口。以下保留其运行、契约及部署说明；部署结果以团队实际环境为准。

## 从这里开始

- `cloudfunctions/api/index.js`：可信云函数入口。
- `cloudfunctions/api/modules/`：C的六个业务模块。
- `docs/HANDOFF.md`：A/B/D实际代码对接说明。
- `docs/api-contracts.json`：从实际路由导出的输入字段。
- `database/`：交给D的集合、权限与索引清单，不会自动改动云环境。
- `test/`、`scripts/demo.js`：本地测试及两账号演示。

## 本地运行

本地测试只使用Node.js自带模块，不需要安装SDK或提供微信账号：

```powershell
cd 你的路径/expense-approval-c
node --test test/business.test.js test/cloud-store.test.js test/miniprogram.test.js test/database.test.js
node scripts/demo.js
```

也可以运行 `npm test`、`npm run demo`。演示覆盖登录、确认好友、建组邀请、创建NORMAL申请、转入GROUP、审批及查结果。测试审核只在test/helpers.js显式注入；云函数不加载测试代码或内存数据库。

## 与 B 的约定

- applications.create仅允许NORMAL/JOINT，默认NORMAL，不直接创建GROUP。
- groups.submitApplication在事务中将NORMAL转为GROUP，锁定成员并写事件。
- 必须为申请人和小组成员、未到期且待审批、无既有意见、无普通分享邀请或资格。后两项防止两种审批上下文混用；失败返回STATE_CONFLICT。
- 每笔申请只绑定一个小组，不支持反向切换或改名单。

这替换原通知中“先创建GROUP”的条目。

## 部署到团队开发环境

1. 用微信开发者工具打开本目录，保留团队真实AppID。原模板AppID随原文件保留，不表示你拥有它。
2. 在 `miniprogram/config.js` 配置团队开发云环境 ID。
3. 按成员 D 数据库交接说明准备业务集合、客户端权限和索引。
4. api服务端环境变量配置APP_SECRET，至少32个随机字符，所有实例相同且长期稳定；不要把密钥写进小程序或使用.env.example占位文字。
5. 在api目录安装SDK后上传云函数api，选择实际支持Node.js 18+的运行时。可使用开发者工具安装依赖；按锁文件复现时运行 `pnpm install --frozen-lockfile --ignore-scripts`。
6. 从小程序账号调用auth.login，再联调无图的同意审批链。控制台测试没有可信OPENID时返回AUTH_REQUIRED，不能通过请求参数伪造身份。

生成APP_SECRET的本地命令：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

改变密钥会导致旧幂等结果无法解密、旧游标失效，需要协调迁移。原quickstartFunctions仅保留为示例，不作为业务入口部署。

## 调用示例

```javascript
const response = await wx.cloud.callFunction({
  name: 'api',
  data: {action: 'applications.create', params: {
    idempotency_key: '本次提交的随机键', description: '学习用键盘',
    price_cent: 19900, tag: '数码', image_ids: [],
    approval_hours: 24, mode: 'NORMAL'
  }}
});
// response.result = {code,message,request_id,data,retryable}
```

所有写动作携带idempotency_key；状态修改另带expected_version。网络结果未知保留原键原参；STATE_CONFLICT刷新后重新确认，用新版本新键。金额为安全整数分，时间为UTC毫秒整数。

## D 仍需接入的能力

| 能力 | 对接文件 | 尚未接入时 |
|---|---|---|
| 真实内容安全审核 | infra/adapters/content.js | 锐评提交返回CONTENT_CHECK_UNAVAILABLE |
| 图片/头像归属及真实元数据核验 | infra/adapters/files.js | 带图或头像写入返回DEPENDENCY_UNAVAILABLE，无图申请可运行 |
| 私有文件临时地址 | 同上 | 预览返回DEPENDENCY_UNAVAILABLE或ACCESS_DENIED |
| 下架/拉黑状态 | infra/adapters/visibility.js | 已有保守过滤，D按交接字段维护状态 |
| 通知、统计、总结和事件消费 | outbox_events及D模块 | 事件持久化，不伪造已通知或已生成总结 |

通知、统计和总结可复用成员 D 的事务、Repository 和事件消费存储接口。

## 到期扫描

请求路径按服务端截止时间拦截过期审批。maintenance.js 提供申请到期和幂等响应压缩扫描，仅供受控任务调用。

D在受控维护函数部署同一代码包并设置入口maintenance.main，每分钟触发一次，具体入口配置以实际控制台为准。服务端配置独立MAINTENANCE_TOKEN（至少32随机字符），触发输入为 `{maintenance_token:对应密钥}`。未配置、缺失或错误密钥均拒绝执行。该密钥只保存在服务端触发器，不能放进小程序。此函数和定时器尚未部署。

## 参考与依赖

SDK固定wx-server-sdk@4.0.2，附pnpm-lock.yaml。本地已验证SDK导入、事务方法及查询命令存在，没有使用真实云凭据。

- [CloudBase事务文档](https://docs.cloudbase.net/database/transaction)：事务内只使用主键读写，外部审核放在事务之外。
- [微信云函数SDK](https://www.npmjs.com/package/wx-server-sdk)。

原示例说明保留在TEMPLATE_README.md。

