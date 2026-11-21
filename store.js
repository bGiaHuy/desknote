// Local storage and validation shared by the app, CLI and tests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Schedule = require('./src/schedule-core');
// Preserve existing installations without moving data while the app is running.
const legacyName = ['Huy', 'Desk'].join(' ');
const legacyDir = path.join(process.env.APPDATA || process.env.HOME, legacyName);
const DATA_DIR = process.env.DESKNOTE_DATA_DIR || (fs.existsSync(path.join(legacyDir, 'tasknest.json')) ? legacyDir : path.join(process.env.APPDATA || process.env.HOME, 'Desknote'));
const pipeName = DATA_DIR === legacyDir ? legacyName.toLowerCase().replace(' ', '-') : 'desknote';
const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\' + pipeName + '-' + crypto.createHash('sha256').update(DATA_DIR).digest('hex').slice(0, 16) : path.join(DATA_DIR, 'desk.sock');
const clone = x => JSON.parse(JSON.stringify(x));
function validateTask(t) {
  if(t.plannedDate&&!Schedule.validDate(t.plannedDate))throw Error('Invalid planned date.');
  if(t.plannedTime&&!Schedule.validTime(t.plannedTime))throw Error('Invalid planned time.');
  if(t.plannedTime&&!t.plannedDate)throw Error('Planned time needs a date.');
  if(t.durationMinutes!==undefined&&(!Number.isInteger(t.durationMinutes)||t.durationMinutes<15||t.durationMinutes>180))throw Error('Work duration must be 15–180 minutes.');
  if(t.sourceRefs!==undefined&&(!Array.isArray(t.sourceRefs)||t.sourceRefs.length>100||t.sourceRefs.some(r=>!['zalo','messenger','gmail'].includes(r.source)||typeof r.id!=='string'||typeof r.threadId!=='string')))throw Error('Invalid message references.');
  if(t.planSource!==undefined&&!['manual','review'].includes(t.planSource))throw Error('Invalid plan origin.');
  if(t.notify!==undefined&&typeof t.notify!=='boolean')throw Error('Notify must be a boolean.');
  if(t.important!==undefined&&typeof t.important!=='boolean')throw Error('Important must be a boolean.');
  if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 200) throw Error('Title must contain 1–200 characters.');
  if (!['todo', 'progress', 'done'].includes(t.status)) throw Error('Status: todo, progress or done.');
  if (!['none', 'low', 'medium', 'high'].includes(t.priority)) throw Error('Priority: none, low, medium or high.');
  if (t.date && (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !Number.isFinite(Date.parse(t.date + 'T00:00:00')) || new Date(t.date + 'T12:00:00Z').toISOString().slice(0,10) !== t.date)) throw Error('Date must be YYYY-MM-DD.');
  if (t.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) throw Error('Time must be HH:mm (24-hour).');
  if (!Array.isArray(t.tags) || !Array.isArray(t.subtasks)) throw Error('Tags and subtasks must be arrays.');
}
function validate(data) {
  Schedule.normalize(data);
  if (!data || !Array.isArray(data.categories) || !data.categories.length || !Array.isArray(data.tasks)) throw Error('Invalid task data.');
  const ids = new Set();
  for (const t of data.tasks) {
    validateTask(t);
    if (ids.has(t.id) || typeof t.id !== 'string') throw Error('Duplicate or invalid task ID.');
    ids.add(t.id);
    if (!data.categories.some(c => c.id === t.catId)) throw Error('Unknown list: ' + t.catId);
  }
  for(const key of ['routines','events','routineChecks']){
    if(!Array.isArray(data[key]))throw Error('Invalid '+key);
    const ids=new Set();
    for(const item of data[key]){
      if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('Invalid/duplicate '+key+' ID.');
      ids.add(item.id);
      if(key==='routineChecks'){
        if(!Schedule.validDate(item.date)||typeof item.done!=='boolean'||!data.routines.some(r=>r.id===item.routineId))throw Error('Invalid routine completion.');
        if(item.id!==item.routineId+':'+item.date)throw Error('Invalid completion ID.');
      }else{
        if(key==='routines'&&item.locked!==undefined&&typeof item.locked!=='boolean')throw Error('Invalid routine lock.');
        if(key==='routines'&&item.routineType!==undefined&&!['wake','breakfast','lunch','dinner','nap','exercise','winddown','sleep','break','study','custom'].includes(item.routineType))throw Error('Invalid routine type.');
        if(item.notify!==undefined&&typeof item.notify!=='boolean')throw Error('Notify must be a boolean.');
        if(typeof item.title!=='string'||!item.title.trim()||item.title.length>200)throw Error('Schedule titles must contain 1–200 characters.');
        if(item.time&&!Schedule.validTime(item.time)||item.endTime&&!Schedule.validTime(item.endTime))throw Error('Times must use HH:mm format.');
        if(key==='events'){
          if(!Schedule.validDate(item.date)||!['none','yearly'].includes(item.repeat)||typeof item.important!=='boolean')throw Error('Invalid event date or repeat rule.');
        }else{
          if(item.excludeDates!==undefined&&(!Array.isArray(item.excludeDates)||item.excludeDates.some(date=>!Schedule.validDate(date))))throw Error('Invalid routine exception date.');
          if(!Array.isArray(item.days)||!item.days.length||item.days.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(item.days).size!==item.days.length)throw Error('Choose at least one repeat day (0=Sun, 1=Mon through 6=Sat).');
          if(!Schedule.validTime(item.time)||typeof item.enabled!=='boolean')throw Error('Routines require a time and enabled state.');
          if(item.startDate&&!Schedule.validDate(item.startDate)||item.endDate&&!Schedule.validDate(item.endDate)||item.startDate&&item.endDate&&item.startDate>item.endDate)throw Error('Invalid routine date range.');
        }
      }
    }
  }
  const overrideIds=new Set();
  if(!Array.isArray(data.routineOverrides))throw Error('Invalid routine overrides.');
  for(const item of data.routineOverrides){
    if(!data.routines.some(r=>r.id===item.routineId)||!Schedule.validDate(item.date)||item.id!==item.routineId+':'+item.date||overrideIds.has(item.id))throw Error('Invalid routine override.');
    overrideIds.add(item.id);
    if(typeof item.skip!=='boolean'||typeof item.reason!=='string'||!Schedule.validTime(item.time)||item.endTime&&!Schedule.validTime(item.endTime))throw Error('Invalid routine override time.');
  }
  return data;
}
function makeTask(fields) {
  const t = { id: crypto.randomUUID().slice(0,8), catId: 'work', title: '', status: 'todo', done: false, date: '', time: '', priority: 'none', tags: [], subtasks: [], desc: '', notes: '', createdAt: Date.now(), ...fields };
  t.done = t.status === 'done';
  validateTask(t);
  return t;
}
function seed() {
  return { version: 1, activeCat: '@all', categories: [{id:'work',name:'Work',icon:''},{id:'study',name:'Study',icon:''}], tasks: [
    makeTask({id:'dbi202',catId:'study',title:'Review study notes',date:'2026-12-01',time:'09:00',priority:'high',subtasks:[{id:'review',text:'Review notes',done:false}]}),
    makeTask({id:'loginfix',title:'Plan the week',priority:'high',status:'progress'}),
    makeTask({id:'gd2',catId:'study',title:'Read a chapter',priority:'medium'})
  ]};
}
// Apply only fields actually edited by the renderer, preserving concurrent CLI edits.
function merge(base, next, current) {
  if(base)Schedule.normalize(base);
  Schedule.normalize(next);Schedule.normalize(current);
  if (!base) return validate(clone(next));
  const result = clone(current);
  for (const key of ['tasks','categories','routines','events','routineChecks','routineOverrides']) {
    const before = new Map(base[key].map(x => [x.id,x]));
    const after = new Map(next[key].map(x => [x.id,x]));
    result[key] = result[key].filter(x => !before.has(x.id) || after.has(x.id));
    for (const item of next[key]) {
      const old = before.get(item.id);
      let dest = result[key].find(x => x.id === item.id);
      if (!old) { if (!dest) result[key].push(clone(item)); continue; }
      if (!dest) continue; // An external deletion must not be resurrected by stale UI.
      for (const field of Object.keys(item)) if (JSON.stringify(item[field]) !== JSON.stringify(old[field])) dest[field] = clone(item[field]);
    }
  }
  for (const key of ['activeCat','showDone']) if (next[key] !== base[key]) result[key] = next[key];
  return validate(result);
}
class Store {
  constructor(dir = DATA_DIR) { this.dir = dir; this.file = path.join(dir,'tasknest.json'); fs.mkdirSync(dir,{recursive:true}); }
  read() { return validate(JSON.parse(fs.readFileSync(this.file,'utf8'))); }
  write(data) {
    validate(data);
    const tmp = this.file + '.' + process.pid + '.tmp';
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file,this.file + '.bak');
    fs.writeFileSync(tmp,JSON.stringify(data,null,2),'utf8');
    fs.renameSync(tmp,this.file);
    return data;
  }
  ensure() { if (!fs.existsSync(this.file)) this.write(seed()); return this.read(); }
  command(req) {
    if (req.command === 'path') return {file:this.file};
    const data = this.read();
    if(req.command==='schedule')return Schedule.occurrences(data,req.from||Schedule.today(),req.to||req.from||Schedule.today(),{includeDone:req.includeDone!==false});
    if(req.command==='milestones')return Schedule.milestones(data,req.from||Schedule.today());
    if(req.command==='routines')return data.routines;
    if(req.command==='events')return data.events;
    if(req.command==='batch'){
      // Validate every operation against an in-memory store; persist once, or nothing.
      if(!Array.isArray(req.operations)||req.operations.length>50)throw Error('Invalid operations.');
      let draft=clone(data);const results=[];
      const virtual=Object.create(Store.prototype);
      virtual.read=()=>clone(draft);virtual.write=next=>{validate(next);draft=clone(next);return next;};
      for(const operation of req.operations){if(['batch','path'].includes(operation.command))throw Error('Invalid nested operation.');results.push(virtual.command(operation));}
      this.write(draft);return results;
    }
    if(req.command==='routine.override'||req.command==='routine.clear-override'){
      const routine=data.routines.find(r=>r.id===req.id);if(!routine||!Schedule.validDate(req.date))throw Error('Invalid routine or date.');
      const id=req.id+':'+req.date;data.routineOverrides=data.routineOverrides.filter(o=>o.id!==id);
      if(req.command==='routine.clear-override'){this.write(data);return {cleared:id};}
      const fields=req.fields||{};if(Object.keys(fields).some(k=>!['time','endTime','skip','reason'].includes(k)))throw Error('Unknown override field.');
      const item={id,routineId:req.id,date:req.date,time:routine.time,endTime:routine.endTime||'',skip:false,reason:'',...fields,updatedAt:Date.now()};
      data.routineOverrides.push(item);this.write(data);return item;
    }
    if(req.command==='routine.check'){
      const routine=data.routines.find(r=>r.id===req.id);
      if(!routine||!Schedule.validDate(req.date)||!Schedule.routineOn(routine,req.date,data.routineOverrides.find(o=>o.routineId===req.id&&o.date===req.date))||typeof req.done!=='boolean')throw Error('Invalid routine date.');
      const id=req.id+':'+req.date;data.routineChecks=data.routineChecks.filter(c=>c.id!==id);
      if(req.done)data.routineChecks.push({id,routineId:req.id,date:req.date,done:true});
      this.write(data);return {id,done:req.done};
    }
    if(/^(routine|event)\.(add|update|delete)$/.test(req.command)){
      const [kind,action]=req.command.split('.');const key=kind==='routine'?'routines':'events';
      const allowed=kind==='routine'?['title','time','endTime','days','startDate','endDate','enabled','notes','notify','excludeDates','routineType','locked']:['title','date','time','endTime','repeat','important','notes','notify'];
      const fields=req.fields||{};
      for(const field of Object.keys(fields))if(!allowed.includes(field))throw Error('Unknown '+kind+' field: '+field);
      let item;
      if(action==='add'){
        const defaults=kind==='routine'?{title:'',time:'',endTime:'',days:[0,1,2,3,4,5,6],startDate:'',endDate:'',enabled:true,notes:''}:{title:'',date:'',time:'',endTime:'',repeat:'none',important:false,notes:''};
        item={id:req.id||crypto.randomUUID().slice(0,8),...defaults,...fields};data[key].push(item);
      }else{
        item=data[key].find(x=>x.id===req.id);if(!item)throw Error('Schedule item not found: '+req.id);
        if(action==='delete'){
          data[key]=data[key].filter(x=>x.id!==req.id);
          if(kind==='routine'){data.routineChecks=data.routineChecks.filter(c=>c.routineId!==req.id);data.routineOverrides=data.routineOverrides.filter(c=>c.routineId!==req.id);}
        }else Object.assign(item,fields);
      }
      this.write(data);return action==='delete'?{deleted:req.id}:item;
    }
    if (req.command === 'list') return data;
    if (req.command === 'get') { const t = data.tasks.find(x => x.id === req.id); if (!t) throw Error('Task not found: '+req.id); return t; }
    if (req.command === 'add') { const t = makeTask(req.fields || {}); data.tasks.push(t); this.write(data); return t; }
    const t = data.tasks.find(x => x.id === req.id);
    if (!t) throw Error('Task not found: '+req.id);
    if (req.command === 'delete') data.tasks = data.tasks.filter(x=>x.id!==req.id);
    else if (req.command === 'update') {
      const allowed = ['title','catId','date','time','priority','status','desc','notes','tags','subtasks','important','notify','plannedDate','plannedTime','durationMinutes','sourceRefs','planSource'];
      for (const [key,value] of Object.entries(req.fields || {})) { if (!allowed.includes(key)) throw Error('Unknown task field: '+key); t[key]=value; }
      t.done = t.status === 'done'; t.doneAt = t.done ? Date.now() : null;
    } else throw Error('Unknown command.');
    this.write(data);
    return req.command === 'delete' ? {deleted:req.id} : t;
  }
}
module.exports = { Store, DATA_DIR, PIPE, makeTask, merge, validate, seed };
