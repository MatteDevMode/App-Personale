(function () {
    // Usa le funzioni condivise da Utils
    const { showToast } = window.Utils || { showToast: function () { } };

    // Waypoint zona giorno (percentuali rispetto alla stanza)
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
    let robotEl = null;
    let dayRoom = null;
    let nightRoom = null;
    let tvEl = null;
    let deskEl = null;
    let bubbleEl = null;
    let zzzEl = null;
    let clockEl = null;

    let state = {
        mode: 'day',          // day | night
        action: 'idle',       // idle | walk | sit | window | tv | workout | sleep | atpc
        spot: 'center',
        room: 'day',          // day | night
        busy: false
    };

    let timers = { action: null, clock: null };
    let moving = false;

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

    function setRobotPos(spotKey, room) {
        if (!robotEl) return;
        const map = room === 'night' ? NIGHT_SPOTS : DAY_SPOTS;
        const spot = map[spotKey] || map.center || { x: 50, y: 50 };
        const parent = room === 'night' ? nightRoom : dayRoom;
        if (!parent) return;

        // Sposta il robot nel DOM della stanza corretta
        if (robotEl.parentElement !== parent) {
            parent.appendChild(robotEl);
        }
        robotEl.style.left = spot.x + '%';
        robotEl.style.top = spot.y + '%';
        state.spot = spotKey;
        state.room = room;
    }

    function setAction(action) {
        if (!robotEl) return;
        state.action = action;
        robotEl.className = 'as-robot state-' + (action === 'window' || action === 'tv' ? 'idle' : action === 'atpc' ? 'sit' : action);
        if (action === 'sleep') robotEl.classList.add('state-sleep');

        // TV
        if (tvEl) {
            if (action === 'tv') tvEl.classList.add('on');
            else if (action !== 'walk') tvEl.classList.remove('on');
        }

        // Desk
        if (deskEl) {
            if (action === 'atpc') deskEl.classList.add('active');
            else deskEl.classList.remove('active');
        }

        // Zzz
        if (zzzEl) {
            if (action === 'sleep') {
                const bed = NIGHT_SPOTS.bed;
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
        const parent = robotEl.parentElement;
        if (bubbleEl.parentElement !== parent) parent.appendChild(bubbleEl);
        bubbleEl.textContent = text;
        bubbleEl.style.left = robotEl.style.left;
        bubbleEl.style.top = 'calc(' + robotEl.style.top + ' - 58px)';
        bubbleEl.classList.add('visible');
        clearTimeout(showBubble._t);
        showBubble._t = setTimeout(() => bubbleEl.classList.remove('visible'), ms || 3200);
    }

    function goTo(spotKey, room, thenAction) {
        if (!robotEl || moving) return Promise.resolve();
        moving = true;
        setAction('walk');
        setRobotPos(spotKey, room || state.room);
        return new Promise(resolve => {
            setTimeout(() => {
                moving = false;
                setAction(thenAction || 'idle');
                resolve();
            }, 1900);
        });
    }

    function pickDayAction() {
        const pool = ACTIONS.slice();
        // evita di ripetere subito la stessa
        const idx = pool.indexOf(state.action);
        if (idx >= 0 && pool.length > 1) pool.splice(idx, 1);
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function runDayLoop() {
        clearTimeout(timers.action);
        if (state.busy || state.mode !== 'day') return;

        const action = pickDayAction();
        let spot = 'center';
        let after = 'idle';

        if (action === 'sit') { spot = 'sofa'; after = 'sit'; }
        else if (action === 'window') { spot = 'window'; after = 'idle'; }
        else if (action === 'tv') { spot = 'tv'; after = 'tv'; }
        else if (action === 'workout') { spot = 'exercise'; after = 'workout'; }
        else { spot = Object.keys(DAY_SPOTS)[Math.floor(Math.random() * Object.keys(DAY_SPOTS).length)]; after = 'idle'; }

        goTo(spot, 'day', after).then(() => {
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
            const win = dayRoom.querySelector('.as-window');
            if (win) win.classList.add('night-view');
        }
        if (clockEl) {
            clockEl.textContent = clockLabel();
            clockEl.classList.add('night');
        }
        goTo('bed', 'night', 'sleep').then(() => {
            showBubble('Buonanotte… Zzz', 2800);
        });
    }

    function enterDay() {
        state.mode = 'day';
        state.busy = false;
        if (nightRoom) nightRoom.classList.remove('is-night-mode');
        if (dayRoom) {
            const win = dayRoom.querySelector('.as-window');
            if (win) win.classList.remove('night-view');
        }
        if (clockEl) {
            clockEl.textContent = clockLabel();
            clockEl.classList.remove('night');
        }
        goTo('center', 'day', 'idle').then(() => {
            showBubble('Pronti per allenarci?', 2500);
            timers.action = setTimeout(runDayLoop, 3000);
        });
    }

    function syncDayNight() {
        const night = isNightHour();
        if (night && state.mode !== 'night') enterNight();
        else if (!night && state.mode !== 'day') enterDay();
        if (clockEl) clockEl.textContent = clockLabel();
    }

    function onRobotClick() {
        if (moving) return;

        if (state.mode === 'night' && state.action === 'sleep') {
            // Sveglia stordito → va al PC
            state.busy = true;
            clearTimeout(timers.action);
            showBubble('Mh… sto arrivando…', 2000);
            setAction('idle');
            goTo('desk', 'night', 'atpc').then(() => {
                showBubble('PC acceso. Chat in arrivo…', 3000);
                // Fase successiva: aprire chat panel
            });
            return;
        }

        // Giorno (o già sveglio): vai alla postazione PC
        state.busy = true;
        clearTimeout(timers.action);
        const targetRoom = state.mode === 'night' ? 'night' : 'night'; // PC è in zona notte
        goTo('desk', targetRoom, 'atpc').then(() => {
            showBubble('Seduto al PC. Chat presto!', 3000);
        });
    }

    function onDeskClick(e) {
        e.stopPropagation();
        if (moving) return;
        state.busy = true;
        clearTimeout(timers.action);
        goTo('desk', 'night', 'atpc').then(() => {
            showBubble('Monitor acceso!', 2500);
        });
    }

    function renderShell() {
        const page = document.getElementById('page-assistants');
        if (!page) return;

        page.innerHTML =
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
            '<p class="as-hint">Tocca il robot verde o la scrivania <strong>TRAINER</strong> per farlo sedere al PC.</p>';

        dayRoom = document.getElementById('asRoomDay');
        nightRoom = document.getElementById('asRoomNight');
        tvEl = document.getElementById('asTv');
        deskEl = document.getElementById('asDeskTrainer');
        clockEl = document.getElementById('asClock');

        // Robot
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
        if (state.mode === 'day') {
            timers.action = setTimeout(runDayLoop, 2500);
        }
        clearInterval(timers.clock);
        timers.clock = setInterval(syncDayNight, 30000);
    }

    function stop() {
        clearTimeout(timers.action);
        clearInterval(timers.clock);
        ready = false;
        robotEl = null;
        dayRoom = null;
        nightRoom = null;
    }

    window.Assistants = {
        onShow: function () {
            try {
                const page = document.getElementById('page-assistants');
                if (!page) {
                    console.error('page-assistants non trovato in index.html');
                    return;
                }
                if (!ready || !page.querySelector('.as-apartment')) {
                    renderShell();
                } else {
                    syncDayNight();
                }
            } catch (err) {
                console.error('Errore Casa IA:', err);
                const page = document.getElementById('page-assistants');
                if (page) {
                    page.innerHTML = '<div class="page-header"><h1>Casa IA</h1></div>' +
                        '<p class="empty-hint">Errore nel caricamento: ' + (err && err.message ? err.message : String(err)) + '</p>';
                }
            }
        }
    };
})();
