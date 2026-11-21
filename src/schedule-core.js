(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeskSchedule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const today=()=>iso(new Date());
  const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1900-01-01'&&s<='9999-12-31'&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
  const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const ordinal=s=>Date.parse(s+'T00:00:00Z')/DAY;
  const addDays=(s,n)=>new Date((ordinal(s)+n)*DAY).toISOString().slice(0,10);
  const daysUntil=(date,from=today())=>Math.round(ordinal(date)-ordinal(from));
  const weekday=s=>new Date(s+'T12:00:00Z').getUTCDay();
  function normalize(data){
    data.routines??=[];data.events??=[];data.routineChecks??=[];data.routineOverrides??=[];
    return data;
  }
  function nextEvent(event,from=today()){
    if(event.repeat!=='yearly')return event.date;
    const start=Math.max(Number(from.slice(0,4)),Number(event.date.slice(0,4)));
    for(let year=start;year<=Math.min(9999,start+8);year++){
      const date=year+event.date.slice(4);
      if(validDate(date)&&date>=from)return date;
    }
    return null;
  }
  function routineOn(routine,date,override=null){
    return routine.enabled!==false&&!override?.skip&&routine.days.includes(weekday(date))&&(!routine.startDate||date>=routine.startDate)&&(!routine.endDate||date<=routine.endDate)&&(!!override||!(routine.excludeDates||[]).includes(date));
  }
  function occurrences(data,from,to=from,{includeDone=true}={}){
    if(!validDate(from)||!validDate(to)||to<from||daysUntil(to,from)>370)throw Error('The schedule range cannot exceed 371 days.');
    const result=[];
    for(const task of data.tasks||[]){
      if(task.date&&task.date>=from&&task.date<=to&&(includeDone||!task.done))result.push({...task,kind:'task',sourceId:task.id,important:task.important===true});
      if(task.plannedDate&&task.plannedDate>=from&&task.plannedDate<=to&&(includeDone||!task.done)&&!(task.date===task.plannedDate&&task.time===task.plannedTime)){
        const start=task.plannedTime?new Date(task.plannedDate+'T'+task.plannedTime+':00'):null;
        const end=start?new Date(start.getTime()+(task.durationMinutes||45)*60000):null;
        result.push({...task,date:task.plannedDate,time:task.plannedTime||'',endTime:end?String(end.getHours()).padStart(2,'0')+':'+String(end.getMinutes()).padStart(2,'0'):'',title:'Work · '+task.title,kind:'task',sourceId:task.id,important:false,occurrenceType:'work'});
      }
    }
    for(const event of data.events||[]){
      for(let date=from;date<=to;date=addDays(date,1)){
        if(date===event.date||event.repeat==='yearly'&&date>=event.date&&date.slice(4)===event.date.slice(4))result.push({...event,date,kind:'event',sourceId:event.id,done:false});
      }
    }
    const checks=new Set((data.routineChecks||[]).filter(c=>c.done).map(c=>c.routineId+':'+c.date));
    const overrides=new Map((data.routineOverrides||[]).map(o=>[o.routineId+':'+o.date,o]));
    for(let date=from;date<=to;date=addDays(date,1)){
      for(const routine of data.routines||[]){
        const override=overrides.get(routine.id+':'+date);
        if(!routineOn(routine,date,override))continue;
        const done=checks.has(routine.id+':'+date);
        if(includeDone||!done)result.push({...routine,...(override?{time:override.time,endTime:override.endTime,adjusted:true,adjustmentReason:override.reason}:{}),date,kind:'routine',sourceId:routine.id,important:false,done});
      }
    }
    return result.sort((a,b)=>(a.date+(a.time||'99:99')).localeCompare(b.date+(b.time||'99:99'))||a.title.localeCompare(b.title));
  }
  function sessionBounds(item){
    if(!item.time)return null;
    const start=new Date(item.date+'T'+item.time+':00').getTime();
    let end=item.endTime?new Date(item.date+'T'+item.endTime+':00').getTime():null;
    if(end!==null&&end<=start)end=new Date(addDays(item.date,1)+'T'+item.endTime+':00').getTime();
    if(end===null&&item.kind==='task'&&item.plannedDate===item.date&&item.plannedTime===item.time)end=start+(item.durationMinutes||45)*60000;
    return {start,end};
  }
  function currentSessions(data,now=Date.now()){
    const date=iso(new Date(now));
    const entries=occurrences(data,addDays(date,-1),date,{includeDone:false});
    const active=entries.filter(item=>{const b=sessionBounds(item);return b&&b.end!==null&&b.start<=now&&now<b.end;});
    return active.filter(item=>item.kind!=='routine'||item.routineType!=='study'||!active.some(x=>x.kind==='event'));
  }
  function milestones(data,from=today()){
    return [
      ...(data.events||[]).filter(e=>e.important).map(e=>({...e,date:nextEvent(e,from),kind:'event',sourceId:e.id})),
      ...(data.tasks||[]).filter(t=>t.important&&t.date&&!t.done).map(t=>({...t,kind:'task',sourceId:t.id}))
    ].filter(e=>e.date&&e.date>=from).map(e=>({...e,remaining:daysUntil(e.date,from)})).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function allEntries(data,from=today()){
    return [...(data.tasks||[]).filter(t=>t.date).map(t=>({...t,kind:'task',sourceId:t.id})),
      ...(data.tasks||[]).filter(t=>t.plannedDate&&!(t.date===t.plannedDate&&t.time===t.plannedTime)).map(t=>({...t,date:t.plannedDate,time:t.plannedTime,title:'Work · '+t.title,kind:'task',sourceId:t.id,important:false,occurrenceType:'work'})),
      ...(data.events||[]).map(e=>({...e,date:nextEvent(e,from)||e.date,kind:'event',sourceId:e.id,done:false}))]
      .sort((a,b)=>(a.date+(a.time||'99:99')).localeCompare(b.date+(b.time||'99:99')));
  }
  function dayLabel(date){return new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'2-digit'});}
  return {iso,today,validDate,validTime,addDays,daysUntil,weekday,normalize,nextEvent,routineOn,occurrences,milestones,allEntries,dayLabel,sessionBounds,currentSessions};
});
