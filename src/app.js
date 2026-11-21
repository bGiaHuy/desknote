/* Task Nest — renderer */

// Browser fallback so the UI can be previewed outside Electron (never used inside the app).
const IN_APP = navigator.userAgent.includes('Electron');
const api = window.nest || (IN_APP ? null : {
  load: async () => { try { const d = JSON.parse(localStorage.getItem('tasknest')); return d ? { status: 'ok', data: d } : { status: 'empty' }; } catch { return { status: 'empty' }; } },
  save: (d) => localStorage.setItem('tasknest', JSON.stringify(d)),
  expandSide: async () => 'right',
  setExpanded: async () => 'right',
  setMini: async (on) => on,
  hide: () => {},
  togglePin: async () => false,
  getPin: async () => false,
  onPinChanged: () => {},
  getAutoStart: async () => false,
  setAutoStart: async (v) => v,
  quit: () => {},
  openData: () => {},
});

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

const EMOJIS = ['·'];
const TAG_COLORS = [
  ['#E7F0FC', '#3E7BD6'], ['#EFE9FB', '#7A5BC7'], ['#E6F2E8', '#4F9463'],
  ['#FCE8EE', '#C94F72'], ['#FBF0DC', '#B87718'], ['#E4F4F4', '#2E8F8F'],
];
const PRIORITY = {
  high: { label: 'Cao', color: '#d49b9c' },
  medium: { label: 'Vừa', color: '#cfbc89' },
  low: { label: 'Thấp', color: '#abc4ce' },
  none: { label: 'Không', color: '#C9C6BE' },
};

// ---------- state ----------
let S = null;
let openId = null;
let saveTimer = null;

function seed() { return {version:1,activeCat:'@all',categories:[{id:'work',name:'Công việc',icon:''},{id:'study',name:'Học tập',icon:''}],tasks:[]}; }

let canSave = false;
function persist() {
  if (!canSave || !S) return;
  clearTimeout(saveTimer);
  window.scheduleChanged?.();
  saveTimer = setTimeout(() => { saveTimer = null; if (api.saveSync && !api.saveSync(S)) toast('Không lưu được. Giữ ứng dụng mở và thử lại.'); else if (!api.saveSync) api.save(S); }, 250);
}
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); if (S && canSave) (api.saveSync || api.save)(S); });

const cat = (id) => S.categories.find((c) => c.id === id);
const task = (id) => S.tasks.find((t) => t.id === id);
let agendaView = false;
const catTasks = () => S.tasks.filter(t => (S.activeCat === '@all' || t.catId === S.activeCat) && (!agendaView || t.date));

// ---------- formatting ----------
function fmtTime(hhmm) { return hhmm || ''; }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const md = d.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' });
  if (diff === 0) return `Hôm nay, ${md}`;
  if (diff === 1) return `Ngày mai, ${md}`;
  if (diff === -1) return `Hôm qua, ${md}`;
  return d.toLocaleDateString('vi-VN', { weekday: 'short', month: 'short', day: 'numeric' });
}
function tagColor(name) {
  let h = 0; for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// Pull a time like "5pm", "at 9:30am" or "17:00" off the end of a quick-add title.
function parseQuickAdd(text) {
  let title = text.trim(), time = '', priority = 'none';
  const pr = title.match(/\s!(high|med|medium|low)\b/i);
  if (pr) { priority = { high: 'high', med: 'medium', medium: 'medium', low: 'low' }[pr[1].toLowerCase()]; title = title.replace(pr[0], ''); }
  const m = title.match(/\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i) || title.match(/\s+(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\s*$/);
  if (m) {
    let h = +m[1]; const min = m[2] ? +m[2] : 0; const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h < 24 && min < 60) { time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`; title = title.slice(0, m.index); }
  }
  return { title: title.trim() || text.trim(), time, priority };
}

// ---------- header / greeting ----------
function renderGreeting() {
  $('#greeting').textContent = agendaView ? 'Lịch làm việc' : 'Việc cần làm';
  $('#deskDate').textContent = new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});
}

function renderStats(celebrate = false) {
  const list = catTasks();
  const done = list.filter((t) => t.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  $('#todaySub').textContent = list.length ? `${list.length - done} việc còn lại · ${done} hoàn thành` : 'Chưa có công việc';
  $('#progressFill').style.width = pct + '%';
  $('#progressPct').textContent = pct + '%';

  // tab counters
  document.querySelectorAll('.tab[data-id]').forEach((el) => {
    const n = S.tasks.filter((t) => (el.dataset.id === '@all' || t.catId === el.dataset.id) && !t.done).length;
    const c = el.querySelector('.count'); if (c) c.textContent = n || '';
  });
  const open = S.tasks.filter((t) => !t.done).length;
  $('#miniCount').textContent = open ? `· ${open}` : '· xong';
}

function renderFooter() {}
function floatHearts() {}

// ---------- tabs ----------
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = [{id:'@all',name:'Tất cả',icon:''},...S.categories].map((c) => `
    <button class="tab ${c.id === S.activeCat ? 'active' : ''}" data-id="${c.id}" draggable="${c.id !== '@all'}" title="Chọn danh sách">
      <span class="emoji">${esc(c.icon)}</span><span class="name">${esc(c.name)}</span><span class="count"></span>
    </button>`).join('') + `<button class="tab add" id="addCat" title="New category">+</button>`;

  nav.querySelectorAll('.tab[data-id]').forEach((el) => {
    el.onclick = () => selectCat(el.dataset.id);
    el.ondblclick = () => { if(el.dataset.id !== '@all') renameCat(el.dataset.id); };
    el.oncontextmenu = (e) => { e.preventDefault(); if(el.dataset.id !== '@all') catMenu(el.dataset.id, el); };
  });
  $('#addCat').onclick = addCat;
  nav.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// ----- reorder lists: drag a tab, or use the right-click menu -----
function moveCat(id, toIndex) {
  const from = S.categories.findIndex((c) => c.id === id);
  if (from < 0) return;
  toIndex = Math.max(0, Math.min(S.categories.length - 1, toIndex));
  if (from === toIndex) return;
  const before = new Map([...document.querySelectorAll('.tab[data-id]')].map((el) => [el.dataset.id, el.getBoundingClientRect().left]));
  const [c] = S.categories.splice(from, 1);
  S.categories.splice(toIndex, 0, c);
  persist();
  renderTabs();
  renderStats();
  // glide tabs into their new spots
  document.querySelectorAll('.tab[data-id]').forEach((el) => {
    const dx = (before.get(el.dataset.id) ?? 0) - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

let dragCat = null;
const tabsNav = $('#tabs');
const clearDropMarks = () => tabsNav.querySelectorAll('.tab').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
tabsNav.addEventListener('dragstart', (e) => {
  const el = e.target.closest('.tab[data-id]'); if (!el) return;
  dragCat = el.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragCat);
  requestAnimationFrame(() => el.classList.add('dragging'));
});
tabsNav.addEventListener('dragover', (e) => {
  if (!dragCat) return;
  e.preventDefault();
  const el = e.target.closest('.tab[data-id]');
  tabsNav.querySelectorAll('.tab').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
  if (!el || el.dataset.id === dragCat) return;
  const r = el.getBoundingClientRect();
  el.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
  // auto-scroll when dragging near the edges
  const nr = tabsNav.getBoundingClientRect();
  if (e.clientX < nr.left + 30) tabsNav.scrollLeft -= 8;
  if (e.clientX > nr.right - 30) tabsNav.scrollLeft += 8;
});
tabsNav.addEventListener('drop', (e) => {
  if (!dragCat) return;
  e.preventDefault();
  const el = e.target.closest('.tab[data-id]');
  const id = dragCat;
  clearDropMarks();
  dragCat = null;
  if (!el || el.dataset.id === id) return;
  const r = el.getBoundingClientRect();
  const after = e.clientX >= r.left + r.width / 2;
  const without = S.categories.filter((c) => c.id !== id);
  let to = without.findIndex((c) => c.id === el.dataset.id) + (after ? 1 : 0);
  moveCat(id, to);
});
tabsNav.addEventListener('dragend', () => { dragCat = null; clearDropMarks(); });

function selectCat(id) {
  if (S.activeCat === id) return;
  S.activeCat = id;
  persist();
  closeDetail();
  renderTabs();
  renderList();
  renderStats();
}

function addCat() {
  const c = { id: uid(), name: 'Danh sách mới', icon: EMOJIS[(S.categories.length + 4) % EMOJIS.length] };
  S.categories.push(c);
  S.activeCat = c.id;
  persist();
  renderTabs(); renderList(); renderStats();
  renameCat(c.id);
}

function renameCat(id) {
  const el = document.querySelector(`.tab[data-id="${id}"] .name`);
  if (!el) return;
  const c = cat(id);
  const input = document.createElement('input');
  input.value = c.name;
  el.replaceWith(input);
  input.focus(); input.select();
  const finish = (ok) => {
    if (ok && input.value.trim()) c.name = input.value.trim();
    persist(); renderTabs(); renderStats();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.onblur = null; finish(false); } };
  input.onblur = () => finish(true);
  input.onclick = (e) => e.stopPropagation();
}

function catMenu(id, anchor) {
  const c = cat(id);
  showMenu(anchor, [
    { icon: '✏️', label: 'Rename', onClick: () => renameCat(id) },
    { icon: '⬅️', label: 'Move left', disabled: S.categories[0].id === id, onClick: () => moveCat(id, S.categories.findIndex((x) => x.id === id) - 1) },
    { icon: '➡️', label: 'Move right', disabled: S.categories[S.categories.length - 1].id === id, onClick: () => moveCat(id, S.categories.findIndex((x) => x.id === id) + 1) },
    { custom: () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="menu-label">Icon</div><div class="emoji-grid">${EMOJIS.map((e) => `<button>${e}</button>`).join('')}</div>`;
      wrap.querySelectorAll('.emoji-grid button').forEach((b) => b.onclick = () => { c.icon = b.textContent; persist(); renderTabs(); renderStats(); closeMenu(); });
      return wrap;
    } },
    { sep: true },
    { icon: '🗑️', label: 'Delete list', danger: true, disabled: S.categories.length <= 1, onClick: () => deleteCat(id) },
  ]);
}

function deleteCat(id) {
  if (S.categories.length <= 1) return;
  const idx = S.categories.findIndex((c) => c.id === id);
  const removedCat = S.categories[idx];
  const removedTasks = S.tasks.filter((t) => t.catId === id);
  S.categories.splice(idx, 1);
  S.tasks = S.tasks.filter((t) => t.catId !== id);
  if (S.activeCat === id) S.activeCat = S.categories[Math.max(0, idx - 1)].id;
  closeDetail();
  persist(); renderTabs(); renderList(); renderStats();
  toast(`Deleted “${removedCat.name}”`, () => {
    S.categories.splice(idx, 0, removedCat);
    S.tasks.push(...removedTasks);
    S.activeCat = removedCat.id;
    persist(); renderTabs(); renderList(); renderStats();
  });
}

// ---------- task list ----------
const ICON_SUB = '<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>';
const ICON_NOTE = '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const STATUS = {
  todo: { label: 'Cần làm' },
  progress: { label: 'Đang làm' },
  done: { label: 'Đã xong' },
};
const STATUS_RANK = { todo: 0, progress: 1 };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 };

function setStatus(t, s) {
  if (t.status === s) return;
  t.status = s;
  t.done = s === 'done';
  t.doneAt = t.done ? Date.now() : null;
}

function statusPill(s, extra = '') {
  return `<button class="status-pill st-${s} ${extra}"><span class="sdot"></span>${STATUS[s].label}</button>`;
}

function statusMenu(anchor, t, after) {
  showMenu(anchor, ['todo', 'progress', 'done'].map((s) => ({
    icon: `<span class="status-pill st-${s} mini"><span class="sdot"></span></span>`,
    label: STATUS[s].label, checked: t.status === s,
    onClick: () => {
      const wasDone = t.status === 'done';
      setStatus(t, s);
      persist();
      after?.(s, wasDone);
    },
  })));
}

function taskRow(t, i, still = false) {
  const subsDone = t.subtasks.filter((s) => s.done).length;
  const meta = [];
  if(t.plannedDate)meta.push(`<span class="mi">Dự kiến ${esc(fmtDate(t.plannedDate))}${t.plannedTime?' · '+esc(t.plannedTime):''}</span>`);
  if(t.time || t.date) {
    const overdue = t.date && new Date(t.date + 'T' + (t.time || '23:59')) < new Date() && !t.done;
    const label = [t.date ? fmtDate(t.date) : '',t.time].filter(Boolean).join(' · ');
    meta.push(`<span class="mi t-clock ${overdue ? 'overdue' : ''}">${esc(label)}</span>`);
  }
  if(t.status === 'progress') meta.push('<span class="mi">Đang làm</span>');
  if (t.priority && t.priority !== 'none') meta.push(`<span class="mi"><span class="pdot" style="background:${PRIORITY[t.priority].color}"></span>${PRIORITY[t.priority].label}</span>`);
  if (t.subtasks.length) meta.push(`<span class="mi">${ICON_SUB}${subsDone}/${t.subtasks.length}</span>`);
  if (t.notes || t.desc) meta.push(`<span class="mi">${ICON_NOTE}</span>`);

  return `
    <li class="task ${t.status === 'done' ? 'done' : ''} ${t.id === openId ? 'selected' : ''} ${still ? 'still' : ''}" data-id="${t.id}" style="--i:${i}">
      <button class="check" title="Complete">${ICON_CHECK}</button>
      <div class="t-main">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">${meta.join('')}</div>
      </div>
      ${statusPill(t.status)}
      <button class="t-del" title="Delete">${ICON_X}</button>
    </li>`;
}

// To do first, then In progress; inside each, High → Medium → Low → none; then the order they were added.
function sortActive(list) {
  return list
    .filter((t) => t.status !== 'done')
    .map((t, i) => [t, i])
    .sort(([a, ai], [b, bi]) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      PRIORITY_RANK[a.priority || 'none'] - PRIORITY_RANK[b.priority || 'none'] ||
      ai - bi)
    .map(([t]) => t);
}

function rowPositions() {
  const m = new Map();
  document.querySelectorAll('#tasks .task').forEach((el) => m.set(el.dataset.id, el.getBoundingClientRect().top));
  return m;
}

// FLIP: rows glide from their old spot to their new one after a re-sort.
function glide(before) {
  document.querySelectorAll('#tasks .task').forEach((el) => {
    const top = before.get(el.dataset.id);
    if (top == null) { el.classList.remove('still'); return; }
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

function renderList({ animate = false } = {}) {
  const ul = $('#tasks');
  const all = catTasks();
  if (!all.length) {
    ul.innerHTML = `<li class="empty"><span class="big">🌱</span>Chưa có việc trong mục này.<br/>Thêm công việc ở bên dưới.</li>`;
    return;
  }
  const before = animate ? rowPositions() : null;
  const active = agendaView ? all.filter(t=>!t.done).sort((a,b)=>(a.date+(a.time||'99:99')).localeCompare(b.date+(b.time||'99:99'))) : sortActive(all);
  const done = all.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  let html = active.length
    ? active.map((t, i) => {
      const heading = agendaView && (!i || active[i-1].date !== t.date) ? `<li class="agenda-heading">${esc(fmtDate(t.date))}</li>` : '';
      return heading + taskRow(t, i, animate);
    }).join('')
    : `<li class="empty small"><span class="big">🌸</span>Đã hoàn thành mọi việc.</li>`;
  if (done.length) {
    html += `<li class="done-toggle ${S.showDone ? 'open' : ''}"><button id="doneToggle">
      <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>Đã hoàn thành<span class="n">${done.length}</span></button></li>`;
    if (S.showDone) html += done.map((t, i) => taskRow(t, i, animate)).join('');
  }
  ul.innerHTML = html;
  if (before) glide(before);
}

// Re-sort after a status change; a row that is about to be hidden fades out first.
let reflowTimer;
function reflow(id, delay = 0) {
  clearTimeout(reflowTimer);
  reflowTimer = setTimeout(() => {
    const t = task(id);
    const li = document.querySelector(`.task[data-id="${id}"]`);
    if (t && li && t.status === 'done' && !S.showDone) {
      li.style.height = li.offsetHeight + 'px';
      li.classList.add('leaving');
      setTimeout(() => renderList({ animate: true }), 260);
    } else renderList({ animate: true });
  }, delay);
}

function updateRow(id) {
  const t = task(id);
  const li = document.querySelector(`.task[data-id="${id}"]`);
  if (!t || !li) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = taskRow(t, 0, true).trim();
  li.replaceWith(tmp.firstChild);
}

$('#tasks').addEventListener('click', (e) => {
  if (e.target.closest('#doneToggle')) {
    S.showDone = !S.showDone;
    persist();
    return renderList({ animate: true });
  }
  const li = e.target.closest('.task');
  if (!li) return;
  const id = li.dataset.id;
  if (e.target.closest('.check')) return toggleTask(id, li);
  if (e.target.closest('.t-del')) return deleteTask(id);
  if (e.target.closest('.status-pill')) {
    return statusMenu(e.target.closest('.status-pill'), task(id), (s, wasDone) => afterStatusChange(id, s, wasDone));
  }
  openId === id ? closeDetail() : openDetail(id);
});
$('#tasks').addEventListener('contextmenu', (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  e.preventDefault();
  taskMenu(li.dataset.id, { x: e.clientX, y: e.clientY });
});

function afterStatusChange(id, s, wasDone) {
  const li = document.querySelector(`.task[data-id="${id}"]`);
  if (li) {
    updateRow(id);
    if (s === 'done' && !wasDone) {
      const chk = document.querySelector(`.task[data-id="${id}"] .check`);
      chk.classList.add('pop'); burst(chk);
    }
  }
  if (openId === id) renderStatus();
  renderStats(s === 'done' && !wasDone);
  reflow(id, s === 'done' ? 650 : 150);
}

function toggleTask(id, li) {
  const t = task(id);
  setStatus(t, t.status === 'done' ? 'todo' : 'done');
  persist();
  li = li || document.querySelector(`.task[data-id="${id}"]`);
  if (li) {
    li.classList.toggle('done', t.done);
    const chk = li.querySelector('.check');
    chk.classList.remove('pop'); void chk.offsetWidth; chk.classList.add('pop');
    if (t.done) burst(chk);
    const pill = li.querySelector('.status-pill');
    pill.outerHTML = statusPill(t.status, 'swap');
  }
  if (openId === id) renderStatus();
  renderStats(t.done);
  reflow(id, t.done ? 650 : 200);
}

function burst(el) {
  const colors = ['#8CC79A', '#F2A7BB', '#F6C86B', '#9CC3F0', '#5DA271', '#C5A8F0'];
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('span');
    p.className = 'burst';
    p.style.setProperty('--a', `${i * 45 + Math.random() * 20}deg`);
    p.style.background = colors[i % colors.length];
    el.appendChild(p);
    setTimeout(() => p.remove(), 650);
  }
}

function addTask(text) {
  const { title, time, priority } = parseQuickAdd(text);
  const t = {
    id: uid(), catId: S.activeCat === '@all' ? S.categories[0].id : S.activeCat, title, time, status: 'todo', done: false, date: todayISO(),
    desc: '', priority, tags: [], subtasks: [], notes: '', createdAt: Date.now(),
  };
  S.tasks.push(t);
  persist();
  renderList({ animate: true });
  document.querySelector(`.task[data-id="${t.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderStats();
}

function deleteTask(id) {
  const idx = S.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const [removed] = S.tasks.splice(idx, 1);
  persist();
  if (openId === id) closeDetail();
  const li = document.querySelector(`.task[data-id="${id}"]`);
  const after = () => { renderList({ animate: true }); renderStats(); };
  if (li) { li.style.height = li.offsetHeight + 'px'; li.classList.add('leaving'); setTimeout(after, 260); } else after();
  toast(`Deleted “${removed.title.slice(0, 28)}”`, () => {
    S.tasks.splice(idx, 0, removed);
    persist(); renderList({ animate: true }); renderStats();
  });
}

function taskMenu(id, anchor) {
  const t = task(id);
  const others = S.categories.filter((c) => c.id !== t.catId);
  const setTo = (s) => () => { const was = t.status === 'done'; setStatus(t, s); persist(); afterStatusChange(id, s, was); };
  showMenu(anchor, [
    { icon: '📄', label: 'Open details', onClick: () => openDetail(id) },
    { label: 'Status', header: true },
    ...['todo', 'progress', 'done'].map((s) => ({
      icon: `<span class="status-pill st-${s} mini"><span class="sdot"></span></span>`,
      label: STATUS[s].label, checked: t.status === s, onClick: setTo(s),
    })),
    { label: 'Priority', header: true },
    ...['high', 'medium', 'low', 'none'].map((p) => ({
      icon: `<span class="pdot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${PRIORITY[p].color}"></span>`,
      label: PRIORITY[p].label, checked: (t.priority || 'none') === p, onClick: () => setPriority(id, p),
    })),
    { sep: true },
    { icon: '📋', label: 'Duplicate', onClick: () => duplicateTask(id) },
    ...(others.length ? [{ sep: true }, { label: 'Move to', header: true }, ...others.map((c) => ({ icon: c.icon, label: c.name, onClick: () => moveTask(id, c.id) }))] : []),
    { sep: true },
    { icon: '🗑️', label: 'Delete', danger: true, onClick: () => deleteTask(id) },
  ]);
}

function duplicateTask(id) {
  const t = task(id);
  const copy = { ...structuredClone(t), id: uid(), title: t.title + ' (copy)', status: 'todo', done: false, doneAt: null, createdAt: Date.now() };
  copy.subtasks.forEach((s) => (s.id = uid()));
  S.tasks.splice(S.tasks.indexOf(t) + 1, 0, copy);
  persist(); renderList({ animate: true }); renderStats();
}

function moveTask(id, catId) {
  const t = task(id);
  t.catId = catId;
  persist();
  if (openId === id) closeDetail();
  renderList({ animate: true }); renderStats();
  toast(`Moved to ${cat(catId).icon} ${cat(catId).name}`);
}

$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#addInput');
  if (!input.value.trim()) return;
  addTask(input.value);
  input.value = '';
});

// ---------- detail panel ----------
let animating = Promise.resolve();

async function openDetail(id) {
  await window.closeDeskAgy?.();
  openId = id;
  document.querySelectorAll('.task').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  fillDetail();
  if (document.body.classList.contains('expanded')) {
    // already open: quick content swap
    const d = $('#detail'); d.style.opacity = '.4';
    requestAnimationFrame(() => { d.style.opacity = ''; });
    return;
  }
  await animating;
  animating = (async () => {
    const side = await api.expandSide();
    document.body.classList.toggle('side-left', side === 'left');
    await api.setExpanded(true);
    document.body.classList.add('expanded');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.body.classList.add('open');
    autosizeAll();
  })();
  await animating;
  const t = task(id);
  if (t && t.title === '') $('#dTitle').focus();
}

async function closeDetail() {
  if (!openId && !document.body.classList.contains('expanded')) return;
  openId = null;
  document.querySelectorAll('.task.selected').forEach((el) => el.classList.remove('selected'));
  await animating;
  animating = (async () => {
    document.body.classList.remove('open');
    await new Promise((r) => setTimeout(r, 200));
    if (openId) { document.body.classList.add('open'); return; } // reopened meanwhile
    document.body.classList.remove('expanded');
    await api.setExpanded(false);
  })();
  await animating;
}

function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
const autosizeAll = () => ['#dTitle', '#dDesc', '#dNotes'].forEach((s) => autosize($(s)));

function fillDetail() {
  const t = task(openId);
  if (!t) return;
  $('#dTitle').value = t.title;
  $('#dDesc').value = t.desc || '';
  $('#dNotes').value = t.notes || '';
  $('#dImportant').checked=!!t.important;
  $('#dNotify').checked=t.notify!==false;
  $('#dPlanDate').value=t.plannedDate||'';$('#dPlanTime').value=t.plannedTime||'';$('#dPlanMinutes').value=t.durationMinutes||45;
  requestAnimationFrame(autosizeAll);
  renderStatus();
  renderDateTime();
  renderPriority();
  renderTags();
  renderSubs();
  $('#dCreated').textContent = 'Tạo lúc ' + new Date(t.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderDateTime() {
  const t = task(openId);
  $('#dDateLabel').textContent = t.date ? fmtDate(t.date) : 'Ch?a ??t';
  $('#dDateBtn').classList.toggle('empty', !t.date);
  $('#dDateBtn').classList.toggle('overdue', !!t.date && !t.done && t.date < todayISO());
  $('#dTimeLabel').textContent = t.time ? fmtTime(t.time) : 'Ch?a ??t';
  $('#dTimeBtn').classList.toggle('empty', !t.time);
}

function renderStatus() {
  const t = task(openId); if (!t) return;
  $('#dStatus').innerHTML = statusPill(t.status, 'big');
}
$('#dStatus').onclick = (e) => {
  const id = openId;
  statusMenu(e.currentTarget, task(id), (s, wasDone) => afterStatusChange(id, s, wasDone));
};

function setPriority(id, p) {
  const t = task(id);
  if (!t || t.priority === p) return;
  t.priority = p;
  persist();
  if (openId === id) renderPriority();
  updateRow(id);
  reflow(id, 150);
}

function renderPriority() {
  const p = task(openId).priority || 'none';
  $('#dPriority').innerHTML = `<span class="chip prio-${p}">${p === 'none' ? 'Set priority' : PRIORITY[p].label}<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>`;
}

function renderTags() {
  const t = task(openId);
  const box = $('#dTags');
  box.querySelectorAll('.tag').forEach((el) => el.remove());
  const input = $('#dTagInput');
  t.tags.forEach((name, i) => {
    const [bg, fg] = tagColor(name);
    const el = document.createElement('span');
    el.className = 'chip tag';
    el.style.background = bg; el.style.color = fg;
    el.innerHTML = `${esc(name)}<span class="x" title="Remove">×</span>`;
    el.querySelector('.x').onclick = () => { t.tags.splice(i, 1); persist(); renderTags(); };
    box.insertBefore(el, input);
  });
}

function renderSubs() {
  const t = task(openId);
  const done = t.subtasks.filter((s) => s.done).length;
  $('#dSubCount').textContent = `${done} / ${t.subtasks.length}`;
  $('#dSubs').innerHTML = t.subtasks.map((s) => `
    <li class="sub ${s.done ? 'done' : ''}" data-id="${s.id}">
      <button class="check ${s.done ? 'on' : ''}">${ICON_CHECK}</button>
      <span class="sub-text" contenteditable="plaintext-only" spellcheck="false">${esc(s.text)}</span>
      <button class="t-del" title="Remove">${ICON_X}</button>
    </li>`).join('');
}

// detail field bindings
function bindText(sel, key, after) {
  const el = $(sel);
  el.addEventListener('input', () => {
    const t = task(openId); if (!t) return;
    t[key] = key === 'title' ? el.value.replace(/\n/g, ' ') : el.value;
    autosize(el);
    persist();
    after?.();
  });
}
bindText('#dTitle', 'title', () => updateRow(openId));
bindText('#dDesc', 'desc', () => updateRow(openId));
bindText('#dNotes', 'notes', () => updateRow(openId));
$('#dImportant').onchange=e=>{const t=task(openId);if(t){t.important=e.target.checked;persist();}};
$('#dNotify').onchange=e=>{const t=task(openId);if(t){t.notify=e.target.checked;persist();}};
for(const selector of ['#dPlanDate','#dPlanTime','#dPlanMinutes'])$(selector).onchange=()=>{
  const t=task(openId);if(!t)return;
  t.plannedDate=$('#dPlanDate').value;t.plannedTime=t.plannedDate?$('#dPlanTime').value:'';t.durationMinutes=Math.max(15,Math.min(180,Math.round((Number($('#dPlanMinutes').value)||45)/15)*15));t.planSource='manual';persist();updateRow(openId);
};
$('#dTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#dDesc').focus(); } });

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function setDate(v) { task(openId).date = v; persist(); renderDateTime(); updateRow(openId); }
function setTime(v) { task(openId).time = v; persist(); renderDateTime(); updateRow(openId); }

// Themed calendar popover (replaces the native date input)
function datePicker(anchor, value, onPick) {
  const view = value ? new Date(value + 'T00:00:00') : new Date();
  view.setDate(1);
  const wrap = document.createElement('div');
  wrap.className = 'cal';
  const today = todayISO();
  const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
  const draw = (dir = 0) => {
    const start = new Date(view); start.setDate(1 - start.getDay());
    let days = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = isoOf(d);
      const cls = [d.getMonth() !== view.getMonth() && 'out', iso === today && 'today', iso === value && 'sel'].filter(Boolean).join(' ');
      days += `<button class="day ${cls}" data-d="${iso}">${d.getDate()}</button>`;
    }
    wrap.innerHTML = `
      <div class="cal-quick">
        <button data-d="${shift(0)}">Today</button><button data-d="${shift(1)}">Tomorrow</button><button data-d="${shift(7)}">Next week</button>
      </div>
      <div class="cal-head">
        <span>${view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <div><button class="nav" data-nav="-1">‹</button><button class="nav" data-nav="1">›</button></div>
      </div>
      <div class="cal-grid ${dir < 0 ? 'from-left' : dir > 0 ? 'from-right' : ''}">
        ${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => `<span class="wd">${w}</span>`).join('')}${days}
      </div>
      <div class="pick-foot"><button class="clear">X?a</button></div>`;
    wrap.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { closeMenu(); onPick(b.dataset.d); });
    wrap.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => { const n = +b.dataset.nav; view.setMonth(view.getMonth() + n); draw(n); });
    wrap.querySelector('.clear').onclick = () => { closeMenu(); onPick(''); };
  };
  draw();
  showMenu(anchor, [{ custom: () => wrap }]);
}

// Themed time popover (replaces the native time input)
function timePicker(anchor, value, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'tp';
  const slots = [];
  for (let m = 0; m < 24 * 60; m += 15) slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  wrap.innerHTML = `
    <div class="cal-quick">${['09:00', '12:00', '15:00', '18:00'].map((v) => `<button data-t="${v}">${fmtTime(v).replace(':00', '')}</button>`).join('')}</div>
    <div class="tp-list">${slots.map((v) => `<button class="slot ${v === value ? 'sel' : ''}" data-t="${v}">${fmtTime(v)}</button>`).join('')}</div>
    <div class="pick-foot"><button class="clear">X?a</button></div>`;
  wrap.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { closeMenu(); onPick(b.dataset.t); });
  wrap.querySelector('.clear').onclick = () => { closeMenu(); onPick(''); };
  showMenu(anchor, [{ custom: () => wrap }]);
  const target = wrap.querySelector('.slot.sel') || wrap.querySelector('[data-t="09:00"].slot');
  wrap.querySelector('.tp-list').scrollTop = target.offsetTop - 60;
}

$('#dDateBtn').onclick = (e) => datePicker(e.currentTarget, task(openId).date, setDate);
$('#dTimeBtn').onclick = (e) => timePicker(e.currentTarget, task(openId).time, setTime);

$('#dPriority').onclick = (e) => {
  const t = task(openId);
  showMenu(e.currentTarget, ['high', 'medium', 'low', 'none'].map((p) => ({
    icon: `<span class="pdot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${PRIORITY[p].color}"></span>`,
    label: PRIORITY[p].label, checked: t.priority === p,
    onClick: () => setPriority(t.id, p),
  })));
};

$('#dTagInput').addEventListener('keydown', (e) => {
  const input = e.target;
  const t = task(openId);
  if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
    e.preventDefault();
    const v = input.value.trim().replace(/,/g, '');
    if (!t.tags.some((x) => x.toLowerCase() === v.toLowerCase())) t.tags.push(v);
    input.value = '';
    persist(); renderTags();
  } else if (e.key === 'Backspace' && !input.value && t.tags.length) {
    t.tags.pop(); persist(); renderTags();
  }
});

$('#dSubForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#dSubInput');
  const v = input.value.trim(); if (!v) return;
  task(openId).subtasks.push({ id: uid(), text: v, done: false });
  input.value = '';
  persist(); renderSubs(); updateRow(openId);
});
$('#dSubs').addEventListener('click', (e) => {
  const li = e.target.closest('.sub'); if (!li) return;
  const t = task(openId);
  const s = t.subtasks.find((x) => x.id === li.dataset.id);
  if (e.target.closest('.check')) {
    s.done = !s.done;
    li.classList.toggle('done', s.done);
    const chk = li.querySelector('.check');
    chk.classList.toggle('on', s.done);
    chk.classList.remove('pop'); void chk.offsetWidth; chk.classList.add('pop');
    if (s.done) burst(chk);
    $('#dSubCount').textContent = `${t.subtasks.filter((x) => x.done).length} / ${t.subtasks.length}`;
    persist(); updateRow(openId);
  } else if (e.target.closest('.t-del')) {
    t.subtasks = t.subtasks.filter((x) => x.id !== s.id);
    persist(); renderSubs(); updateRow(openId);
  }
});
$('#dSubs').addEventListener('input', (e) => {
  const li = e.target.closest('.sub'); if (!li) return;
  const s = task(openId).subtasks.find((x) => x.id === li.dataset.id);
  s.text = e.target.textContent;
  persist();
});
$('#dSubs').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('sub-text')) { e.preventDefault(); e.target.blur(); }
});

$('#dClose').onclick = closeDetail;
$('#dMore').onclick = (e) => taskMenu(openId, e.currentTarget);

// ---------- menus ----------
function closeMenu() { $('#menuLayer').innerHTML = ''; }

function showMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  for (const it of items) {
    if (it.sep) { m.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
    if (it.header) { m.insertAdjacentHTML('beforeend', `<div class="menu-label">${esc(it.label)}</div>`); continue; }
    if (it.custom) { m.appendChild(it.custom()); continue; }
    const b = document.createElement('button');
    b.className = 'menu-item' + (it.danger ? ' danger' : '');
    b.innerHTML = `<span class="mi-icon">${it.icon || ''}</span><span>${esc(it.label)}</span>${it.checked ? '<span class="tick">✓</span>' : ''}`;
    if (it.disabled) { b.disabled = true; b.style.opacity = .4; b.style.cursor = 'default'; }
    b.onclick = () => { closeMenu(); it.onClick?.(); };
    m.appendChild(b);
  }
  $('#menuLayer').appendChild(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, right: anchor.x, top: anchor.y };
  let x = r.left, y = r.bottom + 4;
  const mw = m.offsetWidth, mh = m.offsetHeight;
  if (x + mw > innerWidth - 12) x = Math.max(12, (r.right ?? r.left) - mw);
  if (y + mh > innerHeight - 12) y = Math.max(12, r.top - mh - 4);
  m.style.left = x + 'px'; m.style.top = y + 'px';
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu')) closeMenu(); });

// ---------- toast ----------
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Undo</button>' : ''}`;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ---------- window buttons ----------
async function setPinUI(on) { $('#btnPin').classList.toggle('on', on); $('#btnPin').title = on ? 'Bỏ ghim' : 'Luôn ở trên'; }
$('#btnPin').onclick = async () => { const on = await api.togglePin(); setPinUI(on); toast(on ? '📌 Pinned — stays above other apps' : 'Unpinned — other apps can cover it'); };
api.onPinChanged(setPinUI);
$('#btnClose').onclick = () => api.hide();

let mini = false;
$('#btnMini').onclick = async () => {
  await window.closeDeskAgy?.();
  if (!mini) await closeDetail();
  mini = !mini;
  if (mini) { document.body.classList.add('mini'); await api.setMini(true); }
  else { await api.setMini(false); document.body.classList.remove('mini'); }
  $('#btnMini').title = mini ? 'Expand' : 'Collapse';
  $('#btnMini').innerHTML = mini
    ? '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>';
};
$('.header').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) $('#btnMini').click(); });
api.onRestore?.(() => { if(mini) $('#btnMini').click(); });

$('#btnMenu').onclick = async e => {
  const auto = await api.getAutoStart();
  const notifications=await api.getNotifications();
  showMenu(e.currentTarget,[
    {label:'Nhắc lịch đúng giờ',checked:notifications.enabled,onClick:async()=>{const result=await api.configureNotifications({enabled:!notifications.enabled});toast(result.ok?(!notifications.enabled?'Đã bật nhắc lịch':'Đã tắt nhắc lịch'):result.error);}},
    {label:'Âm thanh thông báo',checked:notifications.sound,onClick:async()=>{await api.configureNotifications({sound:!notifications.sound});}},
    {label:'Thử thông báo Windows',onClick:async()=>{const result=await api.testNotification();toast(result.ok?'Đã gửi thông báo Windows':result.error);}},
    {sep:true},
    {label:'Mở cùng Windows',checked:auto,onClick:async()=>{await api.setAutoStart(!auto);toast(!auto?'Đã bật mở cùng Windows':'Đã tắt mở cùng Windows');}},
    {sep:true},
    {label:'Dọn việc đã hoàn thành',onClick:clearCompleted},
    {label:'Mở thư mục dữ liệu',onClick:()=>api.openData()},
    {sep:true},
    {label:'Thoát Desknote',danger:true,onClick:()=>api.quit()}
  ]);
};

function clearCompleted() {
  const removed = catTasks().filter(t=>t.done);
  if (!removed.length) return toast('Nothing to clear ✨');
  const before = S.tasks.slice();
  S.tasks = S.tasks.filter(t => !removed.some(r=>r.id===t.id));
  if (openId && !task(openId)) closeDetail();
  persist(); renderList(); renderStats();
  toast(`Cleared ${removed.length} completed`, () => { S.tasks = before; persist(); renderList(); renderStats(); });
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#menuLayer').children.length) return closeMenu();
    if (openId) return closeDetail();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); $('#addInput').focus(); }
});

function setView(agenda) {
  agendaView=agenda;
  $('#viewAll').classList.toggle('active',!agenda);
  $('#viewAgenda').classList.toggle('active',agenda);
  renderGreeting(); renderList(); renderStats();
}
$('#viewAll').onclick=()=>setView(false);
$('#viewAgenda').onclick=()=>setView(true);
let refreshTimer;
let lastTyped=0;
document.addEventListener('input',()=>{lastTyped=Date.now();});
async function refreshExternal() {
  if(!S || Date.now()-lastTyped<900) {refreshTimer=setTimeout(refreshExternal,1000);return;}
  // Flush local edits first; main merges only edited fields into the current store.
  if(saveTimer) { clearTimeout(saveTimer); saveTimer=null; if(api.saveSync && !api.saveSync(S)) return toast('Không lưu được thay đổi cục bộ.'); }
  const result=await api.load();
  if(result.status!=='ok')return toast('Không đọc được cập nhật.');
  S=result.data;
  if(S.activeCat!=='@all'&&!cat(S.activeCat))S.activeCat='@all';
  if(openId && !task(openId))await closeDetail();
  renderTabs(); renderList(); renderStats();
  if(openId)fillDetail();
  window.scheduleChanged?.();
  $('#syncLabel').textContent='Đã cập nhật '+new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
}
api.onExternalChange?.(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshExternal,150);});
$('.card').insertAdjacentHTML('beforeend','<footer class="desk-footer"><span id="syncLabel">Lưu trên máy</span><span>Alt + Shift + T</span></footer>');

// ---------- boot ----------
(async function init() {
  if (!api) return; // main process will reload the window once the bridge is ready
  let res = { status: 'error' };
  for (let i = 0; i < 6; i++) {
    res = await api.load().catch(() => ({ status: 'error' }));
    if (res.status !== 'error') break;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  if (res.status === 'error') {
    $('#tasks').innerHTML = `<li class="empty"><span class="big">🫣</span>Couldn't open your tasks.<br/>They're safe — restart Desknote to try again.</li>`;
    return; // do NOT overwrite the file with anything
  }
  S = res.status === 'ok' ? res.data : seed();
  canSave = true;
  if (S.activeCat !== '@all' && !cat(S.activeCat)) S.activeCat = S.categories[0].id;
  for (const t of S.tasks) {
    if (!STATUS[t.status]) t.status = t.done ? 'done' : 'todo';
    t.done = t.status === 'done';
  }
  // header mini counter
  $('.brand').insertAdjacentHTML('beforeend', '<span class="mini-count" id="miniCount"></span>');
  persist();
  renderGreeting();
  renderFooter();
  renderTabs();
  renderList();
  renderStats();
  setPinUI(await api.getPin());
  window.scheduleChanged?.();
  setInterval(() => { renderGreeting(); renderFooter(); }, 60_000);
})();
