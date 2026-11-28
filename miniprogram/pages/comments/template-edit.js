const comments=require('../../services/comments');
const {errorMessage}=require('../../shared/api');
const {runWrite,forgetWrite}=require('../../shared/write');
Page({
 data:{mock:comments.isMock,categories:comments.categories,category:'理性分析',content:'',loading:false,ready:true,error:'',saving:false,writeError:'',saved:false},
 onLoad(o){this.id=o.template_id;if(this.id){wx.setNavigationBarTitle({title:'编辑个人模板'});this.load();}},
 async load(){
  this.setData({loading:true,ready:false,error:''});
  try{const r=await comments.listTemplates({});const t=r.items.find(t=>t.template_id===this.id&&t.is_custom);if(!t){this.setData({error:'模板不存在，或不是你的个人模板'});return;}this.setData({category:t.category,content:t.content,ready:true});}
  catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
 },
 changeCategory(e){if(this.data.saving||this.data.saved)return;this.setData({category:e.currentTarget.dataset.category,writeError:''});forgetWrite(this,'saveTemplate');},
 input(e){if(this.data.saving||this.data.saved)return;this.setData({content:e.detail.value,writeError:''});forgetWrite(this,'saveTemplate');},
 submit(){
  if(!this.data.ready||this.data.saved||this.data.saving)return;
  const content=this.data.content.trim();
  if(!content||content.length>500){this.setData({writeError:'请输入1～500字的模板内容'});return;}
  return runWrite(this,'saveTemplate',comments.saveTemplate,{content,category:this.data.category,...(this.id?{template_id:this.id}:{})},async()=>{this.setData({saved:true});wx.navigateBack();});
 },
 back(){wx.navigateBack();}
});
