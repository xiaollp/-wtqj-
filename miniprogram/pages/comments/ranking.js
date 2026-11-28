const comments=require('../../services/comments');
const {loadPage}=require('../../shared/page-list');
const {runWrite}=require('../../shared/write');
Page({
 data:{mock:comments.isMock,tab:'ranking',items:[],cursor:null,loading:false,error:'',saving:false,writeError:''},
 onShow(){this.load(true);},
 switchTab(e){if(this.data.saving)return;this.setData({tab:e.currentTarget.dataset.tab,writeError:''});this.load(true);},
 load(reset){const tab=this.data.tab;return loadPage(this,p=>comments[tab]({limit:20,...p}),i=>({...i,available:i.available!==false,favorite:tab==='favorites'?true:i.favorite}),reset);},
 retry(){this.load(true);},more(){this.load(false);},
 async onPullDownRefresh(){try{await this.load(true);}finally{wx.stopPullDownRefresh();}},
 toggle(e){const item=this.data.items.find(i=>i.opinion_id===e.currentTarget.dataset.id);if(!item)return;return runWrite(this,'favorite',item.favorite?comments.unfavorite:comments.favorite,{opinion_id:item.opinion_id},async()=>{await this.load(true);});},
 copy(e){const item=this.data.items.find(i=>i.opinion_id===e.currentTarget.dataset.id);if(item&&item.available&&item.content)wx.setClipboardData({data:item.content});}
});
