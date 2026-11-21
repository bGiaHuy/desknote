const {ipcRenderer}=require('electron');
window.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('stop').onclick=()=>ipcRenderer.send('alarm:stop');
  document.getElementById('desk').onclick=()=>ipcRenderer.send('alarm:desk');
});
