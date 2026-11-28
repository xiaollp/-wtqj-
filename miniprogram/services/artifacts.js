const {callApi}=require('../shared/api');
const {artifactsMock}=require('../config');
function invoke(action,params){return artifactsMock?require('../mocks/artifacts').request(action,params):callApi(action,params);}
module.exports={isMock:artifactsMock===true,
 get:id=>invoke('artifacts.get',{application_id:id}),
 generate:(params,context)=>invoke('artifacts.generateCard',{...params,...context}),
 complete:(params,context)=>invoke('artifacts.completeCard',{...params,...context})};
