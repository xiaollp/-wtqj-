// 仅供小组前端演示，数据保存在本机，真实模式不会读取。
const KEY = 'b.groups.demo.v1';
function initial() {
  return {groups:[{group_id:'demo-study',name:'学习装备把关组',creator_id:'demo-me',member_count:3,created_at:Date.now()}],
    members:{'demo-study':[{user_id:'demo-me',nickname:'我（演示）'},{user_id:'demo-friend-1',nickname:'小林'},{user_id:'demo-friend-2',nickname:'阿晴'}]},writes:{}};
}
function fail(message) { throw {code:'VALIDATION_FAILED',message,retryable:false}; }
async function request(action, params) {
  const state = wx.getStorageSync(KEY) || initial();

  if (!state.invitations) {
    state.invitations=[{invitation_id:'demo-incoming',kind:'GROUP',status:'PENDING',
      inviter:{user_id:'demo-friend-1',nickname:'小林',avatar_file_id:null},
      invitee:{user_id:'demo-me',nickname:'我（演示）',avatar_file_id:null},
      group_id:'demo-reading',group_name:'读书消费互助组',application_id:null,expires_at:Date.now()+86400000}];
    wx.setStorageSync(KEY,state);
  }

  if(!state.applications){
    state.applications=[{application_id:'demo-my-application',owner_id:'demo-me',description:'课程资料收纳架',price_cent:5900,tag:'日用品',status:'PENDING',mode:'NORMAL',version:1,created_at:Date.now(),approval_deadline:Date.now()+86400000,participant_ids:[],invitation_ids:[]}];
    wx.setStorageSync(KEY,state);
  }
  const page=items=>{const offset=Number(params.cursor||0),limit=params.limit||20;return {items:items.slice(offset,offset+limit),next_cursor:offset+limit<items.length?String(offset+limit):null};};
  const member=id=>{
    const group=state.groups.find(g=>g.group_id===id);
    if(!group||!state.members[id].some(m=>m.user_id==='demo-me'))throw {code:'ACCESS_DENIED',retryable:false};
    return group;
  };
  const write=handler=>{
    const key=params.idempotency_key;
    if(!key)fail('缺少操作标识');
    const signature=JSON.stringify({action,params});
    if(state.writes[key]){
      if(state.writes[key].signature!==signature)throw {code:'IDEMPOTENCY_CONFLICT',retryable:false};
      return state.writes[key].result;
    }
    const result=handler();state.writes[key]={signature,result};wx.setStorageSync(KEY,state);return result;
  };

  if(action==='applications.list')return page(state.applications.filter(a=>a.owner_id==='demo-me'&&(!params.status||a.status===params.status)));
  if(action==='applications.get'){
    const a=state.applications.find(a=>a.application_id===params.application_id&&a.owner_id==='demo-me');
    if(!a)throw {code:'ACCESS_DENIED',retryable:false};
    return {application:{...a,owner:{user_id:'demo-me',nickname:'我（演示）'},permissions:{can_withdraw:a.status==='PENDING'}},progress:{participants:(a.participant_ids||[]).map(id=>({user:{user_id:id,nickname:(state.members[a.group_id]||[]).find(m=>m.user_id===id)?.nickname||'演示成员'},decision:'PENDING'})),application_status:a.status,version:a.version}};
  }
  if(action==='groups.submitApplication')return write(()=>{
    const group=member(params.group_id);
    const a=state.applications.find(a=>a.application_id===params.application_id&&a.owner_id==='demo-me');
    if(!a)throw {code:'ACCESS_DENIED',retryable:false};
    if(a.status!=='PENDING'||a.approval_deadline<=Date.now())throw {code:'APPLICATION_CLOSED',retryable:false};
    if(a.version!==params.expected_version||a.mode!=='NORMAL'||a.group_id||a.participant_ids.length||a.invitation_ids.length)throw {code:'STATE_CONFLICT',retryable:false};
    const participants=state.members[group.group_id].filter(m=>m.user_id!=='demo-me');
    if(!participants.length||participants.length>20)fail('至少需要一位其他成员才能提交');
    a.mode='GROUP';a.group_id=group.group_id;a.participant_ids=participants.map(m=>m.user_id);a.version+=1;
    return {link_id:'demo-link-'+a.application_id,application_id:a.application_id,group_id:group.group_id,todo_created:true,participant_count:participants.length,version:a.version};
  });
  if(action==='friends.list')return page([
    {user_id:'demo-friend-1',nickname:'小林',avatar_file_id:null},
    {user_id:'demo-friend-2',nickname:'阿晴',avatar_file_id:null},
    {user_id:'demo-friend-3',nickname:'小周',avatar_file_id:null}]);
  if(action==='groups.invite')return write(()=>{
    const group=member(params.group_id);
    const names={'demo-friend-1':'小林','demo-friend-2':'阿晴','demo-friend-3':'小周'};
    if(!names[params.invitee_id])fail('请选择已确认好友');
    if(state.members[group.group_id].some(m=>m.user_id===params.invitee_id))return {invitation_id:null,status:'ACCEPTED',expires_at:null,joined:true,share_path:null};
    if(group.member_count>=21)fail('小组人数已满');
    let invitation=state.invitations.find(i=>i.group_id===group.group_id&&i.invitee.user_id===params.invitee_id&&i.status==='PENDING'&&i.expires_at>Date.now());
    if(!invitation){
      invitation={invitation_id:'demo-invite-'+params.idempotency_key,kind:'GROUP',status:'PENDING',inviter:{user_id:'demo-me',nickname:'我（演示）',avatar_file_id:null},invitee:{user_id:params.invitee_id,nickname:names[params.invitee_id],avatar_file_id:null},group_id:group.group_id,group_name:group.name,application_id:null,expires_at:Date.now()+86400000};
      state.invitations.unshift(invitation);
    }
    return {invitation_id:invitation.invitation_id,status:'PENDING',expires_at:invitation.expires_at,joined:false,share_path:'/pages/groups/invitation?invitation_id='+invitation.invitation_id};
  });
  if(action==='groups.invitations')return page(state.invitations.filter(i=>params.direction==='SENT'?i.inviter.user_id==='demo-me':i.invitee.user_id==='demo-me').map(i=>({...i,status:i.status==='PENDING'&&i.expires_at<=Date.now()?'EXPIRED':i.status})));
  if(action==='groups.getInvitation'){
    const invitation=state.invitations.find(i=>i.invitation_id===params.invitation_id);
    if(!invitation||![invitation.inviter.user_id,invitation.invitee.user_id].includes('demo-me'))throw {code:'INVITATION_INVALID',retryable:false};
    return {invitation:{...invitation,status:invitation.status==='PENDING'&&invitation.expires_at<=Date.now()?'EXPIRED':invitation.status},group_name:invitation.group_name,can_accept:invitation.invitee.user_id==='demo-me'&&invitation.status==='PENDING'&&invitation.expires_at>Date.now()};
  }
  if(action==='groups.acceptInvitation')return write(()=>{
    const invitation=state.invitations.find(i=>i.invitation_id===params.invitation_id);
    if(!invitation||invitation.invitee.user_id!=='demo-me'||(invitation.status!=='ACCEPTED'&&invitation.expires_at<=Date.now()))throw {code:'INVITATION_INVALID',retryable:false};
    let group=state.groups.find(g=>g.group_id===invitation.group_id);
    if(!group){group={group_id:invitation.group_id,name:invitation.group_name,creator_id:invitation.inviter.user_id,member_count:1,created_at:Date.now()};state.groups.unshift(group);state.members[group.group_id]=[invitation.inviter];}
    if(!state.members[group.group_id].some(m=>m.user_id==='demo-me')){
      if(group.member_count>=21)fail('小组人数已满');
      state.members[group.group_id].push(invitation.invitee);group.member_count=state.members[group.group_id].length;
    }
    invitation.status='ACCEPTED';return {invitation_id:invitation.invitation_id,status:'ACCEPTED',expires_at:invitation.expires_at,joined:true,group_id:group.group_id};
  });
  if(action==='groups.todos'){
    member(params.group_id);
    return page(params.group_id==='demo-study'?[{application:{application_id:'demo-application',description:'宿舍共用阅读灯',price_cent:12900,tag:'日用品',status:'PENDING',mode:'GROUP',version:1,created_at:Date.now(),approval_deadline:Date.now()+86400000},my_decision:'PENDING',can_approve:true}]:[]);
  }
  if (action === 'groups.list') {
    const offset = Number(params.cursor || 0), limit = params.limit || 20;
    return {items:state.groups.slice(offset,offset+limit),next_cursor:offset+limit<state.groups.length?String(offset+limit):null};
  }
  if (action === 'groups.get') {
    const group = state.groups.find(item=>item.group_id===params.group_id);
    if (!group) throw {code:'ACCESS_DENIED',message:'小组不存在或你没有权限',retryable:false};
    return {group,members:state.members[group.group_id].map(item=>({...item,avatar_file_id:null}))};
  }
  if (action === 'groups.create') {
    const name = String(params.name || '').trim(), key = params.idempotency_key;
    if (!key || !name || name.length>64) fail('请输入1～64个字符的小组名称');
    if (state.writes[key]) {
      if (state.writes[key].name!==name) throw {code:'IDEMPOTENCY_CONFLICT',retryable:false};
      return state.writes[key].result;
    }
    if (state.groups.some(item=>item.name.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase())) fail('小组名称已被使用，请换一个');
    const group = {group_id:'demo-'+key,name,creator_id:'demo-me',member_count:1,created_at:Date.now()};
    const members = [{user_id:'demo-me',nickname:'我（演示）',avatar_file_id:null}];
    const result = {group,members};
    state.groups.unshift(group); state.members[group.group_id]=members; state.writes[key]={name,result};
    wx.setStorageSync(KEY,state);
    return result;
  }
  throw {code:'VALIDATION_FAILED',message:'演示暂不支持该操作',retryable:false};
}
function addDemoInvitation() {
  const state = wx.getStorageSync(KEY) || initial();
  state.invitations = state.invitations || [];
  const pending = state.invitations.find(i => i.invitee.user_id === 'demo-me' && i.status === 'PENDING' && i.expires_at > Date.now());
  if (pending) return pending.invitation_id;
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const invitation = {
    invitation_id: 'demo-incoming-' + suffix, kind: 'GROUP', status: 'PENDING',
    inviter: {user_id:'demo-friend-1',nickname:'小林',avatar_file_id:null},
    invitee: {user_id:'demo-me',nickname:'我（演示）',avatar_file_id:null},
    group_id:'demo-reading-' + suffix, group_name:'读书互助演示组',
    application_id:null, expires_at:Date.now()+86400000
  };
  state.invitations.unshift(invitation);
  wx.setStorageSync(KEY,state);
  return invitation.invitation_id;
}
module.exports = {request, addDemoInvitation};
