const {callApi}=require('../shared/api');
const {groupsMock}=require('../config');
const mock=require('../mocks/groups');
const friends=require('./friends');
const applications=require('./applications');
function invoke(action,params={},context){
 const input={...params,...context};
 return groupsMock?mock.request(action,input):callApi(action,input);
}
module.exports={
 isMock:groupsMock===true,
 listGroups:p=>invoke('groups.list',p),
 getGroup:id=>invoke('groups.get',{group_id:id}),
 createGroup:(p,c)=>invoke('groups.create',p,c),
 listFriends:p=>groupsMock?mock.request('friends.list',p||{}):friends.listFriends(p),
 inviteMember:(p,c)=>invoke('groups.invite',p,c),
 listInvitations:p=>invoke('groups.invitations',p),
 getInvitation:id=>invoke('groups.getInvitation',{invitation_id:id}),
 acceptInvitation:(p,c)=>invoke('groups.acceptInvitation',p,c),
 listTodos:p=>invoke('groups.todos',p),
 listApplications:p=>groupsMock?mock.request('applications.list',p||{}):applications.listApplications(p),
 getApplication:id=>groupsMock?mock.request('applications.get',{application_id:id}):applications.getApplication(id),
 submitApplication:(p,c)=>invoke('groups.submitApplication',p,c)
};
