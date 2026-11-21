(() => {
  const bar=document.createElement('div');bar.className='review-bar';bar.innerHTML='<button id="openReviews">Inbox review 13:40 · 21:00</button><span id="reviewBrief">Not run yet</span>';
  $('.desk-footer').before(bar);
  const panel=document.createElement('section');panel.className='review-panel';panel.hidden=true;
  panel.innerHTML='<header class="editor-heading"><h2>Review inbox and plan work</h2><button id="closeReviews" aria-label="Close">×</button></header><p class="review-explainer">AGY reads new messages through read-only MCP adapters, applies configured Zalo exclusions, then updates tasks and plans work around your schedule.</p><label class="review-switch"><input type="checkbox" id="reviewsEnabled">Run automatically each day</label><label class="review-switch"><input type="checkbox" id="reviewProactive">Check every 30 minutes (up to 6 extra AGY runs per day)</label><label class="review-switch"><input type="checkbox" id="reviewAdapt">Allow AGY to adjust daily routines</label><div class="review-times"><label>Midday<input type="time" id="reviewMidday"></label><label>Evening<input type="time" id="reviewEvening"></label></div><div class="review-actions"><button id="saveReviews">Save review times</button><button id="runReviewNow">Review now</button></div><button id="undoReviewRoutines">Undo latest routine adjustments</button><p id="reviewDetails" role="status"></p><pre id="reviewSummary"></pre>';
  $('.card').appendChild(panel);
  async function render(){
    const result=await api.getReviews();
    $('#openReviews').textContent='Inbox review '+result.settings.midday+' · '+result.settings.evening;
    const last=result.lastRun;
    $('#reviewBrief').textContent=result.running?'Reviewing…':!result.settings.enabled?'Disabled':last?({done:'Updated',partial:'Partial coverage',failed:'Needs attention',interrupted:'Interrupted'}[last.status]||'Reviewing…'):'Not run yet';
    $('#reviewsEnabled').checked=result.settings.enabled;$('#reviewMidday').value=result.settings.midday;$('#reviewEvening').value=result.settings.evening;
    $('#reviewProactive').checked=result.settings.proactive;$('#reviewAdapt').checked=result.settings.adaptRoutines;$('#undoReviewRoutines').disabled=result.running||!result.canUndo;
    $('#runReviewNow').disabled=result.running;
    $('#reviewDetails').textContent=last?new Date(last.startedAt).toLocaleString('en-GB')+' · '+(last.changes||0)+' items updated':'The PC must be awake and the app running. The first review covers up to 24 hours; later reviews process messages not covered by earlier runs.';
    $('#reviewSummary').textContent=last?.summary||'Messages are treated as data. Reviews never send messages, delete tasks or mark them complete.';
  }
  $('#openReviews').onclick=()=>{panel.hidden=false;render();};$('#closeReviews').onclick=()=>panel.hidden=true;
  $('#saveReviews').onclick=async()=>{const result=await api.configureReviews({enabled:$('#reviewsEnabled').checked,proactive:$('#reviewProactive').checked,adaptRoutines:$('#reviewAdapt').checked,midday:$('#reviewMidday').value,evening:$('#reviewEvening').value});if(!result.ok)toast(result.error);else{toast('Review schedule saved');render();}};
  $('#runReviewNow').onclick=async()=>{const result=await api.runReview();if(!result.ok)toast(result.error);render();};
  $('#undoReviewRoutines').onclick=async()=>{const r=await api.undoReviewRoutines();toast(r.ok?'Routine adjustments undone':r.error);render();};
  api.onReviewUpdated(render);render();
})();
