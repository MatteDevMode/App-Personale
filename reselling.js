(function () {
    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function todayStr() { return formatDate(new Date()); }
    function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    function daysBetween(a, b) { return Math.max(0, Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000)); }
    function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function attr(s) { return esc(s).replace(/"/g, '&quot;'); }
    function eur(n) { return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }); }
    function num(v) { const n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? NaN : n; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

    const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const STATUS = {
        'da-pubblicare': { label: 'Da pubblicare', color: '#E0B34D' },
        'in-vendita': { label: 'In vendita', color: '#6C8CF5' },
        'venduto': { label: 'Venduto', color: '#3FCFA0' }
    };
    const CONDITIONS = ['Nuovo con cartellino', 'Nuovo senza cartellino', 'Ottime condizioni', 'Buone condizioni', 'Condizioni soddisfacenti'];
    const PLATFORMS = ['Vinted', 'eBay', 'Subito', 'Depop', 'Facebook Marketplace', 'Altro'];
    const CATEGORIES = ['Abbigliamento', 'Scarpe', 'Accessori', 'Elettronica', 'Casa', 'Giochi e collezionismo', 'Altro'];
    const STALE_DAYS = 30;

    // ---------- AI (Gemini tramite Firebase AI Logic, livello gratuito) ----------
    const FIREBASE_VER = '12.19.0';
    const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash']; // se il primo non esiste più, prova il successivo
    const APPCHECK_SITE_KEY = '';                                  // opzionale: chiave reCAPTCHA v3 se Firebase richiede App Check
    const MAX_PHOTOS = 4;
    let aiPromise = null;

    function getAI() {
        if (!aiPromise) aiPromise = (async () => {
            const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VER + '/';
            const [appMod, aiMod] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-ai.js')]);
            let app;
            try { app = appMod.getApp('ai-logic'); } catch (e) { app = appMod.initializeApp(window.firebase.app().options, 'ai-logic'); }
            if (APPCHECK_SITE_KEY) {
                const acMod = await import(base + 'firebase-app-check.js');
                acMod.initializeAppCheck(app, { provider: new acMod.ReCaptchaV3Provider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
            }
            return { aiMod, ai: aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() }) };
        })().catch(err => { aiPromise = null; throw err; });
        return aiPromise;
    }

    function buildPrompt(f, nPhotos) {
        const rows = [['Nome', f.name], ['Marca', f.brand], ['Categoria', f.category], ['Taglia', f.size], ['Condizione', f.condition], ['Note del venditore', f.notes]]
            .filter(r => r[1]).map(r => '- ' + r[0] + ': ' + r[1]).join('\n');
        return 'Sei un esperto di vendite su Vinted in Italia. Scrivi un annuncio in italiano per l\u2019oggetto descritto qui sotto' + (nPhotos ? ' e mostrato nelle foto allegate' : '') + '.\n\n' +
            'DATI DEL VENDITORE (affidabili):\n' + rows + '\n\n' +
            'REGOLE:\n' +
            '- Titolo: massimo 60 caratteri, con marca, tipo di articolo, taglia e un dettaglio chiave.\n' +
            '- Descrizione: tono semplice e amichevole, 4-8 righe brevi: cos\u2019\u00e8, stato, taglia, colore o materiale se visibili, eventuali difetti visibili nelle foto, punti di forza. Chiudi con una riga su spedizione e pacchetti, poi una riga con 5-8 hashtag.\n' +
            '- Non inventare nulla che non sia nei dati o chiaramente visibile nelle foto (niente misure, materiali, marche o difetti non verificabili). Se un dato manca, non citarlo.\n' +
            '- Non scrivere il prezzo. Al massimo 2-3 emoji.\n\n' +
            'Rispondi SOLO con JSON valido, nel formato {"titolo":"...","descrizione":"..."}.';
    }

    function parseAIText(text) {
        const clean = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
        try { const o = JSON.parse(clean); return { titolo: String(o.titolo || ''), descrizione: String(o.descrizione || '') }; }
        catch (e) { return { titolo: '', descrizione: String(text || '').trim() }; }
    }

    async function generateWithAI(fields, photos) {
        const { aiMod, ai } = await getAI();
        const parts = [buildPrompt(fields, photos.length)].concat(photos.map(p => ({ inlineData: { mimeType: 'image/jpeg', data: p.b64 } })));
        let lastErr;
        for (const name of MODELS) {
            try {
                const model = aiMod.getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: 'application/json' } });
                const res = await model.generateContent(parts);
                return parseAIText(res.response.text());
            } catch (err) {
                lastErr = err;
                if (!/not.?found|404|no longer|deprecated|unsupported/i.test(String(err && err.message))) throw err;
            }
        }
        throw lastErr;
    }

    function friendlyError(e) {
        const m = String((e && e.message) || e);
        if (/app.?check/i.test(m)) return 'Firebase sta bloccando la richiesta con App Check (serve registrare l\u2019app).';
        if (/quota|429|rate/i.test(m)) return 'hai raggiunto il limite gratuito, riprova tra qualche minuto.';
        if (/not.?found|404/i.test(m)) return 'il modello AI non \u00e8 disponibile.';
        if (/import|fetch|network|Failed to load/i.test(m)) return 'impossibile caricare il modulo AI (controlla la connessione).';
        return m.slice(0, 160);
    }

    function templateText(f) {
        const titolo = [f.brand, f.name, f.size && 'tg. ' + f.size].filter(Boolean).join(' ').slice(0, 60);
        const righe = [f.name + (f.brand ? ' ' + f.brand : '') + '.'];
        if (f.size) righe.push('Taglia: ' + f.size);
        if (f.condition) righe.push('Condizioni: ' + f.condition);
        if (f.category) righe.push('Categoria: ' + f.category);
        if (f.notes) righe.push(f.notes);
        righe.push('Spedizione veloce e imballaggio curato. Scrivimi per qualsiasi domanda o per fare un pacchetto con altri articoli!');
        const tags = [f.brand, f.category, 'vinted'].filter(Boolean).map(t => '#' + t.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, ''));
        righe.push(tags.join(' '));
        return { titolo, descrizione: righe.join('\n') };
    }

    function readAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); }); }
    function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('immagine non valida')); i.src = src; }); }
    async function shrink(file) {
        if (!file.type || file.type.indexOf('image/') !== 0) throw new Error('il file non è un\u2019immagine');
        const img = await loadImage(await readAsDataURL(file));
        const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.82);
    }

    function copyText(t) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
        const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } finally { ta.remove(); }
        return Promise.resolve();
    }

    // ---------- Stile ----------
    function injectStyle() {
        if (document.getElementById('resellingStyle')) return;
        const s = document.createElement('style');
        s.id = 'resellingStyle';
        s.textContent =
            '#page-reselling{padding-bottom:88px;}' +
            '.rs-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}' +
            '.rs-select{width:100%;background:var(--bg-card);border:1px solid var(--border-strong);border-radius:10px;padding:9px 10px;color:var(--text-primary);font-size:13px;font-family:var(--font-body);}' +
            '.rs-banner{background:var(--accent-wash);border:1px solid var(--accent-dim);border-radius:12px;padding:12px 14px;margin-bottom:1rem;font-size:13.5px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;}' +
            '.rs-hint{font-size:12px;color:var(--text-secondary);margin:6px 0 0;line-height:1.5;}' +
            '.rs-stale{font-size:11.5px;color:#E8604C;margin-left:6px;}' +
            '.rs-photos{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0;}' +
            '.rs-thumb{position:relative;aspect-ratio:1;}' +
            '.rs-thumb img{width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--border);}' +
            '.rs-thumb button{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;font-size:12px;line-height:1;}' +
            '.rs-ai{border:1px dashed var(--border-strong);border-radius:12px;padding:12px;margin-top:14px;}' +
            '@media(max-width:720px){#page-reselling{padding-bottom:96px;}.rs-row3{grid-template-columns:1fr 1fr;}}';
        document.head.appendChild(s);
    }

    // ---------- Dati ----------
    function defaultData() { return { items: [], settings: { reinvestPct: 50, targetMarginPct: 30 }, migrated: false }; }
    let data = defaultData();
    let fin = { accounts: [], categories: [], transactions: [], items: [], settings: {} };
    let docRef = null, finRef = null, unsubs = [], loaded = { r: false, f: false }, ready = false;
    let charts = { m: null, c: null };
    const state = { view: 'items', status: 'all', q: '', sort: 'recent', cat: '', brand: '', period: 'month' };

    function saveData() { if (docRef) docRef.set(data).catch(err => console.error('Errore salvataggio Reselling:', err)); }
    function itemById(id) { return data.items.find(i => i.id === id); }
    function accById(id) { return (fin.accounts || []).find(a => a.id === id); }

    function netAmount(i) { return (i.soldPrice || 0) - (i.costs || 0); }
    function profitOf(i) { return netAmount(i) - (i.buyPrice || 0); }
    function marginOf(i) { return i.soldPrice ? profitOf(i) / i.soldPrice * 100 : 0; }
    function startOf(i) { return i.listDate || i.buyDate || todayStr(); }
    function daysListed(i) { return daysBetween(startOf(i), i.status === 'venduto' && i.soldDate ? i.soldDate : todayStr()); }
    function isStale(i) { return i.status === 'in-vendita' && daysListed(i) >= STALE_DAYS; }

    function totals() {
        const sold = data.items.filter(i => i.status === 'venduto');
        const stock = data.items.filter(i => i.status !== 'venduto');
        const profit = sold.reduce((s, i) => s + profitOf(i), 0);
        const pct = data.settings.reinvestPct;
        const reinvest = profit > 0 ? profit * pct / 100 : 0;
        return {
            stockCount: stock.length, invested: stock.reduce((s, i) => s + (i.buyPrice || 0), 0),
            revenue: sold.reduce((s, i) => s + netAmount(i), 0), profit, reinvest, personal: profit > 0 ? profit - reinvest : profit
        };
    }

    // ---------- Movimenti collegati a Finanze ----------
    function removeTx(d, id) { d.transactions = d.transactions.filter(t => t.id !== id); }
    function upsertTx(d, item, key, fields) {
        const existing = item[key] && d.transactions.find(t => t.id === item[key]);
        if (existing) Object.assign(existing, fields);
        else { const id = uid('tx'); d.transactions.push(Object.assign({ id, createdAt: new Date().toISOString() }, fields)); item[key] = id; }
    }
    function reconcile(d, item) {
        const base = { categoryId: 'cat_reselling', itemId: item.id };
        if (item.buyPrice > 0 && item.buyAccountId) {
            upsertTx(d, item, 'buyTxId', Object.assign({ type: 'expense', amount: item.buyPrice, date: item.buyDate, note: 'Acquisto: ' + item.name, accountId: item.buyAccountId }, base));
        } else if (item.buyTxId) { removeTx(d, item.buyTxId); item.buyTxId = null; }
        const n = netAmount(item);
        if (item.status === 'venduto' && n > 0 && item.sellAccountId) {
            upsertTx(d, item, 'sellTxId', Object.assign({ type: 'income', amount: round2(n), date: item.soldDate, note: 'Vendita: ' + item.name, accountId: item.sellAccountId }, base));
        } else if (item.sellTxId) { removeTx(d, item.sellTxId); item.sellTxId = null; }
    }
    function finMutate(fn) {
        return window.db.runTransaction(async tx => {
            const snap = await tx.get(finRef);
            if (!snap.exists) throw new Error('apri prima la scheda Finanze per creare i conti.');
            const d = snap.data();
            d.transactions = d.transactions || []; d.categories = d.categories || [];
            if (!d.categories.some(c => c.id === 'cat_reselling')) d.categories.push({ id: 'cat_reselling', name: 'Reselling', color: '#4FD1C5', budget: null });
            fn(d);
            tx.set(finRef, d);
        });
    }
    async function commitItem(copy) {
        try { await finMutate(d => reconcile(d, copy)); }
        catch (err) { console.error(err); alert('Impossibile aggiornare i conti: ' + err.message); return false; }
        const i = data.items.findIndex(x => x.id === copy.id);
        if (i >= 0) data.items[i] = copy; else data.items.push(copy);
        saveData();
        return true;
    }
    async function deleteItem(item) {
        try { await finMutate(d => { removeTx(d, item.buyTxId); removeTx(d, item.sellTxId); }); }
        catch (err) { alert('Impossibile aggiornare i conti: ' + err.message); return false; }
        data.items = data.items.filter(x => x.id !== item.id);
        saveData();
        return true;
    }

    // ---------- Importazione dal vecchio Reselling (dentro Finanze) ----------
    function migrate() {
        const legacy = fin.items || [];
        data.items = legacy.map(o => ({
            id: o.id, name: o.name || 'Oggetto', brand: '', category: '', size: '', condition: '', source: '',
            buyPrice: o.buyPrice || 0, buyAccountId: o.buyAccountId || null, buyDate: o.buyDate || todayStr(), buyTxId: o.buyTransactionId || null,
            status: o.status === 'venduto' ? 'venduto' : 'in-vendita', listPrice: null, listDate: o.buyDate || null, platform: 'Vinted',
            soldPrice: o.sellPrice || null, soldDate: o.sellDate || null, sellAccountId: o.sellAccountId || null, sellTxId: o.sellTransactionId || null,
            costs: 0, notes: '', vTitle: '', vDesc: '', createdAt: new Date().toISOString()
        }));
        if (fin.settings && typeof fin.settings.resellingReinvestPct === 'number') data.settings.reinvestPct = fin.settings.resellingReinvestPct;
        data.migrated = true;
        saveData();
        renderContent();
    }

    // ---------- Shell ----------
    function renderShell() {
        const page = document.getElementById('page-reselling');
        page.innerHTML =
            '<div class="todo-top"><div><p class="eyebrow">Ambito attivo</p><h1 style="margin:0;">Reselling</h1></div>' +
            '<div class="view-switch"><button id="rsViewItems">Oggetti</button><button id="rsViewStats">Statistiche</button></div></div>' +
            '<div id="resellingContent"></div>' +
            '<div class="fin-bottom-bar"><button class="fin-new-btn" id="rsNewBtn">+ Nuovo oggetto</button></div>';
        document.getElementById('rsViewItems').onclick = () => { state.view = 'items'; renderContent(); };
        document.getElementById('rsViewStats').onclick = () => { state.view = 'stats'; renderContent(); };
        document.getElementById('rsNewBtn').onclick = () => openItemModal(null);
    }

    function renderContent() {
        if (!document.getElementById('rsViewItems')) return;
        document.getElementById('rsViewItems').classList.toggle('active', state.view === 'items');
        document.getElementById('rsViewStats').classList.toggle('active', state.view === 'stats');
        const c = document.getElementById('resellingContent');
        if (state.view === 'items') renderItems(c); else renderStats(c);
    }

    // ---------- Oggetti ----------
    function stat(a, b) { return '<div class="resell-stat"><p>' + a + '</p><p>' + b + '</p></div>'; }

    function filteredItems() {
        const q = state.q.trim().toLowerCase();
        let list = data.items.filter(i =>
            (state.status === 'all' || i.status === state.status) &&
            (!state.cat || i.category === state.cat) && (!state.brand || i.brand === state.brand) &&
            (!q || [i.name, i.brand, i.size, i.category, i.notes].some(t => (t || '').toLowerCase().includes(q))));
        if (state.sort === 'oldest') list.sort((a, b) => (a.status === 'venduto') - (b.status === 'venduto') || daysListed(b) - daysListed(a));
        else if (state.sort === 'profit') list.sort((a, b) => (b.status === 'venduto' ? profitOf(b) : -1e9) - (a.status === 'venduto' ? profitOf(a) : -1e9));
        else list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return list;
    }

    function itemCardHtml(i) {
        const st = STATUS[i.status] || STATUS['in-vendita'];
        const sold = i.status === 'venduto';
        const p = profitOf(i);
        const right = sold
            ? '<span class="item-profit" style="' + (p < 0 ? 'color:#E8604C;' : '') + '">' + (p >= 0 ? '+' : '') + eur(p) + '</span>'
            : '<span class="item-badge">' + st.label + '</span>';
        const sub = [i.brand, i.size, i.category].filter(Boolean).join(' \u00b7 ');
        let meta = 'Acquisto ' + eur(i.buyPrice);
        if (sold) meta += ' \u00b7 Vendita ' + eur(i.soldPrice) + ' \u00b7 margine ' + Math.round(marginOf(i)) + '% \u00b7 in ' + daysListed(i) + ' giorni';
        else if (i.listPrice) meta += ' \u00b7 Prezzo ' + eur(i.listPrice);
        return '<div class="item-card" style="--item-color:' + st.color + ';" data-id="' + i.id + '"><div class="item-top"><span class="item-name">' + esc(i.name) + '</span>' + right + '</div>' +
            (sub ? '<p class="item-meta">' + esc(sub) + '</p>' : '') +
            '<p class="item-meta">' + meta + (isStale(i) ? '<span class="rs-stale">\u23f3 da ' + daysListed(i) + ' giorni</span>' : '') + '</p></div>';
    }

    function drawList() {
        const el = document.getElementById('rsList');
        if (!el) return;
        const list = filteredItems();
        el.innerHTML = list.length ? list.map(itemCardHtml).join('') : '<p class="empty-hint">' + (data.items.length ? 'Nessun oggetto con questi filtri' : 'Nessun oggetto ancora. Aggiungi il primo!') + '</p>';
        el.querySelectorAll('.item-card').forEach(c => c.addEventListener('click', () => { const it = itemById(c.getAttribute('data-id')); if (it) openItemModal(it); }));
    }

    function renderItems(c) {
        const t = totals();
        const legacy = (fin.items || []).length;
        let html = '';
        if (!data.migrated && !data.items.length && legacy) {
            html += '<div class="rs-banner"><span>Ho trovato <b>' + legacy + '</b> oggetti nel vecchio Reselling di Finanze. Vuoi importarli qui? I saldi dei conti non cambiano.</span><button class="btn btn-primary" id="rsMigrate" style="flex:0 0 auto;">Importa</button></div>';
        }
        const brands = Array.from(new Set(data.items.map(i => i.brand).filter(Boolean))).sort();
        const cats = Array.from(new Set(data.items.map(i => i.category).filter(Boolean))).sort();
        const opt = (list, cur, all) => '<option value="">' + all + '</option>' + list.map(x => '<option value="' + attr(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
        const chips = [['all', 'Tutti'], ['da-pubblicare', 'Da pubblicare'], ['in-vendita', 'In vendita'], ['venduto', 'Venduti']];

        html += '<div class="resell-summary">' + stat('Da vendere', t.stockCount) + stat('Investito', eur(t.invested)) + stat('Incassato', eur(t.revenue)) +
            stat('Profitto', eur(t.profit)) + stat('Da reinvestire', eur(t.reinvest)) + stat('Disponibile per te', eur(t.personal)) + '</div>' +
            '<div class="diary-search"><input type="text" id="rsSearch" placeholder="Cerca per nome, marca, taglia..." value="' + attr(state.q) + '" /></div>' +
            '<div class="period-switch">' + chips.map(ch => '<button class="period-btn' + (state.status === ch[0] ? ' active' : '') + '" data-s="' + ch[0] + '">' + ch[1] + '</button>').join('') + '</div>' +
            '<div class="rs-row3"><select class="rs-select" id="rsSort"><option value="recent">Più recenti</option><option value="oldest"' + (state.sort === 'oldest' ? ' selected' : '') + '>Fermi da più tempo</option><option value="profit"' + (state.sort === 'profit' ? ' selected' : '') + '>Più profitto</option></select>' +
            '<select class="rs-select" id="rsBrand">' + opt(brands, state.brand, 'Tutte le marche') + '</select>' +
            '<select class="rs-select" id="rsCat">' + opt(cats, state.cat, 'Tutte le categorie') + '</select></div>' +
            '<div id="rsList"></div>';
        c.innerHTML = html;

        const mig = document.getElementById('rsMigrate'); if (mig) mig.onclick = migrate;
        document.getElementById('rsSearch').addEventListener('input', e => { state.q = e.target.value; drawList(); });
        document.getElementById('rsSort').addEventListener('change', e => { state.sort = e.target.value; drawList(); });
        document.getElementById('rsBrand').addEventListener('change', e => { state.brand = e.target.value; drawList(); });
        document.getElementById('rsCat').addEventListener('change', e => { state.cat = e.target.value; drawList(); });
        c.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { state.status = b.getAttribute('data-s'); renderItems(c); }));
        drawList();
    }

    // ---------- Statistiche ----------
    function periodRange() {
        const t = new Date();
        let start, end = todayStr();
        if (state.period === 'month') start = formatDate(new Date(t.getFullYear(), t.getMonth(), 1));
        else if (state.period === '3months') start = formatDate(new Date(t.getFullYear(), t.getMonth() - 2, 1));
        else if (state.period === 'year') start = formatDate(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate()));
        else { start = '0000-00-00'; end = '9999-99-99'; }
        return { start, end };
    }

    function renderStats(c) {
        Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); charts[k] = null; } });
        const { start, end } = periodRange();
        const sold = data.items.filter(i => i.status === 'venduto' && i.soldDate && i.soldDate >= start && i.soldDate <= end);
        const revenue = sold.reduce((s, i) => s + netAmount(i), 0);
        const profit = sold.reduce((s, i) => s + profitOf(i), 0);
        const cost = sold.reduce((s, i) => s + (i.buyPrice || 0), 0);
        const avgMargin = sold.length ? sold.reduce((s, i) => s + marginOf(i), 0) / sold.length : 0;
        const avgDays = sold.length ? sold.reduce((s, i) => s + daysListed(i), 0) / sold.length : 0;
        const labels = { month: 'Mese', '3months': '3 mesi', year: 'Anno', all: 'Sempre' };

        let html = '<div class="period-switch">' + Object.keys(labels).map(k => '<button class="period-btn' + (state.period === k ? ' active' : '') + '" data-p="' + k + '">' + labels[k] + '</button>').join('') + '</div>' +
            '<div class="resell-summary">' + stat('Venduti', sold.length) + stat('Incassato', eur(revenue)) + stat('Profitto', eur(profit)) +
            stat('Margine medio', Math.round(avgMargin) + '%') + stat('ROI', (cost ? Math.round(profit / cost * 100) : 0) + '%') + stat('Giorni per vendere', Math.round(avgDays)) + '</div>';
        if (sold.length) {
            html += '<div class="chart-card"><p class="chart-title">Incassi e profitto per mese</p><div class="chart-wrap"><canvas id="rsChartM"></canvas></div></div>' +
                '<div class="chart-card"><p class="chart-title">Profitto per categoria</p><div class="chart-wrap"><canvas id="rsChartC"></canvas></div></div>';
        } else html += '<p class="empty-hint">Nessuna vendita nel periodo.</p>';

        html += '<p class="section-label">Impostazioni</p>' +
            '<div class="split-row"><span class="split-label">Percentuale di profitto da reinvestire</span><input type="number" min="0" max="100" id="rsReinvest" value="' + data.settings.reinvestPct + '" /><span style="color:var(--text-muted);font-size:13px;">%</span></div>' +
            '<div class="split-row"><span class="split-label">Margine obiettivo (per il prezzo minimo)</span><input type="number" min="0" max="90" id="rsTarget" value="' + data.settings.targetMarginPct + '" /><span style="color:var(--text-muted);font-size:13px;">%</span></div>';
        c.innerHTML = html;

        c.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { state.period = b.getAttribute('data-p'); renderStats(c); }));
        const setPct = (id, key, def, max) => document.getElementById(id).addEventListener('change', e => {
            let v = parseInt(e.target.value, 10); if (isNaN(v)) v = def;
            data.settings[key] = Math.max(0, Math.min(max, v)); saveData(); renderStats(c);
        });
        setPct('rsReinvest', 'reinvestPct', 50, 100); setPct('rsTarget', 'targetMarginPct', 30, 90);
        if (sold.length && typeof Chart !== 'undefined') drawCharts(sold, start, end);
    }

    function drawCharts(sold, start, end) {
        const txt = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#9BA3B8';
        const grid = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,.07)';
        const first = sold.map(i => i.soldDate).sort()[0];
        const from = parseDateStr(start === '0000-00-00' ? first : (first > start ? first : start)), to = parseDateStr(end === '9999-99-99' ? todayStr() : end);
        const months = [];
        for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d.setMonth(d.getMonth() + 1)) months.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1));
        const by = ym => sold.filter(i => i.soldDate.slice(0, 7) === ym);
        charts.m = new Chart(document.getElementById('rsChartM'), {
            type: 'bar',
            data: {
                labels: months.map(ym => MONTHS[+ym.slice(5, 7) - 1] + ' \u2019' + ym.slice(2, 4)), datasets: [
                    { label: 'Incassato', data: months.map(ym => round2(by(ym).reduce((s, i) => s + netAmount(i), 0))), backgroundColor: '#3FCFA0', borderRadius: 4 },
                    { label: 'Profitto', data: months.map(ym => round2(by(ym).reduce((s, i) => s + profitOf(i), 0))), backgroundColor: '#7C8CF8', borderRadius: 4 }]
            },
            options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: txt } } }, scales: { x: { ticks: { color: txt }, grid: { display: false } }, y: { ticks: { color: txt }, grid: { color: grid } } } }
        });
        const cat = {};
        sold.forEach(i => { const k = i.category || 'Senza categoria'; cat[k] = (cat[k] || 0) + profitOf(i); });
        const keys = Object.keys(cat).sort((a, b) => cat[b] - cat[a]).slice(0, 8);
        charts.c = new Chart(document.getElementById('rsChartC'), {
            type: 'bar',
            data: { labels: keys, datasets: [{ data: keys.map(k => round2(cat[k])), backgroundColor: keys.map(k => cat[k] >= 0 ? '#3FCFA0' : '#E8604C'), borderRadius: 4 }] },
            options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: txt }, grid: { color: grid } }, y: { ticks: { color: txt }, grid: { display: false } } } }
        });
    }

    // ---------- Modale oggetto ----------
    function accOptions(sel) {
        const list = fin.accounts || [];
        return list.length ? list.map(a => '<option value="' + attr(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') : '<option value="">Nessun conto in Finanze</option>';
    }
    function dl(id, list) { return '<datalist id="' + id + '">' + list.map(x => '<option value="' + attr(x) + '"></option>').join('') + '</datalist>'; }

    function openItemModal(item) {
        const isEdit = !!item;
        const v = item || { status: 'da-pubblicare', buyDate: todayStr(), platform: 'Vinted', condition: 'Buone condizioni', buyAccountId: (fin.accounts[0] || {}).id };
        const sold = v.status === 'venduto';
        const brands = Array.from(new Set(data.items.map(i => i.brand).filter(Boolean)));
        const cats = Array.from(new Set(CATEGORIES.concat(data.items.map(i => i.category).filter(Boolean))));
        const photos = [];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML =
            '<div class="modal-box"><p class="modal-title">' + (isEdit ? 'Modifica oggetto' : 'Nuovo oggetto') + '</p>' +
            '<label class="field-label">Nome</label><input type="text" id="rName" value="' + attr(v.name) + '" placeholder="Es. Giubbotto invernale" />' +
            '<div class="row-2"><div><label class="field-label">Marca</label><input type="text" id="rBrand" list="rBrands" value="' + attr(v.brand) + '" /></div>' +
            '<div><label class="field-label">Categoria</label><input type="text" id="rCat" list="rCats" value="' + attr(v.category) + '" /></div></div>' +
            dl('rBrands', brands) + dl('rCats', cats) +
            '<div class="row-2"><div><label class="field-label">Taglia</label><input type="text" id="rSize" value="' + attr(v.size) + '" /></div>' +
            '<div><label class="field-label">Condizione</label><select id="rCond">' + CONDITIONS.map(c => '<option' + (c === v.condition ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div></div>' +
            '<label class="field-label">Dove l\u2019ho preso (opzionale)</label><input type="text" id="rSource" value="' + attr(v.source) + '" />' +
            '<div class="row-2"><div><label class="field-label">Prezzo di acquisto (\u20ac)</label><input type="text" inputmode="decimal" id="rBuy" value="' + (v.buyPrice || '') + '" placeholder="0" /></div>' +
            '<div><label class="field-label">Pagato con</label><select id="rBuyAcc">' + accOptions(v.buyAccountId) + '</select></div></div>' +
            '<label class="field-label">Data acquisto</label><input type="date" id="rBuyDate" value="' + (v.buyDate || todayStr()) + '" />' +
            (sold ? '<p class="modal-sub" style="margin-top:12px;">Venduto il ' + v.soldDate + ' a ' + eur(v.soldPrice) + '. Usa "Modifica vendita" per cambiare i dati della vendita.</p>' :
                '<div class="row-2"><div><label class="field-label">Stato</label><select id="rStatus"><option value="da-pubblicare"' + (v.status === 'da-pubblicare' ? ' selected' : '') + '>Da pubblicare</option><option value="in-vendita"' + (v.status === 'in-vendita' ? ' selected' : '') + '>In vendita</option></select></div>' +
                '<div><label class="field-label">Prezzo proposto (\u20ac)</label><input type="text" inputmode="decimal" id="rList" value="' + (v.listPrice || '') + '" /></div></div>') +
            '<label class="field-label">Piattaforma</label><select id="rPlat">' + PLATFORMS.map(p => '<option' + (p === v.platform ? ' selected' : '') + '>' + p + '</option>').join('') + '</select>' +
            '<p class="rs-hint" id="rHints"></p>' +
            '<label class="field-label">Note</label><textarea id="rNotes" placeholder="Difetti, misure, dettagli utili..." style="min-height:70px;">' + esc(v.notes) + '</textarea>' +
            '<div class="rs-ai"><label class="field-label" style="margin-top:0;">Descrizione per Vinted</label>' +
            '<div class="rs-photos" id="rPhotos"></div>' +
            '<button type="button" class="btn btn-ghost" id="rAddPh" style="width:100%;">Aggiungi foto (max ' + MAX_PHOTOS + ')</button><input type="file" id="rFile" accept="image/*" multiple style="display:none;" />' +
            '<p class="rs-hint">Le foto servono solo a generare il testo e non vengono salvate.</p>' +
            '<div class="row-2" style="margin-top:10px;"><button type="button" class="btn btn-primary" id="rGenAI">Genera con AI</button><button type="button" class="btn btn-ghost" id="rGenTpl">Da modello</button></div>' +
            '<p class="rs-hint" id="rMsg"></p>' +
            '<label class="field-label">Titolo</label><input type="text" id="rVTitle" value="' + attr(v.vTitle) + '" />' +
            '<label class="field-label">Descrizione</label><textarea id="rVDesc" style="min-height:140px;">' + esc(v.vDesc) + '</textarea>' +
            '<div class="row-2" style="margin-top:8px;"><button type="button" class="btn btn-ghost" id="rCopyT">Copia titolo</button><button type="button" class="btn btn-ghost" id="rCopyD">Copia descrizione</button></div></div>' +
            (isEdit ? '<div class="modal-actions" style="flex-direction:column;margin-top:1rem;">' +
                (sold ? '<button class="btn btn-primary" id="rSellEdit">Modifica vendita</button><button class="btn btn-ghost" id="rUnsell">Rimetti in vendita</button>' : '<button class="btn btn-primary" id="rSell">Segna come venduto</button>') + '</div>' : '') +
            '<div class="modal-actions">' + (isEdit ? '<button class="btn btn-danger" id="rDelete">Elimina</button>' : '') +
            '<button class="btn btn-ghost" id="rCancel">Annulla</button><button class="btn btn-primary" id="rSave">Salva</button></div></div>';

        const q = s => overlay.querySelector(s);
        const val = id => q(id).value.trim();
        const close = () => overlay.remove();
        const fields = () => ({ name: val('#rName'), brand: val('#rBrand'), category: val('#rCat'), size: val('#rSize'), condition: val('#rCond'), notes: val('#rNotes') });

        function hints() {
            const buy = num(q('#rBuy').value) || 0, m = data.settings.targetMarginPct, b = val('#rBrand'), c = val('#rCat');
            const out = [];
            if (buy > 0 && m < 100) out.push('Prezzo minimo per il tuo margine del ' + m + '%: <b>' + eur(Math.ceil(buy / (1 - m / 100))) + '</b>');
            let sim = data.items.filter(i => i.status === 'venduto' && i.soldPrice && i.id !== (item && item.id) && c && i.category === c);
            const withBrand = sim.filter(i => b && i.brand === b);
            if (withBrand.length >= 2) sim = withBrand;
            if (sim.length) out.push('Venduti simili (' + sim.length + '): mediana <b>' + eur(median(sim.map(i => i.soldPrice))) + '</b>');
            q('#rHints').innerHTML = out.join('<br>');
        }
        ['#rBuy', '#rBrand', '#rCat'].forEach(s => q(s).addEventListener('input', hints));
        hints();

        function drawPhotos() {
            q('#rPhotos').innerHTML = photos.map((p, i) => '<div class="rs-thumb"><img src="' + p.url + '" alt="" /><button type="button" data-rm="' + i + '">\u00d7</button></div>').join('');
            q('#rPhotos').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { photos.splice(+b.getAttribute('data-rm'), 1); drawPhotos(); });
            q('#rAddPh').style.display = photos.length >= MAX_PHOTOS ? 'none' : 'block';
        }
        drawPhotos();
        q('#rAddPh').onclick = () => q('#rFile').click();
        q('#rFile').addEventListener('change', async e => {
            const files = Array.from(e.target.files); e.target.value = '';
            for (const f of files) {
                if (photos.length >= MAX_PHOTOS) break;
                try { const url = await shrink(f); photos.push({ url, b64: url.split(',')[1] }); } catch (err) { q('#rMsg').textContent = 'Foto non aggiunta: ' + err.message; }
            }
            drawPhotos();
        });

        const setOut = o => { if (o.titolo) q('#rVTitle').value = o.titolo; q('#rVDesc').value = o.descrizione; };
        q('#rGenTpl').onclick = () => {
            const f = fields();
            if (!f.name) { q('#rMsg').textContent = 'Scrivi almeno il nome dell\u2019oggetto.'; return; }
            setOut(templateText(f)); q('#rMsg').textContent = 'Testo creato dal modello: ritoccalo come preferisci.';
        };
        q('#rGenAI').onclick = async () => {
            const f = fields();
            if (!f.name) { q('#rMsg').textContent = 'Scrivi almeno il nome dell\u2019oggetto.'; return; }
            const btn = q('#rGenAI'); btn.disabled = true; btn.textContent = 'Sto scrivendo...';
            q('#rMsg').textContent = photos.length ? 'Guardo le foto e scrivo l\u2019annuncio...' : 'Scrivo l\u2019annuncio (senza foto uso solo i dati).';
            try { setOut(await generateWithAI(f, photos)); q('#rMsg').textContent = 'Fatto. Controlla che sia tutto corretto prima di pubblicare.'; }
            catch (err) { console.error(err); q('#rMsg').textContent = 'Generazione non riuscita: ' + friendlyError(err) + ' Puoi usare "Da modello".'; }
            finally { btn.disabled = false; btn.textContent = 'Genera con AI'; }
        };
        const copy = (id, label) => copyText(q(id).value).then(() => { q('#rMsg').textContent = label + ' copiato.'; });
        q('#rCopyT').onclick = () => copy('#rVTitle', 'Titolo');
        q('#rCopyD').onclick = () => copy('#rVDesc', 'Descrizione');

        q('#rCancel').onclick = close;
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        function build() {
            const name = val('#rName');
            const buy = q('#rBuy').value.trim() ? num(q('#rBuy').value) : 0;
            if (!name) { q('#rName').style.borderColor = '#E8604C'; return null; }
            if (isNaN(buy) || buy < 0) { q('#rBuy').style.borderColor = '#E8604C'; return null; }
            const copy = isEdit ? Object.assign({}, item) : { id: uid('it'), createdAt: new Date().toISOString(), status: 'da-pubblicare', soldPrice: null, soldDate: null, sellAccountId: null, sellTxId: null, buyTxId: null, costs: 0 };
            Object.assign(copy, fields(), { source: val('#rSource'), buyPrice: buy, buyAccountId: q('#rBuyAcc').value || null, buyDate: q('#rBuyDate').value || todayStr(), platform: q('#rPlat').value, vTitle: val('#rVTitle'), vDesc: q('#rVDesc').value.trim() });
            if (!sold) {
                const lp = q('#rList').value.trim() ? num(q('#rList').value) : null;
                copy.listPrice = isNaN(lp) ? null : lp;
                copy.status = q('#rStatus').value;
                if (copy.status === 'in-vendita' && !copy.listDate) copy.listDate = todayStr();
                if (copy.status === 'da-pubblicare') copy.listDate = null;
            }
            return copy;
        }

        q('#rSave').onclick = async () => {
            const copy = build(); if (!copy) return;
            const btn = q('#rSave'); btn.disabled = true;
            if (await commitItem(copy)) { close(); renderContent(); } else btn.disabled = false;
        };
        if (isEdit) {
            q('#rDelete').onclick = async () => {
                if (!confirm('Eliminare questo oggetto? Verranno rimossi anche i movimenti collegati in Finanze.')) return;
                if (await deleteItem(item)) { close(); renderContent(); }
            };
            if (sold) {
                q('#rSellEdit').onclick = () => { close(); openSellModal(item); };
                q('#rUnsell').onclick = async () => {
                    const copy = Object.assign({}, item, { status: 'in-vendita', soldPrice: null, soldDate: null, sellAccountId: null, costs: 0, listDate: item.listDate || todayStr() });
                    if (await commitItem(copy)) { close(); renderContent(); }
                };
            } else {
                q('#rSell').onclick = async () => {
                    const copy = build(); if (!copy) return;
                    if (!(await commitItem(copy))) return;
                    close(); openSellModal(copy);
                };
            }
        }
        document.body.appendChild(overlay);
    }

    // ---------- Modale vendita ----------
    function openSellModal(item) {
        const editing = item.status === 'venduto';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML =
            '<div class="modal-box"><p class="modal-title">' + (editing ? 'Modifica vendita' : 'Segna come venduto') + '</p>' +
            '<p class="modal-sub">' + esc(item.name) + ' \u2014 acquistato a ' + eur(item.buyPrice) + '</p>' +
            '<label class="field-label">Prezzo di vendita (\u20ac)</label><input type="text" inputmode="decimal" id="sPrice" value="' + (item.soldPrice || item.listPrice || '') + '" />' +
            '<label class="field-label">Spese di spedizione o commissioni (\u20ac, opzionale)</label><input type="text" inputmode="decimal" id="sCosts" value="' + (item.costs || '') + '" placeholder="0" />' +
            '<label class="field-label">Ricevuto su</label><select id="sAcc">' + accOptions(item.sellAccountId || item.buyAccountId) + '</select>' +
            '<label class="field-label">Data vendita</label><input type="date" id="sDate" value="' + (item.soldDate || todayStr()) + '" />' +
            '<p class="rs-hint" id="sPrev"></p>' +
            '<div class="modal-actions"><button class="btn btn-ghost" id="sCancel">Annulla</button><button class="btn btn-primary" id="sSave">' + (editing ? 'Salva' : 'Conferma vendita') + '</button></div></div>';
        const q = s => overlay.querySelector(s);
        const calc = () => {
            const p = num(q('#sPrice').value) || 0, c = num(q('#sCosts').value) || 0;
            q('#sPrev').innerHTML = p > 0 ? 'Incasso netto sul conto: <b>' + eur(p - c) + '</b> \u00b7 profitto: <b>' + eur(p - c - (item.buyPrice || 0)) + '</b>' : '';
        };
        ['#sPrice', '#sCosts'].forEach(s => q(s).addEventListener('input', calc)); calc();
        q('#sCancel').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        q('#sSave').onclick = async () => {
            const price = num(q('#sPrice').value), costs = q('#sCosts').value.trim() ? num(q('#sCosts').value) : 0;
            if (isNaN(price) || price <= 0) { q('#sPrice').style.borderColor = '#E8604C'; return; }
            if (isNaN(costs) || costs < 0) { q('#sCosts').style.borderColor = '#E8604C'; return; }
            const copy = Object.assign({}, item, { status: 'venduto', soldPrice: price, costs, soldDate: q('#sDate').value || todayStr(), sellAccountId: q('#sAcc').value || null });
            const btn = q('#sSave'); btn.disabled = true;
            if (await commitItem(copy)) { overlay.remove(); renderContent(); } else btn.disabled = false;
        };
        document.body.appendChild(overlay);
    }

    // ---------- Init ----------
    function tryReady() {
        if (!(loaded.r && loaded.f)) return;
        if (!ready) { ready = true; renderShell(); }
        renderContent();
    }

    function startForUser(uid_) {
        stop();
        injectStyle();
        const page = document.getElementById('page-reselling');
        if (page) page.innerHTML = '<p class="empty-hint">Caricamento...</p>';
        const base = window.db.collection('users').doc(uid_).collection('modules');
        docRef = base.doc('reselling');
        finRef = base.doc('finanze');
        unsubs.push(docRef.onSnapshot(snap => {
            if (snap.exists) { data = Object.assign(defaultData(), snap.data()); data.settings = Object.assign(defaultData().settings, data.settings); }
            else { data = defaultData(); docRef.set(data).catch(err => console.error('Errore inizializzazione Reselling:', err)); }
            loaded.r = true; tryReady();
        }, err => { console.error('Errore lettura Reselling:', err); }));
        unsubs.push(finRef.onSnapshot(snap => {
            fin = Object.assign({ accounts: [], categories: [], transactions: [], items: [], settings: {} }, snap.exists ? snap.data() : {});
            loaded.f = true; tryReady();
        }, err => { console.error('Errore lettura Finanze (Reselling):', err); loaded.f = true; tryReady(); }));
    }

    function stop() {
        unsubs.forEach(u => u()); unsubs = [];
        docRef = null; finRef = null; ready = false; loaded = { r: false, f: false };
        data = defaultData();
    }

    window.Reselling = { onShow: function () { if (ready) renderContent(); } };

    window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
    window.addEventListener('app:authLoggedOut', stop);
    if (window.currentUser) startForUser(window.currentUser.uid);
})();