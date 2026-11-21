const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function createReminderWindow(BrowserWindow, screen) {
  let window = null;
  let messages = [];
  return payload => {
    if (!window || window.isDestroyed()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      window = new BrowserWindow({width:420,height:360,x:area.x+area.width-436,y:area.y+16,
        title:'desknote · Reminder',alwaysOnTop:true,autoHideMenuBar:true,show:false,
        webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      const current = window;
      current.on('closed',()=>{if(window===current){window=null;messages=[];}});
      current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    }
    messages.push({title:payload.title,body:payload.body});
    const current = window;
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>desknote</title><style>body{background:#15271d;color:#edf4ea;font:16px system-ui;padding:16px;line-height:1.5}h1{font-size:20px}article{border-bottom:1px solid #56705b;padding:8px 0}p{white-space:pre-wrap}small{color:#becfbb}</style><h1>desknote · Reminder</h1><small>Close this window to dismiss the reminder.</small>'+messages.map(m=>'<article><strong>'+escape(m.title)+'</strong><p>'+escape(m.body)+'</p></article>').join('')+'</html>';
    return current.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).then(()=>{
      if(!current.isDestroyed()) current.showInactive();
      return {shown:true,fallback:true};
    });
  };
}
module.exports={createReminderWindow};
