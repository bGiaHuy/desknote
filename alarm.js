const fs=require('fs'),path=require('path');
const {spawn}=require('child_process');
class Alarm{
  constructor(dir,{show,hide=()=>{},play=startSound,clock=()=>Date.now(),wakeups=()=>[]}={}){
    this.file=path.join(dir,'alarm.json');this.show=show;this.hide=hide;this.play=play;this.clock=clock;this.timer=null;this.sound=null;this.error=null;
    this.wakeups=wakeups;
    try{this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{this.state={at:null,ringing:false};}
  }
  save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state),'utf8');fs.renameSync(tmp,this.file);}
  status(){return {...this.state,error:this.error};}
  follow(routineId){
    if(typeof routineId!=='string'||!this.wakeups().some(x=>x.sourceId===routineId))throw Error('No upcoming wake-up occurrence for this routine.');
    this.stop();this.state={at:null,ringing:false,routineId};this.refreshWakeup();this.save();return this.status();
  }
  refreshWakeup(){
    if(!this.state.routineId||this.state.ringing||this.state.oneOff)return;
    if(this.state.at&&this.state.at<=this.clock()&&this.state.at>(this.state.stoppedAt||0))return;
    const next=this.wakeups().filter(x=>x.sourceId===this.state.routineId&&x.at>Math.max(this.state.stoppedAt||0,this.clock()-120000)).sort((a,b)=>a.at-b.at)[0];
    if(this.state.at!==(next?.at||null)){this.state.at=next?.at||null;this.save();}
  }
  set(minutes){
    if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('Alarm duration must be 1-1440 minutes.');
    this.stop();this.state={at:this.clock()+minutes*60000,ringing:false};this.save();return this.status();
  }
  once(at){
    if(!Number.isSafeInteger(at)||at<=this.clock()||at>this.clock()+86400000)throw Error('One-off alarm must be within the next 24 hours.');
    const routineId=this.state.routineId;this.stop();this.state={at,ringing:false,oneOff:true,...(routineId?{routineId}:{})};this.save();return this.status();
  }
  stop(keepRoutine=false){this.sound?.stop();this.sound=null;this.hide();this.state={at:null,ringing:false,...(keepRoutine&&this.state.routineId?{routineId:this.state.routineId,stoppedAt:this.clock()}: {})};this.error=null;this.refreshWakeup();this.save();return this.status();}
  tick(){
    this.refreshWakeup();
    if(!this.state.at||this.clock()<this.state.at||this.sound)return;
    this.state.ringing=true;this.save();
    try{this.sound=this.play(error=>{this.error=error.message;});Promise.resolve(this.show()).catch(error=>{this.error=error.message;});}
    catch(error){this.error=error.message;}
  }
  start(){if(this.timer)return;this.tick();this.timer=setInterval(()=>this.tick(),1000);this.timer.unref?.();}
  close(){clearInterval(this.timer);this.timer=null;this.sound?.stop();this.sound=null;this.hide();}
}
function startSound(onError){
  const custom=path.join(require('./store').DATA_DIR,'apple-radar.wav');
  const sound=fs.existsSync(custom)?custom:path.join(process.env.WINDIR||'C:/Windows','Media','Alarm01.wav');
  if(!fs.existsSync(sound))throw Error('Windows alarm sound is missing: '+sound);
  const script='$p=New-Object System.Media.SoundPlayer; $p.SoundLocation=$env.DESKNOTE_ALARM_SOUND; $p.Load(); $p.PlayLooping(); [Console]::ReadLine() | Out-Null; $p.Stop()';
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,DESKNOTE_ALARM_SOUND:sound},stdio:['pipe','ignore','pipe']});
  let stopped=false;
  child.stdin.on('error',()=>{});child.stderr.resume();child.on('error',()=>onError(Error('Could not start Windows alarm audio.')));
  child.on('exit',()=>{if(!stopped)onError(Error('Alarm audio stopped unexpectedly. Stop and re-arm the alarm.'));});
  return {stop(){stopped=true;child.stdin.end('\n');child.kill();}};
}
function createAlarmWindow(BrowserWindow,screen,ipcMain,onStop,onDesk){
  let window=null;
  ipcMain.on('alarm:stop',event=>{if(window&&event.sender===window.webContents)onStop();});
  ipcMain.on('alarm:desk',event=>{if(window&&event.sender===window.webContents){onStop();onDesk();}});
  return {
    async show(){
      if(window&&!window.isDestroyed()){window.show();return;}
      const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      window=new BrowserWindow({width:440,height:290,x:Math.round(a.x+(a.width-440)/2),y:Math.round(a.y+(a.height-290)/2),title:'Desknote - Wake up',alwaysOnTop:true,autoHideMenuBar:true,show:false,
        webPreferences:{preload:path.join(__dirname,'alarm-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
      const current=window;
      current.on('close',event=>{event.preventDefault();onStop();});
      current.on('closed',()=>{if(window===current)window=null;});
      current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      current.webContents.on('will-navigate',event=>event.preventDefault());
      await current.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{background:#15271d;color:#edf4ea;font:17px system-ui;padding:22px;line-height:1.5}h1{font-size:26px}button{font:inherit;padding:10px 14px;margin:5px;border:1px solid #9cbaa1;border-radius:6px;background:#254b32;color:white;cursor:pointer}button:focus-visible{outline:3px solid white}</style><h1>Time to wake up</h1><p>Your alarm keeps ringing until you stop it.</p><button id="desk">I\'m at my desk</button><button id="stop">Stop alarm</button></html>'));
      if(!current.isDestroyed())current.show();
    },
    hide(){if(window&&!window.isDestroyed()){const current=window;window=null;current.destroy();}}
  };
}
module.exports={Alarm,createAlarmWindow,startSound};
