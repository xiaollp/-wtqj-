const {callApi}=require('../shared/api');
const {commentsMock}=require('../config');
const mock=require('../mocks/comments');
const categories=['省钱毒舌','温柔劝诫','搞笑玩梗','理性分析'];
function invoke(action,params={},context){return commentsMock?mock.request(action,{...params,...context}):callApi(action,{...params,...context});}
module.exports={isMock:commentsMock===true,categories,
 listTemplates:p=>invoke('comments.templates',p),
 saveTemplate:(p,c)=>invoke('comments.saveTemplate',p,c),
 deleteTemplate:(p,c)=>invoke('comments.deleteTemplate',p,c),
 ranking:p=>invoke('comments.ranking',p),
 favorites:p=>invoke('comments.favorites',p),
 favorite:(p,c)=>invoke('comments.favorite',p,c),
 unfavorite:(p,c)=>invoke('comments.unfavorite',p,c),
 report:(p,c)=>invoke('comments.report',p,c),
 block:(p,c)=>invoke('comments.block',p,c),
 unblock:(p,c)=>invoke('comments.unblock',p,c)};
