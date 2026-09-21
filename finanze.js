(function () {
    const STORAGE_KEY = 'finanzeAppData';
    const PALETTE = ['#6C8CF5', '#9B7CF8', '#3FCFA0', '#5AB7E8', '#C77DF0', '#4FD1C5', '#E0B34D'];

    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayStr() { return formatDate(new Date()); }
    function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function eur(n) { return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }); }

    const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const MONTHS_FULL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

    // ---------- Data ----------
    function defaultData() {
        return {
            accounts: [
                { id: 'acc1', name: 'Contanti', initialBalance: 0 },
                { id: 'acc2', name: 'Carta', initialBalance: 0 },
                { id: 'acc3', name: 'Conto', initialBalance: 0 },
                { id: 'acc4', name: 'Vinted', initialBalance: 0 }
            ],
            categories: [
                { id: 'cat1', name: 'Spesa', color: '#6C8CF5', budget: null },
                { id: 'cat2', name: 'Mancia', color: '#3FCFA0', budget: null },
                { id: 'cat3', name: 'Trasporti', color: '#9B7CF8', budget: null },
                { id: 'cat4', name: 'Regali', color: '#5AB7E8', budget: null },
                { id: 'cat5', name: 'Divertimento', color: '#C77DF0', budget: null },
                { id: 'cat6', name: 'Altro', color: '#8890A6', budget: null },
                { id: 'cat_reselling', name: 'Reselling', color: '#4FD1C5', budget: null }
            ],
            transactions: [],
            items: [],
            settings: { resellingReinvestPct: 50 }
        };
    }

    let data;
    function loadData() {
        try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) { }
        return defaultData();
    }
    function saveData() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { } }

    function accById(id) { return data.accounts.find(a => a.id === id); }
    function catById(id) { return data.categories.find(c => c.id === id); }
    function itemById(id) { return data.items.find(i => i.id === id); }

    function accountBalance(accId) {
        const acc = accById(accId);
        let bal = acc ? (acc.initialBalance || 0) : 0;
        data.transactions.forEach(t => {
            if (t.type === 'income' && t.accountId === accId) bal += t.amount;
            else if (t.type === 'expense' && t.accountId === accId) bal -= t.amount;
            else if (t.type === 'transfer') {
                if (t.fromAccountId === accId) bal -= t.amount;
                if (t.toAccountId === accId) bal += t.amount;
            }
        });
        return bal;
    }
    function totalBalance() { return data.accounts.reduce((s, a) => s + accountBalance(a.id), 0); }

    function monthSpent(catId, ym) {
        return data.transactions.filter(t => t.type === 'expense' && t.categoryId === catId && t.date.slice(0, 7) === ym)
            .reduce((s, t) => s + t.amount, 0);
    }

    // ---------- State ----------
    const state = {
        view: 'overview',
        period: 'month',
        customFrom: null,
        customTo: null
    };
    let charts = { balance: null, ie: null, cat: null };

    // ---------- Shell ----------
    function renderShell() {
        const page = document.getElementById('page-finanze');
        page.innerHTML =
            '<div class="todo-top">' +
            '<div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Finanze</h1></div>' +
            '<div class="view-switch">' +
            '<button id="fViewOverview">Panoramica</button>' +
            '<button id="fViewTx">Transazioni</button>' +
            '<button id="fViewResell">Reselling</button>' +
            '</div>' +
            '</div>' +
            '<div id="finanzeContent"></div>' +
            '<div class="fin-bottom-bar"><button class="fin-new-btn" id="finNewBtn"></button></div>';

        document.getElementById('fViewOverview').onclick = () => { state.view = 'overview'; renderContent(); };
        document.getElementById('fViewTx').onclick = () => { state.view = 'transactions'; renderContent(); };
        document.getElementById('fViewResell').onclick = () => { state.view = 'reselling'; renderContent(); };
    }

    function renderContent() {
        document.getElementById('fViewOverview').classList.toggle('active', state.view === 'overview');
        document.getElementById('fViewTx').classList.toggle('active', state.view === 'transactions');
        document.getElementById('fViewResell').classList.toggle('active', state.view === 'reselling');

        const btn = document.getElementById('finNewBtn');
        if (state.view === 'reselling') {
            btn.innerHTML = plusIcon() + 'Nuovo oggetto';
            btn.onclick = () => openItemModal('create', { date: todayStr() }, null);
        } else {
            btn.innerHTML = plusIcon() + 'Nuovo movimento';
            btn.onclick = () => openTxModal('create', { type: 'expense', date: todayStr() }, null);
        }

        const c = document.getElementById('finanzeContent');
        if (state.view === 'overview') renderOverview(c);
        else if (state.view === 'transactions') renderTransactions(c);
        else renderReselling(c);
    }

    function plusIcon() {
        return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><path d="M12 5v14M5 12h14"/></svg>';
    }

    // ---------- Overview ----------
    function renderOverview(container) {
        const tot = totalBalance();
        let html = '<div class="fin-total"><p class="fin-total-label">Saldo totale</p><p class="fin-total-amount' + (tot < 0 ? ' negative' : '') + '">' + eur(tot) + '</p></div>';

        html += '<div class="acc-grid">';
        data.accounts.forEach(a => {
            const bal = accountBalance(a.id);
            html += '<div class="acc-card" data-acc="' + a.id + '"><p class="acc-name">' + esc(a.name) + '</p><p class="acc-balance' + (bal < 0 ? ' negative' : '') + '">' + eur(bal) + '</p></div>';
        });
        html += '<div class="acc-add-card" id="addAccBtn">+ Nuovo conto</div></div>';

        const budgeted = data.categories.filter(c => c.budget && c.budget > 0);
        if (budgeted.length) {
            const ym = todayStr().slice(0, 7);
            html += '<p class="section-label">Budget di ' + MONTHS_FULL[new Date().getMonth()] + '</p>';
            budgeted.forEach(c => {
                const spent = monthSpent(c.id, ym);
                const pct = Math.min(100, (spent / c.budget) * 100);
                const cls = spent >= c.budget ? 'over' : (pct >= 80 ? 'warn' : 'ok');
                html += '<div class="budget-row"><div class="budget-top"><span class="cat-name">' + esc(c.name) + '</span><span class="cat-amounts">' + eur(spent) + ' / ' + eur(c.budget) + '</span></div>' +
                    '<div class="budget-bar-track"><div class="budget-bar-fill ' + cls + '" style="width:' + pct + '%;"></div></div></div>';
            });
        }
        html += '<button class="icon-btn" id="manageCatsBtnF" style="margin-bottom:1.25rem;">Gestisci categorie e conti</button>';

        html += periodSwitchHtml();

        html += '<div class="chart-card"><p class="chart-title">Andamento saldo totale</p><canvas id="chartBalance"></canvas></div>';
        html += '<div class="chart-card"><p class="chart-title">Entrate vs Uscite</p><canvas id="chartIncomeExpense"></canvas></div>';
        html += '<div class="chart-card"><p class="chart-title">Spesa per categoria</p><canvas id="chartCategory"></canvas></div>';

        const resell = resellTotals();
        html += '<div class="chart-card">' +
            '<p class="chart-title">Reselling</p>' +
            '<div class="resell-summary">' +
            '<div class="resell-stat"><p>Profitto totale</p><p>' + eur(resell.profit) + '</p></div>' +
            '<div class="resell-stat"><p>Disponibile per te</p><p>' + eur(resell.personal) + '</p></div>' +
            '</div>' +
            '<button class="icon-btn" id="goResellBtn">Vai al Reselling \u2192</button>' +
            '</div>';

        container.innerHTML = html;

        container.querySelectorAll('.acc-card').forEach(el => {
            el.addEventListener('click', () => openAccountModal(accById(el.getAttribute('data-acc'))));
        });
        document.getElementById('addAccBtn').onclick = () => openAccountModal(null);
        document.getElementById('manageCatsBtnF').onclick = () => openCategoryManagerF();
        document.getElementById('goResellBtn').onclick = () => { state.view = 'reselling'; renderContent(); };

        bindPeriodSwitch(container, () => drawCharts());
        drawCharts();
    }

    function periodSwitchHtml() {
        let html = '<div class="period-switch">' +
            '<button class="period-btn" data-p="month">Questo mese</button>' +
            '<button class="period-btn" data-p="3months">Ultimi 3 mesi</button>' +
            '<button class="period-btn" data-p="year">Ultimo anno</button>' +
            '<button class="period-btn" data-p="custom">Personalizzato</button>' +
            '</div>';
        if (state.period === 'custom') {
            html += '<div class="period-custom">' +
                '<input type="date" id="periodFrom" value="' + (state.customFrom || '') + '" />' +
                '<span style="color:var(--text-muted);font-size:12px;">a</span>' +
                '<input type="date" id="periodTo" value="' + (state.customTo || todayStr()) + '" />' +
                '</div>';
        }
        return html;
    }

    function bindPeriodSwitch(container, onChange) {
        container.querySelectorAll('.period-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-p') === state.period);
            b.addEventListener('click', () => {
                state.period = b.getAttribute('data-p');
                renderOverview(container);
            });
        });
        const from = document.getElementById('periodFrom');
        const to = document.getElementById('periodTo');
        if (from) from.addEventListener('change', () => { state.customFrom = from.value; onChange(); });
        if (to) to.addEventListener('change', () => { state.customTo = to.value; onChange(); });
    }

    function periodRange() {
        const today = new Date();
        let start, end = todayStr();
        if (state.period === 'month') {
            start = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
        } else if (state.period === '3months') {
            start = formatDate(new Date(today.getFullYear(), today.getMonth() - 2, 1));
        } else if (state.period === 'year') {
            start = formatDate(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
        } else {
            start = state.customFrom || formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
            end = state.customTo || todayStr();
        }
        return { start, end };
    }

    function buildBalanceSeries(startStr, endStr) {
        const start = parseDateStr(startStr), end = parseDateStr(endStr);
        const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const bucket = totalDays > 60 ? Math.ceil(totalDays / 60) : 1;

        let running = data.accounts.reduce((s, a) => s + (a.initialBalance || 0), 0);
        data.transactions.forEach(t => {
            if (t.date < startStr) {
                if (t.type === 'income') running += t.amount;
                else if (t.type === 'expense') running -= t.amount;
            }
        });

        const labels = [], values = [];
        let cursor = new Date(start);
        while (cursor <= end) {
            const bucketEndRaw = new Date(cursor); bucketEndRaw.setDate(bucketEndRaw.getDate() + bucket - 1);
            const bucketEnd = bucketEndRaw > end ? end : bucketEndRaw;
            const curStr = formatDate(cursor), bEndStr = formatDate(bucketEnd);
            data.transactions.forEach(t => {
                if (t.date >= curStr && t.date <= bEndStr) {
                    if (t.type === 'income') running += t.amount;
                    else if (t.type === 'expense') running -= t.amount;
                }
            });
            labels.push(bucketEnd.getDate() + '/' + (bucketEnd.getMonth() + 1));
            values.push(Math.round(running * 100) / 100);
            cursor.setDate(cursor.getDate() + bucket);
        }
        return { labels, values };
    }

    function buildIncomeExpenseSeries(startStr, endStr) {
        const start = parseDateStr(startStr), end = parseDateStr(endStr);
        const months = [];
        let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
        while (cursor <= endMonth) { months.push(cursor.getFullYear() + '-' + pad2(cursor.getMonth() + 1)); cursor.setMonth(cursor.getMonth() + 1); }

        const labels = months.map(ym => MONTHS[parseInt(ym.slice(5, 7), 10) - 1] + ' \u2019' + ym.slice(2, 4));
        const income = months.map(ym => data.transactions.filter(t => t.type === 'income' && t.date.slice(0, 7) === ym && t.date >= startStr && t.date <= endStr).reduce((s, t) => s + t.amount, 0));
        const expense = months.map(ym => data.transactions.filter(t => t.type === 'expense' && t.date.slice(0, 7) === ym && t.date >= startStr && t.date <= endStr).reduce((s, t) => s + t.amount, 0));
        return { labels, income, expense };
    }

    function buildCategorySeries(startStr, endStr) {
        const sums = {};
        data.transactions.forEach(t => {
            if (t.type === 'expense' && t.date >= startStr && t.date <= endStr) {
                sums[t.categoryId] = (sums[t.categoryId] || 0) + t.amount;
            }
        });
        const entries = Object.keys(sums).map(id => ({ id, amount: sums[id], cat: catById(id) })).filter(e => e.amount > 0);
        entries.sort((a, b) => b.amount - a.amount);
        return {
            labels: entries.map(e => e.cat ? e.cat.name : 'Senza categoria'),
            values: entries.map(e => e.amount),
            colors: entries.map(e => e.cat ? e.cat.color : '#5E6779')
        };
    }

    function chartTextColor() { return getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#9BA3B8'; }
    function chartGridColor() { return getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,0.07)'; }

    function drawCharts() {
        if (typeof Chart === 'undefined') return;
        const { start, end } = periodRange();
        const txt = chartTextColor(), grid = chartGridColor();

        const balCanvas = document.getElementById('chartBalance');
        if (balCanvas) {
            const bs = buildBalanceSeries(start, end);
            if (charts.balance) charts.balance.destroy();
            charts.balance = new Chart(balCanvas, {
                type: 'line',
                data: { labels: bs.labels, datasets: [{ data: bs.values, borderColor: '#7C8CF8', backgroundColor: 'rgba(124,140,248,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
                options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: txt, maxTicksLimit: 6 }, grid: { color: grid } }, y: { ticks: { color: txt }, grid: { color: grid } } } }
            });
        }

        const ieCanvas = document.getElementById('chartIncomeExpense');
        if (ieCanvas) {
            const ie = buildIncomeExpenseSeries(start, end);
            if (charts.ie) charts.ie.destroy();
            charts.ie = new Chart(ieCanvas, {
                type: 'bar',
                data: {
                    labels: ie.labels, datasets: [
                        { label: 'Entrate', data: ie.income, backgroundColor: '#3FCFA0', borderRadius: 4 },
                        { label: 'Uscite', data: ie.expense, backgroundColor: '#E8604C', borderRadius: 4 }
                    ]
                },
                options: { plugins: { legend: { labels: { color: txt } } }, scales: { x: { ticks: { color: txt }, grid: { display: false } }, y: { ticks: { color: txt }, grid: { color: grid } } } }
            });
        }

        const catCanvas = document.getElementById('chartCategory');
        if (catCanvas) {
            const cs = buildCategorySeries(start, end);
            if (charts.cat) charts.cat.destroy();
            if (cs.labels.length) {
                charts.cat = new Chart(catCanvas, {
                    type: 'doughnut',
                    data: { labels: cs.labels, datasets: [{ data: cs.values, backgroundColor: cs.colors, borderWidth: 0 }] },
                    options: { plugins: { legend: { position: 'right', labels: { color: txt, boxWidth: 10, font: { size: 11 } } } } }
                });
            }
        }
    }

    // ---------- Transactions ----------
    function txIconSvg(type) {
        if (type === 'income') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
        if (type === 'expense') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>';
    }

    function txItemHtml(t) {
        let title, meta, amountClass, amountText, color;
        if (t.type === 'transfer') {
            const from = accById(t.fromAccountId), to = accById(t.toAccountId);
            title = (from ? from.name : '?') + ' \u2192 ' + (to ? to.name : '?');
            meta = t.note || 'Trasferimento';
            amountClass = 'transfer'; amountText = eur(t.amount); color = '#8890A6';
        } else {
            const cat = catById(t.categoryId);
            const acc = accById(t.accountId);
            title = t.note || (cat ? cat.name : 'Senza categoria');
            meta = (cat ? cat.name : 'Senza categoria') + ' \u00b7 ' + (acc ? acc.name : '?');
            amountClass = t.type; amountText = (t.type === 'income' ? '+' : '\u2212') + eur(t.amount).replace('-', '');
            color = t.type === 'income' ? '#3FCFA0' : (cat ? cat.color : '#E8604C');
        }
        return '<div class="tx-item" data-id="' + t.id + '">' +
            '<div class="tx-icon" style="--tx-color:' + color + ';">' + txIconSvg(t.type) + '</div>' +
            '<div class="tx-body"><div class="tx-title">' + esc(title) + '</div><div class="tx-meta">' + esc(meta) + '</div></div>' +
            '<div class="tx-amount ' + amountClass + '">' + amountText + '</div>' +
            '</div>';
    }

    function renderTransactions(container) {
        const list = data.transactions.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
        let html = '';
        if (!list.length) {
            html = '<p class="empty-hint">Nessun movimento ancora. Aggiungine uno dal pulsante in basso.</p>';
        } else {
            let lastDate = null;
            list.forEach(t => {
                if (t.date !== lastDate) {
                    const d = parseDateStr(t.date);
                    html += '<p class="section-label">' + d.getDate() + ' ' + MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear() + '</p>';
                    lastDate = t.date;
                }
                html += txItemHtml(t);
            });
        }
        container.innerHTML = html;
        container.querySelectorAll('.tx-item').forEach(el => {
            el.addEventListener('click', () => {
                const t = data.transactions.find(x => x.id === el.getAttribute('data-id'));
                if (t) openTxModal('edit', t, t.id);
            });
        });
    }

    // ---------- Transaction modal ----------
    function accOptions(selected) {
        return data.accounts.map(a => '<option value="' + a.id + '"' + (a.id === selected ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('');
    }
    function catOptions(selected) {
        return data.categories.map(c => '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    }

    function txFieldsHtml(type, vals) {
        if (type === 'transfer') {
            return '<label class="field-label">Da conto</label><select id="txFrom">' + accOptions(vals.fromAccountId) + '</select>' +
                '<label class="field-label">A conto</label><select id="txTo">' + accOptions(vals.toAccountId) + '</select>' +
                '<label class="field-label">Nota (opzionale)</label><input type="text" id="txNote" value="' + esc(vals.note || '') + '" />';
        }
        return '<label class="field-label">Conto</label><select id="txAccount">' + accOptions(vals.accountId) + '</select>' +
            '<label class="field-label">Categoria</label><select id="txCategory">' + catOptions(vals.categoryId) + '</select>' +
            '<label class="field-label">Nota (opzionale)</label><input type="text" id="txNote" value="' + esc(vals.note || '') + '" />';
    }

    function openTxModal(mode, vals, txId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const isEdit = mode === 'edit';
        let type = vals.type || 'expense';

        overlay.innerHTML =
            '<div class="modal-box">' +
            '<p class="modal-title">' + (isEdit ? 'Modifica movimento' : 'Nuovo movimento') + '</p>' +
            (isEdit && vals.itemId ? '<p class="modal-sub">Collegato a un oggetto in Reselling. Modificando qui, il collegamento resta ma i dati dell\u2019oggetto non si aggiornano.</p>' : '') +
            '<div class="type-switch">' +
            '<button type="button" class="type-btn income' + (type === 'income' ? ' selected' : '') + '" data-type="income">Entrata</button>' +
            '<button type="button" class="type-btn expense' + (type === 'expense' ? ' selected' : '') + '" data-type="expense">Uscita</button>' +
            '<button type="button" class="type-btn transfer' + (type === 'transfer' ? ' selected' : '') + '" data-type="transfer">Trasferimento</button>' +
            '</div>' +
            '<label class="field-label">Importo (\u20ac)</label>' +
            '<input type="text" inputmode="decimal" id="txAmount" value="' + (vals.amount || '') + '" placeholder="0.00" />' +
            '<label class="field-label">Data</label>' +
            '<input type="date" id="txDate" value="' + (vals.date || todayStr()) + '" />' +
            '<div id="txDynamicFields">' + txFieldsHtml(type, vals) + '</div>' +
            '<div class="modal-actions">' +
            (isEdit ? '<button class="btn btn-danger" id="txDelete">Elimina</button>' : '') +
            '<button class="btn btn-ghost" id="txCancel">Annulla</button>' +
            '<button class="btn btn-primary" id="txSave">Salva</button>' +
            '</div>' +
            '</div>';

        overlay.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                type = btn.getAttribute('data-type');
                overlay.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('selected', b === btn));
                document.getElementById('txDynamicFields').innerHTML = txFieldsHtml(type, vals);
            });
        });

        overlay.querySelector('#txCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        if (isEdit) {
            overlay.querySelector('#txDelete').onclick = () => {
                data.transactions = data.transactions.filter(x => x.id !== txId);
                saveData(); overlay.remove(); renderContent();
            };
        }

        overlay.querySelector('#txSave').onclick = () => {
            const amount = parseFloat((overlay.querySelector('#txAmount').value || '0').replace(',', '.'));
            const date = overlay.querySelector('#txDate').value || todayStr();
            const note = (document.getElementById('txNote') || {}).value || '';
            if (!amount || amount <= 0) return;

            let tx;
            if (type === 'transfer') {
                const fromAccountId = document.getElementById('txFrom').value;
                const toAccountId = document.getElementById('txTo').value;
                if (fromAccountId === toAccountId) return;
                tx = { type, amount, date, note, fromAccountId, toAccountId };
            } else {
                const accountId = document.getElementById('txAccount').value;
                const categoryId = document.getElementById('txCategory').value;
                tx = { type, amount, date, note, accountId, categoryId };
            }

            if (isEdit) {
                const existing = data.transactions.find(x => x.id === txId);
                Object.assign(existing, tx);
            } else {
                tx.id = uid('tx'); tx.createdAt = new Date().toISOString();
                data.transactions.push(tx);
            }
            saveData(); overlay.remove(); renderContent();
        };

        document.body.appendChild(overlay);
    }

    // ---------- Account modal ----------
    function openAccountModal(acc) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML =
            '<div class="modal-box">' +
            '<p class="modal-title">' + (acc ? 'Modifica conto' : 'Nuovo conto') + '</p>' +
            '<label class="field-label">Nome</label><input type="text" id="accName" value="' + (acc ? esc(acc.name) : '') + '" />' +
            '<label class="field-label">Saldo iniziale (\u20ac)</label><input type="text" inputmode="decimal" id="accInit" value="' + (acc ? acc.initialBalance : '0') + '" />' +
            '<div class="modal-actions">' +
            (acc ? '<button class="btn btn-danger" id="accDelete">Elimina</button>' : '') +
            '<button class="btn btn-ghost" id="accCancel">Annulla</button>' +
            '<button class="btn btn-primary" id="accSave">Salva</button>' +
            '</div>' +
            '</div>';
        overlay.querySelector('#accCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        if (acc) {
            overlay.querySelector('#accDelete').onclick = () => {
                if (!confirm('Eliminare questo conto? I movimenti collegati resteranno ma senza conto associato.')) return;
                data.accounts = data.accounts.filter(a => a.id !== acc.id);
                saveData(); overlay.remove(); renderContent();
            };
        }
        overlay.querySelector('#accSave').onclick = () => {
            const name = overlay.querySelector('#accName').value.trim();
            if (!name) return;
            const init = parseFloat((overlay.querySelector('#accInit').value || '0').replace(',', '.')) || 0;
            if (acc) { acc.name = name; acc.initialBalance = init; }
            else { data.accounts.push({ id: uid('acc'), name, initialBalance: init }); }
            saveData(); overlay.remove(); renderContent();
        };
        document.body.appendChild(overlay);
    }

    // ---------- Category manager ----------
    function openCategoryManagerF() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        function draw() {
            overlay.innerHTML =
                '<div class="modal-box">' +
                '<p class="modal-title">Categorie e conti</p>' +
                '<p class="field-label">Categorie</p>' +
                '<div id="catListF"></div>' +
                '<input type="text" id="newCatNameF" placeholder="Nuova categoria" style="margin-top:8px;" />' +
                '<input type="text" inputmode="decimal" id="newCatBudgetF" placeholder="Budget mensile \u20ac (opzionale)" style="margin-top:8px;" />' +
                '<button class="btn btn-primary" id="addCatBtnF" style="margin-top:8px;width:100%;">Aggiungi categoria</button>' +
                '<div class="modal-actions"><button class="btn btn-ghost" id="closeCatF" style="width:100%;">Chiudi</button></div>' +
                '</div>';
            const list = overlay.querySelector('#catListF');
            list.innerHTML = data.categories.map(c =>
                '<div class="cat-row"><span class="cat-swatch" style="background:' + c.color + ';"></span>' +
                '<span style="flex:1;font-size:13.5px;">' + esc(c.name) + '</span>' +
                '<input type="text" inputmode="decimal" data-budget="' + c.id + '" value="' + (c.budget || '') + '" placeholder="budget" style="width:80px;padding:5px 8px;font-size:12px;" />' +
                (c.id === 'cat_reselling' ? '' : '<button class="icon-btn" data-delcatf="' + c.id + '" style="width:26px;height:26px;">\u00d7</button>') +
                '</div>'
            ).join('');
            list.querySelectorAll('[data-budget]').forEach(inp => inp.addEventListener('change', () => {
                const c = catById(inp.getAttribute('data-budget'));
                const v = parseFloat((inp.value || '').replace(',', '.'));
                c.budget = v > 0 ? v : null;
                saveData(); renderContent();
            }));
            list.querySelectorAll('[data-delcatf]').forEach(b => b.addEventListener('click', () => {
                const cid = b.getAttribute('data-delcatf');
                data.categories = data.categories.filter(c => c.id !== cid);
                saveData(); draw(); renderContent();
            }));
            overlay.querySelector('#closeCatF').onclick = () => overlay.remove();
            overlay.querySelector('#addCatBtnF').onclick = () => {
                const nameInp = overlay.querySelector('#newCatNameF');
                const budgetInp = overlay.querySelector('#newCatBudgetF');
                const name = nameInp.value.trim();
                if (!name) return;
                const budget = parseFloat((budgetInp.value || '').replace(',', '.'));
                data.categories.push({ id: uid('cat'), name, color: PALETTE[data.categories.length % PALETTE.length], budget: budget > 0 ? budget : null });
                saveData(); draw(); renderContent();
            };
        }
        draw();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ---------- Reselling ----------
    function resellTotals() {
        const sold = data.items.filter(i => i.status === 'venduto');
        const invested = data.items.reduce((s, i) => s + (i.buyPrice || 0), 0);
        const revenue = sold.reduce((s, i) => s + (i.sellPrice || 0), 0);
        const profit = sold.reduce((s, i) => s + ((i.sellPrice || 0) - (i.buyPrice || 0)), 0);
        const pct = data.settings.resellingReinvestPct;
        return { invested, revenue, profit, reinvest: profit * pct / 100, personal: profit * (100 - pct) / 100 };
    }

    function itemCardHtml(item) {
        const sold = item.status === 'venduto';
        const color = sold ? '#3FCFA0' : '#6C8CF5';
        let profitHtml = '';
        if (sold) {
            const profit = (item.sellPrice || 0) - (item.buyPrice || 0);
            profitHtml = '<span class="item-profit" style="' + (profit < 0 ? 'color:#E8604C;' : '') + '">' + (profit >= 0 ? '+' : '') + eur(profit) + '</span>';
        }
        return '<div class="item-card" style="--item-color:' + color + ';" data-id="' + item.id + '">' +
            '<div class="item-top"><span class="item-name">' + esc(item.name) + '</span>' + (sold ? profitHtml : '<span class="item-badge">In vendita</span>') + '</div>' +
            '<p class="item-meta">Acquisto ' + eur(item.buyPrice) + (sold ? ' \u00b7 Vendita ' + eur(item.sellPrice) : '') + '</p>' +
            '</div>';
    }

    function renderReselling(container) {
        const t = resellTotals();
        let html = '<div class="split-row">' +
            '<span class="split-label">Percentuale da reinvestire nell\u2019attivit\u00e0</span>' +
            '<input type="number" min="0" max="100" id="splitPct" value="' + data.settings.resellingReinvestPct + '" /><span style="color:var(--text-muted);font-size:13px;">%</span>' +
            '</div>';

        html += '<div class="resell-summary">' +
            '<div class="resell-stat"><p>Investito totale</p><p>' + eur(t.invested) + '</p></div>' +
            '<div class="resell-stat"><p>Incassato totale</p><p>' + eur(t.revenue) + '</p></div>' +
            '<div class="resell-stat"><p>Profitto</p><p>' + eur(t.profit) + '</p></div>' +
            '<div class="resell-stat"><p>Da reinvestire</p><p>' + eur(t.reinvest) + '</p></div>' +
            '<div class="resell-stat"><p>Disponibile per te</p><p>' + eur(t.personal) + '</p></div>' +
            '</div>';

        const inVendita = data.items.filter(i => i.status === 'in-vendita');
        const venduti = data.items.filter(i => i.status === 'venduto').sort((a, b) => (b.sellDate || '').localeCompare(a.sellDate || ''));

        html += '<p class="section-label">In vendita (' + inVendita.length + ')</p>';
        html += inVendita.length ? inVendita.map(itemCardHtml).join('') : '<p class="empty-hint">Nessun oggetto in vendita</p>';

        html += '<p class="section-label">Venduti (' + venduti.length + ')</p>';
        html += venduti.length ? venduti.map(itemCardHtml).join('') : '<p class="empty-hint">Nessun oggetto venduto ancora</p>';

        container.innerHTML = html;

        document.getElementById('splitPct').addEventListener('change', (e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v)) v = 50;
            v = Math.max(0, Math.min(100, v));
            data.settings.resellingReinvestPct = v;
            saveData(); renderReselling(container);
        });

        container.querySelectorAll('.item-card').forEach(el => {
            el.addEventListener('click', () => {
                const item = itemById(el.getAttribute('data-id'));
                if (!item) return;
                if (item.status === 'in-vendita') openSellModal(item);
                else openItemModal('edit', item, item.id);
            });
        });
    }

    function openItemModal(mode, vals, itemId) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const isEdit = mode === 'edit';
        overlay.innerHTML =
            '<div class="modal-box">' +
            '<p class="modal-title">' + (isEdit ? 'Modifica oggetto' : 'Nuovo oggetto da rivendere') + '</p>' +
            '<label class="field-label">Nome oggetto</label><input type="text" id="itName" value="' + esc(vals.name || '') + '" />' +
            '<label class="field-label">Prezzo di acquisto (\u20ac)</label><input type="text" inputmode="decimal" id="itBuyPrice" value="' + (vals.buyPrice || '') + '" />' +
            '<label class="field-label">Pagato con</label><select id="itBuyAcc">' + accOptions(vals.buyAccountId) + '</select>' +
            '<label class="field-label">Data acquisto</label><input type="date" id="itBuyDate" value="' + (vals.date || vals.buyDate || todayStr()) + '" />' +
            '<div class="modal-actions">' +
            (isEdit ? '<button class="btn btn-danger" id="itDelete">Elimina</button>' : '') +
            '<button class="btn btn-ghost" id="itCancel">Annulla</button>' +
            '<button class="btn btn-primary" id="itSave">Salva</button>' +
            '</div>' +
            '</div>';

        overlay.querySelector('#itCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        if (isEdit) {
            overlay.querySelector('#itDelete').onclick = () => {
                if (!confirm('Eliminare questo oggetto? Verranno rimossi anche i movimenti collegati.')) return;
                data.transactions = data.transactions.filter(t => t.itemId !== itemId);
                data.items = data.items.filter(i => i.id !== itemId);
                saveData(); overlay.remove(); renderContent();
            };
        }

        overlay.querySelector('#itSave').onclick = () => {
            const name = overlay.querySelector('#itName').value.trim();
            const buyPrice = parseFloat((overlay.querySelector('#itBuyPrice').value || '0').replace(',', '.'));
            const buyAccountId = overlay.querySelector('#itBuyAcc').value;
            const buyDate = overlay.querySelector('#itBuyDate').value || todayStr();
            if (!name || !buyPrice || buyPrice <= 0) return;

            if (isEdit) {
                const item = itemById(itemId);
                item.name = name; item.buyPrice = buyPrice; item.buyAccountId = buyAccountId; item.buyDate = buyDate;
                const buyTx = data.transactions.find(t => t.id === item.buyTransactionId);
                if (buyTx) { buyTx.amount = buyPrice; buyTx.accountId = buyAccountId; buyTx.date = buyDate; buyTx.note = 'Acquisto: ' + name; }
            } else {
                const itemIdNew = uid('item');
                const txId = uid('tx');
                data.transactions.push({ id: txId, type: 'expense', amount: buyPrice, date: buyDate, note: 'Acquisto: ' + name, accountId: buyAccountId, categoryId: 'cat_reselling', itemId: itemIdNew, createdAt: new Date().toISOString() });
                data.items.push({ id: itemIdNew, name, buyPrice, buyAccountId, buyDate, buyTransactionId: txId, status: 'in-vendita', sellPrice: null, sellDate: null, sellAccountId: null, sellTransactionId: null });
            }
            saveData(); overlay.remove(); renderContent();
        };

        document.body.appendChild(overlay);
    }

    function openSellModal(item) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML =
            '<div class="modal-box">' +
            '<p class="modal-title">Segna come venduto</p>' +
            '<p class="modal-sub">' + esc(item.name) + ' \u2014 acquistato a ' + eur(item.buyPrice) + '</p>' +
            '<label class="field-label">Prezzo di vendita (\u20ac)</label><input type="text" inputmode="decimal" id="sellPrice" />' +
            '<label class="field-label">Ricevuto su</label><select id="sellAcc">' + accOptions(item.buyAccountId) + '</select>' +
            '<label class="field-label">Data vendita</label><input type="date" id="sellDate" value="' + todayStr() + '" />' +
            '<div class="modal-actions">' +
            '<button class="btn btn-ghost" id="sellCancel">Annulla</button>' +
            '<button class="btn btn-primary" id="sellSave">Conferma vendita</button>' +
            '</div>' +
            '</div>';
        overlay.querySelector('#sellCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('#sellSave').onclick = () => {
            const sellPrice = parseFloat((overlay.querySelector('#sellPrice').value || '0').replace(',', '.'));
            const sellAccountId = overlay.querySelector('#sellAcc').value;
            const sellDate = overlay.querySelector('#sellDate').value || todayStr();
            if (!sellPrice || sellPrice <= 0) return;
            const txId = uid('tx');
            data.transactions.push({ id: txId, type: 'income', amount: sellPrice, date: sellDate, note: 'Vendita: ' + item.name, accountId: sellAccountId, categoryId: 'cat_reselling', itemId: item.id, createdAt: new Date().toISOString() });
            item.status = 'venduto'; item.sellPrice = sellPrice; item.sellDate = sellDate; item.sellAccountId = sellAccountId; item.sellTransactionId = txId;
            saveData(); overlay.remove(); renderContent();
        };
        document.body.appendChild(overlay);
    }

    // ---------- Init ----------
    function init() {
        data = loadData();
        renderShell();
        renderContent();
    }

    window.Finanze = { onShow: function () { renderContent(); } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();