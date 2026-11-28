const KEY='b.artifacts.v1';
const samples=[{application_id:'demo-art-approved',description:'学习用键盘',price_cent:19900,result:'APPROVED'},
 {application_id:'demo-art-rejected',description:'重复购买的耳机',price_cent:39900,result:'REJECTED'},
 {application_id:'demo-art-expired',description:'限时促销音箱',price_cent:12900,result:'EXPIRED'}];
async function request(action,p){
 const sample=samples.find(a=>a.application_id===p.application_id);
 const state=wx.getStorageSync(KEY)||{cards:{},writes:{}};
 if(action==='artifacts.get'){
  if(!sample)throw {code:'ACCESS_DENIED',retryable:false};
  return {card:state.cards[sample.application_id]||null,summary:{summary_id:'summary-'+sample.application_id,application_id:sample.application_id,item_info:{description:sample.description,price_cent:sample.price_cent},comments:['钱包申请休假，建议批准。','先算算使用频率，再决定要不要给它留个位置。','喜欢可以先记下，明天还想要再考虑。'],result:sample.result,purchase_advice:sample.result==='EXPIRED'?null:'演示建议：结合使用频率和预算决定是否购买。',ai_status:sample.result==='EXPIRED'?'FAILED':'READY',result_version:1},ai_status:sample.result==='EXPIRED'?'FAILED':'READY'};
 }
 if(!p.idempotency_key)throw {code:'VALIDATION_FAILED',retryable:false};
 const signature=JSON.stringify({action,p}),prior=state.writes[p.idempotency_key];
 if(prior){if(prior.signature!==signature)throw {code:'IDEMPOTENCY_CONFLICT',retryable:false};return prior.result;}
 let result;
 if(action==='artifacts.generateCard'){
  if(!sample)throw {code:'ACCESS_DENIED',retryable:false};
  const card={memorial_id:'memorial-'+sample.application_id,application_id:sample.application_id,item_snapshot:{description:sample.description,price_cent:sample.price_cent},result_snapshot:sample.result,comments_snapshot:['钱包申请休假，建议批准。','先算算使用频率，再决定要不要给它留个位置。','喜欢可以先记下，明天还想要再考虑。'],card_status:'PENDING',snapshot_version:1,card_file_id:null};
  state.cards[sample.application_id]=card;result={...card};
 }else if(action==='artifacts.completeCard'){
  const card=Object.values(state.cards).find(c=>c.memorial_id===p.memorial_id);
  if(!card||card.snapshot_version!==p.snapshot_version)throw {code:'STATE_CONFLICT',retryable:false};
  card.card_status='READY';card.card_file_id=p.file_id;result={...card};
 }else throw {code:'VALIDATION_FAILED',retryable:false};
 state.writes[p.idempotency_key]={signature,result};wx.setStorageSync(KEY,state);return result;
}
module.exports={request,samples};
