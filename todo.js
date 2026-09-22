(function () {
  const PALETTE = ['#6C8CF5', '#9B7CF8', '#3FCFA0', '#5AB7E8', '#C77DF0', '#4FD1C5'];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr() { return formatDate(new Date()); }
  function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDaysToDate(dateStr, n) { const d = parseDateStr(dateStr); d.setDate(d.getDate() + n); return formatDate(d); }
  function addDaysToToday(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return formatDate(d); }
  function nextWeekday(dow) { let d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return formatDate(d); }
  function uid() { return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const WEEKDAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const DOW_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  function humanDate(dateStr) {
    const d = parseDateStr(dateStr);
    return WEEKDAYS_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  // ---------- Data ----------
  function defaultData() {
    return {
      categories: [
        { id: 'cat1', name: 'Lavoro', color: '#6C8CF5' },
        { id: 'cat2', name: 'Personale', color: '#9B7CF8' },
        { id: 'cat3', name: 'Casa', color: '#3FCFA0' }
      ],
      tasks: []
    };
  }

  let data = defaultData();
  let docRef = null;
  let unsubscribe = null;
  let ready = false;

  function saveData() {
    if (!docRef) return;
    docRef.set(data).catch(err => console.error('Errore salvataggio Cose da fare:', err));
  }
  function purgeOldCompleted() {
    const t = todayStr();
    data.tasks = data.tasks.filter(task => !(task.completed && task.completedAt && task.completedAt < t));
  }
  function catById(id) { return data.categories.find(c => c.id === id); }

  // ---------- State ----------
  const state = {
    view: 'calendar',
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    currentDate: todayStr()
  };

  // ---------- Recurrence ----------
  function nextDateFromRecurrence(dateStr, rec) {
    const d = parseDateStr(dateStr);
    if (rec.unit === 'day') d.setDate(d.getDate() + rec.interval);
    else if (rec.unit === 'week') d.setDate(d.getDate() + 7 * rec.interval);
    else if (rec.unit === 'month') d.setMonth(d.getMonth() + rec.interval);
    return formatDate(d);
  }

  // ---------- Parser ----------
  function parseQuickAdd(raw) {
    let title = raw;
    let recurrence = null, date = null, startTime = null, endTime = null;

    function strip(regex) {
      const m = title.match(regex);
      if (m) title = title.replace(regex, ' ');
      return m;
    }

    let m;
    if (m = strip(/\bogni\s+(\d+)\s*giorn[oi]\b/i)) recurrence = { interval: parseInt(m[1], 10), unit: 'day' };
    else if (strip(/\bogni\s+giorno\b/i)) recurrence = { interval: 1, unit: 'day' };
    else if (m = strip(/\bogni\s+(\d+)\s*settiman[ae]\b/i)) recurrence = { interval: parseInt(m[1], 10), unit: 'week' };
    else if (strip(/\bogni\s+settimana\b/i)) recurrence = { interval: 1, unit: 'week' };
    else if (m = strip(/\bogni\s+(\d+)\s*mes[ei]\b/i)) recurrence = { interval: parseInt(m[1], 10), unit: 'month' };
    else if (strip(/\bogni\s+mese\b/i)) recurrence = { interval: 1, unit: 'month' };

    const WD = { domenica: 0, lunedi: 1, 'lunedì': 1, martedi: 2, 'martedì': 2, mercoledi: 3, 'mercoledì': 3, giovedi: 4, 'giovedì': 4, venerdi: 5, 'venerdì': 5, sabato: 6 };

    if (strip(/\bdopodomani\b/i)) date = addDaysToToday(2);
    else if (strip(/\bdomani\b/i)) date = addDaysToToday(1);
    else if (strip(/\boggi\b/i)) date = addDaysToToday(0);
    else if (m = strip(/\btra\s+(\d+)\s*settiman[ae]\b/i)) date = addDaysToToday(parseInt(m[1], 10) * 7);
    else if (m = strip(/\btra\s+(\d+)\s*giorn[oi]\b/i)) date = addDaysToToday(parseInt(m[1], 10));
    else if (m = strip(/\b(?:prossimo\s+)?(domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)\b/i)) {
      const key = m[1].toLowerCase();
      const dow = WD[key];
      if (dow !== undefined) date = nextWeekday(dow);
    } else if (m = strip(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)) {
      let y = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
      date = y + '-' + pad2(parseInt(m[2], 10)) + '-' + pad2(parseInt(m[1], 10));
    }

    if (m = strip(/\bdalle\s+(\d{1,2})(?:[:.](\d{2}))?\s+alle\s+(\d{1,2})(?:[:.](\d{2}))?\b/i)) {
      startTime = pad2(m[1]) + ':' + (m[2] || '00');
      endTime = pad2(m[3]) + ':' + (m[4] || '00');
    } else if (m = strip(/\balle\s+(\d{1,2})(?:[:.](\d{2}))?\b/i)) {
      startTime = pad2(m[1]) + ':' + (m[2] || '00');
    }

    title = title.replace(/\s{2,}/g, ' ').trim();
    title = title.replace(/^(di|il|la|l')\s+/i, '');
    title = title.replace(/^[,;]\s*/, '').replace(/[,;]\s*$/, '');
    title = title.trim();
    if (title.length) title = title.charAt(0).toUpperCase() + title.slice(1);

    return { title: title || raw.trim(), date, startTime, endTime, recurrence };
  }

  // ---------- Rendering ----------
  const els = {};

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function renderShell() {
    const page = document.getElementById('page-todo');
    page.innerHTML =
      '<div class="todo-top">' +
      '<div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Cose da fare</h1></div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
      '<div class="view-switch">' +
      '<button id="viewBtnCal">Calendario</button>' +
      '<button id="viewBtnList">Lista</button>' +
      '</div>' +
      '<button class="icon-btn" id="manageCatsBtn" title="Categorie">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/></svg>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div id="todoContent"></div>' +
      '<div class="quick-add-bar">' +
      '<input id="quickAddInput" type="text" placeholder="Scrivi un\u2019attività... es. dentista domani alle 10" />' +
      '<button class="quick-add-send" id="quickAddSend"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></button>' +
      '</div>';

    document.getElementById('viewBtnCal').onclick = () => { state.view = 'calendar'; renderContent(); };
    document.getElementById('viewBtnList').onclick = () => { state.view = 'list'; renderContent(); };
    document.getElementById('manageCatsBtn').onclick = () => openCategoryManager();

    const input = document.getElementById('quickAddInput');
    const send = document.getElementById('quickAddSend');
    function doSend() {
      const val = input.value.trim();
      if (!val) return;
      const draft = parseQuickAdd(val);
      input.value = '';
      openTaskModal('preview', draft, null);
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  }

  function renderContent() {
    document.getElementById('viewBtnCal').classList.toggle('active', state.view === 'calendar');
    document.getElementById('viewBtnList').classList.toggle('active', state.view === 'list');
    const c = document.getElementById('todoContent');
    if (state.view === 'calendar') renderCalendar(c); else renderList(c);
  }

  function tasksForDate(dateStr) {
    return data.tasks.filter(t => t.date === dateStr).sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return 0;
    });
  }

  function renderCalendar(container) {
    const year = state.calYear, month = state.calMonth;
    const first = new Date(year, month, 1);
    const startWeekday = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const today = todayStr();

    let cellsHtml = '';
    const totalCells = 42;
    for (let i = 0; i < totalCells; i++) {
      let cellDate, otherMonth = false;
      const dayNum = i - startWeekday + 1;
      if (dayNum < 1) { cellDate = new Date(year, month - 1, daysInPrev + dayNum); otherMonth = true; }
      else if (dayNum > daysInMonth) { cellDate = new Date(year, month + 1, dayNum - daysInMonth); otherMonth = true; }
      else { cellDate = new Date(year, month, dayNum); }
      const dStr = formatDate(cellDate);
      const dayTasks = tasksForDate(dStr);
      let pills = '';
      const shown = dayTasks.slice(0, 2);
      shown.forEach(t => {
        const cat = catById(t.categoryId);
        const color = cat ? cat.color : '#5E6779';
        pills += '<div class="cal-pill" style="background:' + color + '33;color:' + color + ';">' + esc(t.title) + '</div>';
      });
      if (dayTasks.length > 2) pills += '<div class="cal-more">+' + (dayTasks.length - 2) + ' altre</div>';

      cellsHtml += '<div class="cal-day' + (otherMonth ? ' other-month' : '') + (dStr === today ? ' today' : '') + '" data-date="' + dStr + '">' +
        '<span class="cal-day-num">' + cellDate.getDate() + '</span>' +
        pills +
        '<button class="cal-add-btn" data-add="' + dStr + '">+</button>' +
        '</div>';
    }

    let dowHtml = DOW_SHORT.map(d => '<div class="cal-dow">' + d + '</div>').join('');

    container.innerHTML =
      '<div class="cal-nav">' +
      '<button class="icon-btn" id="calPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<span class="cal-nav-title">' + MONTHS[month] + ' ' + year + '</span>' +
      '<button class="icon-btn" id="calNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>' +
      '<div class="cal-grid">' + dowHtml + cellsHtml + '</div>';

    document.getElementById('calPrev').onclick = () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(container); };
    document.getElementById('calNext').onclick = () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(container); };

    container.querySelectorAll('.cal-day').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.cal-add-btn')) return;
        state.currentDate = cell.getAttribute('data-date');
        state.view = 'list';
        renderContent();
      });
    });
    container.querySelectorAll('.cal-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTaskModal('create', { date: btn.getAttribute('data-add') }, null);
      });
    });
  }

  function taskItemHtml(t) {
    const cat = catById(t.categoryId);
    const color = cat ? cat.color : '#5E6779';
    const overdue = t.date && !t.completed && t.date < todayStr();
    let meta = [];
    if (t.startTime) meta.push('<span class="task-time">' + t.startTime + (t.endTime ? '\u2013' + t.endTime : '') + '</span>');
    if (cat) meta.push('<span>' + esc(cat.name) + '</span>');
    if (t.recurrence) meta.push('<span>\u21bb ogni ' + (t.recurrence.interval > 1 ? t.recurrence.interval + ' ' : '') + (t.recurrence.unit === 'day' ? 'giorni' : t.recurrence.unit === 'week' ? 'settimane' : 'mesi') + '</span>');
    return '<div class="task-item' + (overdue ? ' overdue' : '') + (t.completed ? ' completed' : '') + '" style="--cat-color:' + color + ';" data-id="' + t.id + '">' +
      '<button class="task-check" data-check="' + t.id + '">' + (t.completed ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' : '') + '</button>' +
      '<div class="task-body"><div class="task-title">' + esc(t.title) + '</div>' +
      (meta.length ? '<div class="task-meta">' + meta.join('') + '</div>' : '') + '</div>' +
      '</div>';
  }

  function renderList(container) {
    const noDate = data.tasks.filter(t => !t.date);
    const dayTasks = tasksForDate(state.currentDate);
    const isToday = state.currentDate === todayStr();

    let html = '<div class="day-nav">' +
      '<button class="icon-btn" id="dayPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<div class="day-nav-controls"><span class="day-nav-title">' + humanDate(state.currentDate) + '</span>' +
      (!isToday ? '<button class="today-btn" id="goToday">Oggi</button>' : '') + '</div>' +
      '<button class="icon-btn" id="dayNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>';

    html += '<p class="section-label">Senza data</p>';
    html += noDate.length ? noDate.map(taskItemHtml).join('') : '<p class="empty-hint">Nessuna attività senza data</p>';

    html += '<p class="section-label">' + (isToday ? 'Oggi' : humanDate(state.currentDate)) + '</p>';
    html += dayTasks.length ? dayTasks.map(taskItemHtml).join('') : '<p class="empty-hint">Nessuna attività in questo giorno</p>';

    container.innerHTML = html;

    document.getElementById('dayPrev').onclick = () => { state.currentDate = addDaysToDate(state.currentDate, -1); renderList(container); };
    document.getElementById('dayNext').onclick = () => { state.currentDate = addDaysToDate(state.currentDate, 1); renderList(container); };
    const goToday = document.getElementById('goToday');
    if (goToday) goToday.onclick = () => { state.currentDate = todayStr(); renderList(container); };

    container.querySelectorAll('[data-check]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleComplete(btn.getAttribute('data-check')); });
    });
    container.querySelectorAll('.task-item').forEach(row => {
      row.addEventListener('click', () => {
        const t = data.tasks.find(x => x.id === row.getAttribute('data-id'));
        if (t) openTaskModal('edit', t, t.id);
      });
    });
  }

  function toggleComplete(id) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) return;
    if (!t.completed) {
      t.completed = true;
      t.completedAt = todayStr();
      if (t.recurrence && t.date) {
        const nextDate = nextDateFromRecurrence(t.date, t.recurrence);
        data.tasks.push(Object.assign({}, t, { id: uid(), date: nextDate, completed: false, completedAt: null }));
      }
    } else {
      t.completed = false;
      t.completedAt = null;
    }
    saveData();
    renderContent();
  }

  // ---------- Category manager ----------
  function openCategoryManager() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    function draw() {
      overlay.innerHTML =
        '<div class="modal-box">' +
        '<p class="modal-title">Categorie</p>' +
        '<div id="catList"></div>' +
        '<p class="field-label">Nuova categoria</p>' +
        '<input type="text" id="newCatName" placeholder="Nome categoria" />' +
        '<div class="row-2" style="margin-top:10px;">' +
        '<button class="btn btn-primary" id="addCatBtn">Aggiungi</button>' +
        '<button class="btn btn-ghost" id="closeCatBtn">Chiudi</button>' +
        '</div>' +
        '</div>';
      const list = overlay.querySelector('#catList');
      list.innerHTML = data.categories.map(c =>
        '<div class="cat-row"><span class="cat-swatch" style="background:' + c.color + ';"></span>' +
        '<span style="flex:1;font-size:14px;">' + esc(c.name) + '</span>' +
        '<button class="icon-btn" data-delcat="' + c.id + '" style="width:26px;height:26px;">\u00d7</button></div>'
      ).join('') || '<p class="empty-hint">Nessuna categoria</p>';
      list.querySelectorAll('[data-delcat]').forEach(b => b.addEventListener('click', () => {
        const cid = b.getAttribute('data-delcat');
        data.categories = data.categories.filter(c => c.id !== cid);
        data.tasks.forEach(t => { if (t.categoryId === cid) t.categoryId = null; });
        saveData(); draw(); renderContent();
      }));
      overlay.querySelector('#closeCatBtn').onclick = () => overlay.remove();
      overlay.querySelector('#addCatBtn').onclick = () => {
        const input = overlay.querySelector('#newCatName');
        const name = input.value.trim();
        if (!name) return;
        const color = PALETTE[data.categories.length % PALETTE.length];
        data.categories.push({ id: uid(), name, color });
        saveData(); draw(); renderContent();
      };
    }
    draw();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ---------- Task modal (create / preview / edit) ----------
  let pendingDeleteChoiceOverlay = null;

  function catOptionsHtml(selectedId) {
    let html = '<option value="">Nessuna categoria</option>';
    data.categories.forEach(c => {
      html += '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    });
    return html;
  }

  function openTaskModal(mode, vals, taskId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const isEdit = mode === 'edit';
    const isPreview = mode === 'preview';
    const title = isPreview ? 'Conferma attività' : (isEdit ? 'Modifica attività' : 'Nuova attività');
    const rec = vals.recurrence || null;

    overlay.innerHTML =
      '<div class="modal-box">' +
      '<p class="modal-title">' + title + '</p>' +
      (isPreview ? '<p class="modal-sub">Controlla e correggi se serve, poi conferma.</p>' : '') +
      '<label class="field-label">Titolo</label>' +
      '<input type="text" id="fTitle" value="' + esc(vals.title || '') + '" />' +
      '<label class="field-label">Data</label>' +
      '<input type="date" id="fDate" value="' + (vals.date || '') + '" />' +
      '<div class="row-2">' +
      '<div><label class="field-label">Inizio (opzionale)</label><input type="time" id="fStart" value="' + (vals.startTime || '') + '" /></div>' +
      '<div><label class="field-label">Fine (opzionale)</label><input type="time" id="fEnd" value="' + (vals.endTime || '') + '" /></div>' +
      '</div>' +
      '<label class="field-label">Categoria</label>' +
      '<select id="fCat">' + catOptionsHtml(vals.categoryId) + '</select>' +
      '<label class="field-label">Ricorrenza</label>' +
      '<select id="fRecUnit">' +
      '<option value="">Nessuna</option>' +
      '<option value="day"' + (rec && rec.unit === 'day' ? ' selected' : '') + '>Ogni N giorni</option>' +
      '<option value="week"' + (rec && rec.unit === 'week' ? ' selected' : '') + '>Ogni N settimane</option>' +
      '<option value="month"' + (rec && rec.unit === 'month' ? ' selected' : '') + '>Ogni N mesi</option>' +
      '</select>' +
      '<input type="text" id="fRecN" inputmode="numeric" placeholder="Intervallo (es. 4)" value="' + (rec ? rec.interval : '') + '" style="margin-top:8px;display:' + (rec ? 'block' : 'none') + ';" />' +
      '<div class="modal-actions">' +
      (isEdit ? '<button class="btn btn-danger" id="fDelete">Elimina</button>' : '') +
      '<button class="btn btn-ghost" id="fCancel">Annulla</button>' +
      '<button class="btn btn-primary" id="fSave">' + (isPreview ? 'Conferma' : 'Salva') + '</button>' +
      '</div>' +
      '</div>';

    const recUnitSel = overlay.querySelector('#fRecUnit');
    const recNInput = overlay.querySelector('#fRecN');
    recUnitSel.addEventListener('change', () => {
      recNInput.style.display = recUnitSel.value ? 'block' : 'none';
      if (recUnitSel.value && !recNInput.value) recNInput.value = '1';
    });

    overlay.querySelector('#fCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    if (isEdit) {
      overlay.querySelector('#fDelete').onclick = () => {
        const t = data.tasks.find(x => x.id === taskId);
        if (t && t.recurrence) {
          overlay.remove();
          openDeleteChoice(taskId);
        } else {
          data.tasks = data.tasks.filter(x => x.id !== taskId);
          saveData(); overlay.remove(); renderContent();
        }
      };
    }

    overlay.querySelector('#fSave').onclick = () => {
      const t = overlay.querySelector('#fTitle').value.trim();
      if (!t) return;
      const dateVal = overlay.querySelector('#fDate').value || null;
      const startVal = overlay.querySelector('#fStart').value || null;
      const endVal = overlay.querySelector('#fEnd').value || null;
      const catVal = overlay.querySelector('#fCat').value || null;
      const recUnit = recUnitSel.value;
      const recN = parseInt(recNInput.value, 10);
      const recurrence = recUnit && recN > 0 ? { interval: recN, unit: recUnit } : null;

      if (isEdit) {
        const task = data.tasks.find(x => x.id === taskId);
        Object.assign(task, { title: t, date: dateVal, startTime: startVal, endTime: endVal, categoryId: catVal, recurrence });
      } else {
        data.tasks.push({ id: uid(), title: t, date: dateVal, startTime: startVal, endTime: endVal, categoryId: catVal, recurrence, completed: false, completedAt: null });
      }
      saveData();
      overlay.remove();
      renderContent();
    };

    document.body.appendChild(overlay);
  }

  function openDeleteChoice(taskId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box">' +
      '<p class="modal-title">Eliminare l\u2019attività ricorrente?</p>' +
      '<p class="modal-sub">È un\u2019attività che si ripete. Cosa vuoi eliminare?</p>' +
      '<div class="modal-actions" style="flex-direction:column;">' +
      '<button class="btn btn-primary" id="delThis">Solo questa occorrenza</button>' +
      '<button class="btn btn-danger" id="delAll">Tutta la serie</button>' +
      '<button class="btn btn-ghost" id="delCancel">Annulla</button>' +
      '</div>' +
      '</div>';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#delCancel').onclick = () => overlay.remove();
    overlay.querySelector('#delThis').onclick = () => {
      const t = data.tasks.find(x => x.id === taskId);
      if (t && t.date && t.recurrence) {
        const nextDate = nextDateFromRecurrence(t.date, t.recurrence);
        data.tasks.push(Object.assign({}, t, { id: uid(), date: nextDate, completed: false, completedAt: null }));
      }
      data.tasks = data.tasks.filter(x => x.id !== taskId);
      saveData(); overlay.remove(); renderContent();
    };
    overlay.querySelector('#delAll').onclick = () => {
      data.tasks = data.tasks.filter(x => x.id !== taskId);
      saveData(); overlay.remove(); renderContent();
    };
    document.body.appendChild(overlay);
  }

  // ---------- Init ----------
  function renderLoading() {
    const page = document.getElementById('page-todo');
    if (page) page.innerHTML = '<p class="empty-hint">Caricamento...</p>';
  }

  function startForUser(uid) {
    ready = false;
    if (unsubscribe) unsubscribe();
    renderLoading();
    docRef = window.db.collection('users').doc(uid).collection('modules').doc('todo');

    unsubscribe = docRef.onSnapshot(snap => {
      if (snap.exists) {
        data = snap.data();
      } else {
        data = defaultData();
        docRef.set(data).catch(err => console.error('Errore inizializzazione Cose da fare:', err));
      }
      purgeOldCompleted();
      if (!ready) { ready = true; renderShell(); }
      renderContent();
    }, err => {
      console.error('Errore lettura Cose da fare:', err);
      renderLoading();
    });
  }

  function stopForLogout() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    docRef = null;
    ready = false;
    data = defaultData();
  }

  window.Todo = {
    onShow: function () { if (ready) { purgeOldCompleted(); renderContent(); } }
  };

  window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
  window.addEventListener('app:authLoggedOut', stopForLogout);
  if (window.currentUser) startForUser(window.currentUser.uid);
})();