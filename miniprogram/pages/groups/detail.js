const groups=require('../../services/groups');
const {errorMessage}=require('../../shared/api');
Page({
 data:{mock:groups.isMock,group:null,members:[],loading:false,error:''},
 onLoad(options){this.groupId=options.group_id;},
 onShow(){this.load();},
 async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
 async load(){
  if(this.data.loading)return;
  if(!this.groupId){this.setData({error:'缺少小组标识，请从小组列表重新进入'});return;}
  this.setData({loading:true,error:''});
  try{const result=await groups.getGroup(this.groupId);this.setData({group:result.group,members:result.members.map(m=>({...m,initial:(m.nickname||'微信用户').slice(0,1)}))});}
  catch(e){this.setData({group:null,members:[],error:errorMessage(e)});}finally{this.setData({loading:false});}
 }
});
