const fs=require('fs');
const path=require('path');
const C=require('./src/schedule-core');
const MINUTE=60000;
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function write(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');fs.renameSync(tmp,file);}
function dueEntries(data,from,to,sent={}){
  if(to<from)return [];
  const fromDate=C.addDays(C.iso(new Date(from)),-1);
  const toDate=C.iso(new Date(to+15*MINUTE));
  const result=[];
  for(const item of C.occurrences(data,fromDate,toDate,{includeDone:false})){
    if(!item.time||item.notify===false)continue;
    const at=new Date(item.date+'T'+item.time+':00').getTime();
    const offsets=item.kind==='task'?[5,0]:item.kind==='event'&&item.important?[15,0]:[0];
    const phases=offsets.map(lead=>({lead,phase:'start',dueAt:at-lead*MINUTE}));
    const bounds=C.sessionBounds(item);
    if(bounds?.end!==null&&bounds?.end!==undefined)phases.push({lead:0,phase:'end',dueAt:bounds.end});
    for(const {lead,phase,dueAt} of phases){
      const key=[item.kind,item.sourceId,item.date,item.time,phase==='end'?'end':lead].join(':');
      const entry=sent[key];
      const retry=entry?.status==='failed'&&entry.at<=to-30000&&dueAt>=to-2*MINUTE;
      if((dueAt<=from||dueAt>to)&&!retry||entry?.status==='shown'||entry?.status==='sending'||entry?.attempts>=2)continue;
      result.push({key,item,lead,phase,dueAt});
    }
  }
  return result.sort((a,b)=>a.dueAt-b.dueAt);
}
class NotificationEngine{
  constructor(store,{send,supported=()=>true,clock=()=>Date.now()}={}){
    this.store=store;this.send=send;this.supported=supported;this.clock=clock;this.lastTick=null;this.running=false;this.timer=null;
    this.settingsFile=path.join(store.dir,'notifications-settings.json');this.stateFile=path.join(store.dir,'notifications-state.json');
    this.settings={enabled:true,sound:true,...read(this.settingsFile,{})};
    this.state={sent:{},lastShownAt:null,lastError:null,...read(this.stateFile,{})};
  }
  status(){return {...this.settings,supported:this.supported(),running:!!this.timer,lastShownAt:this.state.lastShownAt,lastError:this.state.lastError};}
  configure(fields){
    for(const key of Object.keys(fields))if(!['enabled','sound'].includes(key)||typeof fields[key]!=='boolean')throw Error('Invalid notification setting.');
    this.settings={...this.settings,...fields};write(this.settingsFile,this.settings);this.lastTick=this.clock();return this.status();
  }
  start(){if(this.timer)return;this.tick();this.timer=setInterval(()=>this.tick(),10000);this.timer.unref?.();}
  stop(){clearInterval(this.timer);this.timer=null;}
  async test(){
    if(!this.supported())throw Error('Windows chưa hỗ trợ thông báo cho ứng dụng này.');
    try{
      await this.send({title:'desknote · Nhắc lịch đã sẵn sàng',body:'Đến giờ ăn, nghỉ, học hoặc ngủ, bạn sẽ nhận thông báo tại đây.',silent:!this.settings.sound,entries:[]});
      this.state.lastShownAt=this.clock();this.state.lastError=null;write(this.stateFile,this.state);return {shown:true,at:this.state.lastShownAt};
    }catch(error){this.state.lastError=error.message;write(this.stateFile,this.state);throw error;}
  }
  async tick(now=this.clock()){
    if(this.running)return;this.running=true;
    try{
      const from=Math.max(this.lastTick??now-MINUTE,now-2*MINUTE);this.lastTick=now;
      if(!this.settings.enabled)return;
      const entries=dueEntries(this.store.read(),from,now,this.state.sent);
      if(!entries.length)return;
      if(!this.supported()){this.state.lastError='Thông báo hệ thống chưa được hỗ trợ.';write(this.stateFile,this.state);return;}
      const groups=new Map();for(const entry of entries){const group=String(entry.dueAt);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(entry);}
      for(const group of groups.values()){
        for(const entry of group)this.state.sent[entry.key]={status:'sending',at:now,attempts:(this.state.sent[entry.key]?.attempts||0)+1};
        write(this.stateFile,this.state);
        const first=group[0];
        const title=(first.phase==='end'?'Kết thúc phiên · ':first.lead?'Sắp đến giờ · ':'Đến giờ · ')+(group.length===1?first.item.title:group.length+' lịch');
        const body=group.map(({item,lead,phase})=>`${phase==='end'?'Kết thúc · ':''}${lead?'Còn '+lead+' phút · ':''}${item.time}${item.endTime?'–'+item.endTime:''} · ${item.title}`).join('\n');
        try{
          await this.send({title,body,silent:!this.settings.sound,entries:group});
          for(const entry of group)this.state.sent[entry.key].status='shown';
          this.state.lastShownAt=now;this.state.lastError=null;
        }catch(error){for(const entry of group)this.state.sent[entry.key].status='failed';this.state.lastError=error.message;}
        for(const [key,value] of Object.entries(this.state.sent))if(value.at<now-8*86400000)delete this.state.sent[key];
        write(this.stateFile,this.state);
      }
    }catch(error){this.state.lastError=error.message;try{write(this.stateFile,this.state);}catch{}}
    finally{this.running=false;}
  }
}
module.exports={NotificationEngine,dueEntries};
