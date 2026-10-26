(function () {
  function uid() { return 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function defaultData() { return { notes: [] }; }

  function formatUpdated(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = n => String(n).padStart(2, '0');
    const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (sameDay) return 'Oggi · ' + time;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ieri · ' + time;
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' · ' + time;
  }

  function previewText(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'Nota vuota';
    return t.length > 90 ? t.slice(0, 90) + '…' : t;
  }

  let data = defaultData();
  let docRef = null;
  let unsubscribe = null;
  let ready = false;
  let saveTimer = null;
  let skipNextRender = false;

  const state = {
    selectedId: null,
    searchQuery: '',
    mobileShowEditor: false
  };

  function saveData() {
    if (!docRef) return;
    docRef.set(data).catch(err => console.error('Errore salvataggio Note:', err));
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      skipNextRender = true;
      saveData();
      updateStatus('Salvata');
    }, 450);
  }

  function sortedNotes() {
    return data.notes.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  }

  function filteredNotes() {
    const q = state.searchQuery.trim().toLowerCase();
    let list = sortedNotes();
    if (!q) return list;
    return list.filter(n => (n.title || '').toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q));
  }

  function selectedNote() {
    return data.notes.find(n => n.id === state.selectedId) || null;
  }

  function ensureSelection() {
    if (state.selectedId && data.notes.some(n => n.id === state.selectedId)) return;
    const list = filteredNotes();
    state.selectedId = list.length ? list[0].id : null;
    if (!state.selectedId) state.mobileShowEditor = false;
  }

  function createNote() {
    const now = new Date().toISOString();
    const note = { id: uid(), title: '', text: '', createdAt: now, updatedAt: now };
    data.notes.unshift(note);
    state.selectedId = note.id;
    state.searchQuery = '';
    state.mobileShowEditor = true;
    skipNextRender = true;
    saveData();
    renderAll();
    focusEditor(true);
  }

  function deleteSelected() {
    const note = selectedNote();
    if (!note) return;
    const label = (note.title || '').trim() || 'questa nota';
    if (!confirm('Eliminare ' + label + '?')) return;
    data.notes = data.notes.filter(n => n.id !== note.id);
    state.selectedId = null;
    state.mobileShowEditor = false;
    skipNextRender = true;
    saveData();
    renderAll();
  }

  function updateStatus(text) {
    const el = document.getElementById('notesStatus');
    if (el) el.textContent = text;
  }

  function focusEditor(preferTitle) {
    setTimeout(() => {
      const title = document.getElementById('notesTitle');
      const body = document.getElementById('notesBody');
      const target = preferTitle && title ? title : (body || title);
      if (target) {
        target.focus();
        if (typeof target.selectionStart === 'number') {
          const len = target.value.length;
          target.setSelectionRange(len, len);
        }
      }
    }, 40);
  }

  function renderShell() {
    const page = document.getElementById('page-notes');
    page.innerHTML =
      '<div class="todo-top">' +
      '<div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Note</h1></div>' +
      '<button class="btn btn-primary notes-new-btn" id="notesNew">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
      'Nuova nota' +
      '</button>' +
      '</div>' +
      '<div class="notes-layout" id="notesLayout"></div>';

    document.getElementById('notesNew').onclick = createNote;
  }

  function renderAll() {
    ensureSelection();
    const layout = document.getElementById('notesLayout');
    if (!layout) return;

    const notes = filteredNotes();
    const note = selectedNote();
    const showEditor = !!note && (state.mobileShowEditor || window.matchMedia('(min-width: 861px)').matches);

    layout.classList.toggle('show-editor', showEditor);

    let listHtml = '<div class="notes-sidebar">' +
      '<div class="notes-search"><input type="search" id="notesSearch" placeholder="Cerca nelle note..." value="' + esc(state.searchQuery) + '" /></div>' +
      '<div class="notes-list">';

    if (!notes.length) {
      listHtml += '<p class="empty-hint">' + (state.searchQuery ? 'Nessuna nota trovata' : 'Nessuna nota ancora. Scrivi la prima idea.') + '</p>';
    } else {
      notes.forEach(n => {
        const active = n.id === state.selectedId ? ' active' : '';
        const title = (n.title || '').trim() || 'Senza titolo';
        listHtml += '<button type="button" class="notes-item' + active + '" data-id="' + n.id + '">' +
          '<span class="notes-item-title">' + esc(title) + '</span>' +
          '<span class="notes-item-preview">' + esc(previewText(n.text)) + '</span>' +
          '<span class="notes-item-meta">' + esc(formatUpdated(n.updatedAt || n.createdAt)) + '</span>' +
          '</button>';
      });
    }
    listHtml += '</div></div>';

    let editorHtml = '<div class="notes-editor">';
    if (!note) {
      editorHtml += '<div class="notes-empty">' +
        '<p class="notes-empty-title">Le tue idee, qui.</p>' +
        '<p class="empty-hint">Crea una nota e scrivi tutto quello che ti viene in mente. Si salva da sola.</p>' +
        '<button class="btn btn-primary" id="notesEmptyNew">Nuova nota</button>' +
        '</div>';
    } else {
      editorHtml +=
        '<div class="notes-editor-top">' +
        '<button type="button" class="notes-back" id="notesBack" aria-label="Torna alla lista">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>' +
        'Note' +
        '</button>' +
        '<span class="notes-status" id="notesStatus">Salvata</span>' +
        '<button type="button" class="btn btn-danger notes-delete" id="notesDelete">Elimina</button>' +
        '</div>' +
        '<input type="text" class="notes-title-input" id="notesTitle" placeholder="Titolo" value="' + esc(note.title || '') + '" />' +
        '<textarea class="notes-body-input" id="notesBody" placeholder="Scrivi quello che ti passa per la testa...">' + esc(note.text || '') + '</textarea>';
    }
    editorHtml += '</div>';

    layout.innerHTML = listHtml + editorHtml;

    const search = document.getElementById('notesSearch');
    if (search) {
      search.addEventListener('input', () => {
        state.searchQuery = search.value;
        renderAll();
        const again = document.getElementById('notesSearch');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
    }

    layout.querySelectorAll('.notes-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedId = btn.getAttribute('data-id');
        state.mobileShowEditor = true;
        renderAll();
        focusEditor(false);
      });
    });

    const emptyNew = document.getElementById('notesEmptyNew');
    if (emptyNew) emptyNew.onclick = createNote;

    const back = document.getElementById('notesBack');
    if (back) back.onclick = () => { state.mobileShowEditor = false; renderAll(); };

    const del = document.getElementById('notesDelete');
    if (del) del.onclick = deleteSelected;

    const titleInput = document.getElementById('notesTitle');
    const bodyInput = document.getElementById('notesBody');
    if (titleInput && bodyInput && note) {
      const onEdit = () => {
        const current = selectedNote();
        if (!current) return;
        current.title = titleInput.value;
        current.text = bodyInput.value;
        current.updatedAt = new Date().toISOString();
        updateStatus('Salvataggio…');
        const item = layout.querySelector('.notes-item.active');
        if (item) {
          const t = item.querySelector('.notes-item-title');
          const p = item.querySelector('.notes-item-preview');
          const m = item.querySelector('.notes-item-meta');
          if (t) t.textContent = (current.title || '').trim() || 'Senza titolo';
          if (p) p.textContent = previewText(current.text);
          if (m) m.textContent = formatUpdated(current.updatedAt);
        }
        scheduleSave();
      };
      titleInput.addEventListener('input', onEdit);
      bodyInput.addEventListener('input', onEdit);
    }
  }

  function renderLoading() {
    const page = document.getElementById('page-notes');
    if (page) page.innerHTML = '<p class="empty-hint">Caricamento...</p>';
  }

  function startForUser(uid) {
    ready = false;
    if (unsubscribe) unsubscribe();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    renderLoading();
    docRef = window.db.collection('users').doc(uid).collection('modules').doc('notes');

    unsubscribe = docRef.onSnapshot(snap => {
      if (snap.exists) {
        const raw = snap.data() || {};
        data = { notes: Array.isArray(raw.notes) ? raw.notes : [] };
      } else {
        data = defaultData();
        docRef.set(data).catch(err => console.error('Errore inizializzazione Note:', err));
      }
      if (skipNextRender) {
        skipNextRender = false;
        return;
      }
      if (!ready) { ready = true; renderShell(); }
      renderAll();
    }, err => {
      console.error('Errore lettura Note:', err);
      renderLoading();
    });
  }

  function stopForLogout() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    docRef = null;
    ready = false;
    data = defaultData();
    state.selectedId = null;
    state.searchQuery = '';
    state.mobileShowEditor = false;
  }

  window.Notes = {
    onShow: function () { if (ready) renderAll(); }
  };

  window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
  window.addEventListener('app:authLoggedOut', stopForLogout);
  if (window.currentUser) startForUser(window.currentUser.uid);
})();
