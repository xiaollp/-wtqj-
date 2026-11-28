const $=id=>document.getElementById(id);
let current=null,session=null,busy=false,cursor=null,listTicket=0;
const attempts={};
function message(text){$('feedback').textContent=text;}
function clearError(){$('error').textContent='';}
function fail(e){$('error').textContent=(e.message||'操作失败')+(e.request_id?' · '+e.request_id:'');if(e.code==='AUTH_REQUIRED')showLogin();}
function showLogin(){session=null;current=null;$('detail').hidden=true;$('reports').replaceChildren();$('history').replaceChildren();$('reviewForm').reset();$('restrictForm').reset();$('login').hidden=false;$('workspace').hidden=true;$('logout').hidden=true;delete attempts.review;delete attempts.restrict;}
function permissions(){const p=session&&session.permissions||[];return {review:p.includes('REPORT_REVIEW'),restrict:p.includes('USER_RESTRICT')};}
async function task(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);clearError();try{await fn();}catch(e){fail(e);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
async function list(reset=true){const ticket=++listTicket;const r=await adminApi.request('admin.reports.list',{status:$('status').value,limit:20,...(!reset&&cursor?{cursor}:{})});if(ticket!==listTicket)return;if(reset)$('reports').replaceChildren();cursor=r.next_cursor;$('more').hidden=!cursor;for(const item of r.items){const row=document.createElement('div');row.className='report';const text=document.createElement('span');text.textContent=item.report_id+' · '+(item.status||item.report_status)+' · '+item.reason;const button=document.createElement('button');button.textContent='查看详情';button.onclick=()=>task(()=>detail(item.report_id));row.append(text,button);$('reports').append(row);}if(reset&&!r.items.length)$('reports').textContent='暂无符合条件的举报。';}
async function detail(id){current=await adminApi.request('admin.reports.get',{report_id:id});$('detail').hidden=false;$('reportId').textContent=id;$('reasonText').textContent=current.reason;const opinion=current.opinion||{};$('content').textContent=opinion.content||opinion.comment||'正文不可用';$('author').textContent=opinion.author_id||opinion.approver_id||'未返回发布者标识';$('history').replaceChildren();for(const entry of current.history||[]){const line=document.createElement('p');line.textContent=entry.decision+' · '+entry.reason;$('history').append(line);}const p=permissions();$('reviewForm').hidden=!p.review||!['PENDING'].includes(current.status||current.report_status);$('restrictForm').hidden=!p.restrict||!$('author').textContent||$('author').textContent==='未返回发布者标识';}
async function write(slot,action,params){const signature=JSON.stringify(params);if(!attempts[slot]||attempts[slot].signature!==signature)attempts[slot]={signature,key:adminApi.key()};try{const r=await adminApi.request(action,{...params,idempotency_key:attempts[slot].key});delete attempts[slot];return r;}catch(e){if(!e.retryable)delete attempts[slot];throw e;}}
$('mode').textContent=ADMIN_CONFIG.mock?'模拟管理后台 · 账号 demo，密码 demo123。操作仅保存本浏览器，与小程序模拟举报独立。':'真实模式 · 接口协议须由 D 确认，当前配置不代表已部署。';
$('loginForm').onsubmit=e=>{e.preventDefault();task(async()=>{const form=new FormData(e.target);try{session=await adminApi.request('admin.login',{account:form.get('account'),password:form.get('password')});}finally{e.target.elements.password.value='';}$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;message('登录成功');await list();});};
$('logout').onclick=()=>task(async()=>{await adminApi.request('admin.logout');showLogin();message('已退出');});
$('refresh').onclick=()=>task(async()=>{$('detail').hidden=true;current=null;await list();});
$('status').onchange=()=>{if(!busy)task(async()=>{$('detail').hidden=true;current=null;await list();});};
$('more').onclick=()=>task(()=>list(false));
$('reviewForm').onsubmit=e=>{e.preventDefault();if(!current)return;const f=new FormData(e.target),reason=String(f.get('reason')).trim();if(!reason){$('error').textContent='请输入复核说明';return;}if(!confirm('确认提交该复核结论？'))return;task(async()=>{const id=current.report_id;await write('review','comments.review',{report_id:id,decision:f.get('decision'),reason});message('复核已提交');await list();await detail(id);e.target.reset();});};
$('restrictForm').onsubmit=e=>{e.preventDefault();if(!current)return;const f=new FormData(e.target),reason=String(f.get('reason')).trim();if(!reason){$('error').textContent='请输入处置说明';return;}if(!confirm('确认修改该账号状态？'))return;task(async()=>{const r=await write('restrict','admin.users.restrict',{target_user_id:$('author').textContent,status:f.get('status'),reason});message('账号处置已保存：'+r.account_status);e.target.reset();});};

function setBlock(blocked){
 if(!current||!permissions().restrict)return;
 const reason=$('restrictForm').elements.reason.value.trim();
 if(!reason){$('error').textContent='请先填写处置说明';return;}
 if(!confirm(blocked?'确认禁用此账号？':'确认解除禁用并恢复此前状态？'))return;
 return task(async()=>{const r=await write('setBlock','admin.users.setBlock',{target_user_id:$('author').textContent,blocked,reason});message('账号状态：'+r.account_status);$('restrictForm').reset();});
}
$('ban').onclick=()=>setBlock(true);
$('unban').onclick=()=>setBlock(false);
showLogin();
