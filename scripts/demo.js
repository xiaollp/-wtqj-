'use strict';
// 本地演示使用内存数据库和显式注入的测试审核，不连接微信云端。
const { pair } = require('../test/helpers');
(async () => {
  const e = await pair();
  const group = await e.w('owner', 'groups.create', { name: '演示监督组' });
  const invite = await e.w('owner', 'groups.invite', { group_id: group.group.group_id, invitee_id: e.friend });
  await e.w('friend', 'groups.acceptInvitation', { invitation_id: invite.invitation_id });
  const a = await e.create('owner');
  console.log('创建申请:', a);
  console.log('转入小组:', await e.w('owner', 'groups.submitApplication', { application_id: a.application_id, group_id: group.group.group_id, expected_version: a.version }));
  console.log('审批结果:', (await e.approve('friend', a)).application_status);
  console.log('最终详情:', JSON.stringify(await e.get('owner', a), null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
