// 仅本机模板交互演示，不执行或声称通过真实内容审核。
const KEY='b.comments.templates.v1';
const categories=['省钱毒舌','温柔劝诫','搞笑玩梗','理性分析'];
function initial(){return {items:[
 {template_id:'system-save',category:categories[0],content:'先看看已有的东西，省下的钱也能带来快乐。',is_custom:false},
 {template_id:'system-gentle',category:categories[1],content:'喜欢可以先收藏，过几天还想要再决定。',is_custom:false},
 {template_id:'system-fun',category:categories[2],content:'钱包申请休假，建议批准。',is_custom:false},
 {template_id:'system-reason',category:categories[3],content:'比较使用频率、预算和替代品，再考虑是否购买。',is_custom:false}
 ],writes:{}};}
function fail(code,message){throw {code,message,retryable:false};}
async function request(action,params){
 if(!['comments.templates','comments.saveTemplate','comments.deleteTemplate'].includes(action))return require('./comment-social').request(action,params);
 const state=wx.getStorageSync(KEY)||initial();
 if(action==='comments.templates')return {items:state.items.filter(t=>!params.category||t.category===params.category)};
 const key=params.idempotency_key;
 if(!key)fail('VALIDATION_FAILED','缺少操作标识');
 const signature=JSON.stringify({action,params});
 if(state.writes[key]){if(state.writes[key].signature!==signature)fail('IDEMPOTENCY_CONFLICT','请求参数已变化');return state.writes[key].result;}
 const current=state.items.find(t=>t.template_id===params.template_id);
 let result;
 if(action==='comments.saveTemplate'){
  const content=String(params.content||'').trim();
  if(!content||content.length>500||!categories.includes(params.category))fail('VALIDATION_FAILED','检查分类及1～500字的模板内容');
  if(params.template_id&&(!current||!current.is_custom))fail('ACCESS_DENIED','仅可编辑自己的模板');
  if(!params.template_id&&state.items.filter(t=>t.is_custom).length>=50)fail('VALIDATION_FAILED','个人模板最多50条');
  const template={template_id:params.template_id||'custom-'+key,category:params.category,content,is_custom:true};
  if(current)state.items[state.items.indexOf(current)]=template;else state.items.unshift(template);
  result={template};
 }else if(action==='comments.deleteTemplate'){
  if(!current||!current.is_custom)fail('ACCESS_DENIED','仅可删除自己的模板');
  state.items=state.items.filter(t=>t.template_id!==params.template_id);result={deleted:true};
 }else fail('VALIDATION_FAILED','未知模板操作');
 state.writes[key]={signature,result};wx.setStorageSync(KEY,state);return result;
}
module.exports={request};
