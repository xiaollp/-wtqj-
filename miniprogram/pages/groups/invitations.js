const groups=require('../../services/groups');
const {loadPage}=require('../../shared/page-list');
Page({
 data:{mock:groups.isMock,direction:'RECEIVED',items:[],cursor:null,loading:false,error:''},
 onShow(){this.load(true);},
 demoInvite(){
  if(!this.data.mock)return;
  const id=require('../../mocks/groups').addDemoInvitation();
  wx.navigateTo({url:'/pages/groups/invitation?invitation_id='+encodeURIComponent(id)});
 },
 switchTab(e){this.setData({direction:e.currentTarget.dataset.direction});this.load(true);},
 load(reset){const direction=this.data.direction;return loadPage(this,p=>groups.listInvitations({direction,limit:20,...p}),i=>({...i,route:'/pages/groups/invitation?invitation_id='+encodeURIComponent(i.invitation_id),statusLabel:{PENDING:'等待接受',ACCEPTED:'已加入',EXPIRED:'已过期'}[i.status]||i.status}),reset);},
 more(){this.load(false);},retry(){this.load(true);}
});
