const groups=require('../../services/groups');
const {runWrite,forgetWrite}=require('../../shared/write');
Page({
  data:{mock:groups.isMock,name:'',saving:false,writeError:'',requestId:'',createdId:''},
  onName(e){if(this.data.saving||this.data.createdId)return;this.setData({name:e.detail.value,writeError:''});forgetWrite(this,'createGroup');},
  submit(){
    if(this.data.createdId)return;
    const name=this.data.name.trim();
    if(!name||name.length>64){this.setData({writeError:'请输入1～64个字符的小组名称'});return;}
    return runWrite(this,'createGroup',groups.createGroup,{name},async result=>{
      this.setData({createdId:result.group.group_id});
      wx.redirectTo({url:'/pages/groups/detail?group_id='+encodeURIComponent(result.group.group_id)});
    });
  },
  openCreated(){wx.redirectTo({url:'/pages/groups/detail?group_id='+encodeURIComponent(this.data.createdId)});}
});
