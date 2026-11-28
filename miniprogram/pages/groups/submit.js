const groups=require('../../services/groups');
const {loadPage}=require('../../shared/page-list');
const {runWrite}=require('../../shared/write');
const {errorMessage}=require('../../shared/api');
const {applicationView}=require('../../shared/display');
Page({
 data:{mock:groups.isMock,group:null,items:[],cursor:null,loading:false,error:'',saving:false,writeError:'',selected:null,checking:false,result:null,participants:[]},
 onLoad(o){this.groupId=o.group_id;this.initialId=o.application_id;this.init();},
 async init(){
  if(!this.groupId){this.setData({error:'缺少小组标识，请从小组详情重新进入'});return;}
  try{const r=await groups.getGroup(this.groupId);this.setData({group:r.group});await this.load(true);if(this.initialId)await this.chooseId(this.initialId);}
  catch(e){this.setData({error:errorMessage(e)});}
 },
 load(reset){return loadPage(this,p=>groups.listApplications({status:'PENDING',limit:20,...p}),a=>({...applicationView(a),eligible:a.mode==='NORMAL'&&a.approval_deadline>Date.now()}),reset);},
 retry(){this.init();},more(){this.load(false);},
 choose(e){this.chooseId(e.currentTarget.dataset.id);},
 async chooseId(id){
  if(this.data.saving||this.data.checking||this.data.result)return;
  this.setData({checking:true,writeError:'',selected:null});
  try{
   const r=await groups.getApplication(id),a=r.application;
   if(a.mode!=='NORMAL'||a.status!=='PENDING'||a.approval_deadline<=Date.now()||!a.permissions.can_withdraw){this.setData({writeError:'请选择本人未结束的普通申请'});return;}
   if(r.progress.participants.length){this.setData({writeError:'该申请已有审批参与人，无法转入小组'});return;}
   this.setData({selected:applicationView(a)});
  }catch(e){this.setData({writeError:errorMessage(e)});}finally{this.setData({checking:false});}
 },
 async submit(){
  if(!this.data.selected||this.data.saving||this.data.result)return;
  const a=this.data.selected;
  const confirmed=await new Promise(resolve=>wx.showModal({title:'确认提交至小组',content:'申请转为小组审批后不能更换名单。提交时除你以外的现有成员将获得审批资格，之后加入的人不会参与。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!confirmed||this.data.saving||this.data.result)return;
  return runWrite(this,'submitToGroup',groups.submitApplication,{group_id:this.groupId,application_id:a.application_id,expected_version:a.version},async result=>{
    this.setData({result});
    if(this.data.mock){const r=await groups.getApplication(result.application_id);this.setData({participants:r.progress.participants.map(p=>({...p,userId:p.user.user_id}))});}
   },async e=>{if(e.code==='STATE_CONFLICT'||e.code==='APPLICATION_CLOSED'){this.setData({selected:null});await this.load(true);}});
 },
 openResult(){if(!this.data.result)return;wx.navigateTo({url:'/pages/applications/detail?application_id='+encodeURIComponent(this.data.result.application_id)});}
});
