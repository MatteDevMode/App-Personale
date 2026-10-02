const admin = require('firebase-admin');

// ---------- Configurazione ----------
const TZ = 'Europe/Rome';
const MORNING_FROM = 7 * 60;          // 07:00
const MORNING_UNTIL = 11 * 60;        // oltre le 11:00 il riepilogo non viene più mandato
const DIARY_FROM = 20 * 60 + 30;      // 20:30
const DIARY_UNTIL = 23 * 60 + 30;     // oltre le 23:30 il promemoria non viene più mandato
const BUDGET_WARN_PCT = 80;
const BUDGET_OVER_PCT = 100;
const TASK_REMINDER_MIN = 30;         // minuti prima dell'orario di inizio

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
        body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error('Telegram ' + res.status + ': ' + body);
    }
}

async function readModule(name, fallback) {
    const snap = await db.collection('users').doc(UID).collection('modules').doc(name).get();
    return snap.exists ? snap.data() : fallback;
}

// ---------- Main ----------
async function main() {
    const now = romeNow();
    const stateRef = db.collection('users').doc(UID).collection('modules').doc('notifiche');
    const stateSnap = await stateRef.get();
    const state = Object.assign({ lastMorning: '', lastDiary: '', budget: {}, reminded: [] }, stateSnap.exists ? stateSnap.data() : {});
    let failed = false;

    async function attempt(label, fn) {
        try { await fn(); }
        catch (err) { failed = true; console.error('Errore (' + label + '):', err.message); }
    }

    // Messaggio di prova quando lanci il workflow a mano
    if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
        await attempt('test', () => send('✅ Il bot funziona. Le notifiche della tua app sono attive.'));
    }

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

    // 4) Promemoria attività 30 minuti prima
    const remindedToday = (state.reminded || []).filter(k => k.endsWith('|' + now.date));
    for (const t of tasks) {
        if (t.completed || t.date !== now.date || !t.startTime) continue;
        const key = t.id + '|' + now.date;
        if (remindedToday.includes(key)) continue;
        const until = toMin(t.startTime) - now.minutes;
        if (until > 0 && until <= TASK_REMINDER_MIN) {
            await attempt('promemoria ' + t.title, async () => {
                await send('⏰ <b>Tra ' + until + ' minuti</b>\n' + t.startTime + ' – ' + esc(t.title));
                remindedToday.push(key);
            });
        }
    }
    state.reminded = remindedToday;

    await stateRef.set(state);
    if (failed) process.exit(1);
    console.log('Controllo completato (' + now.date + ' ' + Math.floor(now.minutes / 60) + ':' + String(now.minutes % 60).padStart(2, '0') + ' ora italiana).');
}

main().catch(err => { console.error(err); process.exit(1); });