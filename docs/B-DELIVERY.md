# B 前端交付与联调清单

## 范围与当前状态

本次交付B的小程序页面与独立管理后台前端，本次交付面向GitHub的member-b分支，基于成员D的2c9e101版本整理。模拟交互可运行；团队AppID、云环境、D的扩展业务与管理员会话尚未接通，不能视作系统真实联调通过。小程序各开关默认true，模拟入口明确提示。模拟记录按模块分别保存，不作为真实数据源；管理后台模拟数据与小程序举报独立。

## 页面清单

|功能|入口|
|---|---|
|小组列表、创建、详情|pages/groups/index、create、detail|
|邀请发送、收发记录、接受|pages/groups/invite、invitations、invitation|
|小组待办、提交申请|pages/groups/todos、submit|
|模板列表、新增编辑|pages/comments/templates、template-edit|
|榜单收藏、举报拉黑|pages/comments/ranking、report|
|统计看板及PK|pages/statistics/index|
|消息设置|pages/notifications/index|
|纪念列表、总结、卡片|pages/artifacts/index、detail|
|管理员登录、举报列表详情、复核、账号限制及禁用恢复|admin/index.html|

小组需要group_id，纪念详情需要application_id。report接opinion_id及可选target_user_id；真实权限由后端检查。模板选择mode=pick使用templateSelected事件返回{template_id,content}，需A共同接入。收藏复制不计有效复用，source_favorite_id仍需与A的提交接口对齐。

## 启动

小程序用微信开发者工具打开项目根目录，编译后从首页进入。测试号的原云登录仍可能提示-601034，不影响模拟页面入口。

管理后台用浏览器打开admin/index.html。建议在项目根目录运行node scripts/serve-admin.cjs后访问http://127.0.0.1:4173。演示账号demo，密码demo123，刷新后需重新登录；密码不写入存储。管理后台可独立于小程序运行。

## 切换真实接口

miniprogram/config.js按模块设置groupsMock、commentsMock、statisticsMock、notificationsMock、artifactsMock为false。填写团队cloudEnv、AppID及notificationTemplateIds。只切换已部署且字段已核对的模块，不会在真实失败时回退模拟。

管理端admin/config.js需D确认endpoint、Cookie、CSRF与权限值，以及列表详情返回结构，之后再设置mock=false和contractConfirmed=true。当前使用{action,params}作为待确认传输适配，不能把这个默认值视作D已承诺的协议。真实请求携带Cookie，不在本地保存令牌或密码。前端权限示例REPORT_REVIEW/USER_RESTRICT需与D映射。

卡片使用后端过滤后的快照，Canvas绘图，真实模式上传uploads/<user_id>/后completeCard确认版本；D需确认图片规范、路径及文件核验。模拟卡片实际生成本地图片，不把本地路径冒充云端file_id。保存相册需要用户授权；预览和分享链接仍受后端权限控制。私有文件URL到期后刷新获取。

## 待对接与讨论

- A确认首页新增导航、页面路由和模板事件；接收者锐评旁接report入口，收藏来源用于真实审批提交。
- D确认ranking是否含favorite、available，模板查询是否完整返回，举报详情/发布者可见范围与拉黑初始状态，站内消息授权配置。
- D提供统计口径、Card/Summary快照字段及文件约束、管理员会话和嵌套对象。前端已封装接口，模拟数据不是这些接口已部署的证明。
- 用户要求暂不改变既定举报范围。当前沿用接收者举报或拉黑；公开匿名榜单直接举报作为待讨论事项保留，未启用。
- B只展示PK授权结果，授权关系建立和真实评分计算仍属后端及好友业务。
- 真机、多账号、内容安全审核、订阅投递、AI结果和真实举报处置需团队环境验收。

## 个人文档素材

保留本次页面与服务分层、模拟隔离、幂等重试、版本冲突、权限隐藏、空状态、Canvas与图片保存、后台会话边界的实现记录。已有用户反馈包括WXML转义编译修正、接受邀请演示入口补充、拉黑位置调整和举报范围待讨论。完整过程记录见B-HANDOFF.md，个人详细设计和测试文档仍需按指定模板另行编写。

## 模板样式调整

按照同学提供的代码/代码/miniprogram模板，B页面改为浅灰底、白色分组、黑灰文字和微信绿操作。样式局部导入shared/b-theme.wxss，首页入口沿用同一风格。未复制模板的示例业务或改动接口。
