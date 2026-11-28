const statistics=require('../../services/statistics');
const {errorMessage}=require('../../shared/api');
const {timeLabel,priceLabel}=require('../../shared/display');
const {monthLabel,statisticsPeriod}=require('../../shared/statistics-period');
function percent(value){return value===null||value===undefined?'暂无数据':value.toFixed(1)+'%';}
Page({
 data:{mock:statistics.isMock,period:monthLabel(new Date()),today:statisticsPeriod(null,'SIX').today,rangeLabel:'',range:'SIX',tag:'',tagIndex:0,tagOptions:['全部','数码','服饰','零食','游戏','日用品'],tags:['数码','服饰','零食','游戏','日用品'],dashboard:null,tagItems:[],pkItems:[],dashboardError:'',tagsError:'',pkError:'',loading:false,metricVersion:''},
 onShow(){this.load();},
 async onPullDownRefresh(){try{await this.load();}finally{wx.stopPullDownRefresh();}},
 monthChanged(e){this.setData({period:e.detail.value});this.load();},
 rangeChanged(e){this.setData({range:e.currentTarget.dataset.range});this.load();},

 tagChanged(e){
  const index=Number(e.detail.value);
  if(!Number.isInteger(index)||index<0||index>=this.data.tagOptions.length)return;
  this.setData({tagIndex:index,tag:index===0?'':this.data.tagOptions[index]});
  this.load();
 },
 async load(){
  const ticket=(this.ticket||0)+1;this.ticket=ticket;
  const selected=statisticsPeriod(this.data.period,this.data.range);
  const from_to=selected.from_to;
  this.setData({period:selected.period,today:selected.today,rangeLabel:timeLabel(from_to[0])+' 至 '+timeLabel(from_to[1])});
  const tag=this.data.tag;
  this.setData({loading:true,dashboard:null,tagItems:[],pkItems:[],dashboardError:'',tagsError:'',pkError:'',metricVersion:''});
  const results=await Promise.allSettled([
   statistics.dashboard({from_to,...(tag?{tag}:{})}),
   statistics.tags({from_to}),
   statistics.pk({period:this.data.period})
  ]);
  if(ticket!==this.ticket)return;
  const [dashboard,tags,pk]=results;
  const updates={loading:false};
  if(dashboard.status==='fulfilled'){
   const d=dashboard.value;
   updates.dashboard={...d,approvalLabel:percent(d.approval_rate),rejectionLabel:percent(d.rejection_rate),updatedLabel:timeLabel(d.generated_at),
    monthly_trend:d.monthly_trend.map(m=>({...m,rateLabel:percent(m.restraint_rate),bar:Math.min(100,Math.max(0,m.restraint_rate||0)),amountLabel:priceLabel(m.rejected_amount_cent)})),
    high_frequency_tags:d.high_frequency_tags.filter(t=>t.rejection_count>0)};
  }else updates.dashboardError=errorMessage(dashboard.reason);
  if(tags.status==='fulfilled')updates.tagItems=tags.value.items.map(t=>({...t,amountLabel:priceLabel(t.rejected_amount_cent)}));else updates.tagsError=errorMessage(tags.reason);
  if(pk.status==='fulfilled'){updates.pkItems=pk.value.items.map((p,i)=>({...p,position:i+1,rateLabel:percent(p.rejection_rate),scoreLabel:p.score===null||p.score===undefined?'暂无数据':String(p.score)}));updates.metricVersion=pk.value.metric_version;}else updates.pkError=errorMessage(pk.reason);
  this.setData(updates);
 }
});
