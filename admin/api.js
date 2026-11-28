(function(){
 const config=window.ADMIN_CONFIG;
 let session=null;
 const KEY='b.admin.demo.v1';
 function read(){return JSON.parse(localStorage.getItem(KEY)||JSON.stringify({reports:[{report_id:'demo-report-1',status:'PENDING',reason:'演示举报，请检查是否存在不当表达。',opinion:{opinion_id:'demo-opinion-1',content:'这是一条供管理员复核的模拟锐评。',author_id:'demo-author-1'},history:[]}],actions:[],writes:{},users:{}}));}
 function error(code,message){return Object.assign(new Error(message),{code,retryable:false});}
 function write(state,params,result){state.writes[params.idempotency_key]={signature:JSON.stringify(params),result};localStorage.setItem(KEY,JSON.stringify(state));return result;}
 async function mock(action,p){
  if(action==='admin.login'){
   if(p.account!=='demo'||p.password!=='demo123')throw error('AUTH_REQUIRED','演示账号为 demo，密码为 demo123');
   session={admin_id:'demo-admin',permissions:['REPORT_REVIEW','USER_RESTRICT'],expires_at:Date.now()+3600000};return session;
  }
  if(!session||session.expires_at<Date.now())throw error('AUTH_REQUIRED','请重新登录');
  if(action==='admin.logout'){session=null;return {logged_out:true};}
  const state=read();
  if(action==='admin.reports.list')return {items:state.reports.filter(r=>!p.status||r.status===p.status).map(r=>({report_id:r.report_id,status:r.status,reason:r.reason})),next_cursor:null};
  if(action==='admin.reports.get'){
   const report=state.reports.find(r=>r.report_id===p.report_id);if(!report)throw error('ACCESS_DENIED','举报不存在');return report;
  }
  if(!p.idempotency_key)throw error('VALIDATION_FAILED','缺少操作标识');
  const prior=state.writes[p.idempotency_key];
  if(prior){if(prior.signature!==JSON.stringify(p))throw error('IDEMPOTENCY_CONFLICT','参数变化，请重新操作');return prior.result;}
  if(!p.reason||!p.reason.trim()||p.reason.length>500)throw error('VALIDATION_FAILED','请输入1～500字的说明');
  if(action==='comments.review'){
   const report=state.reports.find(r=>r.report_id===p.report_id);
   if(!report||report.status!=='PENDING')throw error('STATE_CONFLICT','举报已处理，请刷新');
   if(!['KEEP','REMOVE'].includes(p.decision))throw error('VALIDATION_FAILED','结论不合法');
   report.status=p.decision==='KEEP'?'KEPT':'REMOVED';report.reviewed_at=Date.now();report.history.push({decision:p.decision,reason:p.reason,admin_id:session.admin_id,created_at:report.reviewed_at});
   return write(state,p,{report_id:report.report_id,report_status:report.status,reviewed_at:report.reviewed_at,action_id:'demo-review-'+p.idempotency_key});
  }
  if(action==='admin.users.setBlock'){
   if(p.target_user_id!=='demo-author-1'||typeof p.blocked!=='boolean')throw error('VALIDATION_FAILED','目标或参数不合法');
   state.users=state.users||{};const user=state.users[p.target_user_id]||{status:'NORMAL',beforeBlock:'NORMAL'};
   if(p.blocked){if(user.status!=='BANNED')user.beforeBlock=user.status;user.status='BANNED';}else if(user.status==='BANNED'){user.status=user.beforeBlock;}
   state.users[p.target_user_id]=user;const result={action_id:'demo-block-'+p.idempotency_key,target_user_id:p.target_user_id,account_status:user.status};state.actions.push({...result,reason:p.reason});return write(state,p,result);
  }
  if(action==='admin.users.restrict'){
   if(!['NORMAL','LIMITED','BANNED'].includes(p.status)||p.target_user_id!=='demo-author-1')throw error('VALIDATION_FAILED','目标或状态不合法');
   state.users=state.users||{};state.users[p.target_user_id]={status:p.status,beforeBlock:p.status==='BANNED'?(state.users[p.target_user_id]?.status||'NORMAL'):p.status};
   const result={action_id:'demo-action-'+p.idempotency_key,target_user_id:p.target_user_id,account_status:p.status};state.actions.push({...result,reason:p.reason});return write(state,p,result);
  }
  throw error('VALIDATION_FAILED','未知操作');
 }
 async function request(action,params={}){
  if(config.mock)return mock(action,params);
  if(!config.contractConfirmed)throw error('CONFIG_REQUIRED','请先与 D 确认管理员接口、会话及 CSRF 协议');
  const response=await fetch(config.endpoint,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...(config.csrfToken?{'X-CSRF-Token':config.csrfToken}:{})},body:JSON.stringify({action,params})});
  const result=await response.json();
  if(!response.ok||result.code!=='OK')throw Object.assign(error(result.code||'NETWORK_ERROR',result.message||'请求失败'),{request_id:result.request_id,retryable:result.retryable,data:result.data});
  return result.data;
 }
 window.adminApi={request,key:()=>crypto.randomUUID()};
})();
