const {callApi}=require('../shared/api');
const {statisticsMock}=require('../config');
function invoke(action,params){return statisticsMock?require('../mocks/statistics').request(action,params):callApi(action,params);}
module.exports={isMock:statisticsMock===true,
 dashboard:p=>invoke('statistics.dashboard',p),
 tags:p=>invoke('statistics.tags',p),
 pk:p=>invoke('statistics.pk',p)};
