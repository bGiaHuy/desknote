(() => {
  const bar=document.createElement('div');bar.className='review-bar';bar.innerHTML='<button id="openReviews">Rà tin 13:40 · 21:00</button><span id="reviewBrief">Chưa chạy</span>';
  $('.desk-footer').before(bar);
  const panel=document.createElement('section');panel.className='review-panel';panel.hidden=true;
  panel.innerHTML='<header class="editor-heading"><h2>Rà tin và xếp việc</h2><button id="closeReviews" aria-label="Đóng">×</button></header><p class="review-explainer">AGY đọc tin mới qua MCP chỉ đọc, bỏ hai nhóm mã giảm giá Zalo, rồi cập nhật công việc và xếp giờ làm quanh lịch đã có.</p><label class="review-switch"><input type="checkbox" id="reviewsEnabled">Tự chạy mỗi ngày</label><label class="review-switch"><input type="checkbox" id="reviewProactive">Rà tin chủ động mỗi 30 phút (tối đa 6 lượt AGY thêm/ngày)</label><label class="review-switch"><input type="checkbox" id="reviewAdapt">Cho AGY điều chỉnh sinh hoạt theo ngày</label><div class="review-times"><label>Giữa ngày<input type="time" id="reviewMidday"></label><label>Cuối ngày<input type="time" id="reviewEvening"></label></div><div class="review-actions"><button id="saveReviews">Lưu giờ rà tin</button><button id="runReviewNow">Rà tin ngay</button></div><button id="undoReviewRoutines">Hoàn tác sinh hoạt lượt gần nhất</button><p id="reviewDetails" role="status"></p><pre id="reviewSummary"></pre>';
  $('.card').appendChild(panel);
  async function render(){
    const result=await api.getReviews();
    $('#openReviews').textContent='Rà tin '+result.settings.midday+' · '+result.settings.evening;
    const last=result.lastRun;
    $('#reviewBrief').textContent=result.running?'Đang rà…':!result.settings.enabled?'Đã tắt':last?({done:'Đã cập nhật',partial:'Thiếu nguồn tin',failed:'Cần kiểm tra',interrupted:'Bị gián đoạn'}[last.status]||'Đang rà…'):'Chưa chạy';
    $('#reviewsEnabled').checked=result.settings.enabled;$('#reviewMidday').value=result.settings.midday;$('#reviewEvening').value=result.settings.evening;
    $('#reviewProactive').checked=result.settings.proactive;$('#reviewAdapt').checked=result.settings.adaptRoutines;$('#undoReviewRoutines').disabled=result.running||!result.canUndo;
    $('#runReviewNow').disabled=result.running;
    $('#reviewDetails').textContent=last?new Date(last.startedAt).toLocaleString('vi-VN')+' · '+(last.changes||0)+' mục cập nhật':'Máy cần thức và app đang chạy nền. Lần đầu đọc tối đa 24 giờ; sau đó chỉ xử lý tin chưa đọc trong lượt rà trước.';
    $('#reviewSummary').textContent=last?.summary||'Tin nhắn không được dùng làm lệnh điều khiển ứng dụng. Không tự gửi tin, xóa việc hoặc đánh dấu hoàn thành.';
  }
  $('#openReviews').onclick=()=>{panel.hidden=false;render();};$('#closeReviews').onclick=()=>panel.hidden=true;
  $('#saveReviews').onclick=async()=>{const result=await api.configureReviews({enabled:$('#reviewsEnabled').checked,proactive:$('#reviewProactive').checked,adaptRoutines:$('#reviewAdapt').checked,midday:$('#reviewMidday').value,evening:$('#reviewEvening').value});if(!result.ok)toast(result.error);else{toast('Đã lưu lịch rà tin');render();}};
  $('#runReviewNow').onclick=async()=>{const result=await api.runReview();if(!result.ok)toast(result.error);render();};
  $('#undoReviewRoutines').onclick=async()=>{const r=await api.undoReviewRoutines();toast(r.ok?'Đã hoàn tác sinh hoạt':r.error);render();};
  api.onReviewUpdated(render);render();
})();
