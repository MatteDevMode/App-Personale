(function () {
    const { showToast, esc, uid, todayStr } = window.Utils || {
        showToast: function () { },
        esc: function (s) { return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); },
        uid: function (p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
        todayStr: function () {
            const d = new Date();
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
    };

    const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
    const GROQ_MODEL = 'llama-3.3-70b-versatile';
    const RATE_MS = 2000;
    const LS_KEY = 'app-personale-groq-key';

    const SYSTEM_PROMPT =
        'Sei un personal trainer esperto e motivante. Chiedi sempre: obiettivo (forza/massa/dimagrire/resistenza), ' +
        'giorni disponibili a settimana, attrezzatura (palestra/casa/manubri/niente), livello esperienza ' +
        '(principiante/intermedio/avanzato), eventuali infortuni o limitazioni. Poi suggerisci scheda allenamento ' +
        'dettagliata con: esercizi, serie, ripetizioni, riposo tra serie, note tecniche su forma corretta. ' +
        'Rispondi in italiano, tono energico ma professionale. Se l\'utente chiede di registrare un allenamento, ' +
        'struttura la risposta in modo chiaro con elenco esercizi.';

    const QUICK = [
        { id: 'scheda', label: 'Suggerisci allenamento', msg: 'Suggeriscimi una scheda di allenamento adatta a me.' },
        { id: 'registro', label: 'Registra esercizio', msg: 'Voglio registrare un allenamento che ho appena fatto.' },
        { id: 'profilo', label: 'Il mio profilo', msg: 'Mostrami il mio profilo allenamento e chiedimi di aggiornarlo se manca qualcosa.' },
        { id: 'progressi', label: 'Progressi', msg: 'Come sto andando? Fammi un riepilogo dei progressi in base a quello che sai.' }
    ];

    const DAY_SPOTS = {
        center: { x: 50, y: 55 },
        sofa: { x: 50, y: 78 },
        window: { x: 82, y: 42 },
        tv: { x: 22, y: 48 },
        exercise: { x: 30, y: 65 },
        plant: { x: 78, y: 72 }
    };
    const NIGHT_SPOTS = {
        bed: { x: 28, y: 48 },
        desk: { x: 22, y: 78 }
    };
    const ACTIONS = ['idle', 'sit', 'window', 'tv', 'workout'];
    const ACTION_MS = { idle: 4000, sit: 5000, window: 4500, tv: 5000, workout: 3500, walk: 2000, sleep: 999999, atpc: 999999 };

    let ready = false;
    let robotEl, dayRoom, nightRoom, tvEl, deskEl, bubbleEl, zzzEl, clockEl, chatEl, pageEl;
    let trainerRef = null;
    let unsubTrainer = null;
    let currentUid = null;

    let trainer = defaultTrainer();
    let state = {
        mode: 'day',
        action: 'idle',
        spot: 'center',
        room: 'day',
        busy: false,
        chatOpen: false,
        sending: false
    };
    let timers = { action: null, clock: null };
    let moving = false;
    let lastSendAt = 0;

    function defaultTrainer() {
        return {
            conversations: [],
            profile: { obiettivo: '', giorniSettimana: null, attrezzatura: '', livello: '', infortuni: '' },
            workoutLogs: [],
            scheduledWorkouts: [],
            apiUsage: { lastReset: todayStr(), requestsToday: 0 }
        };
    }

    function isNightHour() {
        const h = new Date().getHours();
        return h >= 23 || h < 7;
    }

    function clockLabel() {
        const d = new Date();
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return (isNightHour() ? 'Notte' : 'Giorno') + ' · ' + h + ':' + m;
    }

    function getApiKey() {
        try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; }
    }

    function setApiKey(key) {
        try { localStorage.setItem(LS_KEY, key || ''); } catch (e) { }
    }

    function resetUsageIfNeeded() {
        const today = todayStr();
        if (!trainer.apiUsage) trainer.apiUsage = { lastReset: today, requestsToday: 0 };
        if (trainer.apiUsage.lastReset !== today) {
            trainer.apiUsage.lastReset = today;
            trainer.apiUsage.requestsToday = 0;
        }
    }

    function saveTrainer() {
        if (!trainerRef) return Promise.resolve();
        resetUsageIfNeeded();
        return trainerRef.set(trainer).catch(function (err) {
            console.error('Errore salvataggio Trainer:', err);
            showToast('Errore salvataggio chat', 'error');
        });
    }

    // ---------- Robot movimento ----------
    function setRobotPos(spotKey, room) {
        if (!robotEl) return;
        const map = room === 'night' ? NIGHT_SPOTS : DAY_SPOTS;
        const spot = map[spotKey] || map.center || { x: 50, y: 50 };
        const parent = room === 'night' ? nightRoom : dayRoom;
        if (!parent) return;
        if (robotEl.parentElement !== parent) parent.appendChild(robotEl);
        robotEl.style.left = spot.x + '%';
        robotEl.style.top = spot.y + '%';
        state.spot = spotKey;
        state.room = room;
    }

    function setAction(action) {
        if (!robotEl) return;
        state.action = action;
        var cls = action === 'window' || action === 'tv' ? 'idle' : action === 'atpc' ? 'sit' : action;
        robotEl.className = 'as-robot state-' + cls;
        if (action === 'sleep') robotEl.classList.add('state-sleep');
        if (tvEl) {
            if (action === 'tv') tvEl.classList.add('on');
            else if (action !== 'walk') tvEl.classList.remove('on');
        }
        if (deskEl) {
            if (action === 'atpc') deskEl.classList.add('active');
            else if (!state.chatOpen) deskEl.classList.remove('active');
        }
        if (zzzEl) {
            if (action === 'sleep') {
                var bed = NIGHT_SPOTS.bed;
                zzzEl.style.left = bed.x + '%';
                zzzEl.style.top = (bed.y - 18) + '%';
                zzzEl.classList.add('visible');
                if (zzzEl.parentElement !== nightRoom) nightRoom.appendChild(zzzEl);
            } else {
                zzzEl.classList.remove('visible');
            }
        }
    }

    function showBubble(text, ms) {
        if (!bubbleEl || !robotEl) return;
        var parent = robotEl.parentElement;
        if (bubbleEl.parentElement !== parent) parent.appendChild(bubbleEl);
        bubbleEl.textContent = text;
        bubbleEl.style.left = robotEl.style.left;
        bubbleEl.style.top = 'calc(' + robotEl.style.top + ' - 58px)';
        bubbleEl.classList.add('visible');
        clearTimeout(showBubble._t);
        showBubble._t = setTimeout(function () { bubbleEl.classList.remove('visible'); }, ms || 3200);
    }

    function goTo(spotKey, room, thenAction) {
        if (!robotEl || moving) return Promise.resolve();
        moving = true;
        setAction('walk');
        setRobotPos(spotKey, room || state.room);
        return new Promise(function (resolve) {
            setTimeout(function () {
                moving = false;
                setAction(thenAction || 'idle');
                resolve();
            }, 1900);
        });
    }

    function pickDayAction() {
        var pool = ACTIONS.slice();
        var idx = pool.indexOf(state.action);
        if (idx >= 0 && pool.length > 1) pool.splice(idx, 1);
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function runDayLoop() {
        clearTimeout(timers.action);
        if (state.busy || state.mode !== 'day' || state.chatOpen) return;
        var action = pickDayAction();
        var spot = 'center';
        var after = 'idle';
        if (action === 'sit') { spot = 'sofa'; after = 'sit'; }
        else if (action === 'window') { spot = 'window'; after = 'idle'; }
        else if (action === 'tv') { spot = 'tv'; after = 'tv'; }
        else if (action === 'workout') { spot = 'exercise'; after = 'workout'; }
        else {
            var keys = Object.keys(DAY_SPOTS);
            spot = keys[Math.floor(Math.random() * keys.length)];
            after = 'idle';
        }
        goTo(spot, 'day', after).then(function () {
            if (action === 'window') showBubble('Che bella vista…', 2500);
            if (action === 'workout') showBubble('Un po\' di movimento!', 2200);
            timers.action = setTimeout(runDayLoop, ACTION_MS[after] || 4000);
        });
    }

    function enterNight() {
        state.mode = 'night';
        state.busy = false;
        clearTimeout(timers.action);
        if (nightRoom) nightRoom.classList.add('is-night-mode');
        if (dayRoom) {
            var win = dayRoom.querySelector('.as-window');
            if (win) win.classList.add('night-view');
        }
        if (clockEl) {
            clockEl.textContent = clockLabel();
            clockEl.classList.add('night');
        }
        if (!state.chatOpen) {
            goTo('bed', 'night', 'sleep').then(function () {
                showBubble('Buonanotte… Zzz', 2800);
            });
        }
    }

    function enterDay() {
        state.mode = 'day';
        state.busy = false;
        if (nightRoom) nightRoom.classList.remove('is-night-mode');
        if (dayRoom) {
            var win = dayRoom.querySelector('.as-window');
            if (win) win.classList.remove('night-view');
        }
        if (clockEl) {
            clockEl.textContent = clockLabel();
            clockEl.classList.remove('night');
        }
        if (!state.chatOpen) {
            goTo('center', 'day', 'idle').then(function () {
                showBubble('Pronti per allenarci?', 2500);
                timers.action = setTimeout(runDayLoop, 3000);
            });
        }
    }

    function syncDayNight() {
        var night = isNightHour();
        if (night && state.mode !== 'night') enterNight();
        else if (!night && state.mode !== 'day') enterDay();
        if (clockEl) clockEl.textContent = clockLabel();
    }

    // ---------- Chat UI ----------
    function ensureChatDom() {
        if (chatEl && document.body.contains(chatEl)) return chatEl;
        chatEl = document.createElement('div');
        chatEl.id = 'asChat';
        chatEl.className = 'as-chat';
        chatEl.innerHTML =
            '<div class="as-chat-header">' +
            '<div class="as-chat-title">' +
            '<span class="as-chat-dot"></span>' +
            '<div><strong>TrainerBot</strong><span class="as-chat-sub">Personal Trainer IA</span></div>' +
            '</div>' +
            '<button type="button" class="as-chat-close" id="asChatClose" title="Chiudi">×</button>' +
            '</div>' +
            '<div class="as-chat-quick" id="asChatQuick"></div>' +
            '<div class="as-chat-messages" id="asChatMessages"></div>' +
            '<div class="as-chat-settings" id="asChatSettings">' +
            '<label>API key Groq <input type="password" id="asGroqKey" placeholder="gsk_…" autocomplete="off" /></label>' +
            '<button type="button" id="asSaveKey" class="as-btn-small">Salva</button>' +
            '</div>' +
            '<div class="as-chat-input-row">' +
            '<textarea id="asChatInput" rows="1" placeholder="Scrivi un messaggio…"></textarea>' +
            '<button type="button" id="asChatSend" class="as-chat-send" title="Invia">➤</button>' +
            '</div>';
        document.body.appendChild(chatEl);

        var quick = chatEl.querySelector('#asChatQuick');
        QUICK.forEach(function (q) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'as-chip';
            b.textContent = q.label;
            b.addEventListener('click', function () { sendUserMessage(q.msg); });
            quick.appendChild(b);
        });

        chatEl.querySelector('#asChatClose').addEventListener('click', closeChat);
        chatEl.querySelector('#asChatSend').addEventListener('click', function () {
            var input = chatEl.querySelector('#asChatInput');
            sendUserMessage(input.value);
        });
        chatEl.querySelector('#asChatInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendUserMessage(e.target.value);
            }
        });
        chatEl.querySelector('#asSaveKey').addEventListener('click', function () {
            var v = chatEl.querySelector('#asGroqKey').value.trim();
            setApiKey(v);
            showToast(v ? 'API key salvata' : 'API key rimossa', 'success');
        });
        var keyInput = chatEl.querySelector('#asGroqKey');
        keyInput.value = getApiKey();

        return chatEl;
    }

    function renderMessages() {
        var box = document.getElementById('asChatMessages');
        if (!box) return;
        var html = '';
        var list = trainer.conversations || [];
        if (!list.length) {
            html = '<div class="as-msg as-msg-bot"><div class="as-msg-bubble">Ciao! Sono TrainerBot 💪 Dimmi il tuo obiettivo e costruiamo la scheda insieme.</div></div>';
        } else {
            list.forEach(function (m) {
                var role = m.role === 'user' ? 'user' : 'bot';
                html += '<div class="as-msg as-msg-' + role + '"><div class="as-msg-bubble">' + formatMsg(m.text) + '</div></div>';
            });
        }
        if (state.sending) {
            html += '<div class="as-msg as-msg-bot"><div class="as-msg-bubble as-typing"><span></span><span></span><span></span></div></div>';
        }
        box.innerHTML = html;
        box.scrollTop = box.scrollHeight;
    }

    function formatMsg(text) {
        var t = esc(text || '');
        t = t.replace(/\n/g, '<br>');
        t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        return t;
    }

    function openChat() {
        ensureChatDom();
        state.chatOpen = true;
        state.busy = true;
        clearTimeout(timers.action);
        chatEl.classList.add('open');
        if (deskEl) deskEl.classList.add('active');
        setAction('atpc');
        renderMessages();
        setTimeout(function () {
            var input = document.getElementById('asChatInput');
            if (input) input.focus();
        }, 300);
    }

    function closeChat() {
        state.chatOpen = false;
        if (chatEl) chatEl.classList.remove('open');
        if (deskEl) deskEl.classList.remove('active');
        state.busy = false;
        if (state.mode === 'day') {
            setAction('idle');
            timers.action = setTimeout(runDayLoop, 2000);
        } else {
            goTo('bed', 'night', 'sleep');
        }
    }

    function goToPcAndChat() {
        state.busy = true;
        clearTimeout(timers.action);
        goTo('desk', 'night', 'atpc').then(function () {
            openChat();
            showBubble('PC acceso!', 1800);
        });
    }

    function onRobotClick() {
        if (moving) return;
        if (state.chatOpen) return;
        if (state.mode === 'night' && state.action === 'sleep') {
            showBubble('Mh… sto arrivando…', 1800);
            setAction('idle');
            goToPcAndChat();
            return;
        }
        goToPcAndChat();
    }

    function onDeskClick(e) {
        e.stopPropagation();
        if (moving) return;
        if (state.chatOpen) return;
        goToPcAndChat();
    }

    // ---------- Groq API ----------
    function buildMessagesForApi() {
        var msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
        var profile = trainer.profile || {};
        var profileBits = [];
        if (profile.obiettivo) profileBits.push('obiettivo: ' + profile.obiettivo);
        if (profile.giorniSettimana) profileBits.push('giorni/settimana: ' + profile.giorniSettimana);
        if (profile.attrezzatura) profileBits.push('attrezzatura: ' + profile.attrezzatura);
        if (profile.livello) profileBits.push('livello: ' + profile.livello);
        if (profile.infortuni) profileBits.push('infortuni/limiti: ' + profile.infortuni);
        if (profileBits.length) {
            msgs.push({ role: 'system', content: 'Profilo utente noto: ' + profileBits.join('; ') + '.' });
        }
        var hist = (trainer.conversations || []).slice(-12);
        hist.forEach(function (m) {
            msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
        });
        return msgs;
    }

    function sendUserMessage(text) {
        text = (text || '').trim();
        if (!text || state.sending) return;

        var now = Date.now();
        if (now - lastSendAt < RATE_MS) {
            showToast('Aspetta un attimo prima del prossimo messaggio', 'info');
            return;
        }

        var key = getApiKey();
        if (!key) {
            showToast('Inserisci la API key Groq sotto la chat', 'error');
            var settings = document.getElementById('asChatSettings');
            if (settings) settings.classList.add('highlight');
            return;
        }

        lastSendAt = now;
        var input = document.getElementById('asChatInput');
        if (input) input.value = '';

        trainer.conversations = trainer.conversations || [];
        trainer.conversations.push({ role: 'user', text: text, timestamp: new Date().toISOString() });
        state.sending = true;
        setAction('talk');
        renderMessages();
        saveTrainer();

        fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: buildMessagesForApi(),
                temperature: 0.7,
                max_tokens: 1200
            })
        }).then(function (res) {
            if (res.status === 429) {
                return res.json().catch(function () { return {}; }).then(function (body) {
                    var err = new Error('RATE_LIMIT');
                    err.body = body;
                    throw err;
                });
            }
            if (!res.ok) {
                return res.json().catch(function () { return {}; }).then(function (body) {
                    var err = new Error((body && body.error && body.error.message) || ('HTTP ' + res.status));
                    throw err;
                });
            }
            return res.json();
        }).then(function (data) {
            var reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Non sono riuscito a rispondere.';
            trainer.conversations.push({ role: 'assistant', text: reply, timestamp: new Date().toISOString() });
            resetUsageIfNeeded();
            trainer.apiUsage.requestsToday = (trainer.apiUsage.requestsToday || 0) + 1;
            tryParseProfileHints(text, reply);
            state.sending = false;
            setAction('atpc');
            renderMessages();
            return saveTrainer();
        }).catch(function (err) {
            state.sending = false;
            setAction('atpc');
            console.error('Groq error:', err);
            if (err && err.message === 'RATE_LIMIT') {
                showToast('Limite API raggiunto. Riprova tra poco.', 'error');
                showBubble('Limite API… mi riposo un attimo.', 3500);
                trainer.conversations.push({
                    role: 'assistant',
                    text: 'Ho raggiunto il limite di richieste. Riprova tra qualche minuto.',
                    timestamp: new Date().toISOString()
                });
            } else {
                showToast('Errore API: ' + (err && err.message ? err.message : 'sconosciuto'), 'error');
                trainer.conversations.push({
                    role: 'assistant',
                    text: 'Si è verificato un errore di connessione. Controlla la API key e riprova.',
                    timestamp: new Date().toISOString()
                });
            }
            renderMessages();
            saveTrainer();
        });
    }

    function tryParseProfileHints(userText, botText) {
        // Heuristic leggera: se l'utente dichiara dati profilo, salvali
        var t = (userText || '').toLowerCase();
        if (!trainer.profile) trainer.profile = defaultTrainer().profile;
        if (/principiante|intermedio|avanzato/.test(t)) {
            if (/principiante/.test(t)) trainer.profile.livello = 'principiante';
            else if (/intermedio/.test(t)) trainer.profile.livello = 'intermedio';
            else if (/avanzato/.test(t)) trainer.profile.livello = 'avanzato';
        }
        if (/dimagrire|massa|forza|resistenza/.test(t)) {
            if (/dimagrire/.test(t)) trainer.profile.obiettivo = 'dimagrire';
            else if (/massa/.test(t)) trainer.profile.obiettivo = 'massa';
            else if (/forza/.test(t)) trainer.profile.obiettivo = 'forza';
            else if (/resistenza/.test(t)) trainer.profile.obiettivo = 'resistenza';
        }
        var days = t.match(/(\d)\s*giorn/);
        if (days) trainer.profile.giorniSettimana = parseInt(days[1], 10);
        if (/palestra|casa|manubri|corpo libero|niente attrezzi/.test(t)) {
            if (/palestra/.test(t)) trainer.profile.attrezzatura = 'palestra';
            else if (/manubri/.test(t)) trainer.profile.attrezzatura = 'manubri';
            else if (/corpo libero|niente/.test(t)) trainer.profile.attrezzatura = 'corpo libero';
            else if (/casa/.test(t)) trainer.profile.attrezzatura = 'casa';
        }
    }

    // ---------- Shell ----------
    function renderShell() {
        pageEl = document.getElementById('page-assistants');
        if (!pageEl) return;

        pageEl.innerHTML =
            '<div class="as-top">' +
            '<div><p class="eyebrow">Casa assistenti</p><h1>Appartamento IA</h1></div>' +
            '<div class="as-clock" id="asClock">' + clockLabel() + '</div>' +
            '</div>' +
            '<div class="as-apartment" id="asApartment">' +
            '<div class="as-room as-room-day" id="asRoomDay">' +
            '<span class="as-room-label">Zona giorno</span>' +
            '<div class="as-floor-day"></div>' +
            '<div class="as-furniture as-window"></div>' +
            '<div class="as-furniture as-tv" id="asTv"><div class="as-tv-screen"></div><div class="as-tv-stand"></div></div>' +
            '<div class="as-furniture as-sofa"></div>' +
            '<div class="as-furniture as-coffee"></div>' +
            '<div class="as-furniture as-plant"></div>' +
            '</div>' +
            '<div class="as-room as-room-night" id="asRoomNight">' +
            '<span class="as-room-label">Zona notte</span>' +
            '<div class="as-furniture as-bed as-bed-1"></div>' +
            '<div class="as-furniture as-bed as-bed-2"></div>' +
            '<div class="as-furniture as-desk as-desk-trainer" id="asDeskTrainer" title="Personal Trainer">' +
            '<div class="as-monitor"><div class="as-monitor-screen"></div></div>' +
            '<div class="as-chair"></div>' +
            '<span class="as-desk-label">TRAINER</span>' +
            '</div>' +
            '<div class="as-furniture as-desk as-desk-nutri" title="Nutrizionista (presto)">' +
            '<div class="as-monitor"><div class="as-monitor-screen"></div></div>' +
            '<div class="as-chair"></div>' +
            '<span class="as-desk-label">NUTRI</span>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<p class="as-hint">Tocca il robot o la scrivania <strong>TRAINER</strong> per aprire la chat.</p>';

        dayRoom = document.getElementById('asRoomDay');
        nightRoom = document.getElementById('asRoomNight');
        tvEl = document.getElementById('asTv');
        deskEl = document.getElementById('asDeskTrainer');
        clockEl = document.getElementById('asClock');

        robotEl = document.createElement('div');
        robotEl.className = 'as-robot state-idle';
        robotEl.id = 'asRobotTrainer';
        robotEl.title = 'TrainerBot';
        robotEl.innerHTML =
            '<span class="as-robot-badge">PT</span>' +
            '<div class="as-robot-head">' +
            '<span class="as-robot-eye l"></span>' +
            '<span class="as-robot-eye r"></span>' +
            '</div>' +
            '<div class="as-robot-body">' +
            '<span class="as-robot-arm l"></span>' +
            '<span class="as-robot-arm r"></span>' +
            '<span class="as-robot-leg l"></span>' +
            '<span class="as-robot-leg r"></span>' +
            '</div>';
        dayRoom.appendChild(robotEl);
        setRobotPos('center', 'day');
        setAction('idle');

        bubbleEl = document.createElement('div');
        bubbleEl.className = 'as-bubble';
        dayRoom.appendChild(bubbleEl);

        zzzEl = document.createElement('div');
        zzzEl.className = 'as-zzz';
        zzzEl.textContent = 'Zzz';
        nightRoom.appendChild(zzzEl);

        robotEl.addEventListener('click', onRobotClick);
        deskEl.addEventListener('click', onDeskClick);

        ready = true;
        syncDayNight();
        if (state.mode === 'day' && !state.chatOpen) {
            timers.action = setTimeout(runDayLoop, 2500);
        }
        clearInterval(timers.clock);
        timers.clock = setInterval(syncDayNight, 30000);
    }

    // ---------- Firebase ----------
    function startForUser(uid) {
        stopFirebase();
        currentUid = uid;
        if (!window.db) return;
        trainerRef = window.db.collection('users').doc(uid).collection('modules').doc('assistants_trainer');
        unsubTrainer = trainerRef.onSnapshot(function (snap) {
            if (snap.exists) {
                trainer = Object.assign(defaultTrainer(), snap.data());
                if (!Array.isArray(trainer.conversations)) trainer.conversations = [];
            } else {
                trainer = defaultTrainer();
                trainerRef.set(trainer).catch(function (err) {
                    console.error('Init trainer:', err);
                });
            }
            if (state.chatOpen) renderMessages();
        }, function (err) {
            console.error('Lettura trainer:', err);
            showToast('Errore lettura dati Trainer', 'error');
        });
    }

    function stopFirebase() {
        if (unsubTrainer) { unsubTrainer(); unsubTrainer = null; }
        trainerRef = null;
        currentUid = null;
    }

    function stop() {
        clearTimeout(timers.action);
        clearInterval(timers.clock);
        closeChat();
        stopFirebase();
        ready = false;
        robotEl = null;
        dayRoom = null;
        nightRoom = null;
    }

    window.Assistants = {
        onShow: function () {
            try {
                var page = document.getElementById('page-assistants');
                if (!page) {
                    console.error('page-assistants non trovato in index.html');
                    return;
                }
                if (!ready || !page.querySelector('.as-apartment')) {
                    renderShell();
                } else {
                    syncDayNight();
                }
                if (window.currentUser && window.currentUser.uid !== currentUid) {
                    startForUser(window.currentUser.uid);
                }
            } catch (err) {
                console.error('Errore Casa IA:', err);
                var page = document.getElementById('page-assistants');
                if (page) {
                    page.innerHTML = '<div class="page-header"><h1>Casa IA</h1></div>' +
                        '<p class="empty-hint">Errore nel caricamento: ' + (err && err.message ? err.message : String(err)) + '</p>';
                }
            }
        }
    };

    window.addEventListener('app:authReady', function (e) {
        if (e.detail && e.detail.uid) startForUser(e.detail.uid);
    });
    window.addEventListener('app:authLoggedOut', function () {
        stopFirebase();
        trainer = defaultTrainer();
    });
    if (window.currentUser) startForUser(window.currentUser.uid);
})();
