const artifacts=require('../../services/artifacts');
const applications=require('../../services/applications');
const {loadPage}=require('../../shared/page-list');
const {applicationView}=require('../../shared/display');
Page({
 data:{mock:artifacts.isMock,items:[],cursor:null,loading:false,error:''},
 onLoad(){this.load(true);},
 load(reset){return loadPage(this,params=>artifacts.isMock?Promise.resolve({items:require('../../mocks/artifacts').samples.map(a=>({...a,status:a.result,created_at:Date.now()})),next_cursor:null}):applications.listApplications({limit:20,...params}),a=>({...applicationView(a),eligible:['APPROVED','REJECTED','EXPIRED'].includes(a.status)}),reset);},
 more(){this.load(false);},retry(){this.load(true);}
});
