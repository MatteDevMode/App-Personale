(function () {
    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayStr() { return formatDate(new Date()); }
    function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function eur(n) { return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }); }
    function num(v) { const n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? NaN : n; }
    function sum(list) { return list.reduce((s, t) => s + (t.result || 0), 0); }
    function fmtShort(n) { return (n > 0 ? '+' : '') + String(Math.round(n * 100) / 100).replace('.', ',') + '\u20ac'; }
    function signed(n) { return (n > 0 ? '+' : '') + eur(n); }

    const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const WEEKDAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const DOW_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    function humanDate(s) { const d = parseDateStr(s); return WEEKDAYS_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }

    const MAX_SIDE = 1920;       // lato massimo: sotto questa soglia la foto non viene ridimensionata
    const MAX_CHARS = 800000;    // limite di sicurezza per il documento Firestore (1 MB)
    const MAX_PHOTOS = 4;

    // ---------- Stile ----------
    function injectStyle() {
        if (document.getElementById('tradingStyle')) return;
        const s = document.createElement('style');
        s.id = 'tradingStyle';
        s.textContent =
            '#page-trading{padding-bottom:88px;}' +
            '.cal-day.win{background:rgba(63,207,160,.13);border-color:rgba(63,207,160,.4);}' +
            '.cal-day.loss{background:rgba(232,96,76,.13);border-color:rgba(232,96,76,.4);}' +
            '.tr-res{font-size:11px;font-weight:600;margin-top:auto;}' +
            '.tr-res.win{color:var(--teal);}.tr-res.loss{color:#E8604C;}' +
            '.tr-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}' +
            '.tr-photo{position:relative;margin-bottom:8px;}' +
            '.tr-photo img{width:100%;display:block;border-radius:10px;border:1px solid var(--border);cursor:zoom-in;}' +
            '.tr-photo button{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:none;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;font-size:15px;line-height:1;}' +
            '.tr-hint{font-size:11.5px;color:var(--text-muted);margin:6px 0 0;}' +
            '.tr-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;z-index:200;padding:12px;cursor:zoom-out;}' +
            '.tr-lightbox img{max-width:100%;max-height:100%;object-fit:contain;}' +
            '@media(max-width:720px){#page-trading{padding-bottom:96px;}.tr-res{font-size:9.5px;}}';
        document.head.appendChild(s);
    }

    // ---------- Dati ----------
    function defaultData() { return { strategies: [], trades: [] }; }
    let data = defaultData();
    let docRef = null;
    let unsubscribe = null;
    let ready = false;
    const photoCache = new Map();

    function saveData() {
        if (!docRef) return;
        docRef.set(data).catch(err => console.error('Errore salvataggio Trading:', err));
    }
    function photosRef() { return docRef.collection('photos'); }
    function strategyById(id) { return data.strategies.find(s => s.id === id); }

    const state = {
        view: 'calendar',
        calYear: new Date().getFullYear(),
        calMonth: new Date().getMonth(),
        filterDate: null,
        period: 'month'
    };
    let pie = null;

    // ---------- Foto ----------
    function readAsDataURL(file) {
        return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    }
    function loadImage(src) {
        return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('immagine non valida')); i.src = src; });
    }

    // Se la foto è già piccola resta identica all'originale (nessuna perdita di qualità);
    // altrimenti viene ridotta il minimo necessario per entrare nel limite di Firestore.
    async function processImage(file) {
        if (!file.type || file.type.indexOf('image/') !== 0) throw new Error('il file non è un\u2019immagine');
        const original = await readAsDataURL(file);
        const img = await loadImage(original);
        const side = Math.max(img.naturalWidth, img.naturalHeight);
        if (side <= MAX_SIDE && original.length <= MAX_CHARS && /^data:image\/(png|jpeg|webp)/.test(original)) return original;

        let scale = Math.min(1, MAX_SIDE / side);
        for (let i = 0; i < 6; i++) {
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * scale));
            c.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            for (const q of [0.92, 0.85, 0.75, 0.65]) {
                const out = c.toDataURL('image/jpeg', q);
                if (out.length <= MAX_CHARS) return out;
            }
            scale *= 0.8;
        }
        throw new Error('immagine troppo grande');
    }

    async function loadPhoto(id) {
        if (photoCache.has(id)) return photoCache.get(id);
        try {
            const snap = await photosRef().doc(id).get();
            if (snap.exists) { photoCache.set(id, snap.data().data); return snap.data().data; }
        } catch (err) { console.error('Errore lettura foto:', err); }
        return null;
    }

    function openLightbox(src) {
        const o = document.createElement('div');
        o.className = 'tr-lightbox';
        const img = document.createElement('img');
        img.src = src;
        o.appendChild(img);
        o.onclick = () => o.remove();
        document.body.appendChild(o);
    }

    // ---------- Statistiche ----------
    function periodRange() {
        const t = new Date();
        let start, end = todayStr();
        if (state.period === 'month') {
            start = formatDate(new Date(state.calYear, state.calMonth, 1));
            end = formatDate(new Date(state.calYear, state.calMonth + 1, 0));
        } else if (state.period === '3months') start = formatDate(new Date(t.getFullYear(), t.getMonth() - 2, 1));
        else if (state.period === 'year') start = formatDate(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate()));
        else { start = '0000-00-00'; end = '9999-99-99'; }
        return { start, end };
    }

    function computeStats(list) {
        const wins = list.filter(t => t.result > 0);
        const losses = list.filter(t => t.result < 0);
        const grossW = sum(wins), grossL = Math.abs(sum(losses));
        return {
            n: list.length, wins: wins.length, losses: losses.length, be: list.length - wins.length - losses.length,
            net: sum(list),
            winRate: list.length ? Math.round(wins.length / list.length * 100) : 0,
            avgWin: wins.length ? grossW / wins.length : 0,
            avgLoss: losses.length ? grossL / losses.length : 0,
            pf: grossL ? grossW / grossL : (grossW ? Infinity : 0)
        };
    }

    function statsHtml() {
        const { start, end } = periodRange();
        const list = data.trades.filter(t => t.date >= start && t.date <= end);
        const s = computeStats(list);
        const labels = { month: 'Mese', '3months': '3 mesi', year: 'Anno', all: 'Sempre' };

        let html = '<div class="period-switch" style="margin-top:1.5rem;">' +
            Object.keys(labels).map(k => '<button class="period-btn' + (state.period === k ? ' active' : '') + '" data-p="' + k + '">' + labels[k] + '</button>').join('') + '</div>';

        html += '<div class="resell-summary">' +
            '<div class="resell-stat"><p>Risultato</p><p style="color:' + (s.net > 0 ? 'var(--teal)' : (s.net < 0 ? '#E8604C' : 'inherit')) + ';">' + signed(s.net) + '</p></div>' +
            '<div class="resell-stat"><p>Trade</p><p>' + s.n + '</p></div>' +
            '<div class="resell-stat"><p>Win rate</p><p>' + s.winRate + '%</p></div>' +
            '<div class="resell-stat"><p>Guadagno medio</p><p>' + eur(s.avgWin) + '</p></div>' +
            '<div class="resell-stat"><p>Perdita media</p><p>' + eur(s.avgLoss) + '</p></div>' +
            '<div class="resell-stat"><p>Profit factor</p><p>' + (!s.n ? '\u2014' : (s.pf === Infinity ? '\u221e' : s.pf.toFixed(2).replace('.', ','))) + '</p></div>' +
            '</div>';

        if (!s.n) return html + '<p class="empty-hint">Nessun trade nel periodo.</p>';

        html += '<div class="chart-card"><p class="chart-title">Vinti e persi</p><div class="chart-wrap"><canvas id="trChartPie"></canvas></div></div>';

        const groups = {};
        list.forEach(t => { const k = t.strategyId && strategyById(t.strategyId) ? t.strategyId : '_none'; (groups[k] = groups[k] || []).push(t); });
        const rows = Object.keys(groups).map(k => ({ name: k === '_none' ? 'Senza strategia' : strategyById(k).name, st: computeStats(groups[k]) }))
            .sort((a, b) => b.st.net - a.st.net);
        html += '<p class="section-label">Per strategia</p>' + rows.map(r =>
            '<div class="tx-item" style="cursor:default;"><div class="tx-body"><div class="tx-title">' + esc(r.name) + '</div>' +
            '<div class="tx-meta">' + r.st.n + ' trade \u00b7 win rate ' + r.st.winRate + '%</div></div>' +
            '<div class="tx-amount ' + (r.st.net > 0 ? 'income' : (r.st.net < 0 ? 'expense' : 'transfer')) + '">' + signed(r.st.net) + '</div></div>').join('');
        return html;
    }

    function drawPie() {
        if (pie) { pie.destroy(); pie = null; }
        const canvas = document.getElementById('trChartPie');
        if (!canvas || typeof Chart === 'undefined') return;
        const { start, end } = periodRange();
        const s = computeStats(data.trades.filter(t => t.date >= start && t.date <= end));
        const labels = ['Vinti', 'Persi'], values = [s.wins, s.losses], colors = ['#3FCFA0', '#E8604C'];
        if (s.be) { labels.push('Pareggio'); values.push(s.be); colors.push('#8890A6'); }
        const txt = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#9BA3B8';
        pie = new Chart(canvas, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
            options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 11 } } } } }
        });
    }

    // ---------- Shell ----------
    function renderShell() {
        const page = document.getElementById('page-trading');
        page.innerHTML =
            '<div class="todo-top">' +
            '<div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Trading</h1></div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<div class="view-switch"><button id="trViewCal">Calendario</button><button id="trViewList">Lista</button></div>' +
            '<button class="icon-btn" id="trStratBtn" title="Strategie"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/></svg></button>' +
            '</div></div>' +
            '<div id="tradingContent"></div>' +
            '<div class="fin-bottom-bar"><button class="fin-new-btn" id="trNewBtn">+ Nuovo trade</button></div>';
        document.getElementById('trViewCal').onclick = () => { state.view = 'calendar'; state.filterDate = null; renderContent(); };
        document.getElementById('trViewList').onclick = () => { state.view = 'list'; renderContent(); };
        document.getElementById('trStratBtn').onclick = () => openStrategyManager();
        document.getElementById('trNewBtn').onclick = () => openTradeModal('create', { date: state.filterDate || todayStr() }, null);
    }

    function renderContent() {
        document.getElementById('trViewCal').classList.toggle('active', state.view === 'calendar');
        document.getElementById('trViewList').classList.toggle('active', state.view === 'list');
        const c = document.getElementById('tradingContent');
        if (state.view === 'calendar') renderCalendar(c); else renderList(c);
    }

    // ---------- Calendario ----------
    function renderCalendar(container) {
        const year = state.calYear, month = state.calMonth;
        const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrev = new Date(year, month, 0).getDate();
        const today = todayStr();

        const byDate = {};
        data.trades.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });

        let cells = '';
        for (let i = 0; i < 42; i++) {
            let cellDate, other = false;
            const dayNum = i - startWeekday + 1;
            if (dayNum < 1) { cellDate = new Date(year, month - 1, daysInPrev + dayNum); other = true; }
            else if (dayNum > daysInMonth) { cellDate = new Date(year, month + 1, dayNum - daysInMonth); other = true; }
            else cellDate = new Date(year, month, dayNum);
            const dStr = formatDate(cellDate);
            const trades = byDate[dStr] || [];
            const net = sum(trades);
            const cls = net > 0 ? ' win' : (net < 0 ? ' loss' : '');
            cells += '<div class="cal-day' + (other ? ' other-month' : '') + (dStr === today ? ' today' : '') + cls + '" data-date="' + dStr + '">' +
                '<span class="cal-day-num">' + cellDate.getDate() + '</span>' +
                (trades.length ? '<span class="tr-res' + cls + '">' + fmtShort(net) + '</span>' : '') +
                '<button class="cal-add-btn" data-add="' + dStr + '">+</button></div>';
        }

        const arrow = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
        container.innerHTML =
            '<div class="cal-nav"><button class="icon-btn" id="trPrev">' + arrow('M15 6l-6 6 6 6') + '</button>' +
            '<span class="cal-nav-title">' + MONTHS[month] + ' ' + year + '</span>' +
            '<button class="icon-btn" id="trNext">' + arrow('M9 6l6 6-6 6') + '</button></div>' +
            '<div class="cal-grid">' + DOW_SHORT.map(d => '<div class="cal-dow">' + d + '</div>').join('') + cells + '</div>' +
            statsHtml();

        document.getElementById('trPrev').onclick = () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(container); };
        document.getElementById('trNext').onclick = () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(container); };
        container.querySelectorAll('.cal-day').forEach(cell => cell.addEventListener('click', e => {
            if (e.target.closest('.cal-add-btn')) return;
            state.filterDate = cell.getAttribute('data-date');
            state.view = 'list';
            renderContent();
        }));
        container.querySelectorAll('.cal-add-btn').forEach(btn => btn.addEventListener('click', e => {
            e.stopPropagation();
            openTradeModal('create', { date: btn.getAttribute('data-add') }, null);
        }));
        container.querySelectorAll('.period-btn').forEach(b => b.addEventListener('click', () => {
            state.period = b.getAttribute('data-p');
            renderCalendar(container);
        }));
        drawPie();
    }

    // ---------- Lista ----------
    function tradeItemHtml(t) {
        const color = t.result > 0 ? '#3FCFA0' : (t.result < 0 ? '#E8604C' : '#8890A6');
        const st = strategyById(t.strategyId);
        const levels = [t.entry && 'Entrata ' + t.entry, t.tp && 'TP ' + t.tp, t.sl && 'SL ' + t.sl].filter(Boolean).join(' \u00b7 ');
        const photos = (t.photoIds || []).length;
        return '<div class="entry-item" style="--entry-color:' + color + ';" data-id="' + t.id + '">' +
            '<div class="entry-top"><span class="entry-title">' + esc(st ? st.name : 'Senza strategia') + (photos ? ' \ud83d\udcf7' : '') + '</span>' +
            '<span class="entry-time" style="color:' + color + ';font-weight:600;font-size:13px;">' + signed(t.result) + '</span></div>' +
            (levels ? '<p class="entry-preview">' + esc(levels) + '</p>' : '') +
            (t.notes ? '<p class="entry-preview">' + esc(t.notes) + '</p>' : '') + '</div>';
    }

    function renderList(container) {
        if (pie) { pie.destroy(); pie = null; }
        let html = '';
        let list;
        if (state.filterDate) {
            html += '<button class="diary-back" id="trBack">&larr; Tutti i trade</button><p class="diary-date-heading">' + humanDate(state.filterDate) + '</p>';
            list = data.trades.filter(t => t.date === state.filterDate);
        } else list = data.trades.slice();
        list.sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));

        if (!list.length) html += '<p class="empty-hint">' + (state.filterDate ? 'Nessun trade in questo giorno' : 'Nessun trade ancora. Aggiungi il primo!') + '</p>';
        else {
            let last = null;
            list.forEach(t => {
                if (!state.filterDate && t.date !== last) { html += '<p class="diary-date-heading">' + humanDate(t.date) + '</p>'; last = t.date; }
                html += tradeItemHtml(t);
            });
        }
        container.innerHTML = html;
        const back = document.getElementById('trBack');
        if (back) back.onclick = () => { state.filterDate = null; renderList(container); };
        container.querySelectorAll('.entry-item').forEach(row => row.addEventListener('click', () => {
            const t = data.trades.find(x => x.id === row.getAttribute('data-id'));
            if (t) openTradeModal('edit', t, t.id);
        }));
    }

    // ---------- Modale trade ----------
    function openTradeModal(mode, vals, tradeId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const isEdit = mode === 'edit';
        let sign = (vals.result || 0) < 0 ? 'loss' : 'win';
        const photos = [];   // { id, data, isNew }
        const removed = [];
        const noStrategies = !data.strategies.length;

        const stratOptions = data.strategies.map(s => '<option value="' + s.id + '"' + (s.id === vals.strategyId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
            '<option value=""' + (!noStrategies && !vals.strategyId ? ' selected' : '') + '>Nessuna</option>' +
            '<option value="__new__"' + (noStrategies ? ' selected' : '') + '>+ Nuova strategia\u2026</option>';

        overlay.innerHTML =
            '<div class="modal-box">' +
            '<p class="modal-title">' + (isEdit ? 'Modifica trade' : 'Nuovo trade') + '</p>' +
            '<label class="field-label">Data</label><input type="date" id="tDate" value="' + (vals.date || todayStr()) + '" />' +
            '<label class="field-label">Strategia</label><select id="tStrat">' + stratOptions + '</select>' +
            '<input type="text" id="tStratNew" placeholder="Nome della strategia" style="margin-top:8px;display:' + (noStrategies ? 'block' : 'none') + ';" />' +
            '<div class="tr-row3">' +
            '<div><label class="field-label">Entrata</label><input type="text" inputmode="decimal" id="tEntry" value="' + esc(vals.entry || '') + '" /></div>' +
            '<div><label class="field-label">TP</label><input type="text" inputmode="decimal" id="tTp" value="' + esc(vals.tp || '') + '" /></div>' +
            '<div><label class="field-label">SL</label><input type="text" inputmode="decimal" id="tSl" value="' + esc(vals.sl || '') + '" /></div>' +
            '</div>' +
            '<label class="field-label">Risultato</label>' +
            '<div class="type-switch"><button type="button" class="type-btn income' + (sign === 'win' ? ' selected' : '') + '" data-s="win">Guadagno</button>' +
            '<button type="button" class="type-btn expense' + (sign === 'loss' ? ' selected' : '') + '" data-s="loss">Perdita</button></div>' +
            '<input type="text" inputmode="decimal" id="tAmount" placeholder="Importo in \u20ac" value="' + (isEdit ? Math.abs(vals.result || 0) : '') + '" style="margin-top:8px;" />' +
            '<label class="field-label">Note</label><textarea id="tNotes" placeholder="Cosa ha funzionato, cosa no...">' + esc(vals.notes || '') + '</textarea>' +
            '<label class="field-label">Foto</label><div id="tPhotos"></div>' +
            '<button type="button" class="btn btn-ghost" id="tAddPhoto" style="width:100%;">Aggiungi foto</button>' +
            '<input type="file" id="tFile" accept="image/*" multiple style="display:none;" />' +
            '<p class="tr-hint">Su PC puoi anche incollare uno screenshot con Ctrl+V.</p>' +
            '<div class="modal-actions">' + (isEdit ? '<button class="btn btn-danger" id="tDelete">Elimina</button>' : '') +
            '<button class="btn btn-ghost" id="tCancel">Annulla</button><button class="btn btn-primary" id="tSave">Salva</button></div></div>';

        const q = sel => overlay.querySelector(sel);

        function drawPhotos() {
            const box = q('#tPhotos');
            box.innerHTML = photos.map((p, i) => '<div class="tr-photo"><img data-i="' + i + '" alt="Foto del trade" /><button type="button" data-rm="' + i + '">\u00d7</button></div>').join('');
            box.querySelectorAll('img').forEach(img => { const p = photos[+img.getAttribute('data-i')]; img.src = p.data; img.onclick = () => openLightbox(p.data); });
            box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
                const p = photos.splice(+b.getAttribute('data-rm'), 1)[0];
                if (!p.isNew) removed.push(p.id);
                drawPhotos();
            });
            q('#tAddPhoto').style.display = photos.length >= MAX_PHOTOS ? 'none' : 'block';
        }

        async function addFiles(files) {
            for (const f of Array.from(files)) {
                if (photos.length >= MAX_PHOTOS) break;
                try { photos.push({ id: uid('ph'), data: await processImage(f), isNew: true }); }
                catch (err) { alert('Foto non aggiunta: ' + err.message); }
            }
            drawPhotos();
        }

        function onPaste(e) {
            const files = [];
            Array.from((e.clipboardData && e.clipboardData.items) || []).forEach(it => { if (it.kind === 'file' && it.type.indexOf('image/') === 0) files.push(it.getAsFile()); });
            if (files.length) { e.preventDefault(); addFiles(files); }
        }
        document.addEventListener('paste', onPaste);
        function close() { document.removeEventListener('paste', onPaste); overlay.remove(); }

        (vals.photoIds || []).forEach(id => loadPhoto(id).then(d => { if (d) { photos.push({ id, data: d, isNew: false }); drawPhotos(); } }));
        drawPhotos();

        overlay.querySelectorAll('.type-btn').forEach(b => b.addEventListener('click', () => {
            sign = b.getAttribute('data-s');
            overlay.querySelectorAll('.type-btn').forEach(x => x.classList.toggle('selected', x === b));
        }));
        q('#tStrat').addEventListener('change', e => { q('#tStratNew').style.display = e.target.value === '__new__' ? 'block' : 'none'; });
        q('#tAddPhoto').onclick = () => q('#tFile').click();
        q('#tFile').addEventListener('change', e => { const f = e.target.files; addFiles(f).then(() => { e.target.value = ''; }); });
        q('#tCancel').onclick = close;
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        if (isEdit) {
            q('#tDelete').onclick = () => {
                if (!confirm('Eliminare questo trade?')) return;
                (vals.photoIds || []).forEach(id => { photosRef().doc(id).delete().catch(() => { }); photoCache.delete(id); });
                data.trades = data.trades.filter(x => x.id !== tradeId);
                saveData(); close(); renderContent();
            };
        }

        q('#tSave').onclick = async () => {
            const amt = num(q('#tAmount').value);
            if (isNaN(amt) || amt < 0) { q('#tAmount').style.borderColor = '#E8604C'; return; }
            const result = sign === 'loss' && amt ? -amt : amt;

            let strategyId = q('#tStrat').value || null;
            if (strategyId === '__new__') {
                const name = q('#tStratNew').value.trim();
                const existing = name && data.strategies.find(s => s.name.toLowerCase() === name.toLowerCase());
                if (!name) strategyId = null;
                else if (existing) strategyId = existing.id;
                else { strategyId = uid('st'); data.strategies.push({ id: strategyId, name }); }
            }

            const saveBtn = q('#tSave');
            saveBtn.disabled = true;
            try {
                const ref = photosRef();
                await Promise.all(photos.filter(p => p.isNew).map(p => ref.doc(p.id).set({ data: p.data, createdAt: new Date().toISOString() })));
                await Promise.all(removed.map(id => ref.doc(id).delete()));
            } catch (err) {
                console.error('Errore foto Trading:', err);
                alert('Salvataggio delle foto non riuscito: ' + err.message);
                saveBtn.disabled = false;
                return;
            }
            photos.forEach(p => photoCache.set(p.id, p.data));
            removed.forEach(id => photoCache.delete(id));

            const fields = {
                date: q('#tDate').value || todayStr(), strategyId,
                entry: q('#tEntry').value.trim(), tp: q('#tTp').value.trim(), sl: q('#tSl').value.trim(),
                result, notes: q('#tNotes').value.trim(), photoIds: photos.map(p => p.id)
            };
            if (isEdit) Object.assign(data.trades.find(x => x.id === tradeId), fields);
            else data.trades.push(Object.assign({ id: uid('tr'), createdAt: new Date().toISOString() }, fields));
            saveData(); close(); renderContent();
        };

        document.body.appendChild(overlay);
    }

    // ---------- Gestione strategie ----------
    function openStrategyManager() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        function draw() {
            overlay.innerHTML =
                '<div class="modal-box"><p class="modal-title">Strategie</p><div id="stList"></div>' +
                '<p class="field-label">Nuova strategia</p><input type="text" id="newSt" placeholder="Nome strategia" />' +
                '<div class="row-2" style="margin-top:10px;"><button class="btn btn-primary" id="addSt">Aggiungi</button><button class="btn btn-ghost" id="closeSt">Chiudi</button></div></div>';
            const list = overlay.querySelector('#stList');
            list.innerHTML = data.strategies.map(s =>
                '<div class="cat-row"><span style="flex:1;font-size:14px;">' + esc(s.name) + '</span>' +
                '<button class="icon-btn" data-del="' + s.id + '" style="width:26px;height:26px;">\u00d7</button></div>').join('') || '<p class="empty-hint">Nessuna strategia</p>';
            list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
                data.strategies = data.strategies.filter(s => s.id !== b.getAttribute('data-del'));
                saveData(); draw(); renderContent();
            }));
            overlay.querySelector('#closeSt').onclick = () => overlay.remove();
            overlay.querySelector('#addSt').onclick = () => {
                const name = overlay.querySelector('#newSt').value.trim();
                if (!name || data.strategies.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
                data.strategies.push({ id: uid('st'), name });
                saveData(); draw(); renderContent();
            };
        }
        draw();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ---------- Init ----------
    function renderLoading() {
        const page = document.getElementById('page-trading');
        if (page) page.innerHTML = '<p class="empty-hint">Caricamento...</p>';
    }

    function startForUser(uid) {
        ready = false;
        if (unsubscribe) unsubscribe();
        injectStyle();
        renderLoading();
        docRef = window.db.collection('users').doc(uid).collection('modules').doc('trading');
        unsubscribe = docRef.onSnapshot(snap => {
            if (snap.exists) data = Object.assign(defaultData(), snap.data());
            else { data = defaultData(); docRef.set(data).catch(err => console.error('Errore inizializzazione Trading:', err)); }
            if (!ready) { ready = true; renderShell(); }
            renderContent();
        }, err => { console.error('Errore lettura Trading:', err); renderLoading(); });
    }

    function stopForLogout() {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        docRef = null;
        ready = false;
        data = defaultData();
        photoCache.clear();
    }

    window.Trading = { onShow: function () { if (ready) renderContent(); } };

    window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
    window.addEventListener('app:authLoggedOut', stopForLogout);
    if (window.currentUser) startForUser(window.currentUser.uid);
})();