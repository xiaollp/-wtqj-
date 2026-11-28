const comments=require('../../services/comments');
const {errorMessage}=require('../../shared/api');
const {runWrite}=require('../../shared/write');
Page({
 data:{mock:comments.isMock,categories:comments.categories,categoryOptions:['全部',...comments.categories],categoryIndex:0,category:'',scope:'ALL',all:[],items:[],loading:false,error:'',saving:false,writeError:'',pick:false},
 onLoad(o){this.setData({pick:o.mode==='pick'});},
 onShow(){this.load();},
 async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
 filter(){this.setData({items:this.data.all.filter(t=>(!this.data.category||t.category===this.data.category)&&(this.data.scope!=='MINE'||t.is_custom))});},

 changeCategory(e){
  if(this.data.saving)return;
  const index=Number(e.detail.value);
  if(!Number.isInteger(index)||index<0||index>=this.data.categoryOptions.length)return;
  this.setData({categoryIndex:index,category:index===0?'':this.data.categoryOptions[index]});
  this.filter();
 },
 changeScope(e){this.setData({scope:e.currentTarget.dataset.scope});this.filter();},
 async load(){
  if(this.data.loading)return;
  this.setData({loading:true,error:''});
  try{const r=await comments.listTemplates({});this.setData({all:r.items});this.filter();}
  catch(e){this.setData({error:errorMessage(e),all:[],items:[]});}finally{this.setData({loading:false});}
 },
 edit(e){if(this.data.saving)return;wx.navigateTo({url:'/pages/comments/template-edit?template_id='+encodeURIComponent(e.currentTarget.dataset.id)});},
 async remove(e){
  if(this.data.saving)return;
  const id=e.currentTarget.dataset.id;
  const confirmed=await new Promise(resolve=>wx.showModal({title:'删除个人模板',content:'删除后将无法继续从模板列表选择它，已提交的审批意见不受影响。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!confirmed)return;
  return runWrite(this,'deleteTemplate',comments.deleteTemplate,{template_id:id},async()=>{await this.load();});
 },
 use(e){
  const item=this.data.items.find(t=>t.template_id===e.currentTarget.dataset.id);if(!item)return;
  if(this.data.pick){const channel=this.getOpenerEventChannel();if(channel&&channel.emit)channel.emit('templateSelected',{template_id:item.template_id,content:item.content});wx.navigateBack();}
  else wx.setClipboardData({data:item.content});
 }
});
