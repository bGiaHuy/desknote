const C=require('./src/schedule-core');
const minute=60000;
function time(date,hhmm){return new Date(date+'T'+hhmm+':00').getTime();}
function busyIntervals(data,date,excludeId=''){
  return C.occurrences(data,C.addDays(date,-1),C.addDays(date,1),{includeDone:false}).filter(x=>x.time&&!(x.kind==='task'&&x.sourceId===excludeId)&&!(x.kind==='event'&&x.notify===false&&/2NDFE/.test(x.notes||''))&&(x.kind!=='task'||x.occurrenceType==='work')).map(x=>{
    const start=time(x.date,x.time);let end=x.endTime?time(x.date,x.endTime):start+(x.durationMinutes||45)*minute;
    if(end<=start)end+=86400000;
    const rest=x.kind==='task'&&x.catId==='study'?5*minute:0;
    return [start-rest,end+rest];
  });
}
function freeSlot(data,{date='',hhmm='',duration=45,taskId='',deadlineDate='',deadlineTime=''},now=Date.now()){
  duration=Math.max(15,Math.min(180,Number(duration)||45));
  const cutoff=deadlineDate?time(deadlineDate,deadlineTime||'23:59'):Infinity;
  const today=C.iso(new Date(now));
  const valid=(day,at,busy)=>{
    const start=time(day,at),end=start+duration*minute;
    const windows=[[14,17],[19,21],...([0,6].includes(C.weekday(day))?[[9,12]]:[])];
    return start>=now&&end<=cutoff&&windows.some(([a,b])=>start>=time(day,String(a).padStart(2,'0')+':00')&&end<=time(day,String(b).padStart(2,'0')+':00'))&&!busy.some(([a,b])=>start<b&&end>a);
  };
  if(C.validDate(date)&&C.validTime(hhmm)&&date>=today&&C.daysUntil(date,today)<=7&&valid(date,hhmm,busyIntervals(data,date,taskId)))return {plannedDate:date,plannedTime:hhmm,durationMinutes:duration};
  for(let offset=0;offset<7;offset++){
    const day=C.addDays(today,offset),busy=busyIntervals(data,day,taskId);
    for(let m=9*60;m<21*60;m+=15){const at=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');if(valid(day,at,busy))return {plannedDate:day,plannedTime:at,durationMinutes:duration};}
  }
  return {plannedDate:'',plannedTime:'',durationMinutes:duration};
}
function reviewTime(data,date,hhmm){
  let start=time(date,hhmm);
  // Preserve sleep/wind-down; only defer the daytime slot around a fixed exam/class.
  if(hhmm<'18:00'){
    for(const event of C.occurrences(data,date).filter(x=>x.kind==='event'&&x.time&&!(x.notify===false&&/2NDFE/.test(x.notes||'')))){
      const a=time(date,event.time),b=event.endTime?time(date,event.endTime):a+45*minute;
      if(start>=a&&start<b)start=b+10*minute;
    }
  }
  return start;
}
module.exports={freeSlot,busyIntervals,reviewTime};
