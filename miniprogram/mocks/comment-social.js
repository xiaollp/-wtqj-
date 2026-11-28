const KEY='b.comments.social.v1';
const publicItems=[
 {opinion_id:'public-1',content:'购物车先住三天，钱包再开会。'},
 {opinion_id:'public-2',content:'如果每周只用一次，先算算每次使用的成本。'},
 {opinion_id:'public-3',content:'喜欢值得记录，购买可以慢一点。'}
];
function fail(code,message){throw {code,message,retryable:false};}
function request(action,p){
 const state=wx.getStorageSync(KEY)||{favorites:[],reports:[],blocked:false,writes:{}};
 const visible=id=>id!=='received-demo'||!state.blocked;
 const find=id=>id==='received-demo'?{opinion_id:id,content:'先把现有的用好，再考虑添置新的。'}:publicItems.find(i=>i.opinion_id===id);
 const page=items=>{const offset=Number(p.cursor||0),limit=p.limit||20;return {items:items.slice(offset,offset+limit),next_cursor:offset+limit<items.length?String(offset+limit):null};};
 if(action==='comments.ranking')return page(publicItems.map(i=>({...i,favorite:state.favorites.some(f=>f.opinion_id===i.opinion_id),available:true})));
 if(action==='comments.favorites')return page(state.favorites.map(f=>({...f,content:visible(f.opinion_id)?find(f.opinion_id)?.content:null,available:visible(f.opinion_id)})));
 if(!p.idempotency_key)fail('VALIDATION_FAILED','缺少操作标识');
 const signature=JSON.stringify({action,p}),prior=state.writes[p.idempotency_key];
 if(prior){if(prior.signature!==signature)fail('IDEMPOTENCY_CONFLICT','参数已变化');return prior.result;}
 let result;
 if(action==='comments.favorite'||action==='comments.unfavorite'){
  if(!find(p.opinion_id))fail('ACCESS_DENIED','无权访问该意见');
  if(action==='comments.favorite'){
   if(!visible(p.opinion_id))fail('ACCESS_DENIED','内容不可用');
   if(!state.favorites.some(f=>f.opinion_id===p.opinion_id))state.favorites.unshift({opinion_id:p.opinion_id,created_at:Date.now()});
  }else state.favorites=state.favorites.filter(f=>f.opinion_id!==p.opinion_id);
  result={favorite:action==='comments.favorite'};
 }else if(action==='comments.report'){
  if(p.opinion_id!=='received-demo')fail('ACCESS_DENIED','仅接收者可举报');
  const reason=String(p.reason||'').trim();if(!reason||reason.length>500)fail('VALIDATION_FAILED','请输入举报理由');
  let report=state.reports.find(r=>r.opinion_id===p.opinion_id);
  if(!report){report={report_id:'demo-report-'+p.idempotency_key,opinion_id:p.opinion_id,reason,report_status:'PENDING'};state.reports.push(report);}
  result={report_id:report.report_id,report_status:report.report_status};
 }else if(action==='comments.block'||action==='comments.unblock'){
  if(p.target_user_id!=='received-author')fail('ACCESS_DENIED','该演示目标不可操作');
  state.blocked=action==='comments.block';result={blocked:state.blocked};
 }else fail('VALIDATION_FAILED','未知操作');
 state.writes[p.idempotency_key]={signature,result};wx.setStorageSync(KEY,state);return result;
}
module.exports={request};
