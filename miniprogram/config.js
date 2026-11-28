module.exports = {
  cloudEnv: '',
  // B 小组页面本机演示；接团队云环境时改为 false。
  groupsMock: true,
  // 锐评模板独立演示开关，接入 D 的接口时关闭。
  commentsMock: true,
  // 看板演示数据独立于真实业务数据。
  statisticsMock: true,
  notificationsMock: true,
  artifactsMock: true,
  // 真实订阅模板由团队配置，保持空值时禁止伪造授权。
  notificationTemplateIds: { RESULT: '', GROUP_TODO: '' },
  largePurchaseCent: 100000
};
