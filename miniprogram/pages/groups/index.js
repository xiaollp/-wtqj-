const groups = require('../../services/groups');
const { errorMessage } = require('../../shared/api');
Page({
  data:{mock:groups.isMock,items:[],loading:false,loaded:false,error:'',nextCursor:null},
  onShow(){this.load(true);},
  async onPullDownRefresh(){try{await this.load(true);}finally{wx.stopPullDownRefresh();}},
  onReachBottom(){if(this.data.nextCursor)this.load(false);},
  retry(){this.load(true);},
  more(){this.load(false);},
  async load(reset){
    if(this.data.loading)return;
    this.setData({loading:true,error:''});
    try{
      const result=await groups.listGroups({limit:20,...(!reset&&this.data.nextCursor?{cursor:this.data.nextCursor}:{})});
      this.setData({items:reset?result.items:this.data.items.concat(result.items),nextCursor:result.next_cursor,loaded:true});
    }catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
  }
});
