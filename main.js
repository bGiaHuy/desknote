const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, globalShortcut, shell, Notification, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { Store, DATA_DIR, PIPE, merge } = require('./store');
const { AgyBridge } = require('./agy-bridge');
const { NotificationEngine } = require('./notification-engine');
const { ReviewEngine } = require('./review-engine');
const {Alarm,createAlarmWindow}=require('./alarm');
fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath('userData', DATA_DIR);
const store = new Store();
const agyBridge = new AgyBridge(store);
const notificationRefs=new Set();
const showReminderWindow=require('./reminder-window').createReminderWindow(BrowserWindow,screen);
const reminders=new NotificationEngine(store,{send:sendDesktopNotification,supported:()=>true});
const alarmWindow=createAlarmWindow(BrowserWindow,screen,ipcMain,()=>alarm.stop(true),()=>showWindow());
const alarm=new Alarm(DATA_DIR,{show:()=>alarmWindow.show(),hide:()=>alarmWindow.hide(),wakeups:()=>{
  const C=require('./src/schedule-core'),today=C.today();
  return C.occurrences(store.read(),today,C.addDays(today,7),{includeDone:false}).filter(x=>x.kind==='routine'&&x.time).map(x=>({sourceId:x.sourceId,at:new Date(x.date+'T'+x.time+':00').getTime()}));
}});
const reviewModel=new AgyBridge(store);
const reviews=new ReviewEngine(store,{model:reviewModel,isBusy:()=>agyBridge.busy,
  changed:()=>{if(win&&!win.isDestroyed()){win.webContents.send('review:updated');win.webContents.send('data:external-change');}},
  notify:async report=>{if(reminders.settings.enabled)await sendDesktopNotification({title:report.status==='failed'?'desknote · Inbox review failed':'desknote · Inbox reviewed and work planned',body:report.summary.slice(0,220),silent:!reminders.settings.sound,entries:[]});}
});
let rendererBaseline = null;
let commandServer = null;
let desktopHelper = null;

const COLLAPSED_W = 400;   // list only (includes 10px shadow gutter each side)
const EXPANDED_W = 780;    // list + detail
const MINI_H = 78;         // header-only "mini" mode
const MARGIN = 16;

let win = null;
let tray = null;
let expanded = false;
let expandSide = 'right';
let mini = false;
let fullHeight = 680;

async function sendDesktopNotification(payload){
  if(process.env.DESKNOTE_TEST)return Promise.resolve({shown:true,simulated:true});
  // Windows may acknowledge a toast even when Do Not Disturb hides its banner.
  const fallback=showReminderWindow(payload);
  const native=new Promise((resolve,reject)=>{
    if(!Notification.isSupported())return reject(Error('Windows notifications are not supported.'));
    const notification=new Notification({title:payload.title,body:payload.body,silent:payload.silent,icon:appIcon(64),timeoutType:'default'});
    notificationRefs.add(notification);
    const timeout=setTimeout(()=>{notificationRefs.delete(notification);reject(Error('Windows did not confirm notification delivery.'));},10000);
    notification.once('show',()=>{clearTimeout(timeout);resolve({shown:true});});
    notification.once('failed',(_event,error)=>{clearTimeout(timeout);notificationRefs.delete(notification);reject(Error(String(error||'Could not display the Windows notification.')));});
    notification.once('close',()=>notificationRefs.delete(notification));
    notification.on('click',()=>{if(!app.isQuitting){showWindow();const item=payload.entries?.[0]?.item;if(item)win.webContents.send('notification:open',item);}});
    notification.show();
  });
  const results=await Promise.allSettled([native,fallback]);
  for(const result of results)if(result.status==='rejected')log('Reminder channel:',result.reason?.message);
  if(results.every(result=>result.status==='rejected'))throw Error('Both reminder channels failed.');
  return {shown:true,windows:results[0].status==='fulfilled',fallback:results[1].status==='fulfilled'};
}

function setupNotificationShortcut(){
  if(process.platform!=='win32'||process.env.DESKNOTE_TEST)return;
  try{
    const programs=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs');
    const shortcut=path.join(programs,'desknote.lnk');
    const previous=path.join(programs,['Huy','Desk'].join(' ')+'.lnk');
    if(fs.existsSync(previous)&&!fs.existsSync(shortcut))fs.renameSync(previous,shortcut);
    const success=shell.writeShortcutLink(shortcut,fs.existsSync(shortcut)?'update':'create',{
      target:process.execPath,args:app.isPackaged?'':'"'+__dirname+'"',cwd:__dirname,
      appUserModelId:'local.desknote',description:'Tasks, routines and reminders'
    });
    if(!success)log('Notification shortcut could not be updated.');
  }catch(error){log('Notification shortcut:',error.message);}
}

// ---------- persistence ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
const DATA = 'tasknest.json';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try {
    const f = userFile('nest.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, line);
  } catch { /* logging must never break the app */ }
}

// Retry file operations: right after Windows sign-in, antivirus / indexing can briefly lock files.
function retry(fn, label, tries = 8) {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (err) {
      if (i >= tries) { log(label, 'FAILED:', err.code || '', err.message); throw err; }
      sleep(120 * i);
    }
  }
}

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch { return fallback; }
}

function writeFileSafe(file, text) {
  retry(() => fs.writeFileSync(file + '.tmp', text), 'write tmp ' + path.basename(file));
  try {
    retry(() => fs.renameSync(file + '.tmp', file), 'rename ' + path.basename(file), 5);
  } catch {
    // rename blocked (file locked): fall back to writing in place
    retry(() => fs.writeFileSync(file, text), 'direct write ' + path.basename(file));
    try { fs.unlinkSync(file + '.tmp'); } catch {}
  }
}
function writeJSON(name, data) {
  writeFileSafe(userFile(name), JSON.stringify(data, null, 2));
}

// Load tasks. Never pretends the file is missing when it merely failed to read.
function loadData() {
  try { const data = store.ensure(); rendererBaseline = structuredClone(data); return {status:'ok', data}; }
  catch (err) { log('load failed:', err.message); return {status:'error'}; }
}

// One rolling backup per app start, plus one per day kept for a week.
let backedUp = false;
function backupOnce(data) {
  if (backedUp) return;
  backedUp = true;
  try {
    const text = JSON.stringify(data, null, 2);
    writeFileSafe(userFile('tasknest.bak.json'), text);
    const dir = userFile('backups');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(dir, `tasknest-${day}.json`), text);
    fs.readdirSync(dir).filter((n) => n.startsWith('tasknest-')).sort().slice(0, -7)
      .forEach((n) => fs.unlinkSync(path.join(dir, n)));
  } catch (err) { log('backup failed:', err.message); }
}

let lastData = null;
function saveData(data) {
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.tasks)) { log('save: rejected invalid data'); return false; }
  try {
    const merged = merge(rendererBaseline, data, store.read());
    store.write(merged);
    rendererBaseline = structuredClone(data);
    lastData = merged;
    return true;
  } catch (err) { log('save failed:', err.message); return false; }
}

let prefs = readJSON('window.json', {});
// v2: widgets sit behind other apps by default (the pin opts back into always-on-top)
const savePrefs = () => writeJSON('window.json', prefs);
prefs.pinned = false;
if (!prefs.v2) { prefs.v2 = true; app.whenReady().then(savePrefs); }

// ---------- auto start ----------
function loginOpts() {
  // In dev (npm start) Windows must launch electron.exe with this folder as the argument.
  return app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(__dirname)] };
}
function getAutoStart() {
  return app.getLoginItemSettings(loginOpts()).openAtLogin;
}
function setAutoStart(on) {
  app.setLoginItemSettings({ ...loginOpts(), openAtLogin: on });
  prefs.autoStart = on;
  prefs.autoStartExe = process.execPath;
  savePrefs();
  buildTrayMenu();
}

// ---------- icon (drawn in code so there are no binary assets) ----------
function appIcon(size) {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  return img.isEmpty() ? makeIcon(size) : img.resize({ width: size, height: size, quality: 'best' });
}

function makeIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      let r = 0, g = 0, b = 0, a = 0;
      if (d < c - 0.5) { r = 0xF4; g = 0xF1; b = 0xE8; a = 255; } // cream disc
      // two leaves: ellipses rotated ±40°
      const leaf = (cx, cy, ang) => {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const rx = dx * Math.cos(ang) + dy * Math.sin(ang);
        const ry = -dx * Math.sin(ang) + dy * Math.cos(ang);
        return (rx * rx) / ((size * 0.2) ** 2) + (ry * ry) / ((size * 0.11) ** 2) < 1;
      };
      const stem = Math.abs(x + 0.5 - c) < size * 0.045 && y > size * 0.45 && y < size * 0.8;
      if (leaf(c - size * 0.15, size * 0.42, 0.6) || leaf(c + size * 0.15, size * 0.38, -0.6) || stem) {
        r = 0x5D; g = 0xA2; b = 0x71; a = 255;
      }
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a; // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// ---------- window ----------
function workAreaFor(bounds) {
  return screen.getDisplayMatching(bounds).workArea;
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  fullHeight = Math.min(1180, wa.height - 96);

  let x = wa.x + wa.width - COLLAPSED_W - MARGIN + 10;
  let y = wa.y + 64;
  if (prefs.bounds) {
    // only restore if still on a connected screen
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return prefs.bounds.x >= a.x - 50 && prefs.bounds.x < a.x + a.width - 50 &&
             prefs.bounds.y >= a.y - 50 && prefs.bounds.y < a.y + a.height - 50;
    });
    if (onScreen) ({ x, y } = prefs.bounds);
    const a = screen.getDisplayMatching({ x, y, width: COLLAPSED_W, height: fullHeight }).workArea;
    y = Math.max(a.y, Math.min(y, a.y + a.height - fullHeight));
  }

  win = new BrowserWindow({
    x, y,
    width: COLLAPSED_W,
    height: fullHeight,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: false,
    show: false,
    icon: appIcon(256),
    title: 'Desknote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const createdWindow=win;
  createdWindow.on('closed',()=>{clearTimeout(moveTimer);if(win===createdWindow){desktopHelper?.kill();desktopHelper=null;win=null;rendererBaseline=null;expanded=false;mini=false;}});
  createdWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  createdWindow.once('ready-to-show', () => {
    if(createdWindow.isDestroyed()||app.isQuitting)return;
    createdWindow.showInactive();
    if (process.platform === 'win32' && (!process.env.DESKNOTE_TEST || process.env.DESKNOTE_NATIVE_TEST)) {
      const handle = createdWindow.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
      const python = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'pythonw.exe');
      try { fs.unlinkSync(userFile('desktop-command.json')); } catch {}
      try { fs.unlinkSync(userFile('desktop-host.json')); } catch {}
      desktopHelper = spawn(python, [path.join(__dirname,'desktop_host.py'), hwnd, userFile('desktop-host.json')], {windowsHide:true, stdio:'ignore'});
      desktopHelper.on('error', err => log('Desktop attachment failed:',err.message));
    }
  });
  createdWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  createdWindow.webContents.on('will-navigate', e => e.preventDefault());

  // If the bridge to the main process failed to load, reload instead of running without saving.
  let reloads = 0;
  createdWindow.webContents.on('preload-error', (_e, p, err) => log('preload error:', p, err && err.message));
  createdWindow.webContents.on('render-process-gone', (_e, d) => { log('renderer gone:', d.reason); if (!app.isQuitting&&!createdWindow.isDestroyed()) createdWindow.reload(); });
  createdWindow.webContents.on('did-finish-load', async () => {
    const ok = await createdWindow.webContents.executeJavaScript('!!window.nest').catch(() => false);
    if(createdWindow.isDestroyed()||app.isQuitting)return;
    if (!ok) {
      log('bridge missing after load, reload #' + (reloads + 1));
      if (reloads++ < 5) setTimeout(() => {if(!createdWindow.isDestroyed()&&!app.isQuitting)createdWindow.reload();}, 400 * reloads);
    }
  });
  createdWindow.on('session-end', () => log('windows session ending'));

  let moveTimer;
  createdWindow.on('moved', () => { clearTimeout(moveTimer); moveTimer=setTimeout(() => {
    if(createdWindow.isDestroyed()||win!==createdWindow||app.isQuitting)return;
    const b = getBounds();
    // always remember the position of the *collapsed* window
    const cx = expanded && expandSide === 'left' ? b.x + (EXPANDED_W - COLLAPSED_W) : b.x;
    prefs.bounds = { x: cx, y: b.y };
    savePrefs();
  },200); });

  createdWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); createdWindow.hide(); }
  });
}

function getBounds() {
  const native = readJSON('desktop-host.json', null);
  if(desktopHelper && native?.status === 'attached' && native.bounds) return native.bounds;
  return win.getBounds();
}
let desktopResize = Promise.resolve();
function setBounds(b) {
  if(desktopHelper && readJSON('desktop-host.json',{}).status === 'attached') {
    desktopResize = desktopResize.then(() => new Promise(resolve => {
      const id = Date.now() + '-' + Math.random().toString(36).slice(2);
      writeJSON('desktop-command.json',{id,bounds:b});
      const start=Date.now();
      const wait=()=>{
        if(readJSON('desktop-host.json',{}).commandId===id || Date.now()-start>1500) return resolve();
        setTimeout(wait,25);
      };
      wait();
    }));
    return desktopResize;
  }
  win.setResizable(true);
  win.setBounds(b);
  win.setResizable(false);
}

function showWindow() {
  if(app.isQuitting)return;
  if(!win||win.isDestroyed())createWindow();
  const target=win;
  target.showInactive();
  const restore=()=>{if(!target.isDestroyed()&&!app.isQuitting)target.webContents.send('win:restore');};
  if(target.webContents.isLoading())target.webContents.once('did-finish-load',restore);else restore();
}
function hideWindow(){if(win&&!win.isDestroyed())win.hide();}
function toggleShow() {
  if(app.isQuitting)return;
  if(win&&!win.isDestroyed()&&win.isVisible()&&win.isFocused())hideWindow();else showWindow();
}

// ---------- tray ----------
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Desknote', click: showWindow },
    { label: 'Hide', click: hideWindow },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: getAutoStart(), click: (m) => setAutoStart(m.checked) },
    { label: 'Scheduled reminders', type:'checkbox', checked:reminders.settings.enabled, click:m=>{reminders.configure({enabled:m.checked});buildTrayMenu();} },
    { label: 'Test notification', click:()=>reminders.test().catch(error=>log('Notification test:',error.message)) },
    { label: 'Midday/evening inbox reviews', type:'checkbox',checked:reviews.settings.enabled,click:m=>{reviews.configure({enabled:m.checked});buildTrayMenu();} },
    { label: 'Reset position', click: resetPosition },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function setPinned(on) {
  on = false; // This customization always belongs to the desktop background.
  prefs.pinned = on;
  savePrefs();
  win.setAlwaysOnTop(on);
  win.webContents.send('pinned-changed', on);
  buildTrayMenu();
}

function resetPosition() {
  if(app.isQuitting)return;
  if(!win||win.isDestroyed())showWindow();
  const wa = screen.getPrimaryDisplay().workArea;
  const w = getBounds().width;
  setBounds({ x: wa.x + wa.width - w - MARGIN + 10, y: wa.y + MARGIN, width: w, height: getBounds().height });
  expandSide = 'left';
  win.emit('moved');
  win.show();
}

// ---------- IPC ----------
ipcMain.handle('data:load', () => loadData());
ipcMain.on('data:save', (_e, data) => saveData(data));
ipcMain.on('data:save-sync', (e, data) => { e.returnValue = saveData(data); });
ipcMain.handle('data:command', (_event, request) => {
  try {
    const data=store.command(request);
    lastData=store.read();
    win.webContents.send('data:external-change');
    return {ok:true,data};
  } catch(error) { return {ok:false,error:error.message}; }
});
ipcMain.handle('agy:status', () => agyBridge.status());
ipcMain.handle('agy:history', () => agyBridge.history);
ipcMain.handle('agy:send', async (_event, message) => {
  try{
    const data=await agyBridge.send(message);
    lastData=store.read();win.webContents.send('data:external-change');
    return {ok:true,data};
  }catch(error){return {ok:false,error:error.message};}
});
ipcMain.on('agy:cancel',()=>agyBridge.cancel());
ipcMain.handle('agy:open-app',()=>{try{agyBridge.openApp();return {ok:true};}catch(error){return {ok:false,error:error.message};}});
ipcMain.on('app:open-data', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('notifications:status',()=>reminders.status());
ipcMain.handle('notifications:configure',(_event,fields)=>{try{const data=reminders.configure(fields);buildTrayMenu();return {ok:true,data};}catch(error){return {ok:false,error:error.message};}});
ipcMain.handle('notifications:test',async()=>{try{return {ok:true,data:await reminders.test()};}catch(error){return {ok:false,error:error.message};}});
ipcMain.handle('reviews:status',()=>reviews.status());
ipcMain.handle('reviews:configure',(_event,fields)=>{try{const data=reviews.configure(fields);buildTrayMenu();return {ok:true,data};}catch(error){return {ok:false,error:error.message};}});
ipcMain.handle('reviews:undo',()=>{try{return {ok:true,data:reviews.undoRoutineChanges()};}catch(error){return {ok:false,error:error.message};}});
ipcMain.handle('reviews:run',()=>{if(reviews.running||agyBridge.busy)return {ok:false,error:'AGY is busy.'};reviews.run('manual').catch(()=>{});return {ok:true};});

ipcMain.handle('win:expand-side', () => {
  const b = getBounds();
  const wa = workAreaFor(b);
  return b.x + EXPANDED_W <= wa.x + wa.width ? 'right' : 'left';
});

ipcMain.handle('win:set-expanded', async (_e, on) => {
  const b = getBounds();
  // update state *before* resizing so a 'moved' event during setBounds saves the right position
  if (on && !expanded) {
    const wa = workAreaFor(b);
    expandSide = b.x + EXPANDED_W <= wa.x + wa.width ? 'right' : 'left';
    expanded = true;
    const x = expandSide === 'left' ? b.x - (EXPANDED_W - COLLAPSED_W) : b.x;
    await setBounds({ x, y: b.y, width: EXPANDED_W, height: b.height });
  } else if (!on && expanded) {
    expanded = false;
    const x = expandSide === 'left' ? b.x + (EXPANDED_W - COLLAPSED_W) : b.x;
    await setBounds({ x, y: b.y, width: COLLAPSED_W, height: b.height });
  }
  return expandSide;
});

ipcMain.handle('win:set-mini', async (_e, on) => {
  mini = on;
  const b = getBounds();
  let y = b.y;
  if (!on) {
    // growing back to full height: keep it on screen
    const wa = workAreaFor(b);
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - fullHeight));
  }
  await setBounds({ x: b.x, y, width: b.width, height: on ? MINI_H : fullHeight });
  return mini;
});

ipcMain.on('win:hide', hideWindow);
ipcMain.handle('win:toggle-pin', () => { setPinned(!prefs.pinned); return prefs.pinned; });
ipcMain.handle('win:get-pin', () => !!prefs.pinned);
ipcMain.handle('app:get-autostart', () => getAutoStart());
ipcMain.handle('app:set-autostart', (_e, on) => { setAutoStart(on); return getAutoStart(); });
ipcMain.on('app:restart', () => { app.relaunch(); app.isQuitting=true; app.quit(); });
ipcMain.on('app:quit', () => { app.isQuitting = true; app.quit(); });

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { showWindow(); });

  app.whenReady().then(() => {
    app.setAppUserModelId('local.desknote');
    setupNotificationShortcut();

    log('start', app.getVersion(), app.isPackaged ? 'installed' : 'dev', process.execPath);
    try { lastData = store.ensure(); } catch(err) { log('Cannot load data:',err.message); }
    commandServer = net.createServer(socket => {
      socket.setEncoding('utf8');
      let buffer = '';
      socket.setTimeout(5000, () => socket.destroy());
      socket.on('error', err => log('CLI connection:',err.message));
      socket.on('data', async chunk => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) return socket.destroy();
        if (!buffer.includes('\n')) return;
        try {
          const req = JSON.parse(buffer.split('\n')[0]);
          let data;
          if (req.command === 'show') { showWindow(); data = {visible:true}; }
          else if (req.command === 'desktop') { data = readJSON('desktop-host.json',{status:'pending'}); }
          else if (req.command === 'restart') { data={restarting:true}; setTimeout(()=>{app.relaunch();app.isQuitting=true;app.quit();},150); }
          else if (req.command === 'reset-position') { resetPosition(); data={reset:true}; }
          else if (req.command === 'notifications') { data=reminders.status(); }
          else if (req.command === 'alarm.status') { data=alarm.status(); }
          else if (req.command === 'alarm.set') { data=alarm.set(req.fields?.minutes); }
          else if (req.command === 'alarm.follow') { data=alarm.follow(req.id); }
          else if (req.command === 'alarm.once') { data=alarm.once(req.fields?.at); }
          else if (req.command === 'alarm.stop') { data=alarm.stop(); }
          else if (req.command === 'notifications.test') { socket.setTimeout(15000);data=await reminders.test(); }
          else if (req.command === 'notifications.on'||req.command==='notifications.off') { data=reminders.configure({enabled:req.command.endsWith('.on')});buildTrayMenu(); }
          else if (req.command === 'notifications.sound-on'||req.command==='notifications.sound-off') { data=reminders.configure({sound:req.command.endsWith('sound-on')}); }
          else if (req.command === 'reviews.undo') { data=reviews.undoRoutineChanges(); }
          else if (req.command === 'reviews.status') { data=reviews.status(); }
          else if (req.command === 'reviews.preview') { socket.setTimeout(120000);data=await reviews.preview(); }
          else if (req.command === 'reviews.configure') { data=reviews.configure(req.fields||{});buildTrayMenu(); }
          else if (req.command === 'reviews.on'||req.command==='reviews.off') { data=reviews.configure({enabled:req.command.endsWith('.on')});buildTrayMenu(); }
          else if (req.command === 'reviews.run') { if(reviews.running||agyBridge.busy)throw Error('AGY is busy.');reviews.run('manual').catch(()=>{});data={started:true}; }
          else data = store.command(req);
          if (['add','update','delete','batch','routine.add','routine.update','routine.delete','routine.check','routine.override','routine.clear-override','event.add','event.update','event.delete'].includes(req.command)) {
            lastData = store.read();
            if(win&&!win.isDestroyed())win.webContents.send('data:external-change');
          }
          socket.end(JSON.stringify({ok:true,data})+'\n');
        } catch(err) { socket.end(JSON.stringify({ok:false,error:err.message})+'\n'); }
      });
    });
    commandServer.on('error', err => log('CLI server:',err.message));
    commandServer.listen(PIPE);

    // first launch: turn on "start with Windows" (can be switched off from the tray / menu)
    if (!prefs.autoStartInit && !process.env.DESKNOTE_TEST) {
      prefs.autoStartInit = true;
      setAutoStart(true);
    } else if (prefs.autoStart !== false && prefs.autoStartExe !== process.execPath && app.isPackaged) {
      // moved from the dev copy to the installed app: point start-up at this exe
      setAutoStart(true);
    }

    createWindow();

    tray = new Tray(appIcon(32));
    tray.setToolTip('Desknote · Alt+Shift+T');
    tray.on('click', showWindow);
    buildTrayMenu();
    if(!process.env.DESKNOTE_TEST){reminders.start();reviews.start();alarm.start();powerMonitor.on('resume',()=>{reminders.tick();reviews.tick();alarm.tick();});}

    globalShortcut.register('Alt+Shift+T', toggleShow);
  });

  app.on('before-quit', () => { app.isQuitting = true; reminders.stop();reviews.stop();alarm.close(); commandServer?.close(); desktopHelper?.kill(); agyBridge.cancel(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', (e) => e.preventDefault());
}
