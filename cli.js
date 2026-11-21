#!/usr/bin/env node
const net = require('net');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {PIPE} = require('./store');
const Schedule = require('./src/schedule-core');
const args = process.argv.slice(2);
const command = args.shift() || 'help';
if(command.startsWith('gmail.')){
  require('./gmail-reader').run(command,args).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}else{
function help() {
  console.log('desknote alarm.set --minutes 20 | alarm.status | alarm.stop\nWake-up alarm loops until Stop or I am at my desk is clicked. Requires an awake PC with audible speakers.');
  console.log('desknote gmail.login CLIENT.json | gmail.status | gmail.search "QUERY"\nGmail uses read-only consent and Windows-encrypted local credentials.');
  console.log('desknote reviews.status | reviews.preview | reviews.run | reviews.undo | reviews.on | reviews.off\nreviews.preview reads MCP sources without calling AGY. reviews.run starts an authorized live AGY review.\nTask planning: --plan-date YYYY-MM-DD --plan-time HH:mm --minutes 45 (separate from deadline --date/--time).');
  console.log('desknote notifications | notifications.on | notifications.off | notifications.test\ndesknote notifications.sound-on | notifications.sound-off\nUse --notify true|false on tasks, events and routines.');
  console.log('desknote desktop  (native desktop attachment status)');
  console.log('desknote routine.add "Routine title" --time 07:00 --days 1,2,3,4,5\ndesknote routine.update ID --time 08:00 | routine.delete ID\ndesknote routine.check ID --date YYYY-MM-DD --done true\ndesknote event.add "Important date" --date YYYY-MM-DD --important true --repeat yearly\ndesknote event.update ID --date YYYY-MM-DD | event.delete ID\ndesknote routines | events | milestones | schedule --from YYYY-MM-DD --to YYYY-MM-DD');
  console.log(`desknote list [--json]\n desknote agenda [--date YYYY-MM-DD] [--json]\n desknote get ID\n desknote add "Task title" [--date YYYY-MM-DD] [--time HH:mm] [--list work|study] [--priority high|medium|low|none]\n desknote update ID [--title "New title"] [--status todo|progress|done] [--date YYYY-MM-DD] [--time HH:mm] [--notes "..."]\n desknote done ID | desknote reopen ID | desknote delete ID\n desknote path | desknote show\n desknote request FILE.json  (structured command; supports subtasks/tags)\n\nDates and times use the local Windows timezone. Commands start the widget if needed.`);
}
if (command === 'help' || command === '--help') { help(); process.exit(0); }
let req = {command};
const flags = {};
const positional = [];
try {
  while (args.length) { const a=args.shift(); if(a==='--json') flags.json=true; else if(a.startsWith('--')) { if(!args.length || args[0].startsWith('--')) throw Error('Missing value: '+a); flags[a.slice(2)]=args.shift(); } else positional.push(a); }
  const allowed=['json','title','status','date','time','list','priority','notes','desc','days','important','repeat','end-time','start-date','end-date','enabled','done','from','to','notify','plan-date','plan-time','minutes'];
  for(const k of Object.keys(flags)) if(!allowed.includes(k)) throw Error('Unknown option: --'+k);
  const fields={};
  for(const k of ['title','status','date','time','priority','notes','desc']) if(flags[k]!==undefined) fields[k]=flags[k];
  if(flags.list) fields.catId=flags.list;
  if(command==='add') { fields.title=positional[0] || flags.title; req.fields=fields; }
  if(['get','update','delete','done','reopen'].includes(command)) { if(!positional[0]) throw Error('Missing task ID.'); req.id=positional[0]; }
  if(command==='update') req.fields=fields;
  if(command==='alarm.follow'){req.id=positional[0];}
  const bool=name=>{if(!['true','false'].includes(flags[name]))throw Error('--'+name+' must be true or false.');return flags[name]==='true';};
  if(flags.important!==undefined)fields.important=bool('important');
  if(flags.notify!==undefined)fields.notify=bool('notify');
  if(flags['plan-date']!==undefined)fields.plannedDate=flags['plan-date'];
  if(flags['plan-time']!==undefined)fields.plannedTime=flags['plan-time'];
  if(flags.minutes!==undefined)fields.durationMinutes=Number(flags.minutes);
  if(command==='alarm.set')req.fields={minutes:Number(flags.minutes)};
  if(flags['plan-date']!==undefined||flags['plan-time']!==undefined)fields.planSource='manual';
  if(/^(routine|event)\.(add|update|delete)$/.test(command)){
    if(command.endsWith('.add'))fields.title=positional[0]||flags.title;
    else{if(!positional[0])throw Error('Missing ID.');req.id=positional[0];}
    if(flags.days!==undefined)fields.days=flags.days.split(',').map(Number);
    if(flags.repeat!==undefined)fields.repeat=flags.repeat;
    if(flags.enabled!==undefined)fields.enabled=bool('enabled');
    for(const [flag,key] of [['end-time','endTime'],['start-date','startDate'],['end-date','endDate']])if(flags[flag]!==undefined)fields[key]=flags[flag];
    if(!command.endsWith('.delete'))req.fields=fields;
  }
  if(command==='routine.check'){req.id=positional[0];req.date=flags.date;req.done=bool('done');}
  if(command==='schedule'||command==='milestones'){req.from=flags.from;req.to=flags.to;}
  if(command==='done'||command==='reopen') { req.command='update'; req.fields={status:command==='done'?'done':'todo'}; }
  if(command==='agenda') {req.command='schedule';req.from=req.to=flags.date||Schedule.today();req.includeDone=false;}
  if(command==='request') { req=JSON.parse(fs.readFileSync(positional[0],'utf8').replace(/^\uFEFF/,'')); }
} catch(e) { console.error(e.message); process.exit(1); }
function request() { return new Promise((resolve,reject)=>{
  const socket=net.createConnection(PIPE); let text='';
  socket.setEncoding('utf8'); socket.setTimeout(req.command==='reviews.preview'?120000:req.command==='notifications.test'?15000:8000,()=>socket.destroy(Error('Widget request timed out.')));
  socket.on('connect',()=>socket.write(JSON.stringify(req)+'\n'));
  socket.on('data',chunk=>{text+=chunk;if(text.includes('\n')){socket.end();try{const r=JSON.parse(text.split('\n')[0]);r.ok?resolve(r.data):reject(Error(r.error));}catch(e){reject(e);}}});
  socket.on('error',reject);
}); }
(async()=>{
  let result;
  try { result=await request(); } catch(e) {
    if(!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e;
    const exe=path.join(__dirname,'node_modules','electron','dist','electron.exe');
    const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    spawn(exe,[__dirname],{detached:true,stdio:'ignore',windowsHide:true,env}).unref();
    for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,200));try{result=await request();break;}catch(err){if(!['ENOENT','ECONNREFUSED'].includes(err.code))throw err;}}
    if(result===undefined)throw Error('Cannot start Desknote.');
  }
  if((command==='list'||command==='agenda')&&!flags.json) {
    const list=Array.isArray(result)?result:result.tasks;
    console.log(list.map(t=>`${t.done?'[x]':'[ ]'} ${t.id.padEnd(9)} ${(t.date||'').padEnd(10)} ${(t.time||'').padEnd(5)} ${t.title}`).join('\n')||'Nothing scheduled.');
  } else console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
}
