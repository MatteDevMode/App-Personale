(function () {
    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayStr() { return formatDate(new Date()); }
    function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function shiftDate(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return formatDate(d); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function attr(s) { return esc(s).replace(/"/g, '&quot;'); }
    function uid() { return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

    const CAP = 150, CAP_FACTOR = 0.5, KEEP_DAYS = 45;
    const WEIGHT_XP = { s: 5, m: 10, l: 25 };
    const WEIGHT_LABEL = { s: 'Piccola', m: 'Media', l: 'Grande' };
    const TITLES = ['Uovo', 'Pulcino', 'Pinguino curioso', 'Pinguino esploratore', 'Pinguino scivolatore', 'Pinguino tuffatore', 'Pinguino di ghiaccio', 'Pinguino coraggioso', 'Pinguino capitano', 'Pinguino imperatore'];
    const MILESTONES = [[3, 15], [7, 40], [14, 80], [30, 200], [60, 400], [100, 800]];
    const SEED = [
        { name: 'Lavarsi i denti', icon: '🪥', target: 2, weight: 's', auto: null },
        { name: 'Bere dalla borraccia', icon: '💧', target: 1, weight: 's', auto: null },
        { name: 'Leggere 10 pagine', icon: '📖', target: 1, weight: 's', auto: null },
        { name: 'Scrivere nel diario', icon: '✍️', target: 1, weight: 's', auto: 'diario' }
    ];

    // ---------- Livelli ----------
    function need(L) { return 100 + 40 * (L - 1); }
    function levelInfo(total) { let L = 1, rest = total; while (rest >= need(L)) { rest -= need(L); L++; } return { level: L, into: rest, need: need(L) }; }
    function titleOf(L) { return L <= TITLES.length ? TITLES[L - 1] : 'Leggenda del ghiaccio ' + (L - TITLES.length); }
    function eff(raw) { return raw <= CAP ? raw : CAP + (raw - CAP) * CAP_FACTOR; }

    // ---------- Dati ----------
    function defaultData() { return { events: [], history: {}, routines: [], checks: {}, seeded: false, summary: { total: 0, level: 1, title: TITLES[0], streak: 0 } }; }
    let data = defaultData();
    let src = { todo: { tasks: [] }, diario: { entries: [] }, trading: { trades: [] }, reselling: { items: [] } };
    let loaded = {};
    let docRef = null, unsubs = [], ready = false, shownLevel = null;
    let homeEl = null;
    const ui = { day: 'today', calYear: new Date().getFullYear(), calMonth: new Date().getMonth() };

    function resetLoaded() { loaded = { x: false, todo: false, diario: false, trading: false, reselling: false }; }
    resetLoaded();
    function allLoaded() { return loaded.x && loaded.todo && loaded.diario && loaded.trading && loaded.reselling; }
    function save() { if (docRef) docRef.set(data).catch(err => console.error('Errore salvataggio Progressi:', err)); }

    function dayRaw() { const m = {}; data.events.forEach(e => { m[e.date] = (m[e.date] || 0) + e.xp; }); return m; }
    function totalXP() {
        let t = 0;
        Object.keys(data.history).forEach(d => { t += data.history[d]; });
        const m = dayRaw();
        Object.keys(m).forEach(d => { t += eff(Math.max(0, m[d])); });
        return Math.round(t);
    }
    function activeDates() {
        const s = new Set();
        data.events.forEach(e => { if (e.key.indexOf('streak:') !== 0 && e.xp > 0) s.add(e.date); });
        Object.keys(data.history).forEach(d => { if (data.history[d] > 0) s.add(d); });
        return s;
    }
    // Serie: giorni consecutivi con almeno un'azione; si perdona un giorno saltato (al massimo uno ogni 7)
    function computeStreak() {
        const act = activeDates(), today = todayStr();
        let d = act.has(today) ? today : shiftDate(today, -1);
        let current = 0, start = null, lastMiss = -99, i = 0;
        while (i < 4000) {
            if (act.has(d)) { current++; start = d; }
            else if (act.has(shiftDate(d, -1)) && i - lastMiss > 7) { lastMiss = i; }
            else break;
            d = shiftDate(d, -1); i++;
        }
        return { current, start };
    }

    // ---------- Routine ----------
    function diaryHas(date) {
        return (src.diario.entries || []).some(e => e.date === date || (e.createdAt && formatDate(new Date(e.createdAt)) === date));
    }
    function scheduled(r, date) {
        if (r.archived || (r.since && date < r.since)) return false;
        return !r.days || !r.days.length || r.days.indexOf(parseDateStr(date).getDay()) >= 0;
    }
    function routineCount(r, date) {
        if (r.auto === 'diario') return diaryHas(date) ? (r.target || 1) : 0;
        return (data.checks[date] && data.checks[date][r.id]) || 0;
    }
    function routineDone(r, date) { return routineCount(r, date) >= (r.target || 1); }

    function setCheck(date, rid, n) {
        data.checks[date] = data.checks[date] || {};
        if (n > 0) data.checks[date][rid] = n; else delete data.checks[date][rid];
        engine();
    }

    // ---------- Motore: allinea i punti alle cose fatte ----------
    function reconcile() {
        if (!allLoaded()) return null;
        const today = todayStr(), yesterday = shiftDate(today, -1);
        let changed = false;
        const added = [];

        function sync(prefix, date, desired) {
            data.events.filter(e => e.date === date && e.key.indexOf(prefix) === 0).forEach(e => {
                if (!desired[e.key]) { data.events = data.events.filter(x => x !== e); changed = true; }
                else if (e.xp !== desired[e.key].xp) { e.xp = desired[e.key].xp; changed = true; }
            });
            Object.keys(desired).forEach(k => {
                if (!data.events.some(e => e.key === k)) {
                    const ev = { key: k, xp: desired[k].xp, label: desired[k].label, date, ts: new Date().toISOString() };
                    data.events.push(ev); added.push(ev); changed = true;
                }
            });
        }
        const localDay = iso => (iso ? formatDate(new Date(iso)) : null);
        const firstN = (list, n) => list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).slice(0, n);

        // attività completate oggi (il peso lo sceglie l'utente: s/m/l)
        const tasks = {};
        (src.todo.tasks || []).filter(t => t.completed && t.completedAt === today).forEach(t => { tasks['task:' + t.id] = { xp: WEIGHT_XP[t.weight || 'm'] || 10, label: 'Attività: ' + t.title }; });
        sync('task:', today, tasks);

        // diario: 10 XP la prima voce scritta oggi, 3 le successive
        const diary = {};
        (src.diario.entries || []).filter(e => localDay(e.createdAt) === today).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .forEach((e, i) => { diary['diary:' + e.id] = { xp: i === 0 ? 10 : 3, label: 'Diario' }; });
        sync('diary:', today, diary);

        // trade registrati e oggetti messi in vendita oggi: 5 XP, solo i primi 3 (si premia l'impegno, non l'esito)
        const trades = {};
        firstN((src.trading.trades || []).filter(t => localDay(t.createdAt) === today), 3).forEach(t => { trades['trade:' + t.id] = { xp: 5, label: 'Trade registrato' }; });
        sync('trade:', today, trades);
        const listed = {};
        firstN((src.reselling.items || []).filter(i => i.listDate === today && i.status !== 'da-pubblicare'), 3).forEach(i => { listed['list:' + i.id] = { xp: 5, label: 'Oggetto in vendita: ' + i.name }; });
        sync('list:', today, listed);

        // routine di oggi e di ieri (ieri si può ancora spuntare)
        [yesterday, today].forEach(date => {
            const sch = data.routines.filter(r => scheduled(r, date));
            const rd = {}, all = {};
            sch.filter(r => routineDone(r, date)).forEach(r => { rd['routine:' + r.id + ':' + date] = { xp: WEIGHT_XP[r.weight || 's'] || 5, label: 'Routine: ' + r.name }; });
            if (sch.length >= 2 && sch.every(r => routineDone(r, date))) all['routines-all:' + date] = { xp: 20, label: 'Tutte le routine del giorno' };
            sync('routine:', date, rd);
            sync('routines-all:', date, all);
        });

        // bonus serie
        const st = computeStreak();
        MILESTONES.forEach(m => {
            const key = 'streak:' + m[0] + ':' + st.start;
            if (st.start && st.current >= m[0] && !data.events.some(e => e.key === key)) {
                const ev = { key, xp: m[1], label: 'Serie di ' + m[0] + ' giorni', date: today, ts: new Date().toISOString() };
                data.events.push(ev); added.push(ev); changed = true;
            }
        });

        // eventi vecchi: li riassumo per tenere il documento leggero
        const cutoff = shiftDate(today, -KEEP_DAYS);
        const old = data.events.filter(e => e.date < cutoff);
        if (old.length) {
            const m = {}; old.forEach(e => { m[e.date] = (m[e.date] || 0) + e.xp; });
            Object.keys(m).forEach(d => { data.history[d] = (data.history[d] || 0) + eff(Math.max(0, m[d])); });
            data.events = data.events.filter(e => e.date >= cutoff);
            changed = true;
        }

        const total = totalXP(), info = levelInfo(total), prev = data.summary.level || 1;
        const summary = { total, level: info.level, title: titleOf(info.level), streak: computeStreak().current, updated: today };
        if (JSON.stringify(summary) !== JSON.stringify(data.summary)) { data.summary = summary; changed = true; }
        return { changed, added, levelUp: info.level > prev ? info.level : null };
    }

    function engine() {
        ready = allLoaded();
        const r = reconcile();
        if (r) {
            if (r.changed) save();
            const gain = r.added.reduce((s, e) => s + e.xp, 0);
            if (gain > 0) toast('+' + gain + ' XP', r.added.length === 1 ? r.added[0].label : r.added.length + ' cose fatte');
            if (r.levelUp) { shownLevel = r.levelUp; celebrate(r.levelUp); }
        }
        render();
    }

    // ---------- Stile ----------
    function injectStyle() {
        if (document.getElementById('xpStyle')) return;
        const s = document.createElement('style');
        s.id = 'xpStyle';
        s.textContent = `
#page-progressi{padding-bottom:40px;}
.xp-card{background:linear-gradient(160deg,var(--bg-card),var(--bg-card-hover));border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.1rem;margin-bottom:14px;}
.xp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.xp-lv{margin:0;font-size:12px;color:var(--accent);font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
.xp-title{margin:0;font-family:var(--font-head);font-size:19px;font-weight:700;}
.xp-streak{font-size:13px;color:var(--text-secondary);background:var(--bg-page);border:1px solid var(--border);border-radius:999px;padding:5px 11px;white-space:nowrap;}
.xp-bar{height:10px;border-radius:6px;background:var(--bg-page);border:1px solid var(--border);overflow:hidden;margin:12px 0 6px;}
.xp-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--accent),var(--teal));transition:width .6s ease;}
.xp-sub{margin:0;font-size:12.5px;color:var(--text-secondary);}
.xp-sec{margin:14px 0 8px;font-size:12px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.03em;}
.xp-r{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-page);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.xp-r.done{opacity:.6;}.xp-r.done .xp-r-name{text-decoration:line-through;}
.xp-r-icon{font-size:18px;width:24px;text-align:center;}
.xp-r-name{flex:1;font-size:14px;}
.xp-r-count{font-size:12.5px;color:var(--text-secondary);}
.xp-r-auto{font-size:10.5px;color:var(--text-muted);border:1px solid var(--border);border-radius:20px;padding:1px 6px;}
.xp-r-check{width:24px;height:24px;border-radius:7px;border:1.5px solid var(--border-strong);background:transparent;color:transparent;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
.xp-r.done .xp-r-check{background:var(--teal);border-color:var(--teal);color:#05201a;}
.xp-minus{width:24px;height:24px;border-radius:7px;border:1px solid var(--border-strong);background:transparent;color:var(--text-secondary);cursor:pointer;}
.xp-link{background:none;border:none;color:var(--accent);font-size:12.5px;cursor:pointer;font-family:var(--font-body);padding:6px 0 0;}
.xp-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:1.25rem 0 8px;flex-wrap:wrap;}
.xp-head p{margin:0;font-size:12px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.03em;}
.xp-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;}
.xp-cal-dow{text-align:center;font-size:11px;color:var(--text-muted);}
.xp-cal-cell{aspect-ratio:1;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-secondary);position:relative;}
.xp-cal-cell.today{border-color:var(--accent);}
.xp-cal-cell.act::after{content:'';position:absolute;bottom:4px;width:4px;height:4px;border-radius:50%;background:var(--accent);}
.xp-ev{display:flex;justify-content:space-between;gap:10px;padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;font-size:13px;}
.xp-ev b{color:var(--teal);}
.xp-ev span:last-child{color:var(--text-muted);font-size:12px;flex-shrink:0;}
.xp-days{display:flex;gap:5px;flex-wrap:wrap;}
.xp-day-chip{flex:1;min-width:38px;padding:8px 0;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-card);color:var(--text-secondary);font-size:12px;cursor:pointer;font-family:var(--font-body);}
.xp-day-chip.on{border-color:var(--accent);color:var(--accent);background:var(--accent-wash);}
.xp-toast{position:fixed;left:50%;bottom:92px;transform:translate(-50%,16px);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:160;background:var(--bg-sidebar);border:1px solid var(--accent);border-radius:999px;padding:9px 16px;font-size:13.5px;color:var(--text-primary);box-shadow:0 6px 24px rgba(0,0,0,.35);white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;}
.xp-toast.show{opacity:1;transform:translate(-50%,0);}
.xp-toast b{color:var(--teal);margin-right:6px;}.xp-toast span{color:var(--text-secondary);}
.xp-celebrate{position:fixed;inset:0;z-index:300;background:radial-gradient(ellipse at 50% 30%,rgba(40,48,110,.92),rgba(4,5,13,.96));display:flex;align-items:center;justify-content:center;cursor:pointer;animation:xp-in .4s ease;overflow:hidden;}
@keyframes xp-in{from{opacity:0}to{opacity:1}}
.xp-cel-box{text-align:center;color:#e8ebff;position:relative;z-index:2;padding:20px;}
.xp-cel-lv{margin:10px 0 0;font-size:34px;font-weight:800;font-family:var(--font-head);}
.xp-cel-title{margin:4px 0 0;font-size:18px;color:#ffd97a;}
.xp-cel-sub{margin:18px 0 0;font-size:12px;color:rgba(232,235,255,.5);}
.xp-conf{position:absolute;top:-12px;width:8px;height:14px;border-radius:2px;animation:xp-fall linear forwards;}
@keyframes xp-fall{to{transform:translateY(110vh) rotate(540deg);}}`;
        document.head.appendChild(s);
    }

    function toast(text, sub) {
        injectStyle();
        let t = document.getElementById('xpToast');
        if (!t) { t = document.createElement('div'); t.id = 'xpToast'; t.className = 'xp-toast'; document.body.appendChild(t); }
        t.innerHTML = '<b>' + esc(text) + '</b><span>' + esc(sub || '') + '</span>';
        t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
    }

    function celebrate(level) {
        injectStyle();
        const colors = ['#ffd97a', '#7C8CF8', '#3FCFA0', '#ff8a7a', '#5AB7E8'];
        let conf = '';
        for (let i = 0; i < 36; i++) conf += '<span class="xp-conf" style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[i % colors.length] + ';animation-duration:' + (2.5 + Math.random() * 2.5).toFixed(1) + 's;animation-delay:' + (Math.random() * 1.2).toFixed(1) + 's;"></span>';
        const o = document.createElement('div');
        o.className = 'xp-celebrate';
        o.innerHTML = conf + '<div class="xp-cel-box">' + (window.Matty && window.Matty.penguin ? window.Matty.penguin(130) : '<div style="font-size:80px;">🐧</div>') +
            '<p class="xp-cel-lv">Livello ' + level + '!</p><p class="xp-cel-title">' + esc(titleOf(level)) + '</p><p class="xp-cel-sub">Tocca per continuare</p></div>';
        o.onclick = () => o.remove();
        setTimeout(() => o.remove(), 7000);
        document.body.appendChild(o);
    }

    // ---------- Interfaccia ----------
    function levelCardHtml() {
        const info = levelInfo(data.summary.total || 0), st = computeStreak();
        const raw = dayRaw()[todayStr()] || 0;
        const pct = Math.min(100, Math.round(info.into / info.need * 100));
        return '<div class="xp-top"><div><p class="xp-lv">Livello ' + info.level + '</p><p class="xp-title">' + esc(titleOf(info.level)) + '</p></div>' +
            '<div class="xp-streak">🔥 ' + st.current + (st.current === 1 ? ' giorno' : ' giorni') + '</div></div>' +
            '<div class="xp-bar"><div class="xp-fill" style="width:' + pct + '%;"></div></div>' +
            '<p class="xp-sub">' + info.into + ' / ' + info.need + ' XP · oggi +' + Math.round(eff(raw)) + (raw > CAP ? ' (tetto raggiunto: i punti ora valgono la metà)' : '') + '</p>';
    }

    function routinesHtml(date) {
        const list = data.routines.filter(r => scheduled(r, date));
        if (!list.length) return '<p class="empty-hint">Nessuna routine per questo giorno.</p>';
        return list.map(r => {
            const c = routineCount(r, date), t = r.target || 1, done = c >= t;
            return '<div class="xp-r' + (done ? ' done' : '') + '" data-r="' + attr(r.id) + '" data-date="' + date + '">' +
                '<span class="xp-r-icon">' + esc(r.icon || '•') + '</span><span class="xp-r-name">' + esc(r.name) + '</span>' +
                (t > 1 ? '<span class="xp-r-count">' + c + '/' + t + '</span>' : '') + (r.auto ? '<span class="xp-r-auto">auto</span>' : '') +
                (c > 0 && !r.auto && t > 1 ? '<button class="xp-minus" data-minus="' + attr(r.id) + '">\u2212</button>' : '') +
                '<span class="xp-r-check">\u2713</span></div>';
        }).join('');
    }

    function bindRoutines(container) {
        container.querySelectorAll('.xp-r').forEach(row => row.addEventListener('click', e => {
            const r = data.routines.find(x => x.id === row.getAttribute('data-r'));
            if (!r || r.auto) return;
            const date = row.getAttribute('data-date'), c = routineCount(r, date), t = r.target || 1;
            if (e.target.closest('[data-minus]')) return setCheck(date, r.id, Math.max(0, c - 1));
            if (t === 1) setCheck(date, r.id, c ? 0 : 1);
            else if (c < t) setCheck(date, r.id, c + 1);
        }));
    }

    function mountHome(el) {
        injectStyle();
        homeEl = el;
        renderHome();
    }

    function renderHome() {
        if (!homeEl || !document.body.contains(homeEl)) return;
        if (!ready) { homeEl.innerHTML = ''; return; }
        homeEl.innerHTML = '<div class="xp-card">' + levelCardHtml() + '<p class="xp-sec">Routine di oggi</p>' + routinesHtml(todayStr()) +
            '<button class="xp-link" id="xpOpen">Apri Progressi \u2192</button></div>';
        bindRoutines(homeEl);
        const open = homeEl.querySelector('#xpOpen');
        if (open) open.onclick = () => { if (typeof switchPage === 'function') switchPage('progressi'); };
    }

    function calHtml() {
        const y = ui.calYear, mo = ui.calMonth;
        const lead = (new Date(y, mo, 1).getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate(), act = activeDates(), today = todayStr();
        let cells = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => '<div class="xp-cal-dow">' + d + '</div>').join('');
        for (let i = 0; i < lead; i++) cells += '<div></div>';
        for (let d = 1; d <= dim; d++) {
            const ds = y + '-' + pad2(mo + 1) + '-' + pad2(d);
            const sch = data.routines.filter(r => scheduled(r, ds)), done = sch.filter(r => routineDone(r, ds)).length;
            const ratio = sch.length ? done / sch.length : 0;
            cells += '<div class="xp-cal-cell' + (ds === today ? ' today' : '') + (act.has(ds) ? ' act' : '') + '"' +
                (ratio > 0 ? ' style="background:rgba(63,207,160,' + (0.18 + 0.55 * ratio).toFixed(2) + ');"' : '') + '>' + d + '</div>';
        }
        return '<div class="cal-nav"><button class="icon-btn" id="xpPrev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>' +
            '<span class="cal-nav-title">' + MONTHS[mo] + ' ' + y + '</span>' +
            '<button class="icon-btn" id="xpNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>' +
            '<div class="xp-cal">' + cells + '</div>';
    }

    function renderPage() {
        const page = document.getElementById('page-progressi');
        if (!page) return;
        if (!ready) { page.innerHTML = '<p class="empty-hint">Caricamento...</p>'; return; }
        const date = ui.day === 'yesterday' ? shiftDate(todayStr(), -1) : todayStr();
        const events = data.events.filter(e => e.xp !== 0).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 12);
        page.innerHTML =
            '<div class="todo-top"><div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Progressi</h1></div></div>' +
            '<div class="xp-card">' + levelCardHtml() + '</div>' +
            '<div class="xp-head"><p>Routine</p><div style="display:flex;gap:8px;align-items:center;"><div class="view-switch"><button id="xpToday" class="' + (ui.day === 'today' ? 'active' : '') + '">Oggi</button><button id="xpYest" class="' + (ui.day === 'yesterday' ? 'active' : '') + '">Ieri</button></div>' +
            '<button class="icon-btn" id="xpManage" title="Gestisci routine" style="width:auto;padding:0 12px;font-size:12.5px;">Gestisci</button></div></div>' +
            '<div id="xpRoutines">' + routinesHtml(date) + '</div>' +
            '<div class="xp-head"><p>Costanza</p></div>' + calHtml() +
            '<div class="xp-head"><p>Ultimi punti</p></div>' +
            (events.length ? events.map(e => { const d = parseDateStr(e.date); return '<div class="xp-ev"><span><b>+' + e.xp + '</b> ' + esc(e.label) + '</span><span>' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + '</span></div>'; }).join('') : '<p class="empty-hint">Ancora nessun punto. Completa un\u2019attività o una routine!</p>');

        bindRoutines(page);
        page.querySelector('#xpToday').onclick = () => { ui.day = 'today'; renderPage(); };
        page.querySelector('#xpYest').onclick = () => { ui.day = 'yesterday'; renderPage(); };
        page.querySelector('#xpManage').onclick = openRoutineManager;
        page.querySelector('#xpPrev').onclick = () => { ui.calMonth--; if (ui.calMonth < 0) { ui.calMonth = 11; ui.calYear--; } renderPage(); };
        page.querySelector('#xpNext').onclick = () => { ui.calMonth++; if (ui.calMonth > 11) { ui.calMonth = 0; ui.calYear++; } renderPage(); };
    }

    function render() { renderHome(); renderPage(); }

    // ---------- Gestione routine ----------
    function openRoutineManager() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        function draw() {
            overlay.innerHTML = '<div class="modal-box"><p class="modal-title">Le mie routine</p><div id="rtList"></div>' +
                '<div class="row-2" style="margin-top:10px;"><button class="btn btn-primary" id="rtAdd">Nuova routine</button><button class="btn btn-ghost" id="rtClose">Chiudi</button></div></div>';
            const list = overlay.querySelector('#rtList');
            list.innerHTML = data.routines.filter(r => !r.archived).map(r =>
                '<div class="cat-row" style="cursor:pointer;" data-edit="' + attr(r.id) + '"><span style="width:24px;text-align:center;">' + esc(r.icon || '•') + '</span><span style="flex:1;font-size:14px;">' + esc(r.name) +
                '</span><span style="font-size:12px;color:var(--text-muted);">' + (r.target > 1 ? r.target + ' volte · ' : '') + WEIGHT_XP[r.weight || 's'] + ' XP</span></div>').join('') || '<p class="empty-hint">Nessuna routine</p>';
            list.querySelectorAll('[data-edit]').forEach(row => row.addEventListener('click', () => { overlay.remove(); openRoutineModal(data.routines.find(x => x.id === row.getAttribute('data-edit'))); }));
            overlay.querySelector('#rtClose').onclick = () => overlay.remove();
            overlay.querySelector('#rtAdd').onclick = () => { overlay.remove(); openRoutineModal(null); };
        }
        draw();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    function openRoutineModal(r) {
        const isEdit = !!r;
        const v = r || { name: '', icon: '', target: 1, days: [], weight: 's', auto: null };
        const sel = new Set(v.days && v.days.length ? v.days : [0, 1, 2, 3, 4, 5, 6]);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = '<div class="modal-box"><p class="modal-title">' + (isEdit ? 'Modifica routine' : 'Nuova routine') + '</p>' +
            '<div class="row-2"><div><label class="field-label">Nome</label><input type="text" id="rtName" value="' + attr(v.name) + '" /></div>' +
            '<div><label class="field-label">Icona (emoji)</label><input type="text" id="rtIcon" value="' + attr(v.icon) + '" placeholder="\ud83d\udca7" /></div></div>' +
            '<div class="row-2"><div><label class="field-label">Quante volte al giorno</label><input type="text" inputmode="numeric" id="rtTarget" value="' + (v.target || 1) + '" /></div>' +
            '<div><label class="field-label">Peso</label><select id="rtWeight">' + ['s', 'm', 'l'].map(k => '<option value="' + k + '"' + ((v.weight || 's') === k ? ' selected' : '') + '>' + WEIGHT_LABEL[k] + ' \u00b7 ' + WEIGHT_XP[k] + ' XP</option>').join('') + '</select></div></div>' +
            '<label class="field-label">Giorni</label><div class="xp-days">' + DAY_ORDER.map(d => '<button type="button" class="xp-day-chip' + (sel.has(d) ? ' on' : '') + '" data-d="' + d + '">' + DAY_NAMES[d] + '</button>').join('') + '</div>' +
            '<label class="field-label">Come si completa</label><select id="rtAuto"><option value="">Con un tocco</option><option value="diario"' + (v.auto === 'diario' ? ' selected' : '') + '>Da sola, quando scrivo nel diario</option></select>' +
            '<div class="modal-actions">' + (isEdit ? '<button class="btn btn-danger" id="rtDel">Elimina</button>' : '') + '<button class="btn btn-ghost" id="rtCancel">Annulla</button><button class="btn btn-primary" id="rtSave">Salva</button></div></div>';
        const q = s => overlay.querySelector(s);
        overlay.querySelectorAll('.xp-day-chip').forEach(b => b.addEventListener('click', () => {
            const d = +b.getAttribute('data-d');
            if (sel.has(d)) sel.delete(d); else sel.add(d);
            b.classList.toggle('on', sel.has(d));
        }));
        q('#rtCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        if (isEdit) q('#rtDel').onclick = () => {
            if (!confirm('Eliminare questa routine?')) return;
            data.routines = data.routines.filter(x => x.id !== r.id);
            overlay.remove(); engine();
        };
        q('#rtSave').onclick = () => {
            const name = q('#rtName').value.trim();
            let target = parseInt(q('#rtTarget').value, 10);
            if (!name) { q('#rtName').style.borderColor = '#E8604C'; return; }
            if (isNaN(target) || target < 1) target = 1;
            target = Math.min(9, target);
            const fields = { name, icon: q('#rtIcon').value.trim(), target, weight: q('#rtWeight').value, auto: q('#rtAuto').value || null, days: sel.size === 7 ? [] : Array.from(sel) };
            if (!fields.days.length && sel.size !== 7) { alert('Scegli almeno un giorno.'); return; }
            if (isEdit) Object.assign(r, fields);
            else data.routines.push(Object.assign({ id: uid(), since: todayStr() }, fields));
            overlay.remove(); engine();
        };
        document.body.appendChild(overlay);
    }

    // ---------- Init ----------
    function seedIfNeeded() {
        if (data.seeded) return;
        const today = todayStr();
        SEED.forEach(s => data.routines.push(Object.assign({ id: uid(), since: today, days: [] }, s)));
        data.seeded = true;
        save();
    }

    function listen(path, key, assign) {
        unsubs.push(docRef.parent.doc(path).onSnapshot(snap => {
            assign(snap.exists ? snap.data() : {});
            loaded[key] = true;
            if (loaded.x) engine();
        }, err => { console.error('Errore lettura Progressi (' + path + '):', err); loaded[key] = true; }));
    }

    function startForUser(uid_) {
        stop();
        injectStyle();
        docRef = window.db.collection('users').doc(uid_).collection('modules').doc('xp');
        unsubs.push(docRef.onSnapshot(snap => {
            if (snap.metadata && snap.metadata.hasPendingWrites) return; // sono le mie scritture: lo stato locale è già aggiornato
            data = Object.assign(defaultData(), snap.exists ? snap.data() : {});
            const lv = data.summary.level || 1;
            if (shownLevel !== null && lv > shownLevel) celebrate(lv);
            shownLevel = lv;
            loaded.x = true;
            seedIfNeeded();
            ready = allLoaded();
            engine();
        }, err => console.error('Errore lettura Progressi:', err)));
        listen('todo', 'todo', d => { src.todo = Object.assign({ tasks: [] }, d); });
        listen('diario', 'diario', d => { src.diario = Object.assign({ entries: [] }, d); });
        listen('trading', 'trading', d => { src.trading = Object.assign({ trades: [] }, d); });
        listen('reselling', 'reselling', d => { src.reselling = Object.assign({ items: [] }, d); });
    }

    function stop() {
        unsubs.forEach(u => u()); unsubs = [];
        docRef = null; ready = false; shownLevel = null;
        data = defaultData(); resetLoaded();
        src = { todo: { tasks: [] }, diario: { entries: [] }, trading: { trades: [] }, reselling: { items: [] } };
    }

    window.XP = { mountHome, summary: () => data.summary };
    window.Progressi = { onShow: function () { render(); } };

    window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
    window.addEventListener('app:authLoggedOut', stop);
    if (window.currentUser) startForUser(window.currentUser.uid);
})();