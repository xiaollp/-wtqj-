const artifacts=require('../../services/artifacts');
const applications=require('../../services/applications');
const {errorMessage,createWriteContext,requireCloud,login}=require('../../shared/api');
const {statusLabels,priceLabel}=require('../../shared/display');
const {visibleComments,receiptLayout}=require('../../shared/receipt');
Page({
 data:{mock:artifacts.isMock,loading:false,saving:false,error:'',summary:null,aiStatus:'',resultLabel:'',price:'',preview:'',shareEnabled:false,printedComments:[],canvasHeight:840,receiptId:'',cardExcerpt:false,feeding:false,feedDone:false,feedHeight:0},
 onLoad(o){this.id=o.application_id;this.load();},

 onShow(){this.hidden=false;},
 onHide(){this.hidden=true;this.skipAnimation();},

 onUnload(){this.stopFeed();this.disposed=true;},
 stopFeed(){
  clearTimeout(this.feedStartTimer);clearTimeout(this.feedEndTimer);
  this.feedTicket=(this.feedTicket||0)+1;
 },
 startFeed(){
  if(!this.data.summary||this.data.saving)return;
  this.stopFeed();
  this.fullComments=visibleComments(this.data.summary.comments).map((text,index)=>({id:index+1,text,display:text}));
  if(this.hidden){this.skipAnimation();return;}
  const ticket=this.feedTicket;
  this.setData({printedComments:this.fullComments.map(c=>({...c})),feeding:true,feedDone:false,feedHeight:0},()=>{
   wx.nextTick(()=>{
    if(this.disposed||this.feedTicket!==ticket)return;
    this.createSelectorQuery().select('.receipt-paper').boundingClientRect(rect=>{
     if(this.disposed||this.feedTicket!==ticket)return;
     if(!rect||!rect.height){this.skipAnimation();return;}
     this.feedStartTimer=setTimeout(()=>{
      if(this.disposed||this.feedTicket!==ticket)return;
      this.setData({feedHeight:Math.ceil(rect.height)+18});
      this.feedEndTimer=setTimeout(()=>{
       if(this.disposed||this.feedTicket!==ticket)return;
       this.setData({feeding:false,feedDone:true});
      },2300);
     },80);
    }).exec();
   });
  });
 },
 skipAnimation(){
  this.stopFeed();
  if(this.disposed)return;
  this.setData({feeding:false,feedDone:true});

 },
 async load(){
  if(this.data.loading||this.data.saving)return;
  if(!this.id){this.setData({error:'缺少申请标识'});return;}
  this.stopFeed();this.localImage=null;this.fullComments=[];
  this.setData({loading:true,error:'',summary:null,preview:'',shareEnabled:false,printedComments:[]});
  try{
   const r=await artifacts.get(this.id);this.card=r.card;
   this.setData({summary:r.summary,aiStatus:r.ai_status,resultLabel:r.summary?statusLabels[r.summary.result]||r.summary.result:'',price:r.summary?priceLabel(r.summary.item_info.price_cent):'',shareEnabled:!!r.summary});
   this.setData({receiptId:String(this.id).slice(-12).toUpperCase()});this.startFeed();
   if(r.card&&r.card.card_status==='READY'&&r.card.card_file_id&&!artifacts.isMock){const files=await applications.getFileUrls([r.card.card_file_id]);const item=files.items.find(f=>f.file_id===r.card.card_file_id);if(item)this.setData({preview:item.url});}
  }catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({loading:false});}
 },
 async generate(){
  if(this.data.loading||this.data.saving)return;
  this.skipAnimation();
  this.setData({saving:true,error:'',preview:''});
  try{
   this.generateContext=this.generateContext||createWriteContext();
   await artifacts.generate({application_id:this.id},this.generateContext);
   // 绘图只使用后端返回的过滤后快照。
   const data=await artifacts.get(this.id);this.card=data.card;
   if(!this.card)throw new Error('Missing card snapshot');
   const filePath=await this.drawCard(this.card);
   this.localImage=filePath;
   if(artifacts.isMock){this.setData({preview:filePath});}
   else{
    if(!this.uploaded||this.uploaded.version!==this.card.snapshot_version){
     const user=await login();const context=createWriteContext();
     const upload=await requireCloud().uploadFile({cloudPath:'uploads/'+user.user_id+'/memorial-'+context.idempotency_key+'.png',filePath});
     this.uploaded={version:this.card.snapshot_version,fileId:upload.fileID,context:createWriteContext()};
    }
    await artifacts.complete({memorial_id:this.card.memorial_id,file_id:this.uploaded.fileId,snapshot_version:this.card.snapshot_version},this.uploaded.context);
    this.setData({preview:filePath});
   }
   this.generateContext=null;this.uploaded=null;
  }catch(e){if(e.retryable===false){this.generateContext=null;this.uploaded=null;}this.setData({error:errorMessage(e)});}finally{this.setData({saving:false});}
 },

 drawCard(card){
  return new Promise((resolve,reject)=>{
   let ctx=wx.createCanvasContext('memorial',this);
   const layout=receiptLayout(ctx,card,statusLabels[card.result_snapshot]||card.result_snapshot,priceLabel(card.item_snapshot.price_cent));
   this.setData({canvasHeight:layout.height,cardExcerpt:layout.truncated},()=>{
    ctx=wx.createCanvasContext('memorial',this);
    ctx.setFillStyle('#eceee8');ctx.fillRect(0,0,600,layout.height);
    ctx.setFillStyle('#fffef8');ctx.fillRect(24,22,552,layout.height-44);
    ctx.setFillStyle('#282d28');ctx.setFontSize(32);ctx.fillText('消 费 审 批 小 票',64,95);
    ctx.setFontSize(19);ctx.setFillStyle('#74786f');ctx.fillText(artifacts.isMock?'本机演示 · 好友把关纪念':'好友把关 · 消费决定纪念',64,136);
    ctx.fillText('NO. '+this.data.receiptId,64,178);
    ctx.setStrokeStyle('#d3d5ca');ctx.setLineDash([5,7],0);ctx.beginPath();ctx.moveTo(64,205);ctx.lineTo(536,205);ctx.stroke();
    for(const row of layout.rows){ctx.setFontSize(row.size);ctx.setFillStyle(row.color);ctx.fillText(row.text,56,row.y);}
    const bottom=layout.height-165;
    ctx.beginPath();ctx.moveTo(64,bottom-20);ctx.lineTo(536,bottom-20);ctx.stroke();
    ctx.setLineDash([],0);ctx.setFillStyle('#3c4439');
    // 条纹仅作装饰，不编码个人身份或访问凭证。
    let x=155;
    for(let i=0;i<48;i++){const width=i%3===0?5:2;ctx.fillRect(x,bottom+2,width,35);x+=width+3;}
    ctx.setFillStyle('#74786f');ctx.setFontSize(18);ctx.fillText('感谢好友认真把关',205,bottom+72);ctx.setFontSize(16);ctx.fillText('仅为审批纪念，不代表实际消费凭证',135,bottom+110);
    for(let x=24;x<576;x+=24){ctx.setFillStyle('#eceee8');ctx.beginPath();ctx.arc(x+12,layout.height-22,8,0,Math.PI*2);ctx.fill();}
    ctx.draw(false,()=>wx.canvasToTempFilePath({canvasId:'memorial',width:600,height:layout.height,destWidth:600,destHeight:layout.height,fileType:'png',success:r=>resolve(r.tempFilePath),fail:reject},this));
   });
  });
 },
 async saveImage(){
  if(!this.data.preview)return;
  try{
    let filePath=this.localImage;
    if(!filePath){
      filePath=await new Promise((resolve,reject)=>wx.downloadFile({
        url:this.data.preview,
        success:r=>r.statusCode===200?resolve(r.tempFilePath):reject(new Error('下载失败')),
        fail:reject
      }));
    }
    await new Promise((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath,success:resolve,fail:reject}));
    wx.showToast({title:'已保存'});
  }catch(_){this.setData({error:'保存失败，请确认相册权限，或刷新后重新生成。'});}
 },
 previewImage(){if(this.data.preview)wx.previewImage({urls:[this.data.preview]});},
 onShareAppMessage(){return artifacts.isMock?{title:'消费审批',path:'/pages/index/index'}:{title:'查看消费审批纪念',path:'/pages/artifacts/detail?application_id='+encodeURIComponent(this.id)};}
});
