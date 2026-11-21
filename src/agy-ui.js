(() => {
  let showing=false,busy=false;
  const panel=document.createElement('aside');panel.className='agy-panel';panel.id='agyPanel';
  panel.innerHTML=`<header class="agy-header"><div><h2>AGY</h2><p id="agyStatus">Checking connection…</p></div><button id="agyClose" aria-label="Close AGY">×</button></header><div class="agy-intro">Ask to add or edit tasks, routines and important dates.</div><div id="agyMessages" class="agy-messages" role="log" aria-live="polite"></div><p id="agyActivity" class="agy-activity"></p><form id="agyForm"><textarea id="agyInput" rows="3" maxlength="8000" placeholder="Example: remind me to exercise at 17:30 Monday through Friday" aria-label="Message AGY" required></textarea><div class="agy-actions"><button type="button" id="agyOpenApp">Open AGY app</button><button type="button" id="agyStop" hidden>Stop</button><button type="submit" id="agySend">Send</button></div></form>`;
  $('#panes').appendChild(panel);
  function addMessage(message){const node=document.createElement('div');node.className='agy-message '+message.role+(message.error?' error':'');const label=document.createElement('span');label.textContent=message.role==='user'?'You':'AGY';const text=document.createElement('p');text.textContent=message.text;node.append(label,text);if(message.changes){const changes=document.createElement('small');changes.textContent='Updated '+message.changes+' schedule items.';node.append(changes);}$('#agyMessages').appendChild(node);$('#agyMessages').scrollTop=$('#agyMessages').scrollHeight;}
  async function close(){
    if(!showing)return;showing=false;document.body.classList.remove('agy-open');$('#viewAgy').classList.remove('active');
    if(!openId){await api.setExpanded(false);document.body.classList.remove('expanded');}
  }
  window.closeDeskAgy=close;
  async function open(){
    if(showing)return close();
    if(mini)await $('#btnMini').onclick();
    await closeDetail();
    const side=await api.expandSide();document.body.classList.toggle('side-left',side==='left');
    await api.setExpanded(true);document.body.classList.add('expanded','agy-open');showing=true;$('#viewAgy').classList.add('active');
    const status=await api.agyStatus();$('#agyStatus').textContent=status.loggedIn?'Connected to AGY CLI':status.installed?'AGY is not connected · check the CLI':'AGY CLI not found';
    const history=await api.agyHistory();$('#agyMessages').innerHTML='';history.forEach(addMessage);$('#agyInput').focus();
  }
  $('#viewAgy').onclick=open;$('#agyClose').onclick=close;
  $('#agyOpenApp').onclick=async()=>{const result=await api.agyOpenApp();if(!result.ok)$('#agyActivity').textContent=result.error;};
  $('#agyStop').onclick=()=>api.agyCancel();
  $('#agyForm').onsubmit=async e=>{
    e.preventDefault();const input=$('#agyInput'),message=input.value.trim();if(!message||busy)return;
    // Preserve pending task edits before AGY takes its planner snapshot.
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;if(!api.saveSync(S))return toast('Could not save the task being edited.');}
    busy=true;$('#agySend').disabled=true;$('#agyStop').hidden=false;input.value='';addMessage({role:'user',text:message});$('#agyActivity').textContent='AGY is working…';
    try{const result=await api.agySend(message);if(!result.ok)throw Error(result.error);addMessage(result.data);lastTyped=0;await refreshExternal();$('#agyActivity').textContent='';}
    catch(error){addMessage({role:'assistant',text:error.message,error:true});$('#agyActivity').textContent='';}
    finally{busy=false;$('#agySend').disabled=false;$('#agyStop').hidden=true;}
  };
  $('#agyInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#agyForm').requestSubmit();}};
})();
