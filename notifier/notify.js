const admin = require('firebase-admin');

// ---------- Configurazione ----------
const TZ = 'Europe/Rome';
const MORNING_FROM = 7 * 60;          // 07:00
const MORNING_UNTIL = 11 * 60;        // oltre le 11:00 il riepilogo non viene più mandato
const DIARY_FROM = 20 * 60 + 30;      // 20:30
const DIARY_UNTIL = 23 * 60 + 30;     // oltre le 23:30 il promemoria non viene più mandato
const WEEKLY_FROM = 21 * 60;          // domenica 21:00
const WEEKLY_UNTIL = 23 * 60 + 30;    // oltre le 23:30 il riepilogo settimanale non viene più mandato
const BUDGET_WARN_PCT = 80;
const BUDGET_OVER_PCT = 100;
const TASK_REMINDER_MIN = 30;         // minuti prima dell'orario di inizio
const STALE_DAYS = 30;                // oggetti in vendita da questi giorni: avviso
const ROUTINE_FROM = 21 * 60 + 30;    // 21:30: avviso se mancano routine
const ROUTINE_UNTIL = 23 * 60 + 30;
const START_GRACE_MIN = 10;           // l'avviso "ora" parte anche con fino a 10 min di ritardo
const APP_URL = 'https://mattedevmode.github.io/App-Personale/';
const MOODS = { ottimo: '😄 Ottimo', bene: '🙂 Bene', neutro: '😐 Neutro', giu: '😞 Giù', arrabbiato: '😠 Arrabbiato' };

// ---------- Segreti (da GitHub Secrets) ----------
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const UID = process.env.FIREBASE_UID;
const SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!TOKEN || !CHAT_ID || !UID || !SERVICE_ACCOUNT) {
    console.error('Mancano uno o più secret: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, FIREBASE_UID, FIREBASE_SERVICE_ACCOUNT');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SERVICE_ACCOUNT)) });
const db = admin.firestore();

// ---------- Utilità ----------
function romeNow() {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return {
        date: p.year + '-' + p.month + '-' + p.day,
        month: p.year + '-' + p.month,
        minutes: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10)
    };
}

function toMin(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function daysBetween(a, b) {
    return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

function romeDateOf(iso) {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
    return new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0 = domenica
}

function ddmm(dateStr) {
    const [, m, d] = dateStr.split('-');
    return d + '/' + m;
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function eur(n) {
    return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

async function send(text) {
    const res = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHAT_ID,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📱 Apri l\'app', url: APP_URL }]] }
        })
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error('Telegram ' + res.status + ': ' + body);
    }
}

async function sendDocument(filename, content, caption) {
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('caption', caption);
    form.append('document', new Blob([content], { type: 'application/json' }), filename);
    const res = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendDocument', { method: 'POST', body: form });
    if (!res.ok) {
        const body = await res.text();
        throw new Error('Telegram ' + res.status + ': ' + body);
    }
}

async function readModule(name, fallback) {
    const snap = await db.collection('users').doc(UID).collection('modules').doc(name).get();
    return snap.exists ? snap.data() : fallback;
}

// ---------- Attività scritte al bot ----------
const WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const WD_MAP = { domenica: 0, lunedi: 1, 'lunedì': 1, martedi: 2, 'martedì': 2, mercoledi: 3, 'mercoledì': 3, giovedi: 4, 'giovedì': 4, venerdi: 5, 'venerdì': 5, sabato: 6 };
const DEFAULT_TODO_CATEGORIES = [
    { id: 'cat1', name: 'Lavoro', color: '#6C8CF5' },
    { id: 'cat2', name: 'Personale', color: '#9B7CF8' },
    { id: 'cat3', name: 'Casa', color: '#3FCFA0' }
];
const HELP_TEXT = '🤖 <b>Scrivimi le attività</b>\nPer esempio:\n• <i>dentista domani alle 10</i>\n• <i>riunione venerdì dalle 15 alle 16 #lavoro</i>\n• <i>pagare la bolletta ogni mese</i>\n\nPuoi mandarne più di una, una per riga. Se capisco male, scrivi /annulla.';

function pad2(n) { return String(n).padStart(2, '0'); }

// Stesso comportamento della barra "Scrivi un'attività" dell'app (today = data di oggi in formato AAAA-MM-GG, ora italiana)
function parseQuickAdd(raw, today) {
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

    if (strip(/\bdopodomani\b/i)) date = addDays(today, 2);
    else if (strip(/\bdomani\b/i)) date = addDays(today, 1);
    else if (strip(/\b(?:oggi|stasera|stamattina|questa\s+sera|questa\s+mattina)\b/i)) date = today;
    else if (m = strip(/\btra\s+(\d+)\s*settiman[ae]\b/i)) date = addDays(today, parseInt(m[1], 10) * 7);
    else if (m = strip(/\btra\s+(\d+)\s*giorn[oi]\b/i)) date = addDays(today, parseInt(m[1], 10));
    else if (m = strip(/(?:^|\s)(?:prossimo\s+)?(domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)(?![a-zàèéìòù])/i)) {
        const dow = WD_MAP[m[1].toLowerCase()];
        let d = addDays(today, 1);
        while (weekdayOf(d) !== dow) d = addDays(d, 1);
        date = d;
    } else if (m = strip(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)) {
        const dd = parseInt(m[1], 10), mo = parseInt(m[2], 10);
        if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
            const explicit = !!m[3];
            let y = explicit ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : parseInt(today.slice(0, 4), 10);
            let cand = y + '-' + pad2(mo) + '-' + pad2(dd);
            if (!explicit && cand < today) cand = (y + 1) + '-' + pad2(mo) + '-' + pad2(dd);
            date = cand;
        }
    }

    const okTime = (h, mi) => h <= 23 && mi <= 59;
    if (m = strip(/\bdalle\s+(\d{1,2})(?:[:.](\d{2}))?\s+alle\s+(\d{1,2})(?:[:.](\d{2}))?\b/i)) {
        const h1 = parseInt(m[1], 10), m1 = parseInt(m[2] || '0', 10), h2 = parseInt(m[3], 10), m2 = parseInt(m[4] || '0', 10);
        if (okTime(h1, m1) && okTime(h2, m2)) { startTime = pad2(h1) + ':' + pad2(m1); endTime = pad2(h2) + ':' + pad2(m2); }
    } else if (m = strip(/\balle\s+(\d{1,2})(?:[:.](\d{2}))?\b/i)) {
        const h1 = parseInt(m[1], 10), m1 = parseInt(m[2] || '0', 10);
        if (okTime(h1, m1)) startTime = pad2(h1) + ':' + pad2(m1);
    }

    title = title.replace(/\s{2,}/g, ' ').trim();
    title = title.replace(/^(di|il|la|l')\s+/i, '');
    title = title.replace(/^[,;]\s*/, '').replace(/[,;]\s*$/, '');
    title = title.trim();
    if (title.length) title = title.charAt(0).toUpperCase() + title.slice(1);

    return { title: title || raw.trim(), date, startTime, endTime, recurrence };
}

function extractCategory(line, categories) {
    const m = line.match(/(?:^|\s)#([\wàèéìòù]+)/i);
    if (!m) return { text: line, cat: null, unknown: null };
    const tag = m[1].toLowerCase();
    const cat = categories.find(c => c.name.toLowerCase() === tag) || categories.find(c => c.name.toLowerCase().startsWith(tag)) || null;
    return { text: line.replace(m[0], ' ').trim(), cat, unknown: cat ? null : m[1] };
}

function humanDate(dateStr, today) {
    if (dateStr === today) return 'oggi';
    if (dateStr === addDays(today, 1)) return 'domani';
    const [, mo, d] = dateStr.split('-');
    return WEEKDAYS_IT[weekdayOf(dateStr)] + ' ' + parseInt(d, 10) + ' ' + MONTHS_IT[parseInt(mo, 10) - 1];
}

function recurrenceText(r) {
    const names = { day: ['giorno', 'giorni'], week: ['settimana', 'settimane'], month: ['mese', 'mesi'] }[r.unit];
    return r.interval > 1 ? 'ogni ' + r.interval + ' ' + names[1] : 'ogni ' + names[0];
}

function taskSummary(t, today, catName) {
    const parts = ['📅 ' + (t.date ? humanDate(t.date, today) : 'senza data')];
    if (t.startTime) parts.push('🕙 ' + t.startTime + (t.endTime ? '–' + t.endTime : ''));
    if (t.recurrence) parts.push('🔁 ' + recurrenceText(t.recurrence));
    if (catName) parts.push('🏷 ' + esc(catName));
    return '✅ <b>' + esc(t.title) + '</b>\n' + parts.join(' · ');
}

async function tgGet(method, params) {
    const res = await fetch('https://api.telegram.org/bot' + TOKEN + '/' + method + '?' + new URLSearchParams(params));
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error('Telegram ' + method + ': ' + (json.description || res.status));
    return json.result;
}

function todoRef() { return db.collection('users').doc(UID).collection('modules').doc('todo'); }

async function addTasks(newTasks) {
    await db.runTransaction(async tx => {
        const snap = await tx.get(todoRef());
        const d = snap.exists ? snap.data() : { categories: DEFAULT_TODO_CATEGORIES, tasks: [] };
        d.tasks = d.tasks || [];
        newTasks.forEach(t => d.tasks.push(t));
        tx.set(todoRef(), d);
    });
}

async function undoLast(state) {
    const ids = state.lastAdded || [];
    if (!ids.length) { await send('Non c\'è niente da annullare.'); return; }
    let removed = [];
    await db.runTransaction(async tx => {
        const snap = await tx.get(todoRef());
        if (!snap.exists) { removed = []; return; }
        const d = snap.data();
        const before = d.tasks || [];
        removed = before.filter(t => ids.includes(t.id));
        d.tasks = before.filter(t => !ids.includes(t.id));
        tx.set(todoRef(), d);
    });
    state.lastAdded = [];
    await send(removed.length
        ? '↩️ <b>Eliminate</b>\n' + removed.map(t => '• ' + esc(t.title)).join('\n')
        : 'Quelle attività non ci sono più (le hai già tolte dall\'app).');
}

async function handleMessage(text, now, state) {
    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
    if (cmd === '/start' || cmd === '/aiuto' || cmd === '/help') { await send(HELP_TEXT); return; }
    if (cmd === '/annulla') { await undoLast(state); return; }
    if (cmd.startsWith('/')) { await send('Comando non riconosciuto. Scrivimi direttamente l\'attività, per esempio: <i>dentista domani alle 10</i>'); return; }

    const todo = await readModule('todo', { categories: DEFAULT_TODO_CATEGORIES, tasks: [] });
    const categories = todo.categories || [];
    const created = [], notes = [];
    const stamp = Date.now().toString(36);

    text.split(/\n+/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
        const ex = extractCategory(line, categories);
        const p = parseQuickAdd(ex.text || line, now.date);
        if (ex.unknown) notes.push('⚠️ Categoria #' + esc(ex.unknown) + ' non trovata: salvata senza categoria.');
        created.push({
            id: 't_' + stamp + i + Math.random().toString(36).slice(2, 6),
            title: p.title, date: p.date, startTime: p.startTime, endTime: p.endTime,
            categoryId: ex.cat ? ex.cat.id : null, recurrence: p.recurrence, completed: false, completedAt: null,
            _catName: ex.cat ? ex.cat.name : null
        });
    });
    if (!created.length) return;

    const summaries = created.map(t => taskSummary(t, now.date, t._catName));
    created.forEach(t => { delete t._catName; });
    await addTasks(created);
    state.lastAdded = created.map(t => t.id);
    await send((created.length > 1 ? '<b>Aggiunte ' + created.length + ' attività</b>\n\n' : '') + summaries.join('\n\n') + (notes.length ? '\n\n' + notes.join('\n') : ''));
}

async function processIncoming(now, state, stateRef) {
    const firstRun = typeof state.lastUpdateId !== 'number';
    const params = { timeout: '0', allowed_updates: JSON.stringify(['message']) };
    if (!firstRun) params.offset = String(state.lastUpdateId + 1);

    let updates;
    try { updates = await tgGet('getUpdates', params); }
    catch (err) { console.warn('Messaggi Telegram non letti:', err.message); return; }

    if (firstRun) {
        // Alla prima esecuzione ignoro i vecchi messaggi in coda, così non diventano attività per sbaglio
        state.lastUpdateId = updates.length ? updates[updates.length - 1].update_id : 0;
        await stateRef.set(state);
        await send(HELP_TEXT);
        return;
    }

    for (const u of updates) {
        state.lastUpdateId = u.update_id;
        const msg = u.message;
        if (msg && msg.text && String(msg.chat.id) === String(CHAT_ID)) {
            try { await handleMessage(msg.text.trim(), now, state); }
            catch (err) {
                console.error('Errore messaggio Telegram:', err.message);
                try { await send('⚠️ Non sono riuscito a salvare l\'attività. Riprova tra poco.'); } catch (e) { /* ignoro */ }
            }
        }
        await stateRef.set(state); // salvo subito l'avanzamento, così un messaggio non viene mai elaborato due volte
    }
}

// ---------- Main ----------
async function main() {
    const now = romeNow();
    const stateRef = db.collection('users').doc(UID).collection('modules').doc('notifiche');
    const stateSnap = await stateRef.get();
    const state = Object.assign(
        { lastMorning: '', lastDiary: '', lastWeekly: '', lastBackup: '', lastStale: '', lastRoutine: '', staleAlerted: [], lastAdded: [], budget: {}, reminded: [], doneByDay: {} },
        stateSnap.exists ? stateSnap.data() : {}
    );
    let failed = false;

    async function attempt(label, fn) {
        try { await fn(); }
        catch (err) { failed = true; console.error('Errore (' + label + '):', err.message); }
    }

    // Messaggio di prova solo se spunti "test" quando lanci il workflow a mano
    if (process.env.TEST_MESSAGE === 'true') {
        await attempt('test', () => send('✅ Il bot funziona. Le notifiche della tua app sono attive.'));
    }

    // 0) Attività scritte al bot (prima di leggere le attività, così quelle appena create contano subito)
    await attempt('messaggi telegram', () => processIncoming(now, state, stateRef));

    const todo = await readModule('todo', { tasks: [] });
    const tasks = todo.tasks || [];

    // 1) Riepilogo del mattino
    if (now.minutes >= MORNING_FROM && now.minutes < MORNING_UNTIL && state.lastMorning !== now.date) {
        const todayTasks = tasks
            .filter(t => t.date === now.date && !t.completed)
            .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
        const overdue = tasks
            .filter(t => t.date && t.date < now.date && !t.completed)
            .sort((a, b) => a.date.localeCompare(b.date));

        await attempt('mattino', async () => {
            if (todayTasks.length || overdue.length) {
                let msg = '☀️ <b>Buongiorno! Ecco la giornata</b>\n';
                if (todayTasks.length) {
                    msg += '\n<b>Oggi</b>\n' + todayTasks.map(t => '• ' + (t.startTime ? t.startTime + ' ' : '') + esc(t.title)).join('\n') + '\n';
                }
                if (overdue.length) {
                    msg += '\n⚠️ <b>Scadute</b>\n' + overdue.map(t => {
                        const [y, m, d] = t.date.split('-');
                        return '• ' + esc(t.title) + ' (' + d + '/' + m + ')';
                    }).join('\n') + '\n';
                }
                await send(msg.trim());
            }
            state.lastMorning = now.date;
        });
    }

    // 1b) Oggetti in vendita da troppo tempo (una volta al giorno, al mattino)
    if (now.minutes >= MORNING_FROM && now.minutes < MORNING_UNTIL && state.lastStale !== now.date) {
        const resell = await readModule('reselling', { items: [] });
        const stale = (resell.items || []).filter(i => i.status === 'in-vendita' && daysBetween(i.listDate || i.buyDate || now.date, now.date) >= STALE_DAYS);
        const fresh = stale.filter(i => !(state.staleAlerted || []).includes(i.id));
        await attempt('reselling fermi', async () => {
            if (fresh.length) {
                await send('⏳ <b>In vendita da più di ' + STALE_DAYS + ' giorni</b>\n' +
                    fresh.map(i => '• ' + esc(i.name) + ' (' + daysBetween(i.listDate || i.buyDate || now.date, now.date) + ' giorni)').join('\n') +
                    '\n\nForse è il momento di abbassare il prezzo.');
            }
            state.staleAlerted = stale.map(i => i.id);
            state.lastStale = now.date;
        });
    }

    // 2) Promemoria diario
    if (now.minutes >= DIARY_FROM && now.minutes < DIARY_UNTIL && state.lastDiary !== now.date) {
        const diario = await readModule('diario', { entries: [] });
        const wroteToday = (diario.entries || []).some(e => e.date === now.date);
        await attempt('diario', async () => {
            if (!wroteToday) {
                await send('📖 Oggi non hai ancora scritto nel diario. Ti va di dedicargli due minuti?');
            }
            state.lastDiary = now.date;
        });
    }

    // 3) Budget
    const fin = await readModule('finanze', { categories: [], transactions: [] });
    const newBudgetState = {};
    for (const cat of (fin.categories || [])) {
        if (!cat.budget || cat.budget <= 0) continue;
        const key = now.month + ':' + cat.id;
        const sent = (state.budget && state.budget[key]) || 0;
        newBudgetState[key] = sent;

        const spent = (fin.transactions || [])
            .filter(t => t.type === 'expense' && t.categoryId === cat.id && (t.date || '').slice(0, 7) === now.month)
            .reduce((s, t) => s + t.amount, 0);
        const pct = (spent / cat.budget) * 100;

        let level = 0;
        if (pct >= BUDGET_OVER_PCT) level = BUDGET_OVER_PCT;
        else if (pct >= BUDGET_WARN_PCT) level = BUDGET_WARN_PCT;

        if (level > sent) {
            await attempt('budget ' + cat.name, async () => {
                const msg = level === BUDGET_OVER_PCT
                    ? '🚨 <b>Budget superato: ' + esc(cat.name) + '</b>\nHai speso ' + eur(spent) + ' su ' + eur(cat.budget) + ' questo mese.'
                    : '💸 <b>Attenzione al budget: ' + esc(cat.name) + '</b>\nHai già speso ' + eur(spent) + ' su ' + eur(cat.budget) + ' (' + Math.round(pct) + '%).';
                await send(msg);
                newBudgetState[key] = level;
            });
        }
    }
    state.budget = newBudgetState; // tiene solo il mese corrente

    // 3b) Progressi: nuovo livello e routine mancanti
    const xp = await readModule('xp', { events: [], history: {}, routines: [], checks: {}, summary: {} });
    const level = (xp.summary && xp.summary.level) || 1;
    if (typeof state.lastLevelNotified !== 'number') state.lastLevelNotified = level; // la prima volta non avviso
    else if (level > state.lastLevelNotified) {
        await attempt('livello', async () => {
            await send('🎉 <b>Livello ' + level + '!</b>\n' + esc(xp.summary.title || '') + '\nTotale: ' + (xp.summary.total || 0) + ' XP');
            state.lastLevelNotified = level;
        });
    }

    if (now.minutes >= ROUTINE_FROM && now.minutes < ROUTINE_UNTIL && state.lastRoutine !== now.date) {
        const dow = weekdayOf(now.date);
        const diarioR = await readModule('diario', { entries: [] });
        const wrote = (diarioR.entries || []).some(e => e.date === now.date || (e.createdAt && romeDateOf(e.createdAt) === now.date));
        const missing = (xp.routines || []).filter(r => !r.archived && (!r.since || r.since <= now.date) && (!r.days || !r.days.length || r.days.includes(dow)))
            .filter(r => (r.auto === 'diario' ? (wrote ? (r.target || 1) : 0) : (((xp.checks || {})[now.date] || {})[r.id] || 0)) < (r.target || 1));
        await attempt('routine', async () => {
            if (missing.length) {
                await send('📋 <b>Ti ' + (missing.length === 1 ? 'manca 1 routine' : 'mancano ' + missing.length + ' routine') + '</b>\n' + missing.map(r => '• ' + esc(r.icon ? r.icon + ' ' : '') + esc(r.name)).join('\n'));
            }
            state.lastRoutine = now.date;
        });
    }

    // 4) Promemoria attività: 30 minuti prima e all'ora di inizio
    const remindedToday = (state.reminded || []).filter(k => k.includes('|' + now.date));
    for (const t of tasks) {
        if (t.completed || t.date !== now.date || !t.startTime) continue;
        const until = toMin(t.startTime) - now.minutes;

        const preKey = t.id + '|' + now.date;
        if (until > 0 && until <= TASK_REMINDER_MIN && !remindedToday.includes(preKey)) {
            await attempt('promemoria ' + t.title, async () => {
                await send('⏰ <b>Tra ' + until + ' minuti</b>\n' + t.startTime + ' – ' + esc(t.title));
                remindedToday.push(preKey);
            });
        }

        const startKey = preKey + '|start';
        if (until <= 0 && until > -START_GRACE_MIN && !remindedToday.includes(startKey)) {
            await attempt('inizio ' + t.title, async () => {
                await send('🔔 <b>Ora</b>\n' + t.startTime + ' – ' + esc(t.title));
                remindedToday.push(startKey);
            });
        }
    }
    state.reminded = remindedToday;

    // 5) Conteggio delle attività completate oggi (l'app elimina le completate il giorno dopo)
    const doneToday = tasks.filter(t => t.completed && t.completedAt === now.date).length;
    state.doneByDay = Object.assign({}, state.doneByDay);
    state.doneByDay[now.date] = Math.max(state.doneByDay[now.date] || 0, doneToday);
    const cutoff = addDays(now.date, -14);
    Object.keys(state.doneByDay).forEach(k => { if (k < cutoff) delete state.doneByDay[k]; });

    // 6) Riepilogo settimanale (domenica sera, oppure a richiesta dal workflow)
    const weeklyTest = process.env.WEEKLY_TEST === 'true';
    const inWeeklyWindow = weekdayOf(now.date) === 0 && now.minutes >= WEEKLY_FROM && now.minutes < WEEKLY_UNTIL;
    const weeklyDue = inWeeklyWindow && state.lastWeekly !== now.date;
    const backupDue = inWeeklyWindow && state.lastBackup !== now.date;
    if (weeklyTest || weeklyDue) {
        await attempt('riepilogo settimanale', async () => {
            const from = addDays(now.date, -6);
            const to = now.date;
            const inRange = d => !!d && d >= from && d <= to;

            // Attività
            const done = Object.keys(state.doneByDay).filter(inRange).reduce((s, k) => s + state.doneByDay[k], 0);
            const overdue = tasks.filter(t => t.date && t.date < now.date && !t.completed).length;
            const upcoming = tasks.filter(t => !t.completed && t.date && t.date > to && t.date <= addDays(to, 7)).length;

            // Soldi
            const week = (fin.transactions || []).filter(t => inRange(t.date));
            const expenses = week.filter(t => t.type === 'expense');
            const expenseTot = expenses.reduce((s, t) => s + t.amount, 0);
            const incomeTot = week.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const byCat = {};
            expenses.forEach(t => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount; });
            const top = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).slice(0, 3).map(id => {
                const c = (fin.categories || []).find(x => x.id === id);
                return esc(c ? c.name : 'Altro') + ' ' + eur(byCat[id]);
            });

            // Diario
            const diario = await readModule('diario', { entries: [] });
            const entries = (diario.entries || []).filter(e => inRange(e.date));
            const days = new Set(entries.map(e => e.date)).size;
            const moodCount = {};
            entries.forEach(e => { if (MOODS[e.mood]) moodCount[e.mood] = (moodCount[e.mood] || 0) + 1; });
            const topMood = Object.keys(moodCount).sort((a, b) => moodCount[b] - moodCount[a])[0];

            let msg = '📊 <b>Riepilogo della settimana</b>\n' + ddmm(from) + ' – ' + ddmm(to) + '\n';

            msg += '\n✅ <b>Attività</b>\nCompletate: ' + done;
            if (overdue) msg += '\nScadute: ' + overdue;
            msg += '\nIn arrivo nei prossimi 7 giorni: ' + upcoming + '\n';

            msg += '\n💶 <b>Soldi</b>\n';
            if (expenseTot > 0 || incomeTot > 0) {
                msg += 'Uscite: ' + eur(expenseTot) + '\nEntrate: ' + eur(incomeTot) + '\n';
                if (top.length) msg += 'Dove hai speso di più: ' + top.join(', ') + '\n';
            } else {
                msg += 'Nessun movimento questa settimana.\n';
            }

            msg += '\n📖 <b>Diario</b>\n';
            if (entries.length) {
                msg += 'Voci: ' + entries.length + ' in ' + days + (days === 1 ? ' giorno' : ' giorni') + '\n';
                if (topMood) msg += 'Umore più frequente: ' + MOODS[topMood] + '\n';
            } else {
                msg += 'Nessuna voce questa settimana.\n';
            }

            // Trading
            const trading = await readModule('trading', { trades: [] });
            const trades = (trading.trades || []).filter(t => inRange(t.date));
            if (trades.length) {
                const wins = trades.filter(t => t.result > 0).length;
                const losses = trades.filter(t => t.result < 0).length;
                const net = trades.reduce((s, t) => s + (t.result || 0), 0);
                msg += '\n📈 <b>Trading</b>\nTrade: ' + trades.length + ' (' + wins + ' vinti, ' + losses + ' persi)\nWin rate: ' + Math.round(wins / trades.length * 100) + '%\nRisultato: ' + (net > 0 ? '+' : '') + eur(net) + '\n';
            }

            // Reselling
            const resell = await readModule('reselling', { items: [] });
            const rItems = resell.items || [];
            const rSold = rItems.filter(i => i.status === 'venduto' && inRange(i.soldDate));
            if (rSold.length || rItems.some(i => i.status !== 'venduto')) {
                const rNet = rSold.reduce((s, i) => s + ((i.soldPrice || 0) - (i.costs || 0)), 0);
                const rProfit = rSold.reduce((s, i) => s + ((i.soldPrice || 0) - (i.costs || 0) - (i.buyPrice || 0)), 0);
                msg += '\n🏷️ <b>Reselling</b>\nVenduti: ' + rSold.length + ' · incassato ' + eur(rNet) + '\nProfitto: ' + (rProfit > 0 ? '+' : '') + eur(rProfit) +
                    '\nIn vendita: ' + rItems.filter(i => i.status === 'in-vendita').length + '\n';
            }

            await send(msg.trim());
            if (!weeklyTest) state.lastWeekly = now.date;
        });
    }

    // 7) Backup settimanale su Telegram (stesso formato dell'esportazione dall'app)
    if (weeklyTest || backupDue) {
        await attempt('backup', async () => {
            const diarioData = await readModule('diario', { entries: [] });
            const tradingData = await readModule('trading', { strategies: [], trades: [] });
            const resellingData = await readModule('reselling', { items: [] });
            const backup = {
                app: 'app-personale',
                version: 1,
                exportedAt: new Date().toISOString(),
                modules: { todo, diario: diarioData, finanze: fin, trading: tradingData, reselling: resellingData, xp }
            };
            await sendDocument('backup-' + now.date + '.json', JSON.stringify(backup, null, 2), '💾 Backup settimanale (' + ddmm(now.date) + ')');
            if (!weeklyTest) state.lastBackup = now.date;
        });
    }

    await stateRef.set(state);
    if (failed) process.exit(1);
    console.log('Controllo completato (' + now.date + ' ' + Math.floor(now.minutes / 60) + ':' + String(now.minutes % 60).padStart(2, '0') + ' ora italiana).');
}

main().catch(err => { console.error(err); process.exit(1); });