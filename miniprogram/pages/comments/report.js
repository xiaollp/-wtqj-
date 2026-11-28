const comments=require('../../services/comments');
const {runWrite}=require('../../shared/write');
Page({
 data:{mock:comments.isMock,reason:'',saving:false,writeError:'',report:null,blockResult:null,targetAvailable:false,valid:false,reportOpen:false},
 onLoad(o){this.opinionId=o.opinion_id;this.targetId=o.target_user_id;this.setData({valid:!!this.opinionId,targetAvailable:!!this.targetId});},
 showReport(){this.setData({reportOpen:true});},
 input(e){if(this.data.saving||this.data.report)return;this.setData({reason:e.detail.value,writeError:''});},
 submit(){if(!this.data.valid||this.data.report)return;const reason=this.data.reason.trim();if(!reason||reason.length>500){this.setData({writeError:'请输入1～500字的举报理由'});return;}return runWrite(this,'report',comments.report,{opinion_id:this.opinionId,reason},async report=>{this.setData({report});});},
 async block(){
  if(!this.targetId||this.data.saving)return;
  const blocked=this.data.blockResult===true;
  const confirmed=await new Promise(resolve=>wx.showModal({title:blocked?'解除拉黑':'拉黑发布者',content:blocked?'解除后可再次看到对方符合展示条件的锐评。':'拉黑后对方的锐评将对你隐藏，审批决定保留。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!confirmed)return;
  return runWrite(this,'block',blocked?comments.unblock:comments.block,{target_user_id:this.targetId},async r=>{this.setData({blockResult:r.blocked});});
 }
});
