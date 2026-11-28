const groups=require('../../services/groups');
const {loadPage}=require('../../shared/page-list');
const {runWrite}=require('../../shared/write');
Page({
 data:{mock:groups.isMock,items:[],cursor:null,loading:false,error:'',saving:false,writeError:'',result:null,selected:''},
 onLoad(o){this.groupId=o.group_id;if(!this.groupId){this.setData({error:'缺少小组标识'});return;}this.load(true);},
 load(reset){return loadPage(this,p=>groups.listFriends({limit:20,...p}),x=>x,reset);},
 more(){this.load(false);},retry(){this.load(true);},
 select(e){if(this.data.saving)return;this.setData({selected:e.currentTarget.dataset.id,result:null,writeError:''});},
 submit(){
  if(!this.groupId||!this.data.selected||this.data.result)return;
  return runWrite(this,'invite',groups.inviteMember,{group_id:this.groupId,invitee_id:this.data.selected},async result=>{this.setData({result});});
 },
 onShareAppMessage(){return this.data.result&&!this.data.mock?{title:'邀请你加入消费监督小组',path:this.data.result.share_path}:{title:'消费审批',path:'/pages/index/index'};}
});
