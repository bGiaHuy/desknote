const assert=require('assert/strict');
const {createReminderWindow}=require('./reminder-window');
const windows=[];
class Window {
  constructor(options){this.options=options;this.handlers={};this.webContents={setWindowOpenHandler:fn=>this.open=fn};windows.push(this);}
  on(event,fn){this.handlers[event]=fn;}
  isDestroyed(){return !!this.destroyed;}
  async loadURL(url){this.html=decodeURIComponent(url.split(',').slice(1).join(','));}
  showInactive(){this.shown=true;}
}
(async()=>{
  const show=createReminderWindow(Window,{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:-1920,y:0,width:1920,height:1080}})});
  await show({title:'Exam <script>',body:'07:30 & room'});
  assert(windows[0].shown);assert(windows[0].options.alwaysOnTop);assert.equal(windows[0].options.x,-436);
  assert(windows[0].html.includes('Exam &lt;script&gt;'));assert(windows[0].html.includes('07:30 &amp; room'));
  assert.equal(windows[0].open().action,'deny');
  await show({title:'Second reminder',body:'Keep both'});
  assert.equal(windows.length,1);assert(windows[0].html.includes('Exam &lt;script&gt;'));assert(windows[0].html.includes('Second reminder'));
  windows[0].destroyed=true;windows[0].handlers.closed();
  await show({title:'New reminder',body:'Fresh window'});
  assert.equal(windows.length,2);assert(!windows[1].html.includes('Second reminder'));
  console.log('PASS: persistent fallback, grouped reminders, safe text, display bounds, dismiss and reopen.');
})().catch(error=>{console.error(error);process.exitCode=1;});
