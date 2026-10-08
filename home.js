(function () {
    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayStr() { return formatDate(new Date()); }
    function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function shiftDate(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return formatDate(d); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function eur(n) { return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }); }
    function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

    const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    const MOOD_EMOJI = { ottimo: '😄', bene: '🙂', neutro: '😐', giu: '😞', arrabbiato: '😠' };

    let todo, diario, fin;
    let unsubs = [];
    let loaded = {};

    function resetData() {
        todo = { tasks: [], categories: [] };
        diario = { entries: [] };
        fin = { accounts: [], categories: [], transactions: [] };
        loaded = { todo: false, diario: false, finanze: false };
    }
    resetData();

    function injectStyle() {
        if (document.getElementById('homeStyle')) return;
        const s = document.createElement('style');
        s.id = 'homeStyle';
        s.textContent =
            '.home-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}' +
            '.home-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.1rem 1.25rem;cursor:pointer;}' +
            '.home-card:hover{border-color:var(--border-strong);}' +
            '.home-card.wide{grid-column:1/-1;}' +
            '.home-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}' +
            '.home-title{font-family:var(--font-head);font-weight:600;font-size:14.5px;margin:0;}' +
            '.home-link{font-size:12px;color:var(--accent);}' +
            '.home-big{font-family:var(--font-head);font-size:26px;font-weight:700;margin:0;}' +
            '.home-big.negative{color:#E8604C;}' +
            '.home-sub{font-size:12.5px;color:var(--text-secondary);margin:3px 0 0;}' +
            '.home-task{display:flex;gap:10px;align-items:center;padding:8px 10px;border-left:3px solid var(--c,var(--border));background:var(--bg-card-hover);border-radius:8px;margin-bottom:6px;font-size:13.5px;}' +
            '.home-task.past{opacity:.55;}' +
            '.home-task-time{color:var(--text-secondary);font-size:12px;min-width:42px;}' +
            '.home-warn{color:#E8604C;font-size:12.5px;margin:8px 0 0;}' +
            '.home-card .budget-bar-track{margin-top:8px;}' +
            '@media(max-width:720px){.home-grid{grid-template-columns:1fr;}}';
        document.head.appendChild(s);
    }

    // ---------- Calcoli ----------
    function totalBalance() {
        return fin.accounts.reduce((sum, a) => {
            let bal = a.initialBalance || 0;
            fin.transactions.forEach(t => {
                if (t.type === 'income' && t.accountId === a.id) bal += t.amount;
                else if (t.type === 'expense' && t.accountId === a.id) bal -= t.amount;
                else if (t.type === 'transfer') {
                    if (t.fromAccountId === a.id) bal -= t.amount;
                    if (t.toAccountId === a.id) bal += t.amount;
                }
            });
            return sum + bal;
        }, 0);
    }

    function monthSpent(catId, ym) {
        return fin.transactions.filter(t => t.type === 'expense' && (catId ? t.categoryId === catId : true) && (t.date || '').slice(0, 7) === ym)
            .reduce((s, t) => s + t.amount, 0);
    }

    function diaryStreak() {
        const dates = new Set(diario.entries.map(e => e.date));
        let d = todayStr();
        if (!dates.has(d)) d = shiftDate(d, -1);
        let n = 0;
        while (dates.has(d)) { n++; d = shiftDate(d, -1); }
        return n;
    }

    // ---------- Card ----------
    function todayCard() {
        const today = todayStr();
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const tasks = todo.tasks || [];
        const open = tasks.filter(t => t.date === today && !t.completed)
            .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
        const done = tasks.filter(t => t.date === today && t.completed).length;
        const overdue = tasks.filter(t => t.date && t.date < today && !t.completed).length;
        const tomorrow = tasks.filter(t => t.date === shiftDate(today, 1) && !t.completed).length;
        const total = open.length + done;
        const pct = total ? Math.round(done / total * 100) : 0;

        let html = '<div class="home-card wide" data-go="todo"><div class="home-head"><p class="home-title">Oggi</p><span class="home-link">Cose da fare →</span></div>';
        if (!total) {
            html += '<p class="home-sub">Niente in programma per oggi.</p>';
        } else {
            html += '<p class="home-sub" style="margin:0 0 4px;">' + done + ' di ' + total + ' completate</p>' +
                '<div class="budget-bar-track" style="margin-bottom:12px;"><div class="budget-bar-fill ok" style="width:' + pct + '%;"></div></div>';
            if (!open.length) html += '<p class="home-sub">Tutto fatto per oggi 🎉</p>';
            open.slice(0, 6).forEach(t => {
                const cat = (todo.categories || []).find(c => c.id === t.categoryId);
                const past = t.startTime && toMin(t.startTime) < nowMin;
                html += '<div class="home-task' + (past ? ' past' : '') + '" style="--c:' + (cat ? cat.color : '#5E6779') + ';">' +
                    '<span class="home-task-time">' + (t.startTime || '') + '</span><span>' + esc(t.title) + '</span></div>';
            });
            if (open.length > 6) html += '<p class="home-sub">+' + (open.length - 6) + ' altre</p>';
        }
        if (overdue) html += '<p class="home-warn">⚠️ ' + overdue + (overdue === 1 ? ' attività scaduta' : ' attività scadute') + '</p>';
        if (tomorrow) html += '<p class="home-sub">Domani: ' + tomorrow + (tomorrow === 1 ? ' attività' : ' attività') + '</p>';
        return html + '</div>';
    }

    function financeCard() {
        const total = totalBalance();
        const ym = todayStr().slice(0, 7);
        let html = '<div class="home-card" data-go="finanze"><div class="home-head"><p class="home-title">Finanze</p><span class="home-link">Apri →</span></div>' +
            '<p class="home-big' + (total < 0 ? ' negative' : '') + '">' + eur(total) + '</p>' +
            '<p class="home-sub">Saldo totale · spese di ' + MONTHS[new Date().getMonth()] + ': ' + eur(monthSpent(null, ym)) + '</p>';

        let worst = null;
        (fin.categories || []).forEach(c => {
            if (!c.budget || c.budget <= 0) return;
            const spent = monthSpent(c.id, ym);
            const pct = spent / c.budget * 100;
            if (!worst || pct > worst.pct) worst = { c, spent, pct };
        });
        if (worst) {
            const cls = worst.pct >= 100 ? 'over' : (worst.pct >= 80 ? 'warn' : 'ok');
            html += '<p class="home-sub" style="margin-top:12px;">Budget ' + esc(worst.c.name) + ': ' + eur(worst.spent) + ' / ' + eur(worst.c.budget) + '</p>' +
                '<div class="budget-bar-track"><div class="budget-bar-fill ' + cls + '" style="width:' + Math.min(100, worst.pct) + '%;"></div></div>';
        }
        return html + '</div>';
    }

    function diaryCard() {
        const today = todayStr();
        const todayEntries = (diario.entries || []).filter(e => e.date === today)
            .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        const streak = diaryStreak();
        const last = todayEntries[todayEntries.length - 1];
        const emoji = last && MOOD_EMOJI[last.mood] ? ' ' + MOOD_EMOJI[last.mood] : '';

        let html = '<div class="home-card" data-go="diario"><div class="home-head"><p class="home-title">Diario</p><span class="home-link">' + (todayEntries.length ? 'Apri' : 'Scrivi') + ' →</span></div>';
        if (todayEntries.length) {
            html += '<p class="home-big" style="font-size:20px;">Hai scritto oggi' + emoji + '</p>';
        } else {
            html += '<p class="home-big" style="font-size:20px;">Oggi non hai ancora scritto</p>';
        }
        html += '<p class="home-sub">' + (streak > 1 ? 'Serie: ' + streak + ' giorni di fila' : (streak === 1 ? 'Ieri o oggi hai scritto: continua così' : 'Nessuna serie attiva')) + '</p>';
        return html + '</div>';
    }

    // ---------- Render ----------
    function render() {
        const page = document.getElementById('page-home');
        if (!page) return;
        if (!loaded.todo || !loaded.diario || !loaded.finanze) {
            page.innerHTML = '<p class="empty-hint">Caricamento...</p>';
            return;
        }
        const now = new Date();
        const h = now.getHours();
        const greet = h < 12 ? 'Buongiorno' : (h < 18 ? 'Buon pomeriggio' : 'Buonasera');
        const dateLabel = WEEKDAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()];

        page.innerHTML =
            '<div class="page-header"><p class="eyebrow" style="text-transform:capitalize;">' + dateLabel + '</p><h1>' + greet + '</h1></div>' +
            '<div class="home-grid">' + todayCard() + financeCard() + diaryCard() + '</div>';

        page.querySelectorAll('[data-go]').forEach(el => {
            el.addEventListener('click', () => switchPage(el.getAttribute('data-go')));
        });
    }

    // ---------- Init ----------
    function listen(ref, key, assign) {
        unsubs.push(ref.onSnapshot(snap => {
            assign(snap.exists ? snap.data() : {});
            loaded[key] = true;
            render();
        }, err => {
            console.error('Errore lettura Panoramica (' + key + '):', err);
            loaded[key] = true;
            render();
        }));
    }

    function startForUser(uid) {
        stop();
        injectStyle();
        render();
        const base = window.db.collection('users').doc(uid).collection('modules');
        listen(base.doc('todo'), 'todo', d => { todo = Object.assign({ tasks: [], categories: [] }, d); });
        listen(base.doc('diario'), 'diario', d => { diario = Object.assign({ entries: [] }, d); });
        listen(base.doc('finanze'), 'finanze', d => { fin = Object.assign({ accounts: [], categories: [], transactions: [] }, d); });
    }

    function stop() {
        unsubs.forEach(u => u());
        unsubs = [];
        resetData();
    }

    window.Home = { onShow: render };

    window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
    window.addEventListener('app:authLoggedOut', stop);
    if (window.currentUser) startForUser(window.currentUser.uid);
})();