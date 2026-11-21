const C=require('./src/schedule-core');const {Store}=require('./store');
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
function routineKind(r){
  if(r.routineType)return r.routineType;
  const key=(r.notes||'').match(/lifestyle-approved-20261109:([^\]]+)/)?.[1];
  if(key)return ({'movement':'exercise','class-break':'break','afternoon-break':'break','wind-down':'winddown'})[key]||key;
  const name=normalize(r.title||'');
  if(/morning-study/.test(r.notes||'')||/\b(hoc|study|class|exam)\b/.test(name))return 'study';
  if(/chuan bi ngu|wind.?down/.test(name))return 'winddown';
  if(/nghi trua|nap/.test(name))return 'nap';
  if(/thuc day|wake/.test(name))return 'wake';
  if(/ngu|sleep/.test(name))return 'sleep';
  if(/an sang|breakfast/.test(name))return 'breakfast';
  if(/an trua|lunch/.test(name))return 'lunch';
  if(/an toi|dinner/.test(name))return 'dinner';
  if(/di bo|van dong|exercise/.test(name))return 'exercise';
  if(/nghi|nuoc|break|water/.test(name))return 'break';
  return 'custom';
}
function validateWindow(item,kind){
  if(!C.validTime(item.time)||!C.validTime(item.endTime))throw Error('Routine adjustments require both start and end times.');
  const a=minutes(item.time),b=minutes(item.endTime),duration=(b-a+1440)%1440;
  const bounds={wake:[10,60],breakfast:[20,90],lunch:[20,90],dinner:[20,90],nap:[10,20],exercise:[15,90],winddown:[30,120],sleep:[480,600],break:[5,30],custom:[5,180]};
  const [min,max]=bounds[kind]||bounds.custom;
  if(duration<min||duration>max)throw Error(kind==='sleep'?'Automatic schedules must allow at least 8 hours of sleep.':'The duration of '+kind+' is outside the allowed routine duration.');
  const windows={wake:[300,510],breakfast:[300,600],lunch:[630,870],dinner:[1020,1260],nap:[720,930],exercise:[360,1230],winddown:[1170,1380],break:[360,1290],custom:[360,1290]};
  if(kind==='sleep'){if(a<1260||b<300||b>510)throw Error('Keep the main sleep period at night.');}
  else{const [start,end]=windows[kind]||windows.custom;if(a<start||b>end||b<=a)throw Error('Time '+kind+' is outside the allowed adjustment window.');}
}
function interval(item){const a=new Date(item.date+'T'+item.time+':00').getTime();let b=new Date(item.date+'T'+item.endTime+':00').getTime();if(b<=a)b+=86400000;return [a,b];}
function prepareRoutineChanges(ops,snapshot,current,now,messageMap=new Map()){
  let draft=structuredClone(current);const commands=[],audit=[],changed=new Set();
  const virtual=Object.create(Store.prototype);virtual.read=()=>structuredClone(draft);virtual.write=next=>{draft=structuredClone(next);return next;};
  const today=C.iso(new Date(now));
  const targets=new Set();
  for(const op of ops){
    if(op.command!=='routine.add'){const target=op.id+':'+(op.command==='routine.override'?op.date:'default');if(targets.has(target))throw Error('Duplicate routine change.');targets.add(target);}
    if(!['routine.override','routine.update','routine.add'].includes(op.command))throw Error('Unsupported automatic routine operation.');
    const fields=JSON.parse(op.fieldsJson);const reason=String(fields.reason||'').trim();if(!reason)throw Error('Routine adjustments require a reason.');
    const keys=fields.sourceKeys||[];if(!Array.isArray(keys)||keys.some(k=>!messageMap.has(k)))throw Error('Invalid routine adjustment sources.');
    let command,old,after;
    if(op.command==='routine.add'){
      if(audit.filter(x=>x.command==='routine.add').length>=3)throw Error('Each review can add at most three routines.');
      const allowed=['title','time','endTime','days','routineType','reason','sourceKeys'];if(Object.keys(fields).some(k=>!allowed.includes(k)))throw Error('Invalid fields for a new routine.');
      const kind=fields.routineType||routineKind(fields);if(kind==='study')throw Error('Fixed study schedules cannot be created or changed automatically.');
      validateWindow(fields,kind);
      if(draft.routines.some(r=>normalize(r.title)===normalize(fields.title||'')))throw Error('This routine already exists.');
      command={command:'routine.add',fields:{title:fields.title,time:fields.time,endTime:fields.endTime,days:fields.days||[0,1,2,3,4,5,6],routineType:kind,notes:'Assistant: '+reason,startDate:today,enabled:true,notify:true}};
      after=virtual.command(command);command={...command,id:after.id};
      audit.push({command:'routine.add',id:after.id,before:null,after:structuredClone(after),reason});changed.add(after.id);commands.push(command);continue;
    }
    old=current.routines.find(r=>r.id===op.id);const before=snapshot.routines.find(r=>r.id===op.id);
    if(!old||!before||JSON.stringify(old)!==JSON.stringify(before))throw Error('You recently edited this routine. It will be preserved until the next review.');
    const kind=routineKind(old);if(old.locked||kind==='study')throw Error('Study sessions and locked routines cannot be moved automatically.');
    if(op.command==='routine.update'){
      if(!keys.some(k=>messageMap.get(k).isSelf))throw Error('Changing a repeating routine requires your explicit request. Use a dated override for a single day.');
      if(Object.keys(fields).some(k=>!['time','endTime','reason','sourceKeys'].includes(k)))throw Error('Automatic changes can adjust repeating times but cannot delete or disable routines.');
      const next={...old,...fields};validateWindow(next,kind);
      command={command:'routine.update',id:old.id,fields:{time:next.time,endTime:next.endTime}};
      after=virtual.command(command);audit.push({command:'routine.update',id:old.id,before:{time:old.time,endTime:old.endTime},after:{time:after.time,endTime:after.endTime},reason});
    }else{
      if(Object.keys(fields).some(k=>!['time','endTime','skip','reason','sourceKeys'].includes(k)))throw Error('Invalid fields in the dated override.');
      if(!C.validDate(op.date)||op.date<today||C.daysUntil(op.date,today)>7)throw Error('Automatic routine adjustments are limited to the next seven days.');
      if(draft.routineChecks.some(c=>c.routineId===old.id&&c.date===op.date&&c.done))throw Error('Completed occurrences cannot be changed.');
      const existing=current.routineOverrides.find(o=>o.routineId===old.id&&o.date===op.date)||null;
      const original=snapshot.routineOverrides.find(o=>o.routineId===old.id&&o.date===op.date)||null;
      if(JSON.stringify(existing)!==JSON.stringify(original))throw Error('This dated override was recently changed.');
      const effective={...old,...fields};
      if(fields.skip){if(!['nap','break','exercise','custom'].includes(kind))throw Error('Meals, sleep and wind-down cannot be skipped automatically.');}
      else{validateWindow(effective,kind);if(new Date(op.date+'T'+effective.time+':00').getTime()<now)throw Error('Past occurrences cannot be changed automatically.');}
      command={command:'routine.override',id:old.id,date:op.date,fields:{time:effective.time,endTime:effective.endTime,skip:!!fields.skip,reason}};
      after=virtual.command(command);audit.push({command:'routine.override',id:old.id,date:op.date,before:existing,after:structuredClone(after),reason});
    }
    changed.add(op.command==='routine.override'?old.id+':'+op.date:old.id);commands.push(command);
  }
  const occurrences=C.occurrences(draft,C.addDays(today,-1),C.addDays(today,8),{includeDone:false});
  for(const item of occurrences.filter(x=>x.kind==='routine'&&(changed.has(x.sourceId)||changed.has(x.sourceId+':'+x.date)))){
    if(new Date(item.date+'T'+item.time+':00').getTime()<now)continue;
    const [a,b]=interval(item),kind=routineKind(item);
    for(const other of occurrences){
      if(other===item||!other.time||other.kind==='routine'&&other.sourceId===item.sourceId&&other.date===item.date)continue;
      if(other.kind==='task'&&(other.occurrenceType!=='work'||other.planSource==='review'))continue;
      if(other.kind==='event'&&other.notify===false&&/2NDFE/.test(other.notes||''))continue;
      if(kind==='break'&&other.kind==='routine'&&routineKind(other)==='study')continue;
      const start=new Date(other.date+'T'+other.time+':00').getTime();
      const [c,d]=other.kind==='task'||!other.endTime?[start,start+(other.durationMinutes||45)*60000]:interval(other);
      if(a<d&&b>c)throw Error('Adjustment to '+item.title+' overlaps '+other.title+' ('+item.date+').');
    }
  }
  return {draft,commands,audit};
}
module.exports={routineKind,validateWindow,prepareRoutineChanges};
