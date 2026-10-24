(function () {
    function pad2(n) { return String(n).padStart(2, '0'); }
    function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
    const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    function fmtDateTime(iso) { const d = new Date(iso); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' \u00b7 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function dm(iso) { const d = new Date(iso); return d.getDate() + '/' + (d.getMonth() + 1); }

    // ---------- Frasi di Matty ----------
    const PHRASES = [
        "Il tuo valore non dipende da chi ti risponde, né da quanto in fretta.",
        "Un messaggio senza risposta è solo un messaggio senza risposta. Non è un verdetto su di te.",
        "Hai già fatto cose difficili. Anche questa la attraversi.",
        "Un respiro lento, poi guardi cosa c'è davvero da fare adesso.",
        "Non sei il tuo umore di stamattina.",
        "Ti sei accorto di come ti senti: è già metà del lavoro.",
        "Oggi basta un passo piccolo. Anche uno minuscolo conta.",
        "Sei una persona intera, anche quando qualcuno è occupato.",
        "Le sensazioni vanno e vengono come le onde. Tu sei lo scoglio, non l'onda.",
        "Fai una cosa che è solo tua, anche piccola.",
        "Se la mente corre, tu puoi camminare.",
        "Ti stai impegnando più di quanto pensi.",
        "Non devi risolvere tutto stasera.",
        "Il fatto che tu ci stia lavorando dice molto di te.",
        "Sei una buona compagnia, anche per te stesso.",
        "Una giornata storta non cancella quelle buone.",
        "Puoi stare bene anche mentre aspetti una risposta.",
        "Fidarsi di sé si allena come un muscolo: un po' ogni giorno.",
        "\"Non basto\" è un pensiero, non un fatto.",
        "Ti meriti la stessa gentilezza che daresti a un amico.",
        "Quando ti viene da reagire, aspetta 10 minuti. Poi decidi.",
        "Per sapere che vai bene non serve una conferma da fuori.",
        "Ogni volta che aspetti prima di reagire, ti alleni a restare calmo.",
        "Sei più di quello che ti passa per la testa adesso.",
        "Oggi hai fatto qualcosa di buono. Trovalo.",
        "La calma non arriva tutta insieme, arriva a pezzetti.",
        "Sono un pinguino e te lo dico: il freddo passa. Sempre. 🐧",
        "Anche i pinguini scivolano. Poi si rialzano e fanno finta di niente.",
        "Pesce per tutti, soprattutto per chi ha fatto del suo meglio.",
        "Tu più una cosa che ti piace: giornata già migliore.",
        "Respira. Poi bevi un bicchiere d'acqua. Davvero.",
        "Non devi essere perfetto, solo presente.",
        "La tua giornata è tua, non dipende da un telefono.",
        "Puoi voler bene a qualcuno e voler bene anche a te.",
        "Piano piano è comunque avanti.",
        "Il te di un anno fa sarebbe curioso di vedere dove sei arrivato.",
        "Se un pensiero ti fa male, scrivilo: sulla carta pesa meno.",
        "Non sei in ritardo su niente.",
        "Sei già abbastanza, e puoi comunque crescere, senza fretta.",
        "Un bel respiro, spalle giù, e via. Matty fa il tifo per te. 🐧"
    ];

    // ---------- Dati ----------
    let matty = { customPhrases: [] };
    let spazio = { sessions: [] };
    let mattyRef = null, spazioRef = null, unsubs = [];
    let dirty = false, saveTimer = null;
    let currentPhrase = null, mountEl = null;

    function saveMatty() { if (mattyRef) mattyRef.set(matty).catch(err => console.error('Errore salvataggio Matty:', err)); }
    function saveSpazio(now) {
        if (!spazioRef) return;
        dirty = true;
        clearTimeout(saveTimer);
        const run = () => { dirty = false; spazioRef.set(spazio).catch(err => console.error('Errore salvataggio Spazio Privato:', err)); };
        if (now) run(); else saveTimer = setTimeout(run, 600);
    }
    function getSession(id) { return spazio.sessions.find(s => s.id === id); }
    function hasContent(s) { return s.start != null || Object.keys(s.answers || {}).some(k => (s.answers[k] || '').trim()); }

    // ---------- Pinguino ----------
    function penguin(width) {
        return '<div class="mt-pg" style="width:' + width + 'px;">' +
            '<svg class="mt-svg" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Matty il pinguino">' +
            '<ellipse cx="60" cy="133" rx="30" ry="4" fill="rgba(0,0,0,.25)"/>' +
            '<g class="mt-bob">' +
            '<ellipse cx="44" cy="127" rx="12" ry="5.5" fill="#F6A83B"/><ellipse cx="76" cy="127" rx="12" ry="5.5" fill="#F6A83B"/>' +
            '<ellipse cx="60" cy="78" rx="42" ry="50" fill="#232B45"/>' +
            '<ellipse cx="60" cy="92" rx="27" ry="34" fill="#F4F7FB"/>' +
            '<ellipse cx="19" cy="86" rx="8" ry="21" fill="#34416b" transform="rotate(12 19 86)"/>' +
            '<g class="mt-wave"><ellipse cx="101" cy="86" rx="8" ry="21" fill="#34416b" transform="rotate(-12 101 86)"/></g>' +
            '<g class="mt-eye"><circle cx="46" cy="60" r="8" fill="#fff"/><circle cx="47.5" cy="61" r="4.2" fill="#10152A"/><circle cx="49" cy="59" r="1.5" fill="#fff"/></g>' +
            '<g class="mt-eye"><circle cx="74" cy="60" r="8" fill="#fff"/><circle cx="72.5" cy="61" r="4.2" fill="#10152A"/><circle cx="74" cy="59" r="1.5" fill="#fff"/></g>' +
            '<ellipse cx="34" cy="74" rx="6" ry="4" fill="#FF8FA3" opacity=".55"/><ellipse cx="86" cy="74" rx="6" ry="4" fill="#FF8FA3" opacity=".55"/>' +
            '<path d="M54 67 Q60 63 66 67 Q60 74 54 67Z" fill="#F6A83B"/>' +
            '<path d="M52 77 Q60 85 68 77" fill="none" stroke="#10152A" stroke-width="2.4" stroke-linecap="round"/>' +
            '<path d="M27 99 Q60 114 93 99 L91 109 Q60 124 29 109Z" fill="#E8604C"/><path d="M78 112 L87 128 L75 125Z" fill="#C94A38"/>' +
            '</g></svg></div>';
    }
    function jump(wrap) {
        const pg = wrap && wrap.querySelector('.mt-pg');
        if (!pg) return;
        pg.classList.remove('jump'); void pg.offsetWidth; pg.classList.add('jump');
    }

    // ---------- Stile ----------
    const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5A8.5 8.5 0 1111.5 3 7 7 0 0021 12.5z"/></svg>';
    function injectStyle() {
        if (document.getElementById('mattyStyle')) return;
        const s = document.createElement('style');
        s.id = 'mattyStyle';
        s.textContent = `
.mt-card{background:linear-gradient(160deg,var(--bg-card),var(--bg-card-hover));border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.1rem;margin-bottom:14px;}
.mt-row{display:flex;align-items:center;gap:16px;}
.mt-pg-wrap{flex-shrink:0;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.mt-bubble{position:relative;flex:1;background:var(--bg-page);border:1px solid var(--border-strong);border-radius:16px;padding:12px 14px;font-size:14px;line-height:1.5;color:var(--text-primary);cursor:pointer;min-height:48px;display:flex;align-items:center;}
.mt-bubble::before{content:'';position:absolute;left:-8px;top:50%;margin-top:-7px;border-width:7px 8px 7px 0;border-style:solid;border-color:transparent var(--border-strong) transparent transparent;}
.mt-bubble::after{content:'';position:absolute;left:-6px;top:50%;margin-top:-6px;border-width:6px 7px 6px 0;border-style:solid;border-color:transparent var(--bg-page) transparent transparent;}
.mt-bubble.pop{animation:mt-pop .35s ease-out;}
.mt-actions{display:flex;gap:10px;align-items:center;margin-top:12px;}
.mt-private{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(124,140,248,.45);background:linear-gradient(135deg,#171b3d,#2a2f6e);color:#e6e9ff;border-radius:999px;padding:12px;font-size:14px;font-weight:500;font-family:var(--font-body);cursor:pointer;}
.mt-private svg{width:16px;height:16px;}
.mt-edit{background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;font-family:var(--font-body);}
.mt-svg{display:block;width:100%;height:auto;overflow:visible;}
.mt-bob{animation:mt-bob 3.2s ease-in-out infinite;}
.mt-eye{transform-box:fill-box;transform-origin:center;animation:mt-blink 4.8s infinite;}
.mt-wave{transform-box:fill-box;transform-origin:50% 8%;animation:mt-wave 1.6s ease-in-out 2;}
.mt-pg.jump .mt-svg{animation:mt-jump .5s ease-out;}
@keyframes mt-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes mt-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes mt-wave{0%,100%{transform:rotate(0)}25%{transform:rotate(-28deg)}75%{transform:rotate(-14deg)}}
@keyframes mt-jump{0%{transform:translateY(0) scale(1,1)}30%{transform:translateY(-12px) scale(.95,1.06)}60%{transform:translateY(0) scale(1.06,.94)}100%{transform:translateY(0) scale(1,1)}}
@keyframes mt-pop{0%{transform:scale(.96);opacity:.5}100%{transform:scale(1);opacity:1}}
@media(max-width:720px){.mt-row{gap:12px;}}

.sp-overlay{position:fixed;inset:0;z-index:150;background:radial-gradient(ellipse at 50% 0%,#141a3f 0%,#090c1f 55%,#04050d 100%);color:#e8ebff;overflow-y:auto;animation:sp-in .5s ease;font-family:var(--font-body);}
@keyframes sp-in{from{opacity:0}to{opacity:1}}
.sp-stars{position:fixed;inset:0;pointer-events:none;}
.sp-star{position:absolute;border-radius:50%;background:#fff;opacity:.6;animation:sp-tw 4s ease-in-out infinite;}
@keyframes sp-tw{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
.sp-home-btn,.sp-timer{position:fixed;top:14px;z-index:5;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#e8ebff;border-radius:999px;padding:8px 14px;font-size:13px;font-family:inherit;}
.sp-home-btn{left:14px;cursor:pointer;}
.sp-timer{right:14px;display:none;}
.sp-content{position:relative;z-index:2;width:100%;max-width:520px;margin:0 auto;padding:70px 18px 40px;display:flex;flex-direction:column;align-items:center;gap:16px;animation:sp-fade .45s ease;}
@keyframes sp-fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.sp-matty{width:92px;}
.sp-bubble{position:relative;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:14px 16px;font-size:16px;line-height:1.55;text-align:center;width:100%;}
.sp-bubble::before{content:'';position:absolute;top:-8px;left:50%;margin-left:-8px;border-width:0 8px 8px;border-style:solid;border-color:transparent transparent rgba(255,255,255,.16);}
.sp-actions{display:flex;flex-direction:column;gap:10px;width:100%;}
.sp-actions.row{flex-direction:row;}
.sp-btn{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:#e8ebff;border-radius:14px;padding:13px 16px;font-size:15px;cursor:pointer;font-family:inherit;}
.sp-btn.primary{background:linear-gradient(135deg,#5a63d8,#7c8cf8);border-color:transparent;color:#fff;font-weight:500;}
.sp-btn.danger{color:#ff9d90;border-color:rgba(232,96,76,.45);}
.sp-btn:disabled{opacity:.4;cursor:default;}
.sp-foot{font-size:12px;color:rgba(232,235,255,.55);text-align:center;margin:6px 0 0;line-height:1.5;}
.sp-content textarea,.sp-content input[type=text]{width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:12px 14px;color:#f1f3ff;font-size:16px;font-family:inherit;line-height:1.5;}
.sp-content textarea{min-height:150px;resize:vertical;}
.sp-content textarea:focus,.sp-content input:focus{outline:none;border-color:#7c8cf8;}
.sp-levels{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;width:100%;}
.sp-lv{aspect-ratio:1;border-radius:12px;border:1.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e8ebff;font-size:16px;cursor:pointer;font-family:inherit;}
.sp-lv.sel{background:var(--c);border-color:var(--c);color:#0b0f22;font-weight:700;}
.sp-lv-legend{display:flex;justify-content:space-between;width:100%;font-size:11.5px;color:rgba(232,235,255,.5);}
.sp-breath{display:flex;flex-direction:column;align-items:center;gap:20px;margin:14px 0;}
.sp-circle{width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(124,140,248,.55),rgba(124,140,248,.12));box-shadow:0 0 50px rgba(124,140,248,.35);animation:sp-breathe 10s ease-in-out infinite;}
@keyframes sp-breathe{0%{transform:scale(.6)}40%{transform:scale(1)}100%{transform:scale(.6)}}
.sp-pills{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;font-size:13px;color:rgba(232,235,255,.7);}
.sp-pill{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:#e8ebff;border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit;}
.sp-tabs{display:flex;gap:6px;background:rgba(255,255,255,.07);border-radius:999px;padding:3px;width:100%;}
.sp-tabs button{flex:1;border:none;background:transparent;color:rgba(232,235,255,.7);border-radius:999px;padding:8px;font-size:13px;cursor:pointer;font-family:inherit;}
.sp-tabs button.on{background:#5a63d8;color:#fff;}
.sp-sky{position:relative;width:100%;height:52vh;min-height:300px;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:radial-gradient(ellipse at 50% 100%,rgba(90,99,216,.18),transparent 70%),rgba(255,255,255,.03);overflow:hidden;}
.sp-sky-star{position:absolute;transform:translate(-50%,-50%);border:none;border-radius:50%;cursor:pointer;padding:0;background:radial-gradient(circle,#fff6d6 0%,#ffd97a 40%,rgba(255,217,122,0) 72%);animation:sp-tw 3.6s ease-in-out infinite;}
.sp-sky-star.draft{background:radial-gradient(circle,#c9d1ff 0%,rgba(150,160,255,.35) 45%,rgba(150,160,255,0) 72%);}
.sp-item{width:100%;text-align:left;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-left:3px solid #ffd97a;border-radius:12px;padding:12px 14px;color:#e8ebff;cursor:pointer;font-family:inherit;display:block;margin-bottom:8px;}
.sp-item.draft{border-left-color:#8f98e6;}
.sp-item .top{display:flex;justify-content:space-between;font-size:12.5px;color:rgba(232,235,255,.65);margin-bottom:4px;}
.sp-item .pv{font-size:14px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.sp-detail{width:100%;}
.sp-detail h3{margin:0 0 2px;font-size:17px;font-weight:600;}
.sp-detail h4{margin:16px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9aa4ff;font-weight:600;}
.sp-detail p{margin:0;white-space:pre-wrap;font-size:15px;line-height:1.55;}
.sp-chart{width:100%;height:230px;position:relative;}
.sp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;}
.sp-stat{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;text-align:center;}
.sp-stat b{display:block;font-size:20px;}.sp-stat span{font-size:11px;color:rgba(232,235,255,.6);}
@media(max-width:720px){.sp-circle{width:130px;height:130px;}}`;
        document.head.appendChild(s);
    }

    // ---------- Matty nella home ----------
    function pickPhrase() {
        const pool = PHRASES.concat((matty.customPhrases || []).map(p => p.text));
        if (pool.length < 2) return pool[0];
        let p;
        do { p = pool[Math.floor(Math.random() * pool.length)]; } while (p === currentPhrase);
        return p;
    }

    function mountHome(el) {
        if (!el) return;
        injectStyle();
        mountEl = el;
        if (!currentPhrase) currentPhrase = pickPhrase();
        el.innerHTML =
            '<div class="mt-card"><div class="mt-row">' +
            '<div class="mt-pg-wrap" id="mtPg" title="Toccami!">' + penguin(104) + '</div>' +
            '<div class="mt-bubble" id="mtBubble">' + esc(currentPhrase) + '</div></div>' +
            '<div class="mt-actions"><button class="mt-private" id="mtOpen">' + MOON + 'Spazio Privato</button>' +
            '<button class="mt-edit" id="mtEdit">Le mie frasi</button></div></div>';

        const change = () => {
            currentPhrase = pickPhrase();
            const b = el.querySelector('#mtBubble');
            b.textContent = currentPhrase;
            b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
            jump(el.querySelector('#mtPg'));
        };
        el.querySelector('#mtPg').addEventListener('click', change);
        el.querySelector('#mtBubble').addEventListener('click', change);
        el.querySelector('#mtOpen').addEventListener('click', openSpazio);
        el.querySelector('#mtEdit').addEventListener('click', openPhraseManager);
    }

    function openPhraseManager() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        function draw() {
            overlay.innerHTML =
                '<div class="modal-box"><p class="modal-title">Le mie frasi</p>' +
                '<p class="modal-sub">Matty ha ' + PHRASES.length + ' frasi sue. Qui aggiungi le tue: vengono mescolate con quelle di Matty.</p>' +
                '<div id="phList"></div>' +
                '<label class="field-label">Nuova frase</label><textarea id="phNew" placeholder="Scrivi una frase che vuoi leggere..." style="min-height:80px;"></textarea>' +
                '<div class="row-2" style="margin-top:10px;"><button class="btn btn-primary" id="phAdd">Aggiungi</button><button class="btn btn-ghost" id="phClose">Chiudi</button></div></div>';
            const list = overlay.querySelector('#phList');
            list.innerHTML = (matty.customPhrases || []).map(p =>
                '<div class="cat-row"><span style="flex:1;font-size:13.5px;">' + esc(p.text) + '</span>' +
                '<button class="icon-btn" data-del="' + p.id + '" style="width:26px;height:26px;">\u00d7</button></div>').join('') || '<p class="empty-hint">Nessuna frase tua ancora</p>';
            list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
                matty.customPhrases = matty.customPhrases.filter(p => p.id !== b.getAttribute('data-del'));
                saveMatty(); draw();
            }));
            overlay.querySelector('#phClose').onclick = () => overlay.remove();
            overlay.querySelector('#phAdd').onclick = () => {
                const t = overlay.querySelector('#phNew').value.trim();
                if (!t) return;
                matty.customPhrases.push({ id: uid('ph'), text: t });
                saveMatty(); draw();
            };
        }
        draw();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ---------- Spazio Privato ----------
    const STEPS = ['start', 'breath', 'q1', 'q2', 'q3', 'q4', 'q5', 'final'];
    const QUESTIONS = {
        q1: 'Cosa è successo? Solo i fatti, come li vedrebbe una telecamera.',
        q2: 'Cosa sto pensando in questo momento?',
        q3: 'Cosa sento? Emozioni e corpo, come vengono.',
        q4: 'Cosa mi viene voglia di fare adesso?',
        q5: 'Cosa direi a un amico che vive la stessa cosa?'
    };
    const LABELS = { q1: 'Cosa è successo', q2: 'Cosa pensavo', q3: 'Cosa sentivo', q4: 'Cosa mi veniva da fare', q5: 'Cosa direi a un amico' };

    let ov = null, view = 'menu', cur = { id: null }, detailId = null, backTo = 'menu', listQuery = '';
    let spInt = null, waitInt = null, waitEnd = null, trendChart = null;
    const $ = sel => ov && ov.querySelector(sel);

    function mattyBlock(text) { return '<div class="sp-matty">' + penguin(92) + '</div><div class="sp-bubble">' + esc(text) + '</div>'; }
    function levelColor(i) { return 'hsl(' + (160 - i * 16) + ',65%,58%)'; }

    function openSpazio() {
        if (ov) return;
        injectStyle();
        let stars = '';
        for (let i = 0; i < 70; i++) {
            const sz = (Math.random() * 2 + 1).toFixed(1);
            stars += '<span class="sp-star" style="left:' + (Math.random() * 100).toFixed(1) + '%;top:' + (Math.random() * 100).toFixed(1) + '%;width:' + sz + 'px;height:' + sz + 'px;animation-delay:' + (Math.random() * 4).toFixed(1) + 's;animation-duration:' + (3 + Math.random() * 3).toFixed(1) + 's;"></span>';
        }
        ov = document.createElement('div');
        ov.className = 'sp-overlay';
        ov.innerHTML = '<div class="sp-stars">' + stars + '</div><button class="sp-home-btn" id="spHome">\u2190 Torna a casa</button><div class="sp-timer" id="spTimer"></div><div class="sp-content" id="spContent"></div>';
        document.body.appendChild(ov);
        document.body.style.overflow = 'hidden';
        $('#spHome').onclick = closeSpazio;
        view = 'menu';
        renderView();
    }

    function closeSpazio() {
        if (!ov) return;
        clearInterval(spInt); clearInterval(waitInt);
        if (trendChart) { trendChart.destroy(); trendChart = null; }
        if (dirty) saveSpazio(true);
        waitEnd = null;
        ov.remove(); ov = null;
        document.body.style.overflow = '';
    }

    function renderView() {
        if (!ov) return;
        clearInterval(spInt);
        if (trendChart) { trendChart.destroy(); trendChart = null; }
        const c = $('#spContent');
        c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
        ov.scrollTop = 0;
        if (view === 'menu') renderMenu(c);
        else if (view === 'flow') renderFlow(c);
        else if (view === 'done') renderDone(c);
        else if (view === 'detail') renderDetail(c);
        else renderStars(c);
    }

    function go(v) { view = v; renderView(); }

    function renderMenu(c) {
        const drafts = spazio.sessions.filter(s => s.status === 'draft' && hasContent(s)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const done = spazio.sessions.filter(s => s.status === 'done').length;
        c.innerHTML = mattyBlock('Ci sono io. Cosa facciamo?') +
            '<div class="sp-actions"><button class="sp-btn primary" id="spStart">Ho bisogno di un attimo</button>' +
            (drafts.length ? '<button class="sp-btn" id="spResume">Riprendi da dove eri</button>' : '') +
            '<button class="sp-btn" id="spStars">Le mie stelle' + (done ? ' (' + done + ')' : '') + '</button></div>' +
            '<p class="sp-foot">Se ti senti molto gi\u00f9, parlane anche con una persona di cui ti fidi o con un professionista.</p>';
        $('#spStart').onclick = startNew;
        if (drafts.length) $('#spResume').onclick = () => { cur.id = drafts[0].id; go('flow'); };
        $('#spStars').onclick = () => { view = 'sky'; renderView(); };
    }

    function startNew() {
        spazio.sessions = spazio.sessions.filter(s => !(s.status === 'draft' && !hasContent(s)));
        const s = { id: uid('sp'), createdAt: new Date().toISOString(), date: todayStr(), status: 'draft', start: null, end: null, timerMin: null, answers: {}, step: 'start' };
        spazio.sessions.push(s);
        cur.id = s.id;
        waitEnd = null; clearInterval(waitInt);
        const t = $('#spTimer'); if (t) t.style.display = 'none';
        saveSpazio(true);
        go('flow');
    }

    function levelHtml(sel) {
        let h = '<div class="sp-levels">';
        for (let i = 0; i <= 10; i++) h += '<button class="sp-lv' + (sel === i ? ' sel' : '') + '" data-v="' + i + '" style="--c:' + levelColor(i) + ';">' + i + '</button>';
        return h + '</div><div class="sp-lv-legend"><span>calmo</span><span>molto forte</span></div>';
    }

    function stepTo(name) {
        const s = getSession(cur.id);
        if (!s) return go('menu');
        s.step = name;
        saveSpazio(true);
        renderView();
    }

    function renderFlow(c) {
        const s = getSession(cur.id);
        if (!s) return go('menu');
        const step = s.step;
        const idx = STEPS.indexOf(step);
        const prev = idx > 0 ? STEPS[idx - 1] : null;
        const next = STEPS[idx + 1];
        const nav = (nextLabel, nextDisabled) =>
            '<div class="sp-actions row"><button class="sp-btn" id="spBack">Indietro</button><button class="sp-btn primary" id="spNext"' + (nextDisabled ? ' disabled' : '') + '>' + nextLabel + '</button></div>';
        const bindNav = () => {
            $('#spBack').onclick = () => prev ? stepTo(prev) : go('menu');
            const n = $('#spNext');
            if (n) n.onclick = () => next ? stepTo(next) : finish();
        };

        if (step === 'start' || step === 'final') {
            const key = step === 'start' ? 'start' : 'end';
            c.innerHTML = mattyBlock(step === 'start' ? 'Ci sono io. Da 0 a 10, quanto è forte adesso?' : 'E adesso, da 0 a 10?') +
                levelHtml(s[key]) + nav(step === 'start' ? 'Avanti' : 'Fine', s[key] == null);
            bindNav();
            c.querySelectorAll('.sp-lv').forEach(b => b.addEventListener('click', () => {
                const cs = getSession(cur.id);
                if (cs) cs[key] = +b.getAttribute('data-v');
                saveSpazio(false);
                c.querySelectorAll('.sp-lv').forEach(x => x.classList.toggle('sel', x === b));
                $('#spNext').disabled = false;
            }));
        } else if (step === 'breath') {
            c.innerHTML = mattyBlock('Respiriamo insieme per un minuto. Prima il corpo, poi la testa.') +
                '<div class="sp-breath"><div class="sp-circle"></div><div id="spBreathTxt" style="font-size:18px;">Inspira</div></div>' + nav('Salta');
            bindNav();
            const t0 = Date.now();
            spInt = setInterval(() => {
                const el = $('#spBreathTxt'), nx = $('#spNext');
                if (!el) return;
                const e = Date.now() - t0;
                el.textContent = e >= 60000 ? 'Bene così' : (e % 10000 < 4000 ? 'Inspira' : 'Espira');
                if (e >= 60000 && nx) nx.textContent = 'Continua';
            }, 200);
        } else {
            let html = mattyBlock(QUESTIONS[step]) +
                '<textarea id="spText" placeholder="Scrivi quello che ti viene...">' + esc(s.answers[step] || '') + '</textarea>';
            if (step === 'q4') {
                html += '<div class="sp-pills"><span>Prima di agire, puoi aspettare un po\u2019:</span>' +
                    [5, 10, 15].map(m => '<button class="sp-pill" data-w="' + m + '">' + m + ' min</button>').join('') + '</div>';
            }
            c.innerHTML = html + nav('Avanti');
            bindNav();
            const ta = $('#spText');
            ta.addEventListener('input', () => { const cs = getSession(cur.id); if (cs) cs.answers[step] = ta.value; saveSpazio(false); });
            c.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => startWait(+b.getAttribute('data-w'))));
        }
    }

    function startWait(min) {
        const s = getSession(cur.id);
        if (s) { s.timerMin = min; saveSpazio(true); }
        waitEnd = Date.now() + min * 60000;
        clearInterval(waitInt);
        tickWait();
        waitInt = setInterval(tickWait, 1000);
    }
    function tickWait() {
        const el = $('#spTimer');
        if (!el || !waitEnd) return;
        const left = waitEnd - Date.now();
        el.style.display = 'block';
        if (left <= 0) { el.textContent = '\ud83d\udc27 Hai aspettato. Bravo'; clearInterval(waitInt); return; }
        el.textContent = '\u23f3 ' + Math.floor(left / 60000) + ':' + pad2(Math.floor(left / 1000) % 60);
    }

    function finish() {
        const s = getSession(cur.id);
        if (!s) return go('menu');
        s.status = 'done';
        s.completedAt = new Date().toISOString();
        saveSpazio(true);
        go('done');
    }

    function renderDone(c) {
        const s = getSession(cur.id);
        if (!s) return go('menu');
        let msg;
        if (s.end < s.start) msg = 'Da ' + s.start + ' a ' + s.end + ': l\u2019intensit\u00e0 \u00e8 scesa. Ti sei fermato a scrivere invece di reagire, ed \u00e8 questo che si allena.';
        else if (s.end === s.start) msg = 'Sei rimasto a ' + s.end + ', e va bene. Ti sei fermato a scrivere invece di reagire: \u00e8 gi\u00e0 un passo.';
        else msg = 'A volte l\u2019intensit\u00e0 resta alta, soprattutto all\u2019inizio. Hai scritto tutto lo stesso. Se continua, parlane con qualcuno di cui ti fidi: non devi tenerla da solo.';
        c.innerHTML = mattyBlock(msg) +
            '<div class="sp-actions"><button class="sp-btn primary" id="spRead">Rileggi cosa hai scritto</button>' +
            '<button class="sp-btn" id="spSky">Le mie stelle</button><button class="sp-btn" id="spHome2">Torna a casa</button></div>';
        $('#spRead').onclick = () => { detailId = s.id; backTo = 'done'; go('detail'); };
        $('#spSky').onclick = () => { view = 'sky'; renderView(); };
        $('#spHome2').onclick = closeSpazio;
    }

    // ---------- Le mie stelle ----------
    function tabsHtml(active) {
        return '<div class="sp-tabs">' + [['sky', 'Cielo'], ['list', 'Lista'], ['trend', 'Andamento']].map(t =>
            '<button data-tab="' + t[0] + '" class="' + (t[0] === active ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>';
    }
    function bindTabs(c) {
        c.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { view = b.getAttribute('data-tab'); renderView(); }));
        const m = c.querySelector('#spMenu');
        if (m) m.onclick = () => go('menu');
    }
    const BACK = '<div class="sp-actions"><button class="sp-btn" id="spMenu">\u2190 Indietro</button></div>';
    function visibleSessions() { return spazio.sessions.filter(s => s.status === 'done' || hasContent(s)); }
    function openDetail(id, from) { detailId = id; backTo = from; go('detail'); }

    function renderStars(c) {
        const all = visibleSessions().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (view === 'sky') {
            let html = tabsHtml('sky');
            if (!all.length) html += mattyBlock('Il cielo è ancora vuoto. La prima stella nasce quando finisci un percorso.');
            else {
                html += '<div class="sp-sky">' + all.map(s => {
                    const x = 8 + (hash(s.id) % 8400) / 100, y = 10 + (hash(s.id + 'y') % 7800) / 100;
                    const size = 22 + (s.start || 0) * 1.6;
                    return '<button class="sp-sky-star' + (s.status === 'done' ? '' : ' draft') + '" data-id="' + s.id + '" title="' + esc(fmtDateTime(s.createdAt)) + '" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%;width:' + size + 'px;height:' + size + 'px;animation-delay:' + ((hash(s.id) % 30) / 10) + 's;"></button>';
                }).join('') + '</div><p class="sp-foot">Ogni stella \u00e8 un momento in cui ti sei fermato. Toccane una per rileggerlo.</p>';
            }
            c.innerHTML = html + BACK;
            bindTabs(c);
            c.querySelectorAll('.sp-sky-star').forEach(b => b.addEventListener('click', () => openDetail(b.getAttribute('data-id'), 'sky')));
        } else if (view === 'list') {
            c.innerHTML = tabsHtml('list') + '<input type="text" id="spSearch" placeholder="Cerca nelle tue risposte..." value="' + esc(listQuery) + '" /><div id="spItems" style="width:100%;"></div>' + BACK;
            bindTabs(c);
            const draw = () => {
                const q = listQuery.toLowerCase();
                const items = all.slice().reverse().filter(s => !q || Object.keys(s.answers || {}).some(k => (s.answers[k] || '').toLowerCase().includes(q)));
                $('#spItems').innerHTML = items.length ? items.map(s => {
                    const first = Object.keys(s.answers || {}).sort().map(k => s.answers[k]).find(t => (t || '').trim()) || '';
                    return '<button class="sp-item' + (s.status === 'done' ? '' : ' draft') + '" data-id="' + s.id + '"><div class="top"><span>' + esc(fmtDateTime(s.createdAt)) + '</span><span>' +
                        (s.status === 'done' ? s.start + ' \u2192 ' + s.end : 'non completato') + '</span></div><div class="pv">' + esc(first) + '</div></button>';
                }).join('') : '<p class="sp-foot">Nessun momento trovato.</p>';
                $('#spItems').querySelectorAll('.sp-item').forEach(b => b.addEventListener('click', () => openDetail(b.getAttribute('data-id'), 'list')));
            };
            draw();
            $('#spSearch').addEventListener('input', e => { listQuery = e.target.value; draw(); });
        } else {
            const done = all.filter(s => s.status === 'done' && s.start != null && s.end != null);
            let html = tabsHtml('trend');
            if (!done.length) html += mattyBlock('Qui vedrai come cambia l\u2019intensit\u00e0 col tempo. Serve almeno un percorso completato.');
            else {
                const avg = k => (done.reduce((s, x) => s + x[k], 0) / done.length).toFixed(1).replace('.', ',');
                const dropped = done.filter(s => s.end < s.start).length;
                html += '<div class="sp-stats"><div class="sp-stat"><b>' + done.length + '</b><span>momenti</span></div>' +
                    '<div class="sp-stat"><b>' + avg('start') + ' \u2192 ' + avg('end') + '</b><span>media prima \u2192 dopo</span></div>' +
                    '<div class="sp-stat"><b>' + dropped + '/' + done.length + '</b><span>volte scesa</span></div></div>' +
                    '<div class="sp-chart"><canvas id="spChart"></canvas></div>';
            }
            c.innerHTML = html + BACK;
            bindTabs(c);
            const canvas = $('#spChart');
            if (canvas && typeof Chart !== 'undefined') {
                const tick = '#cfd6ee';
                trendChart = new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: done.map(s => dm(s.createdAt)), datasets: [
                            { label: 'Prima', data: done.map(s => s.start), borderColor: '#ff8a7a', backgroundColor: '#ff8a7a', tension: 0.3 },
                            { label: 'Dopo', data: done.map(s => s.end), borderColor: '#5fe0b4', backgroundColor: '#5fe0b4', tension: 0.3 }
                        ]
                    },
                    options: {
                        maintainAspectRatio: false,
                        scales: { y: { min: 0, max: 10, ticks: { stepSize: 2, color: tick }, grid: { color: 'rgba(255,255,255,.08)' } }, x: { ticks: { color: tick, maxTicksLimit: 7 }, grid: { display: false } } },
                        plugins: { legend: { labels: { color: tick, boxWidth: 10 } } }
                    }
                });
            }
        }
    }

    function renderDetail(c) {
        const s = getSession(detailId);
        if (!s) return go(backTo === 'menu' ? 'menu' : backTo);
        let html = '<div class="sp-detail"><h3>' + esc(fmtDateTime(s.createdAt)) + '</h3><p style="color:rgba(232,235,255,.65);font-size:14px;">' +
            (s.status === 'done' ? 'Intensit\u00e0: ' + s.start + ' \u2192 ' + s.end : 'Momento non completato') +
            (s.timerMin ? ' \u00b7 attesa di ' + s.timerMin + ' min' : '') + '</p>';
        const keys = Object.keys(LABELS).filter(k => (s.answers[k] || '').trim());
        html += keys.length ? keys.map(k => '<h4>' + LABELS[k] + '</h4><p>' + esc(s.answers[k]) + '</p>').join('') : '<p style="margin-top:14px;color:rgba(232,235,255,.6);">Nessuna risposta scritta.</p>';
        html += '</div><div class="sp-actions row"><button class="sp-btn" id="spBack">Indietro</button><button class="sp-btn danger" id="spDel">Elimina</button></div>';
        c.innerHTML = html;
        $('#spBack').onclick = () => go(backTo);
        $('#spDel').onclick = () => {
            if (!confirm('Eliminare questo momento?')) return;
            spazio.sessions = spazio.sessions.filter(x => x.id !== s.id);
            saveSpazio(true);
            go(backTo === 'menu' ? 'menu' : backTo);
        };
    }

    // ---------- Init ----------
    function startForUser(uid_) {
        stop();
        const base = window.db.collection('users').doc(uid_).collection('modules');
        mattyRef = base.doc('matty');
        spazioRef = base.doc('spazio');
        unsubs.push(mattyRef.onSnapshot(snap => {
            matty = Object.assign({ customPhrases: [] }, snap.exists ? snap.data() : {});
        }, err => console.error('Errore lettura Matty:', err)));
        unsubs.push(spazioRef.onSnapshot(snap => {
            if (dirty || (ov && view === 'flow')) return; // non sovrascrivere ciò che sto scrivendo
            spazio = Object.assign({ sessions: [] }, snap.exists ? snap.data() : {});
        }, err => console.error('Errore lettura Spazio Privato:', err)));
    }

    function stop() {
        unsubs.forEach(u => u());
        unsubs = [];
        mattyRef = null; spazioRef = null;
        closeSpazio();
        matty = { customPhrases: [] };
        spazio = { sessions: [] };
        currentPhrase = null;
    }

    window.Matty = { mountHome, penguin };

    window.addEventListener('app:authReady', e => startForUser(e.detail.uid));
    window.addEventListener('app:authLoggedOut', stop);
    if (window.currentUser) startForUser(window.currentUser.uid);
})();