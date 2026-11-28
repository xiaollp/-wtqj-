function visibleComments(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    if (typeof item === 'string') return item.trim();
    if (!item || item.comment_visible === false || item.available === false) return '';
    const value = item.content || item.comment;
    return typeof value === 'string' ? value.trim() : '';
  }).filter(Boolean);
}
function wrapText(ctx, text, size, width) {
  ctx.setFontSize(size);
  const lines=[];
  let line='';
  for (const char of Array.from(String(text || ''))) {
    if (char === '\n') { lines.push(line); line=''; continue; }
    if (line && ctx.measureText(line + char).width > width) { lines.push(line); line=char; }
    else line+=char;
  }
  if (line) lines.push(line);
  return lines;
}
function receiptLayout(ctx, card, resultLabel, priceLabel) {
  const rows=[];
  let y=240;
  let truncated=false;
  function add(text,size,color) {
    for (const line of wrapText(ctx,text,size,488)) {
      if (y > 2900) { truncated=true; return; }
      rows.push({text:line,size,color,y}); y+=size+14;
    }
    y+=12;
  }
  add(card.item_snapshot.description,30,'#282d28');
  add(priceLabel,42,'#282d28');
  const resultColor = { APPROVED: '#078544', REJECTED: '#c23b32', EXPIRED: '#70757a' }[card.result_snapshot] || '#70757a';
  add('审批结果  '+resultLabel,25,resultColor);
  add('--------------------------------',22,'#b5b8ae');
  add('好友把关留言',24,'#74786f');
  const comments=visibleComments(card.comments_snapshot);
  if (!comments.length) add('暂无可展示的好友留言',24,'#74786f');
  comments.forEach((text,index)=>add(String(index+1).padStart(2,'0')+' / '+text,25,'#343b32'));
  if (truncated) { rows.push({text:'锐评节选 · 完整内容请在小程序查看',size:21,color:'#74786f',y:y+12}); y+=58; }
  const height=Math.max(840,y+240);
  return {rows,height,truncated};
}
module.exports={visibleComments,wrapText,receiptLayout};
