const tags = ['数码', '服饰', '零食', '游戏', '日用品'];
const tagKeywords = {
  数码: /手机|耳机|键盘|鼠标|电脑|相机|充电|平板|显示器|硬盘/,
  服饰: /衣服|裤|外套|裙|鞋|服装|袜|帽|衬衫/,
  零食: /零食|饼干|薯片|巧克力|饮料|奶茶|糖果/,
  游戏: /游戏|主机|手柄|皮肤|卡带|steam/i,
  日用品: /毛巾|纸巾|洗衣|洗发|牙刷|清洁|水杯|餐具/
};

function suggestTag(description) {
  return description.trim() ? tags.find(tag => tagKeywords[tag].test(description)) || '日用品' : '';
}

function parsePrice(input) {
  const match = String(input).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1] + (match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

module.exports = { tags, suggestTag, parsePrice };
