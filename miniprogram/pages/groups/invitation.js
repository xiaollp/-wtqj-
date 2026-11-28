const groups=require('../../services/groups');
const {errorMessage}=require('../../shared/api');
const {runWrite}=require('../../shared/write');
Page({
 data:{mock:groups.isMock,invitation:null,groupName:'',canAccept:false,loading:false,error:'',saving:false,writeError:'',expiresText:''},
 onLoad(o){this.id=o.invitation_id;this.load();},
 async load(){
  if(this.data.loading)return;
  if(!this.id){this.setData({error:'邀请链接缺少标识'});return;}
  this.setData({loading:true,error:'',invitation:null,canAccept:false});
  try{const r=await groups.getInvitation(this.id);this.setData({invitation:r.invitation,groupName:r.group_name,canAccept:r.can_accept,expiresText:new Date(r.invitation.expires_at).toLocaleString()});}
  catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
 },
 accept(){if(!this.data.canAccept)return;return runWrite(this,'accept',groups.acceptInvitation,{invitation_id:this.id},async()=>{await this.load();});},
 openGroup(){wx.navigateTo({url:'/pages/groups/detail?group_id='+encodeURIComponent(this.data.invitation.group_id)});}
});
