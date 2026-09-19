(function () {
    const STORAGE_KEY = 'diarioAppData';

    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayStr() { return formatDate(new Date()); }
    function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function uid() { return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const WEEKDAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const DOW_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

    function humanDate(dateStr) {
        const d = parseDateStr(dateStr);
        return WEEKDAYS_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    }
    function timeFromISO(iso) {
        const d = new Date(iso);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    const MOODS = [
        { id: 'ottimo', emoji: '😄', label: 'Ottimo', color: '#3FCFA0' },
        { id: 'bene', emoji: '🙂', label: 'Bene', color: '#6C8CF5' },
        { id: 'neutro', emoji: '😐', label: 'Neutro', color: '#8890A6' },
        { id: 'giu', emoji: '😞', label: 'Giù', color: '#D98C8C' },
        { id: 'arrabbiato', emoji: '😠', label: 'Arrabbiato', color: '#E8604C' }
    ];
    function moodById(id) { return MOODS.find(m => m.id === id); }

    const PROMPTS = [
        'Cosa ti ha fatto sorridere oggi?',
        'Cosa ti ha pesato di più oggi, e perché?',
        'Per cosa sei grato in questo momento?',
        'Cosa vorresti ricordare di oggi tra un anno?',
        'C\u2019è qualcosa che avresti voluto dire e non hai detto?',
        'Cosa ti ha sorpreso oggi?',
        'Di cosa hai bisogno in questo momento?',
        'Cosa hai imparato di te stesso oggi?',
        'Cosa vorresti lasciarti alle spalle?',
        'Qual è stato il momento più vero della giornata?',
        'Cosa ti sta preoccupando in questi giorni?',
        'Cosa faresti se avessi più coraggio oggi?',
        'Chi ha reso migliore la tua giornata?',
        'Cosa vorresti fare diversamente domani?',
        'Di cosa sei orgoglioso, anche di poco?'
    ];

    function dayOfYear(dateStr) {
        const d = parseDateStr(dateStr);
        const start = new Date(d.getFullYear(), 0, 0);
        return Math.floor((d - start) / 86400000);
    }
    function promptForToday() { return PROMPTS[dayOfYear(todayStr()) % PROMPTS.length]; }

    // ---------- Data ----------
    let data;
    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { }
        return { entries: [] };
    }
    function saveData() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { } }

    // ---------- State ----------
    const state = {
        view: 'calendar',
        calYear: new Date().getFullYear(),
        calMonth: new Date().getMonth(),
        filterDate: null,
        searchQuery: ''
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    function entriesForDate(dateStr) {
        return data.entries.filter(e => e.date === dateStr).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    // ---------- Shell ----------
    function renderShell() {
        const page = document.getElementById('page-diario');
        page.innerHTML =
            '<div class="todo-top">' +
            '<div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Diario</h1></div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<div class="view-switch">' +
            '<button id="dViewCal">Calendario</button>' +
            '<button id="dViewList">Lista</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div id="diarioContent"></div>' +
            '<div class="diary-bottom-bar">' +
            '<button class="diary-new-btn" id="newEntryBtn">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
            'Nuova voce' +
            '</button>' +
            '</div>';

        document.getElementById('dViewCal').onclick = () => { state.view = 'calendar'; state.filterDate = null; renderContent(); };
        document.getElementById('dViewList').onclick = () => { state.view = 'list'; renderContent(); };
        document.getElementById('newEntryBtn').onclick = () => openEntryModal('create', { date: state.filterDate || todayStr() }, null);
    }

    function renderContent() {
        document.getElementById('dViewCal').classList.toggle('active', state.view === 'calendar');
        document.getElementById('dViewList').classList.toggle('active', state.view === 'list');
        const c = document.getElementById('diarioContent');
        if (state.view === 'calendar') renderCalendar(c); else renderList(c);
    }

    // ---------- Calendar ----------
    function renderCalendar(container) {
        const year = state.calYear, month = state.calMonth;
        const first = new Date(year, month, 1);
        const startWeekday = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrev = new Date(year, month, 0).getDate();
        const today = todayStr();

        let cellsHtml = '';
        for (let i = 0; i < 42; i++) {
            let cellDate, otherMonth = false;
            const dayNum = i - startWeekday + 1;
            if (dayNum < 1) { cellDate = new Date(year, month - 1, daysInPrev + dayNum); otherMonth = true; }
            else if (dayNum > daysInMonth) { cellDate = new Date(year, month + 1, dayNum - daysInMonth); otherMonth = true; }
            else { cellDate = new Date(year, month, dayNum); }
            const dStr = formatDate(cellDate);
            const dayEntries = entriesForDate(dStr);
            let dots = '';
            dayEntries.slice(0, 4).forEach(e => {
                const mood = moodById(e.mood);
                dots += '<span class="cal-dot" style="background:' + (mood ? mood.color : '#5E6779') + ';"></span>';
            });
            if (dayEntries.length > 4) dots += '<span class="cal-more">+' + (dayEntries.length - 4) + '</span>';

            cellsHtml += '<div class="cal-day' + (otherMonth ? ' other-month' : '') + (dStr === today ? ' today' : '') + '" data-date="' + dStr + '">' +
                '<span class="cal-day-num">' + cellDate.getDate() + '</span>' +
                (dots ? '<div class="cal-dot-row">' + dots + '</div>' : '') +
                '<button class="cal-add-btn" data-add="' + dStr + '">+</button>' +
                '</div>';
        }

        const dowHtml = DOW_SHORT.map(d => '<div class="cal-dow">' + d + '</div>').join('');

        container.innerHTML =
            '<div class="cal-nav">' +
            '<button class="icon-btn" id="dCalPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>' +
            '<span class="cal-nav-title">' + MONTHS[month] + ' ' + year + '</span>' +
            '<button class="icon-btn" id="dCalNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>' +
            '</div>' +
            '<div class="cal-grid">' + dowHtml + cellsHtml + '</div>';

        document.getElementById('dCalPrev').onclick = () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(container); };
        document.getElementById('dCalNext').onclick = () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(container); };

        container.querySelectorAll('.cal-day').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.closest('.cal-add-btn')) return;
                state.filterDate = cell.getAttribute('data-date');
                state.view = 'list';
                renderContent();
            });
        });
        container.querySelectorAll('.cal-add-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEntryModal('create', { date: btn.getAttribute('data-add') }, null);
            });
        });
    }

    // ---------- List ----------
    function entryItemHtml(e) {
        const mood = moodById(e.mood);
        const color = mood ? mood.color : '#5E6779';
        return '<div class="entry-item" style="--entry-color:' + color + ';" data-id="' + e.id + '">' +
            '<div class="entry-top">' +
            (mood ? '<span class="entry-mood">' + mood.emoji + '</span>' : '') +
            '<span class="entry-title">' + esc(e.title || 'Senza titolo') + '</span>' +
            '<span class="entry-time">' + timeFromISO(e.createdAt) + '</span>' +
            '</div>' +
            '<p class="entry-preview">' + esc(e.text || '') + '</p>' +
            '</div>';
    }

    function renderList(container) {
        let html = '<div class="diary-search">' +
            '<input type="text" id="diarySearchInput" placeholder="Cerca nelle tue voci..." value="' + esc(state.searchQuery) + '" />' +
            '</div>';

        if (state.filterDate) {
            html += '<button class="diary-back" id="backToAll">&larr; Tutte le voci</button>';
            html += '<p class="diary-date-heading">' + humanDate(state.filterDate) + '</p>';
            const dayEntries = entriesForDate(state.filterDate);
            html += dayEntries.length ? dayEntries.map(entryItemHtml).join('') : '<p class="empty-hint">Nessuna voce in questo giorno</p>';
        } else {
            const hiddenToday = (function () { try { return localStorage.getItem('diaryPromptHidden') === todayStr(); } catch (e) { return false; } })();
            if (!state.searchQuery && !hiddenToday) {
                html += '<div class="diary-prompt"><p>' + esc(promptForToday()) + '</p><button id="hidePrompt" aria-label="Nascondi spunto">&times;</button></div>';
            }

            let list = data.entries.slice();
            if (state.searchQuery) {
                const q = state.searchQuery.toLowerCase();
                list = list.filter(e => (e.title || '').toLowerCase().includes(q) || (e.text || '').toLowerCase().includes(q));
            }
            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

            if (!list.length) {
                html += '<p class="empty-hint">' + (state.searchQuery ? 'Nessuna voce trovata' : 'Nessuna voce ancora. Scrivi la prima!') + '</p>';
            } else {
                let lastDate = null;
                list.forEach(e => {
                    if (e.date !== lastDate) { html += '<p class="diary-date-heading">' + humanDate(e.date) + '</p>'; lastDate = e.date; }
                    html += entryItemHtml(e);
                });
            }
        }

        container.innerHTML = html;

        const searchInput = document.getElementById('diarySearchInput');
        searchInput.addEventListener('input', () => { state.searchQuery = searchInput.value; renderList(container); searchInput.focus(); searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); });

        const back = document.getElementById('backToAll');
        if (back) back.onclick = () => { state.filterDate = null; renderList(container); };

        const hideBtn = document.getElementById('hidePrompt');
        if (hideBtn) hideBtn.onclick = () => { try { localStorage.setItem('diaryPromptHidden', todayStr()); } catch (e) { } renderList(container); };

        container.querySelectorAll('.entry-item').forEach(row => {
            row.addEventListener('click', () => {
                const e = data.entries.find(x => x.id === row.getAttribute('data-id'));
                if (e) openEntryModal('edit', e, e.id);
            });
        });
    }

    // ---------- Modal ----------
    function moodPickerHtml(selectedId) {
        return '<div class="mood-picker">' + MOODS.map(m =>
            '<button type="button" class="mood-btn' + (m.id === selectedId ? ' selected' : '') + '" data-mood="' + m.id + '" style="--mood-color:' + m.color + ';--mood-wash:' + m.color + '22;">' +
            m.emoji + '<span>' + m.label + '</span>' +
            '</button>'
        ).join('') + '</div>';
    }

    function openEntryModal(mode, vals, entryId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const isEdit = mode === 'edit';
        let selectedMood = vals.mood || null;

        overlay.innerHTML =
            '<div class="modal-box">' +
            '<p class="modal-title">' + (isEdit ? 'Modifica voce' : 'Nuova voce') + '</p>' +
            '<label class="field-label">Data</label>' +
            '<input type="date" id="eDate" value="' + (vals.date || todayStr()) + '" />' +
            '<label class="field-label">Umore</label>' +
            moodPickerHtml(selectedMood) +
            '<label class="field-label">Titolo</label>' +
            '<input type="text" id="eTitle" placeholder="Un titolo breve" value="' + esc(vals.title || '') + '" />' +
            '<label class="field-label">Testo</label>' +
            '<textarea id="eText" placeholder="Scrivi quello che vuoi...">' + esc(vals.text || '') + '</textarea>' +
            '<div class="modal-actions">' +
            (isEdit ? '<button class="btn btn-danger" id="eDelete">Elimina</button>' : '') +
            '<button class="btn btn-ghost" id="eCancel">Annulla</button>' +
            '<button class="btn btn-primary" id="eSave">Salva</button>' +
            '</div>' +
            '</div>';

        overlay.querySelectorAll('.mood-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedMood = btn.getAttribute('data-mood');
                overlay.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('selected', b === btn));
            });
        });

        overlay.querySelector('#eCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        if (isEdit) {
            overlay.querySelector('#eDelete').onclick = () => {
                if (!confirm('Eliminare questa voce di diario?')) return;
                data.entries = data.entries.filter(x => x.id !== entryId);
                saveData(); overlay.remove(); renderContent();
            };
        }

        overlay.querySelector('#eSave').onclick = () => {
            const dateVal = overlay.querySelector('#eDate').value || todayStr();
            const titleVal = overlay.querySelector('#eTitle').value.trim();
            const textVal = overlay.querySelector('#eText').value.trim();
            if (!titleVal && !textVal) return;

            if (isEdit) {
                const e = data.entries.find(x => x.id === entryId);
                Object.assign(e, { date: dateVal, title: titleVal, text: textVal, mood: selectedMood });
            } else {
                data.entries.push({ id: uid(), date: dateVal, title: titleVal, text: textVal, mood: selectedMood, createdAt: new Date().toISOString() });
            }
            saveData();
            overlay.remove();
            renderContent();
        };

        document.body.appendChild(overlay);
        setTimeout(() => { const t = overlay.querySelector('#eTitle'); if (t) t.focus(); }, 50);
    }

    // ---------- Init ----------
    function init() {
        data = loadData();
        renderShell();
        renderContent();
    }

    window.Diario = { onShow: function () { renderContent(); } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();