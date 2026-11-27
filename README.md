# 消费审批微信小程序 C 后端

成员 A 的小程序页面、服务签名、路由和联调入口见 [成员 A 交接](docs/A-HANDOFF.md)。

在原始示例工程上新增31个后端action：登录资料、好友、申请、审批资格、普通审批、多人会审、小组及文件预览入口。使用 JavaScript / CommonJS，要求 Node.js 18或以上。A/B负责的前端示例保留，未代为实现业务页面。

**当前状态：核心业务代码已实现并通过本地测试，未部署到真实微信云环境。** 已对照安装的wx-server-sdk检查接口形态；真实云事务、权限和索引仍需团队开发环境联调。

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
node --test test/business.test.js test/cloud-store.test.js
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
3. D按database清单创建集合、设置业务集合客户端read/write均为false、配置索引。
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

D可直接复用本次实现的事务、幂等、Repository，也可按HANDOFF.md的存储接口替换CloudStore。

## 到期扫描

请求路径已经检查服务端截止时间，不依赖定时扫描才阻止过期审批。maintenance.js提供批量扫描，未注册公开action，未创建平台定时器。

D在受控维护函数部署同一代码包并设置入口maintenance.main，每分钟触发一次，具体入口配置以实际控制台为准。服务端配置独立MAINTENANCE_TOKEN（至少32随机字符），触发输入为 `{maintenance_token:对应密钥}`。未配置、缺失或错误密钥均拒绝执行。该密钥只保存在服务端触发器，不能放进小程序。此函数和定时器尚未部署。

## 参考与依赖

SDK固定wx-server-sdk@4.0.2，附pnpm-lock.yaml。本地已验证SDK导入、事务方法及查询命令存在，没有使用真实云凭据。

- [CloudBase事务文档](https://docs.cloudbase.net/database/transaction)：事务内只使用主键读写，外部审核放在事务之外。
- [微信云函数SDK](https://www.npmjs.com/package/wx-server-sdk)。

原示例说明保留在TEMPLATE_README.md。

