/* Shared data with app.js; all mutations go through the main-process store. */
(() => {
  const C=window.DeskSchedule;
  let selected=C.today(), month=selected.slice(0,7), showAll=false;
  const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const root=document.createElement('section');root.id='scheduleRoot';root.className='schedule-root';
  root.innerHTML=`
    <section class="routine-section" aria-labelledby="routineHeading">
      <div class="schedule-heading"><h2 id="routineHeading">Routines</h2><span id="routineSummary"></span><button id="manageRoutines" title="View and edit all routines">All</button><button id="addRoutine" aria-label="Add routine">+</button></div>
      <div id="routineToday" class="routine-today"></div>
    </section>
    <section class="desktop-calendar" aria-label="Calendar and important dates">
      <div class="schedule-heading calendar-heading"><button id="calendarMonth" title="Go to current month"></button><div class="calendar-nav"><button id="calendarToday">Today</button><button id="calendarPrev" aria-label="Previous month">‹</button><button id="calendarNext" aria-label="Next month">›</button></div></div>
      <div class="calendar-weekdays" aria-hidden="true">${['T2','T3','T4','T5','T6','T7','CN'].map(x=>`<span>${x}</span>`).join('')}</div>
      <div id="calendarGrid" class="calendar-grid" role="group" aria-label="Choose a date"></div>
      <div class="calendar-key"><span><i class="dot-task"></i>Work</span><span><i class="dot-routine"></i>Routines</span><span><i class="dot-important"></i>Important</span></div>
      <div class="schedule-heading day-heading"><h3 id="selectedDay"></h3><button id="scheduleAll">All dates</button><button id="addEvent" aria-label="Add event">+</button></div>
      <div id="calendarAgenda" class="calendar-agenda"></div>
      <div class="schedule-heading countdown-heading"><h3>Important dates</h3><button id="addMilestone">+ Add date</button></div>
      <div id="countdownList" class="countdown-list"></div>
    </section>
    <section id="scheduleEditor" class="schedule-editor" hidden aria-label="Edit schedule">
      <div class="editor-heading"><h2 id="editorTitle"></h2><button type="button" id="editorClose" aria-label="Close">×</button></div>
      <form id="scheduleForm">
        <label>Title<input id="sTitle" required maxlength="200" autocomplete="off"></label>
        <div id="eventFields"><label>Date<input id="sDate" type="date" min="1900-01-01" max="9999-12-31"></label></div>
        <div class="editor-two"><label>Start time<input id="sTime" type="time"></label><label>End time<input id="sEndTime" type="time"></label></div>
        <div id="routineFields">
          <fieldset><legend>Repeat on</legend><div class="weekday-options">${[1,2,3,4,5,6,0].map(n=>`<label><input type="checkbox" name="sDay" value="${n}"><span>${weekdays[n]}</span></label>`).join('')}</div></fieldset>
          <div class="day-presets"><button type="button" data-days="0,1,2,3,4,5,6">Every day</button><button type="button" data-days="1,2,3,4,5">Mon–Fri</button><button type="button" data-days="0,6">Weekends</button></div>
          <div class="editor-two"><label>Start date (optional)<input id="sStart" type="date"></label><label>End date (optional)<input id="sEnd" type="date"></label></div>
          <label class="editor-check"><input id="sEnabled" type="checkbox">Enabled</label>
        </div>
        <div id="eventRepeatFields"><label>Repeat<select id="sRepeat"><option value="none">Does not repeat</option><option value="yearly">Yearly</option></select></label><label class="editor-check"><input type="checkbox" id="sImportant">Important date · show countdown</label></div>
        <label class="editor-check"><input type="checkbox" id="sNotify">Notify at scheduled time</label>
        <label>Notes<textarea id="sNotes" rows="3"></textarea></label>
        <p id="scheduleError" role="alert"></p>
        <div class="editor-actions"><button type="button" id="scheduleDelete" class="danger">Delete schedule</button><button type="button" id="scheduleCancel">Cancel</button><button type="submit" id="scheduleSave">Save</button></div>
      </form>
      <div id="routineManager" hidden></div>
    </section>`;
  $('#addForm').insertAdjacentElement('afterend',root);
  const el=id=>document.getElementById(id);
  // View preferences are independent of planner data and background reminders.
  let layout={};try{layout=JSON.parse(localStorage.getItem('desknote-layout')||localStorage.getItem(['huy','desk','layout'].join('-'))||'{}');}catch{}
  const remember=()=>localStorage.setItem('desknote-layout',JSON.stringify(layout));
  const toolbar=document.createElement('div');toolbar.className='schedule-layout-bar';
  toolbar.innerHTML='<span>Your schedule</span><button id="focusTasks" aria-controls="scheduleRoot"></button>';
  root.before(toolbar);
  const current=document.createElement('section');current.id='currentSession';current.className='current-session';current.setAttribute('aria-label','Current activities');toolbar.before(current);
  const focusButton=el('focusTasks');
  function focusLayout(){root.hidden=!!layout.focus;focusButton.textContent=layout.focus?'Show schedule':'Tasks only';focusButton.setAttribute('aria-expanded',String(!layout.focus));}
  focusButton.onclick=()=>{layout.focus=!layout.focus;remember();focusLayout();};focusLayout();
  function fold(key,heading,children,defaultOpen){
    const container=document.createElement('div');container.className='schedule-fold';
    heading.before(container);container.append(heading);
    const body=document.createElement('div');body.id='fold-'+key;body.className='schedule-fold-body';children.forEach(node=>body.append(node));container.append(body);
    const button=document.createElement('button');button.className='fold-toggle';button.setAttribute('aria-controls',body.id);heading.prepend(button);
    const label=heading.querySelector('h2,h3')?.textContent||'Month calendar';
    function update(){const open=layout[key]??defaultOpen;body.hidden=!open;button.textContent=open?'−':'+';button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',(open?'Collapse ':'Open ')+label);}
    button.onclick=()=>{layout[key]=!(layout[key]??defaultOpen);remember();update();};update();
  }
  fold('routines',root.querySelector('.routine-section .schedule-heading'),[el('routineToday')],true);
  fold('month',root.querySelector('.calendar-heading'),[root.querySelector('.calendar-weekdays'),el('calendarGrid'),root.querySelector('.calendar-key')],false);
  fold('agenda',root.querySelector('.day-heading'),[el('calendarAgenda')],false);
  fold('countdowns',root.querySelector('.countdown-heading'),[el('countdownList')],true);
  function routineLabel(r){
    const days=r.days.length===7?'Every day':r.days.map(d=>weekdays[d]).join(', ');
    return [days,r.startDate?'from '+r.startDate:'',r.endDate?'until '+r.endDate:'',r.enabled===false?'Paused':''].filter(Boolean).join(' · ');
  }
  function row(item,date=selected,detailed=showAll){
    const check=item.kind!=='event'?`<button class="schedule-check ${item.done?'on':''}" data-check="${item.kind}" data-id="${esc(item.sourceId)}" data-date="${date}" aria-label="${item.done?'Mark incomplete':'Mark complete'} ${esc(item.title)}" aria-pressed="${!!item.done}">${item.done?'✓':''}</button>`:'<span class="event-mark"></span>';
    return `<div class="schedule-row ${item.done?'is-done':''}" data-kind="${item.kind}" data-id="${esc(item.sourceId)}">${check}<span class="schedule-time">${esc(item.time||'All day')}${item.endTime?`<small>&ndash;${esc(item.endTime)}</small>`:''}</span><button class="schedule-entry" data-open="${item.kind}" data-id="${esc(item.sourceId)}"><span>${esc(item.title)}${item.adjusted?`<small title="${esc(item.adjustmentReason)}">Adjusted</small>`:""}</span>${detailed?`<small>${item.kind==='routine'?esc(routineLabel(item)):C.dayLabel(item.date)+(item.kind==='task'?' · Work':item.important?' · Important':' · Event')}</small>`:''}</button>${item.important?'<span class="important-mark" title="Important dates">•</span>':''}</div>`;
  }
  function render(){
    if(!S)return;
    C.normalize(S);
    const today=C.today();
    const now=Date.now(),active=C.currentSessions(S,now);
    const next=C.occurrences(S,today,C.addDays(today,1),{includeDone:false}).find(item=>item.time&&C.sessionBounds(item).start>now);
    current.innerHTML='<h2>Now</h2>'+(active.length?active.map(item=>row(item,item.date,false)).join(''):'<p class="schedule-empty">No active sessions.</p>')+(next?'<h3>Up next</h3>'+row(next,next.date,false):'');
    const routines=C.occurrences(S,today).filter(x=>x.kind==='routine');
    el('routineSummary').textContent=routines.length?`${routines.filter(x=>x.done).length}/${routines.length}`:'';
    el('routineToday').innerHTML=routines.length?routines.map(r=>row(r,today,false)).join(''):'<p class="schedule-empty">No routines today. Click + to add sleep, study, meal or exercise times.</p>';
    const first=month+'-01';
    const from=C.addDays(first,-((C.weekday(first)+6)%7));
    const entries=C.occurrences(S,from,C.addDays(from,41));
    const byDate=new Map();for(const item of entries){if(!byDate.has(item.date))byDate.set(item.date,[]);byDate.get(item.date).push(item);}
    el('calendarMonth').textContent=new Date(first+'T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    el('calendarGrid').innerHTML=Array.from({length:42},(_,i)=>{
      const date=C.addDays(from,i),items=byDate.get(date)||[];
      const important=items.some(x=>x.important);
      const types=[items.some(x=>x.kind==='task')?'task':null,items.some(x=>x.kind==='routine')?'routine':null,items.some(x=>x.kind==='event')||important?'important':null].filter(Boolean);
      return `<button class="calendar-day ${date.slice(0,7)!==month?'other-month':''} ${date===today?'is-today':''} ${date===selected?'is-selected':''} ${important?'is-important':''}" data-date="${date}" aria-label="${date}, ${items.length} items${important?', important date':''}" aria-pressed="${date===selected}" ${date===today?'aria-current="date"':''} title="${esc(C.dayLabel(date)+(items.length?' · '+items.map(x=>x.title).join(', '):''))}"><span>${Number(date.slice(8))}</span><span class="calendar-dots">${types.map(t=>`<i class="dot-${t}"></i>`).join('')}</span></button>`;
    }).join('');
    el('selectedDay').textContent=showAll?'Full schedule':C.dayLabel(selected);
    el('scheduleAll').textContent=showAll?'Selected day':'All dates';
    if(showAll){
      const dated=C.allEntries(S);
      el('calendarAgenda').innerHTML=(dated.length?dated.map(x=>row(x,x.date)).join(''):'<p class="schedule-empty">No dated items yet.</p>')+(S.routines.length?'<p class="schedule-subhead">Weekly routines</p>'+S.routines.map(r=>row({...r,kind:'routine',sourceId:r.id},'')).join(''):'');
    }else{
      const day=C.occurrences(S,selected);
      el('calendarAgenda').innerHTML=day.length?day.map(x=>row(x)).join(''):'<p class="schedule-empty">Nothing scheduled for this day. Click + to add an item.</p>';
    }
    const milestones=C.milestones(S);
    el('countdownList').innerHTML=milestones.length?milestones.map(m=>`<button class="countdown-item" data-open="${m.kind}" data-id="${esc(m.sourceId)}"><span><strong>${esc(m.title)}</strong><small>${C.dayLabel(m.date)}${m.time?' · '+m.time:''}</small></span><span class="countdown-number">${m.remaining===0?'Today':m.remaining===1?'Tomorrow':m.remaining+' days'}</span></button>`).join(''):'<p class="schedule-empty">Add birthdays, exams or dates to remember.</p>';
  }
  window.scheduleChanged=render;
  api.onNotificationOpen?.(item=>{if(C.validDate(item.date)){selected=item.date;month=selected.slice(0,7);showAll=false;render();}});
  async function mutate(request){
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;if(!api.saveSync(S))throw Error('Could not save the task being edited.');}
    const result=await api.command(request);
    if(!result.ok)throw Error(result.error);
    lastTyped=0;await refreshExternal();
    return result.data;
  }
  let editing=null;
  function closeEditor(){el('scheduleEditor').hidden=true;editing=null;el('scheduleError').textContent='';}
  function edit(kind,id='',important=false){
    const item=(kind==='routine'?S.routines:S.events).find(x=>x.id===id)||{};
    editing={kind,id};el('scheduleEditor').hidden=false;el('routineManager').hidden=true;el('scheduleForm').hidden=false;
    el('editorTitle').textContent=(id?'Edit ':'Add ')+(kind==='routine'?'routine':'event');
    el('sTitle').value=item.title||'';el('sDate').value=item.date||selected;
    el('sTime').value=item.time||'';el('sTime').required=kind==='routine';el('sEndTime').value=item.endTime||'';
    el('sDate').required=kind==='event';
    el('sStart').value=item.startDate||'';el('sEnd').value=item.endDate||'';
    el('sNotes').value=item.notes||'';el('sEnabled').checked=item.enabled!==false;
    el('sNotify').checked=item.notify!==false;
    el('sRepeat').value=item.repeat||'none';el('sImportant').checked=item.important??important;
    document.querySelectorAll('[name="sDay"]').forEach(box=>box.checked=(item.days||[0,1,2,3,4,5,6]).includes(Number(box.value)));
    el('routineFields').hidden=kind!=='routine';el('eventFields').hidden=kind!=='event';el('eventRepeatFields').hidden=kind!=='event';
    el('scheduleDelete').hidden=!id;el('scheduleError').textContent='';
    el('sTitle').focus();
  }
  el('scheduleForm').onsubmit=async e=>{
    e.preventDefault();if(!editing)return;
    const {kind,id}=editing;
    const fields={title:el('sTitle').value.trim(),time:el('sTime').value,endTime:el('sEndTime').value,notes:el('sNotes').value,notify:el('sNotify').checked};
    if(kind==='routine')Object.assign(fields,{days:[...document.querySelectorAll('[name="sDay"]:checked')].map(x=>Number(x.value)),startDate:el('sStart').value,endDate:el('sEnd').value,enabled:el('sEnabled').checked});
    else Object.assign(fields,{date:el('sDate').value,repeat:el('sRepeat').value,important:el('sImportant').checked});
    el('scheduleSave').disabled=true;
    try{await mutate({command:kind+(id?'.update':'.add'),id,fields});closeEditor();}
    catch(error){el('scheduleError').textContent=error.message;}
    finally{el('scheduleSave').disabled=false;}
  };
  el('scheduleDelete').onclick=async()=>{
    if(!editing?.id)return;
    try{await mutate({command:editing.kind+'.delete',id:editing.id});closeEditor();}catch(error){el('scheduleError').textContent=error.message;}
  };
  el('editorClose').onclick=el('scheduleCancel').onclick=closeEditor;
  el('addRoutine').onclick=()=>edit('routine');el('addEvent').onclick=()=>edit('event');el('addMilestone').onclick=()=>edit('event','',true);
  el('manageRoutines').onclick=()=>{
    el('scheduleEditor').hidden=false;el('scheduleForm').hidden=true;el('routineManager').hidden=false;el('editorTitle').textContent='Routines';
    el('routineManager').innerHTML=S.routines.length?S.routines.map(r=>`<button class="routine-manage-item" data-open="routine" data-id="${esc(r.id)}"><strong>${esc(r.time)} · ${esc(r.title)}</strong><small>${esc(routineLabel(r))}</small></button>`).join(''):'<p class="schedule-empty">No routines yet. Click + in Routines to add one.</p>';
  };
  document.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>{const days=button.dataset.days.split(',');document.querySelectorAll('[name="sDay"]').forEach(box=>box.checked=days.includes(box.value));});
  el('calendarGrid').onclick=e=>{
    const button=e.target.closest('[data-date]');if(!button)return;
    layout.agenda=true;remember();const agendaToggle=root.querySelector('[aria-controls="fold-agenda"]');if(agendaToggle.getAttribute('aria-expanded')==='false'){layout.agenda=false;agendaToggle.click();}
    selected=button.dataset.date;month=selected.slice(0,7);showAll=false;render();
  };
  el('calendarGrid').onkeydown=e=>{
    const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!moves[e.key])return;
    e.preventDefault();selected=C.addDays(e.target.closest('[data-date]')?.dataset.date||selected,moves[e.key]);month=selected.slice(0,7);showAll=false;render();el('calendarGrid').querySelector(`[data-date="${selected}"]`).focus();
  };
  function moveMonth(n){const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+n);month=C.iso(d).slice(0,7);render();}
  el('calendarPrev').onclick=()=>moveMonth(-1);el('calendarNext').onclick=()=>moveMonth(1);
  el('calendarToday').onclick=el('calendarMonth').onclick=()=>{selected=C.today();month=selected.slice(0,7);showAll=false;render();};
  el('scheduleAll').onclick=()=>{showAll=!showAll;render();};
  async function handleEntryClick(e){
    const check=e.target.closest('[data-check]');
    if(check){
      try{
        const id=check.dataset.id,date=check.dataset.date;
        if(check.dataset.check==='routine'){
          if(!date)return edit('routine',id);
          const done=S.routineChecks.some(c=>c.routineId===id&&c.date===date&&c.done);
          await mutate({command:'routine.check',id,date,done:!done});
        }else{const task=S.tasks.find(t=>t.id===id);await mutate({command:'update',id,fields:{status:task.done?'todo':'done'}});}
      }catch(error){toast(error.message);}
      return;
    }
    const button=e.target.closest('[data-open]');if(!button)return;
    if(button.dataset.open==='task')openDetail(button.dataset.id);else edit(button.dataset.open,button.dataset.id);
  }
  root.addEventListener('click',handleEntryClick);current.addEventListener('click',handleEntryClick);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('scheduleEditor').hidden){e.stopPropagation();closeEditor();}},true);
  setInterval(render,10000);
  render();
})();
