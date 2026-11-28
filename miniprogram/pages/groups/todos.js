const groups=require('../../services/groups');
const {loadPage}=require('../../shared/page-list');
Page({
 data:{mock:groups.isMock,items:[],cursor:null,loading:false,error:''},
 onLoad(o){this.groupId=o.group_id;},
 onShow(){if(!this.groupId){this.setData({error:'缺少小组标识'});return;}this.load(true);},
 async onPullDownRefresh(){try{if(this.groupId)await this.load(true);}finally{wx.stopPullDownRefresh();}},
 load(reset){return loadPage(this,p=>groups.listTodos({group_id:this.groupId,limit:20,...p}),i=>({...i,applicationId:i.application.application_id,amount:(i.application.price_cent/100).toFixed(2)}),reset);},
 more(){this.load(false);},retry(){this.load(true);},
 open(e){const id=e.currentTarget.dataset.id;
  if(this.data.mock){wx.showModal({title:'模拟待办',content:'这是一条演示申请。真实模式会打开申请详情，使用你的审批资格进行操作。',showCancel:false});return;}
  wx.navigateTo({url:'/pages/applications/detail?application_id='+encodeURIComponent(id)});
 }
});
