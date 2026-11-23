# 本地验证记录

2026年11月23日，Windows，Node.js v24.22.3。

执行命令：`node --test test/business.test.js test/cloud-store.test.js`。最终29项测试通过，0项失败。

本轮覆盖身份与并发首次登录、好友双方确认、定向邀请和越权、幂等重放及异参冲突、审核失败/超时/跨截止边界、撤回与审批竞争、两种会审聚合、资格撤销、NORMAL转GROUP、成员快照、满员并发、到期及原决定保留、下架后幂等重放过滤、分页游标隔离、受限账号、事件失败原子回滚、图片绑定与授权预览，以及云存储适配方法与错误分类。

本地CloudStore测试使用SDK形态的替身；业务测试使用串行事务内存存储。它们验证代码规则及适配器调用，不代替真实云数据库的隔离、索引、配额、权限和性能测试。没有使用云环境凭据，没有部署函数、创建平台索引或发送消息。

已安装固定的wx-server-sdk@4.0.2，检查require导入、数据库runTransaction和command.all方法，并检查安装源码的doc.get/set与事务包装形式。APP_SECRET、MAINTENANCE_TOKEN及云环境配置仍由团队提供。
