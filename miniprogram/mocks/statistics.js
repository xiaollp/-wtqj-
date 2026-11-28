// 演示记录不来源于真实账号或本机申请，全部仅用于统计前端展示。
const tags=['数码','服饰','零食','游戏','日用品'];
function monthLabel(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');}
function records(){
 const now=new Date(),items=[];
 for(let m=0;m<6;m++)for(let i=0;i<10;i++)items.push({
  time:new Date(now.getFullYear(),now.getMonth()-m,2+i).getTime(),
  tag:tags[i%5],status:i%3===0?'REJECTED':i%3===1?'APPROVED':'PENDING',price_cent:5000+i*1000
 });
 return items;
}
function rate(count,total){return total?Math.round(count/total*1000)/10:null;}
async function request(action,p={}){
 const selected=records().filter(r=>(!p.from_to||(r.time>=p.from_to[0]&&r.time<=p.from_to[1]))&&(!p.tag||r.tag===p.tag));
 if(action==='statistics.tags')return {items:tags.map(tag=>{
  const rows=selected.filter(r=>r.tag===tag),rejected=rows.filter(r=>r.status==='REJECTED');
  return {tag,application_count:rows.length,rejection_count:rejected.length,rejected_amount_cent:rejected.reduce((n,r)=>n+r.price_cent,0)};
 })};
 if(action==='statistics.dashboard'){
  const rejected=selected.filter(r=>r.status==='REJECTED').length;
  const approved=selected.filter(r=>r.status==='APPROVED').length;
  const months=[...new Set(selected.map(r=>monthLabel(new Date(r.time))))].sort();
  return {total_count:selected.length,approval_rate:rate(approved,selected.length),rejection_rate:rate(rejected,selected.length),
   high_frequency_tags:tags.map(tag=>({tag,rejection_count:selected.filter(r=>r.tag===tag&&r.status==='REJECTED').length})).sort((a,b)=>b.rejection_count-a.rejection_count),
   monthly_trend:months.map(month=>{const rows=selected.filter(r=>monthLabel(new Date(r.time))===month),rejected=rows.filter(r=>r.status==='REJECTED');return {month,application_count:rows.length,rejection_count:rejected.length,rejected_amount_cent:rejected.reduce((n,r)=>n+r.price_cent,0),restraint_rate:rate(rejected.length,rows.length)};}),generated_at:Date.now()};
 }
 if(action==='statistics.pk'){
  const available=records().some(r=>monthLabel(new Date(r.time))===p.period);
  return {items:available?[
   {nickname:'小林（授权演示）',rejection_rate:60,saving_count:6,score:78},
   {nickname:'阿晴（授权演示）',rejection_rate:40,saving_count:4,score:62}]:[],metric_version:'DEMO',generated_at:Date.now()};
 }
 throw {code:'VALIDATION_FAILED',retryable:false};
}
module.exports={request};
