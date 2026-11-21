(function () {
  const { esc, uid, todayStr, showToast } = window.Utils || {
    esc: function (s) {
      return String(s || '').replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    },
    uid: function (p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    todayStr: function () {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    showToast: function (m) { console.log(m); }
  };

  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  // llama-3.3-70b-versatile è solo Enterprise; free/dev usa gpt-oss-120b
  const GROQ_MODEL = 'openai/gpt-oss-120b';
  const AI_RATE_MS = 3000;
  let lastAiCallAt = 0;
  let aiLoading = false;
  let pendingSuggestion = null; // { text, scheda }
  let lastCoachMessage = '';

  function defaultData() {
    return {
      profile: {
        obiettivo: '',
        livello: '',
        attrezzatura: '',
        giorniDisponibili: null
      },
      exercises: [],
      schedules: [],
      workoutLogs: [],
      aiCache: { ultimoSuggerimento: '', timestamp: null }
    };
  }

  let data = defaultData();
  let docRef = null;
  let unsub = null;
  let ready = false;
  let currentUid = null;

  const state = {
    tab: 'oggi',
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    selectedDate: null,
    expandedEx: null,
    session: null, // in-progress log for active schedule
    progressExerciseId: null
  };

  function getGroqKey() {
    try { return localStorage.getItem('app-personale-groq-key') || ''; } catch (e) { return ''; }
  }
  function setGroqKey(k) {
    try { localStorage.setItem('app-personale-groq-key', k || ''); } catch (e) { }
  }

  function save() {
    if (!docRef) return Promise.resolve();
    return docRef.set(data)
      .then(function () { showToast('Salvato', 'success'); })
      .catch(function (err) {
        console.error('Errore salvataggio Allenamenti:', err);
        showToast('Errore nel salvataggio', 'error');
      });
  }

  function activeSchedule() {
    return (data.schedules || []).find(function (s) { return s.attiva; }) || null;
  }

  function exerciseById(id) {
    return (data.exercises || []).find(function (e) { return e.id === id; });
  }

  function ensureExercise(nome) {
    nome = (nome || '').trim();
    if (!nome) return null;
    var found = (data.exercises || []).find(function (e) {
      return e.nome.toLowerCase() === nome.toLowerCase();
    });
    if (found) return found;
    var ex = { id: uid('ex'), nome: nome, gruppoMuscolare: '', note: '' };
    data.exercises = data.exercises || [];
    data.exercises.push(ex);
    return ex;
  }

  function logsOnDate(dateStr) {
    return (data.workoutLogs || []).filter(function (l) { return l.date === dateStr; });
  }

  function logDatesSet() {
    var set = {};
    (data.workoutLogs || []).forEach(function (l) { if (l.date) set[l.date] = true; });
    return set;
  }

  function computeStreak() {
    var set = logDatesSet();
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var key = function (dt) {
      return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    };
    // se oggi non c'è log, parti da ieri
    if (!set[key(d)]) d.setDate(d.getDate() - 1);
    var streak = 0;
    while (set[key(d)]) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function monthLogCount(y, m) {
    var prefix = y + '-' + String(m + 1).padStart(2, '0');
    return (data.workoutLogs || []).filter(function (l) { return (l.date || '').slice(0, 7) === prefix; }).length;
  }

  function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    var p = dateStr.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    var days = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  // ---------- Session helpers (Oggi) ----------
  function initSessionFromSchedule(sch) {
    if (!sch) return null;
    return {
      scheduleId: sch.id,
      nome: sch.nome,
      started: false,
      esercizi: (sch.esercizi || []).map(function (se) {
        var sets = [];
        var n = Math.max(1, Number(se.serieTarget) || 1);
        for (var i = 0; i < n; i++) {
          sets.push({
            ripetizioni: se.ripTarget || '',
            peso: se.pesoTarget || ''
          });
        }
        return {
          exerciseId: se.exerciseId,
          nome: (exerciseById(se.exerciseId) || {}).nome || se.nome || 'Esercizio',
          serieTarget: se.serieTarget,
          ripTarget: se.ripTarget,
          riposoSec: se.riposoSec,
          pesoTarget: se.pesoTarget,
          done: false,
          note: '',
          serie: sets
        };
      })
    };
  }

  function syncSession() {
    var sch = activeSchedule();
    if (!sch) {
      state.session = null;
      return;
    }
    if (!state.session || state.session.scheduleId !== sch.id) {
      state.session = initSessionFromSchedule(sch);
    }
  }

  // ---------- Render shell ----------
  function render() {
    var page = document.getElementById('page-workouts');
    if (!page) return;

    syncSession();

    page.innerHTML =
      '<div class="wo-header">' +
      '<div><p class="eyebrow">Fitness</p><h1>💪 Allenamenti</h1></div>' +
      '<div class="wo-header-actions">' +
      '<button type="button" class="wo-icon-btn" id="woProfileBtn" title="Profilo">⚙️</button>' +
      '</div>' +
      '</div>' +
      '<div class="wo-tabs">' +
      '<button type="button" class="wo-tab' + (state.tab === 'oggi' ? ' active' : '') + '" data-tab="oggi">Oggi</button>' +
      '<button type="button" class="wo-tab' + (state.tab === 'storico' ? ' active' : '') + '" data-tab="storico">Storico</button>' +
      '<button type="button" class="wo-tab' + (state.tab === 'progressi' ? ' active' : '') + '" data-tab="progressi">Progressi</button>' +
      '</div>' +
      '<div id="woTabBody"></div>';

    page.querySelectorAll('.wo-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.getAttribute('data-tab');
        render();
      });
    });
    page.querySelector('#woProfileBtn').addEventListener('click', openProfileModal);

    var body = page.querySelector('#woTabBody');
    if (state.tab === 'oggi') renderOggi(body);
    else if (state.tab === 'storico') renderStorico(body);
    else renderProgressi(body);
  }

  // ---------- TAB OGGI ----------
  function renderOggi(el) {
    var sch = activeSchedule();
    var html = '';

    if (!sch) {
      html +=
        '<div class="wo-card wo-empty">' +
        '<p>Nessuna scheda attiva per oggi.</p>' +
        '<div class="wo-empty-actions">' +
        '<button type="button" class="wo-btn wo-btn-primary" id="woCreateSchedule">Crea scheda manuale</button>' +
        '<button type="button" class="wo-btn" id="woAiSuggest"' + (aiLoading ? ' disabled' : '') + '>' +
        (aiLoading ? 'Coach in corso…' : '✨ Chiedi suggerimento IA') +
        '</button>' +
        '</div>' +
        '</div>';
    } else {
      var sess = state.session;
      html +=
        '<div class="wo-card">' +
        '<p class="wo-card-sub">' + esc(formatDateLabel(todayStr())) + '</p>' +
        '<p class="wo-card-title">' + esc(sch.nome || 'Scheda') + '</p>' +
        '<div class="wo-ex-list">';

      (sess.esercizi || []).forEach(function (ex, idx) {
        var target = (ex.serieTarget || '?') + '×' + (ex.ripTarget || '?') +
          (ex.pesoTarget ? ' · ' + ex.pesoTarget + 'kg' : '') +
          (ex.riposoSec ? ' · riposo ' + ex.riposoSec + 's' : '');
        var open = state.expandedEx === idx;
        html +=
          '<div class="wo-ex' + (ex.done ? ' done' : '') + (open ? ' open' : '') + '" data-idx="' + idx + '">' +
          '<div class="wo-ex-row">' +
          '<div class="wo-ex-check">✓</div>' +
          '<div style="flex:1;min-width:0;">' +
          '<div class="wo-ex-name">' + esc(ex.nome) + '</div>' +
          '<div class="wo-ex-meta">' + esc(target) + '</div>' +
          '</div>' +
          '</div>' +
          '<div class="wo-ex-body">' +
          '<div class="wo-set-list">';
        (ex.serie || []).forEach(function (set, si) {
          html +=
            '<div class="wo-set-row">' +
            '<span class="wo-set-num">S' + (si + 1) + '</span>' +
            '<input type="number" inputmode="numeric" data-set="' + si + '" data-field="ripetizioni" placeholder="Reps" value="' + esc(String(set.ripetizioni || '')) + '" />' +
            '<input type="number" inputmode="decimal" data-set="' + si + '" data-field="peso" placeholder="Kg" step="0.5" value="' + esc(String(set.peso || '')) + '" />' +
            '</div>';
        });
        html +=
          '</div>' +
          '<button type="button" class="wo-btn wo-btn-ghost wo-add-set" data-idx="' + idx + '">+ serie</button>' +
          '<div class="wo-ex-note"><textarea data-field="note" placeholder="Note (opzionale)">' + esc(ex.note || '') + '</textarea></div>' +
          '</div>' +
          '</div>';
      });

      html +=
        '</div>' +
        '<div class="wo-btn-row">' +
        '<button type="button" class="wo-btn wo-btn-primary" id="woSaveWorkout">💾 Salva allenamento</button>' +
        '<button type="button" class="wo-btn" id="woEditSchedule">✏️ Modifica scheda</button>' +
        '<button type="button" class="wo-btn" id="woAiSuggest"' + (aiLoading ? ' disabled' : '') + '>' +
        (aiLoading ? 'Coach in corso…' : '✨ Nuovo suggerimento IA') +
        '</button>' +
        '<button type="button" class="wo-btn wo-btn-ghost" id="woDeactivate">Disattiva</button>' +
        '</div>' +
        '</div>';
    }

    if (pendingSuggestion) {
      html += renderSuggestionCard(pendingSuggestion);
    }

    html +=
      '<div class="wo-coach">' +
      '<div class="wo-coach-label">Coach IA</div>' +
      '<p class="wo-coach-text">' + esc(lastCoachMessage || coachTip()) + '</p>' +
      '</div>';

    el.innerHTML = html;

    var createBtn = el.querySelector('#woCreateSchedule');
    if (createBtn) createBtn.addEventListener('click', function () { openScheduleModal(null); });
    var aiBtn = el.querySelector('#woAiSuggest');
    if (aiBtn) aiBtn.addEventListener('click', requestAiSuggestion);
    bindSuggestionActions(el);

    el.querySelectorAll('.wo-ex-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        var card = row.closest('.wo-ex');
        var idx = Number(card.getAttribute('data-idx'));
        // toggle done if click on check
        if (e.target.classList.contains('wo-ex-check')) {
          state.session.esercizi[idx].done = !state.session.esercizi[idx].done;
          render();
          return;
        }
        state.expandedEx = state.expandedEx === idx ? null : idx;
        render();
      });
    });

    el.querySelectorAll('.wo-ex-body input, .wo-ex-body textarea').forEach(function (input) {
      input.addEventListener('click', function (e) { e.stopPropagation(); });
      input.addEventListener('change', function () {
        var card = input.closest('.wo-ex');
        var idx = Number(card.getAttribute('data-idx'));
        var ex = state.session.esercizi[idx];
        if (input.getAttribute('data-field') === 'note') {
          ex.note = input.value;
        } else {
          var si = Number(input.getAttribute('data-set'));
          var field = input.getAttribute('data-field');
          if (ex.serie[si]) ex.serie[si][field] = input.value;
        }
      });
    });

    el.querySelectorAll('.wo-add-set').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = Number(btn.getAttribute('data-idx'));
        var ex = state.session.esercizi[idx];
        var last = ex.serie[ex.serie.length - 1] || { ripetizioni: '', peso: '' };
        ex.serie.push({ ripetizioni: last.ripetizioni, peso: last.peso });
        state.expandedEx = idx;
        render();
      });
    });

    var saveBtn = el.querySelector('#woSaveWorkout');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentWorkout);
    var editBtn = el.querySelector('#woEditSchedule');
    if (editBtn) editBtn.addEventListener('click', function () { openScheduleModal(activeSchedule()); });
    var deact = el.querySelector('#woDeactivate');
    if (deact) deact.addEventListener('click', function () {
      var sch = activeSchedule();
      if (!sch) return;
      sch.attiva = false;
      state.session = null;
      save().then(render);
    });
  }

  function coachTip() {
    if (data.aiCache && data.aiCache.ultimoSuggerimento) {
      return data.aiCache.ultimoSuggerimento;
    }
    var logs = (data.workoutLogs || []).slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    if (!logs.length) {
      return 'Registra il primo allenamento oppure chiedi un suggerimento IA per partire.';
    }
    var last = logs[0];
    var n = (last.esercizi || []).length;
    return 'Ultimo allenamento il ' + formatDateLabel(last.date) +
      (last.nome ? ' · ' + last.nome : '') +
      ' · ' + n + ' esercizi. Continua così 💪';
  }

  function renderSuggestionCard(sug) {
    var html =
      '<div class="wo-suggest-card">' +
      '<div class="wo-coach-label">Suggerimento IA</div>' +
      '<div class="wo-suggest-text">' + formatAiText(sug.text) + '</div>';
    if (sug.scheda && sug.scheda.esercizi && sug.scheda.esercizi.length) {
      html +=
        '<ul class="wo-suggest-list">' +
        sug.scheda.esercizi.map(function (e) {
          return '<li><strong>' + esc(e.nome) + '</strong> · ' +
            esc(String(e.serieTarget || '?')) + '×' + esc(String(e.ripTarget || '?')) +
            (e.pesoTarget ? ' · ' + esc(String(e.pesoTarget)) + 'kg' : '') +
            (e.riposoSec ? ' · riposo ' + esc(String(e.riposoSec)) + 's' : '') +
            '</li>';
        }).join('') +
        '</ul>' +
        '<div class="wo-btn-row">' +
        '<button type="button" class="wo-btn wo-btn-primary" id="woUseSuggestion">Usa come scheda oggi</button>' +
        '<button type="button" class="wo-btn wo-btn-ghost" id="woDismissSuggestion">Nascondi</button>' +
        '</div>';
    } else {
      html += '<div class="wo-btn-row"><button type="button" class="wo-btn wo-btn-ghost" id="woDismissSuggestion">Nascondi</button></div>';
    }
    html += '</div>';
    return html;
  }

  function formatAiText(text) {
    var t = String(text || '').replace(/---SCHEDA---[\s\S]*?---FINE---/gi, '').trim();
    return esc(t).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function bindSuggestionActions(el) {
    var use = el.querySelector('#woUseSuggestion');
    var dismiss = el.querySelector('#woDismissSuggestion');
    if (dismiss) dismiss.addEventListener('click', function () {
      pendingSuggestion = null;
      render();
    });
    if (use) use.addEventListener('click', function () {
      if (!pendingSuggestion || !pendingSuggestion.scheda) return;
      applySuggestionAsSchedule(pendingSuggestion.scheda);
    });
  }

  function applySuggestionAsSchedule(scheda) {
    var draft = {
      id: uid('sch'),
      nome: scheda.tipo || 'Scheda IA',
      attiva: true,
      createdAt: new Date().toISOString(),
      esercizi: (scheda.esercizi || []).map(function (e) {
        var linked = ensureExercise(e.nome);
        return {
          exerciseId: linked.id,
          nome: linked.nome,
          serieTarget: e.serieTarget != null ? Number(e.serieTarget) : null,
          ripTarget: e.ripTarget != null ? Number(e.ripTarget) : null,
          riposoSec: e.riposoSec != null ? Number(e.riposoSec) : null,
          pesoTarget: e.pesoTarget != null && e.pesoTarget !== '' ? Number(e.pesoTarget) : null
        };
      })
    };
    data.schedules = data.schedules || [];
    data.schedules.forEach(function (s) { s.attiva = false; });
    data.schedules.push(draft);
    state.session = null;
    pendingSuggestion = null;
    lastCoachMessage = 'Scheda «' + draft.nome + '» attivata dal coach. Forza! 💪';
    data.aiCache = data.aiCache || {};
    data.aiCache.ultimoSuggerimento = lastCoachMessage;
    data.aiCache.timestamp = new Date().toISOString();
    save().then(function () {
      showToast('Scheda attivata', 'success');
      state.tab = 'oggi';
      render();
    });
  }

  function parseSchedaBlock(text) {
    if (!text) return null;
    var m = String(text).match(/---SCHEDA---([\s\S]*?)---FINE---/i);
    if (!m) return null;
    var lines = m[1].trim().split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var tipo = 'Allenamento';
    var esercizi = [];
    lines.forEach(function (line) {
      var tm = line.match(/^tipo\s*:\s*(.+)$/i);
      if (tm) { tipo = tm[1].trim(); return; }
      var parts = line.split('|').map(function (p) { return p.trim(); });
      if (parts.length >= 2 && parts[0]) {
        esercizi.push({
          nome: parts[0],
          serieTarget: parts[1] || '',
          ripTarget: parts[2] || '',
          riposoSec: parts[3] || '',
          pesoTarget: parts[4] || '',
          note: parts[5] || ''
        });
      }
    });
    if (!esercizi.length) return null;
    return { tipo: tipo, esercizi: esercizi };
  }

  function logsLastDays(n) {
    var cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (n - 1));
    var cutStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    return (data.workoutLogs || [])
      .filter(function (l) { return (l.date || '') >= cutStr; })
      .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
  }

  function buildContextSummary() {
    var p = data.profile || {};
    var lines = [];
    lines.push('Profilo: obiettivo=' + (p.obiettivo || 'n/d') +
      ', livello=' + (p.livello || 'n/d') +
      ', attrezzatura=' + (p.attrezzatura || 'n/d') +
      ', giorni/settimana=' + (p.giorniDisponibili != null ? p.giorniDisponibili : 'n/d'));
    var recent = logsLastDays(7);
    if (!recent.length) {
      lines.push('Nessun allenamento negli ultimi 7 giorni.');
    } else {
      lines.push('Allenamenti ultimi 7 giorni:');
      recent.forEach(function (log) {
        var parts = (log.esercizi || []).map(function (ex) {
          var maxW = 0;
          var sets = (ex.serie || []).map(function (s) {
            if (s.peso != null && Number(s.peso) > maxW) maxW = Number(s.peso);
            return (s.ripetizioni != null ? s.ripetizioni : '?') + (s.peso != null ? '@' + s.peso + 'kg' : '');
          }).join(', ');
          return ex.nome + ' [' + sets + ']';
        });
        lines.push('- ' + log.date + ' ' + (log.nome || '') + ': ' + parts.join('; '));
      });
    }
    var known = (data.exercises || []).map(function (e) { return e.nome; }).slice(0, 30);
    if (known.length) lines.push('Esercizi noti: ' + known.join(', '));
    return lines.join('\n');
  }

  function canCallAi() {
    var now = Date.now();
    if (now - lastAiCallAt < AI_RATE_MS) {
      showToast('Aspetta un attimo prima di una nuova richiesta', 'info');
      return false;
    }
    if (!getGroqKey()) {
      showToast('Imposta la API key Groq nel profilo ⚙️', 'error');
      openProfileModal();
      return false;
    }
    return true;
  }

  function callGroq(messages) {
    lastAiCallAt = Date.now();
    return fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getGroqKey()
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.6,
        max_tokens: 2048
      })
    }).then(function (res) {
      if (res.status === 429) {
        var err = new Error('RATE_LIMIT');
        throw err;
      }
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error((body && body.error && body.error.message) || ('HTTP ' + res.status));
        });
      }
      return res.json();
    }).then(function (data) {
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    });
  }

  function requestAiSuggestion() {
    if (aiLoading || !canCallAi()) return;
    aiLoading = true;
    render();

    var system =
      'Sei un personal trainer esperto. Rispondi in italiano, tono motivante e conciso. ' +
      'Suggerisci UNA scheda di allenamento per OGGI (6-8 esercizi max), tenendo conto di recupero muscolare e progressione. ' +
      'Alla FINE del messaggio includi SEMPRE questo blocco:\n' +
      '---SCHEDA---\n' +
      'tipo: Nome sessione\n' +
      'Nome esercizio | serie | ripetizioni | riposo_sec | peso_consigliato_kg\n' +
      '---FINE---\n' +
      'Una riga per esercizio. Non omettere il blocco.';

    callGroq([
      { role: 'system', content: system },
      { role: 'user', content: 'Contesto atleta:\n' + buildContextSummary() + '\n\nSuggerisci la scheda di oggi.' }
    ]).then(function (reply) {
      var scheda = parseSchedaBlock(reply);
      pendingSuggestion = { text: reply, scheda: scheda };
      lastCoachMessage = scheda
        ? ('Ho preparato «' + (scheda.tipo || 'Scheda') + '» con ' + scheda.esercizi.length + ' esercizi. Puoi attivarla qui sotto.')
        : 'Ho un consiglio per te (scheda non strutturata). Leggi il testo del suggerimento.';
      data.aiCache = data.aiCache || {};
      data.aiCache.ultimoSuggerimento = lastCoachMessage;
      data.aiCache.timestamp = new Date().toISOString();
      return save();
    }).catch(function (err) {
      console.error('Groq suggest:', err);
      if (err && err.message === 'RATE_LIMIT') {
        showToast('Limite API raggiunto, riprova tra poco', 'error');
        lastCoachMessage = 'Coach IA in pausa (limite API). Riprova tra qualche minuto.';
      } else {
        showToast('Coach IA non disponibile, riprova più tardi', 'error');
        lastCoachMessage = 'Coach IA non disponibile: ' + (err && err.message ? err.message : 'errore');
      }
    }).then(function () {
      aiLoading = false;
      render();
    });
  }

  function localProgressInsight(esercizi) {
    var tips = [];
    esercizi.forEach(function (ex) {
      var name = ex.nome;
      if (!name) return;
      var maxToday = 0;
      (ex.serie || []).forEach(function (s) {
        var w = Number(s.peso);
        if (!isNaN(w) && w > maxToday) maxToday = w;
      });
      if (!maxToday) return;
      // cerca log precedenti stesso esercizio
      var prevMax = 0;
      var prevDate = '';
      (data.workoutLogs || []).forEach(function (log) {
        if (log.date === todayStr()) return;
        (log.esercizi || []).forEach(function (e) {
          if ((e.nome || '') !== name) return;
          (e.serie || []).forEach(function (s) {
            var w = Number(s.peso);
            if (!isNaN(w) && w > prevMax) {
              prevMax = w;
              prevDate = log.date;
            }
          });
        });
      });
      if (prevMax > 0 && maxToday > prevMax) {
        var delta = Math.round((maxToday - prevMax) * 10) / 10;
        tips.push(name + ': +' + delta + 'kg rispetto al max precedente (' + prevMax + 'kg' + (prevDate ? ' il ' + prevDate : '') + ')');
      } else if (prevMax > 0 && maxToday === prevMax) {
        tips.push(name + ': hai eguagliato il record di ' + prevMax + 'kg');
      }
    });
    if (!tips.length) return 'Allenamento registrato. Continua con costanza: la progressione arriverà.';
    return tips.slice(0, 3).join('. ') + '. Ottimo lavoro! 💪';
  }

  function requestPostWorkoutAnalysis(logEntry) {
    // insight locale immediato
    lastCoachMessage = localProgressInsight(logEntry.esercizi || []);
    data.aiCache = data.aiCache || {};
    data.aiCache.ultimoSuggerimento = lastCoachMessage;
    data.aiCache.timestamp = new Date().toISOString();

    if (!getGroqKey()) {
      save().then(render);
      return;
    }
    if (Date.now() - lastAiCallAt < AI_RATE_MS) {
      save().then(render);
      return;
    }

    var summary = (logEntry.esercizi || []).map(function (ex) {
      var sets = (ex.serie || []).map(function (s) {
        return (s.ripetizioni != null ? s.ripetizioni : '?') + (s.peso != null ? '@' + s.peso : '');
      }).join(', ');
      return ex.nome + ': ' + sets;
    }).join('\n');

    callGroq([
      {
        role: 'system',
        content: 'Sei un personal trainer. In italiano, 2-3 frasi max: commenta l\'allenamento appena finito, cita progressioni di peso se ci sono, dai un consiglio concreto per la prossima sessione. Niente elenchi lunghi.'
      },
      {
        role: 'user',
        content: 'Profilo: ' + JSON.stringify(data.profile || {}) +
          '\nStorico recente:\n' + buildContextSummary() +
          '\n\nAllenamento appena salvato (' + logEntry.date + ' – ' + (logEntry.nome || '') + '):\n' + summary
      }
    ]).then(function (reply) {
      var msg = String(reply || '').trim();
      if (msg) {
        lastCoachMessage = msg;
        data.aiCache.ultimoSuggerimento = msg;
        data.aiCache.timestamp = new Date().toISOString();
        return save();
      }
    }).catch(function (err) {
      console.error('Groq analysis:', err);
      // mantieni insight locale
    }).then(function () {
      render();
    });
  }

  function saveCurrentWorkout() {
    if (!state.session) return;
    var esercizi = state.session.esercizi.map(function (ex) {
      var linked = ensureExercise(ex.nome);
      return {
        exerciseId: linked ? linked.id : ex.exerciseId,
        nome: ex.nome,
        serie: (ex.serie || []).map(function (s) {
          return {
            ripetizioni: s.ripetizioni === '' ? null : Number(s.ripetizioni),
            peso: s.peso === '' ? null : Number(s.peso)
          };
        }).filter(function (s) {
          return s.ripetizioni != null || s.peso != null;
        }),
        note: ex.note || ''
      };
    }).filter(function (ex) { return ex.serie.length > 0 || ex.note; });

    if (!esercizi.length) {
      showToast('Inserisci almeno una serie', 'error');
      return;
    }

    var logEntry = {
      id: uid('wl'),
      date: todayStr(),
      scheduleId: state.session.scheduleId || null,
      nome: state.session.nome || 'Allenamento',
      durataMinuti: null,
      sensazioni: null,
      esercizi: esercizi,
      createdAt: new Date().toISOString()
    };

    data.workoutLogs = data.workoutLogs || [];
    data.workoutLogs.push(logEntry);

    state.session.esercizi.forEach(function (ex) { ex.done = true; });

    save().then(function () {
      showToast('Allenamento salvato! 💪', 'success');
      requestPostWorkoutAnalysis(logEntry);
    });
  }

  // ---------- TAB STORICO ----------
  function renderStorico(el) {
    var y = state.calYear;
    var m = state.calMonth;
    var set = logDatesSet();
    var first = new Date(y, m, 1);
    var startDow = (first.getDay() + 6) % 7; // lun=0
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var html =
      '<div class="wo-stats-row">' +
      '<div class="wo-stat"><div class="wo-stat-val">🔥 ' + computeStreak() + '</div><div class="wo-stat-label">Streak giorni</div></div>' +
      '<div class="wo-stat"><div class="wo-stat-val">' + monthLogCount(y, m) + '</div><div class="wo-stat-label">Questo mese</div></div>' +
      '</div>' +
      '<div class="wo-card">' +
      '<div class="wo-cal-nav">' +
      '<button type="button" class="wo-icon-btn" id="woCalPrev">←</button>' +
      '<strong>' + MONTHS[m] + ' ' + y + '</strong>' +
      '<button type="button" class="wo-icon-btn" id="woCalNext">→</button>' +
      '</div>' +
      '<div class="wo-cal-grid">';

    DOW.forEach(function (d) { html += '<div class="wo-cal-dow">' + d + '</div>'; });
    for (var i = 0; i < startDow; i++) html += '<div class="wo-cal-day muted"></div>';
    var today = todayStr();
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var cls = 'wo-cal-day';
      if (ds === today) cls += ' today';
      if (set[ds]) cls += ' has-log';
      if (state.selectedDate === ds) cls += ' selected';
      html += '<button type="button" class="' + cls + '" data-date="' + ds + '">' + day + '</button>';
    }
    html += '</div></div>';

    var selected = state.selectedDate;
    var list = (data.workoutLogs || []).slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    if (selected) list = list.filter(function (l) { return l.date === selected; });
    else list = list.slice(0, 5);

    html += '<div class="wo-card"><p class="wo-card-title">' +
      (selected ? 'Allenamenti del ' + formatDateLabel(selected) : 'Ultimi allenamenti') +
      '</p>';

    if (!list.length) {
      html += '<p class="wo-card-sub">Nessun allenamento' + (selected ? ' in questo giorno' : '') + '.</p>';
    } else {
      list.forEach(function (log) {
        var n = (log.esercizi || []).length;
        html +=
          '<div class="wo-log-item" data-id="' + esc(log.id) + '">' +
          '<div><div class="wo-log-name">' + esc(log.nome || 'Allenamento') + '</div>' +
          '<div class="wo-log-meta">' + n + ' esercizi' + (log.durataMinuti ? ' · ' + log.durataMinuti + ' min' : '') + '</div></div>' +
          '<div class="wo-log-right">' + esc(log.date) + '</div>' +
          '</div>';
      });
    }
    html += '</div>';

    if (selected) {
      var detail = logsOnDate(selected);
      if (detail.length) {
        html += '<div class="wo-card" id="woLogDetail">';
        detail.forEach(function (log) {
          html += '<p class="wo-card-title">' + esc(log.nome || 'Allenamento') + '</p>';
          (log.esercizi || []).forEach(function (ex) {
            var sets = (ex.serie || []).map(function (s, i) {
              return 'S' + (i + 1) + ': ' + (s.ripetizioni != null ? s.ripetizioni + ' rip' : '-') +
                (s.peso != null ? ' @ ' + s.peso + 'kg' : '');
            }).join(' · ');
            html += '<div style="margin-bottom:10px;"><strong>' + esc(ex.nome || 'Esercizio') + '</strong>' +
              '<div class="wo-log-meta">' + esc(sets || 'Nessuna serie') + '</div>' +
              (ex.note ? '<div class="wo-log-meta">' + esc(ex.note) + '</div>' : '') +
              '</div>';
          });
        });
        html += '</div>';
      }
    }

    el.innerHTML = html;

    el.querySelector('#woCalPrev').addEventListener('click', function () {
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      render();
    });
    el.querySelector('#woCalNext').addEventListener('click', function () {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      render();
    });
    el.querySelectorAll('.wo-cal-day[data-date]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ds = btn.getAttribute('data-date');
        state.selectedDate = state.selectedDate === ds ? null : ds;
        render();
      });
    });
  }

  // ---------- TAB PROGRESSI ----------
  function allLoggedExerciseNames() {
    var map = {};
    (data.workoutLogs || []).forEach(function (log) {
      (log.esercizi || []).forEach(function (ex) {
        var name = ex.nome || (exerciseById(ex.exerciseId) || {}).nome;
        if (name) map[name] = ex.exerciseId || name;
      });
    });
    return Object.keys(map).sort();
  }

  function seriesForExercise(name) {
    var points = [];
    (data.workoutLogs || []).forEach(function (log) {
      (log.esercizi || []).forEach(function (ex) {
        var n = ex.nome || (exerciseById(ex.exerciseId) || {}).nome;
        if (n !== name) return;
        var maxW = 0;
        var vol = 0;
        (ex.serie || []).forEach(function (s) {
          var w = Number(s.peso) || 0;
          var r = Number(s.ripetizioni) || 0;
          if (w > maxW) maxW = w;
          vol += w * r;
        });
        points.push({ date: log.date, maxPeso: maxW, volume: vol });
      });
    });
    points.sort(function (a, b) { return a.date.localeCompare(b.date); });
    return points;
  }

  function renderProgressi(el) {
    var names = allLoggedExerciseNames();
    if (!state.progressExerciseId && names.length) state.progressExerciseId = names[0];

    var html =
      '<div class="wo-progress-select"><select id="woExSelect">' +
      '<option value="">Seleziona esercizio</option>';
    names.forEach(function (n) {
      html += '<option value="' + esc(n) + '"' + (state.progressExerciseId === n ? ' selected' : '') + '>' + esc(n) + '</option>';
    });
    html += '</select></div>';

    if (!names.length) {
      html += '<div class="wo-card wo-empty"><p>Nessun dato ancora. Salva qualche allenamento per vedere i progressi.</p></div>';
      el.innerHTML = html;
      return;
    }

    var pts = seriesForExercise(state.progressExerciseId || names[0]);
    html +=
      '<div class="wo-chart-wrap"><h3>Peso max nel tempo</h3><canvas id="woChartWeight" height="180"></canvas></div>' +
      '<div class="wo-chart-wrap"><h3>Volume (serie × rip × peso)</h3><canvas id="woChartVolume" height="180"></canvas></div>';

    var maxP = 0, maxV = 0, maxPDate = '', maxVDate = '';
    pts.forEach(function (p) {
      if (p.maxPeso >= maxP) { maxP = p.maxPeso; maxPDate = p.date; }
      if (p.volume >= maxV) { maxV = p.volume; maxVDate = p.date; }
    });
    html +=
      '<div class="wo-records">' +
      '<div class="wo-record"><div><strong>Record peso</strong><br><span>' + (maxPDate || '—') + '</span></div><strong>' + (maxP || '—') + ' kg</strong></div>' +
      '<div class="wo-record"><div><strong>Record volume</strong><br><span>' + (maxVDate || '—') + '</span></div><strong>' + (maxV || '—') + '</strong></div>' +
      '</div>';

    el.innerHTML = html;
    el.querySelector('#woExSelect').addEventListener('change', function (e) {
      state.progressExerciseId = e.target.value;
      render();
    });

    drawLineChart(document.getElementById('woChartWeight'), pts.map(function (p) { return p.maxPeso; }), pts.map(function (p) { return p.date.slice(5); }), '#3FCFA0');
    drawBarChart(document.getElementById('woChartVolume'), pts.map(function (p) { return p.volume; }), pts.map(function (p) { return p.date.slice(5); }), '#6C8CF5');
  }

  function drawLineChart(canvas, values, labels, color) {
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.parentElement.clientWidth - 28;
    var h = 180;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);
    if (!values.length) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#888';
      ctx.font = '13px sans-serif';
      ctx.fillText('Nessun dato', 12, 30);
      return;
    }
    var max = Math.max.apply(null, values.concat([1]));
    var pad = 28;
    var chartW = w - pad * 1.2;
    var chartH = h - pad * 1.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach(function (v, i) {
      var x = pad + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
      var y = pad / 2 + chartH - (v / max) * chartH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    values.forEach(function (v, i) {
      var x = pad + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
      var y = pad / 2 + chartH - (v / max) * chartH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#888';
    ctx.font = '10px sans-serif';
    if (labels.length) {
      ctx.fillText(labels[0], pad, h - 6);
      if (labels.length > 1) ctx.fillText(labels[labels.length - 1], w - pad - 24, h - 6);
    }
  }

  function drawBarChart(canvas, values, labels, color) {
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.parentElement.clientWidth - 28;
    var h = 180;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);
    if (!values.length) return;
    var max = Math.max.apply(null, values.concat([1]));
    var pad = 20;
    var n = values.length;
    var gap = 4;
    var barW = Math.max(4, (w - pad * 2 - gap * (n - 1)) / n);
    values.forEach(function (v, i) {
      var x = pad + i * (barW + gap);
      var bh = (v / max) * (h - pad * 2);
      var y = h - pad - bh;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y, barW, bh);
      ctx.globalAlpha = 1;
    });
  }

  // ---------- Modals ----------
  function openProfileModal() {
    var p = data.profile || {};
    openModal('Profilo allenamento',
      '<div class="wo-form">' +
      '<div class="wo-form-row"><label>Obiettivo</label>' +
      '<select id="woProfOb">' +
      opt('', '—', p.obiettivo) +
      opt('forza', 'Forza', p.obiettivo) +
      opt('massa', 'Massa', p.obiettivo) +
      opt('dimagrimento', 'Dimagrimento', p.obiettivo) +
      opt('resistenza', 'Resistenza', p.obiettivo) +
      '</select></div>' +
      '<div class="wo-form-row"><label>Livello</label>' +
      '<select id="woProfLiv">' +
      opt('', '—', p.livello) +
      opt('principiante', 'Principiante', p.livello) +
      opt('intermedio', 'Intermedio', p.livello) +
      opt('avanzato', 'Avanzato', p.livello) +
      '</select></div>' +
      '<div class="wo-form-row"><label>Attrezzatura</label>' +
      '<select id="woProfAtt">' +
      opt('', '—', p.attrezzatura) +
      opt('palestra', 'Palestra', p.attrezzatura) +
      opt('casa', 'Casa', p.attrezzatura) +
      opt('manubri', 'Manubri', p.attrezzatura) +
      '</select></div>' +
      '<div class="wo-form-row"><label>Giorni disponibili / settimana</label>' +
      '<input type="number" id="woProfDays" inputmode="numeric" min="1" max="7" value="' + esc(String(p.giorniDisponibili || '')) + '" /></div>' +
      '<div class="wo-form-row"><label>API key Groq (solo locale)</label>' +
      '<input type="password" id="woProfKey" placeholder="gsk_…" value="' + esc(getGroqKey()) + '" autocomplete="off" /></div>' +
      '</div>',
      function (box) {
        data.profile = {
          obiettivo: box.querySelector('#woProfOb').value,
          livello: box.querySelector('#woProfLiv').value,
          attrezzatura: box.querySelector('#woProfAtt').value,
          giorniDisponibili: box.querySelector('#woProfDays').value ? Number(box.querySelector('#woProfDays').value) : null
        };
        setGroqKey(box.querySelector('#woProfKey').value.trim());
        save().then(function () {
          closeModal();
          render();
        });
      }
    );
  }

  function opt(val, label, current) {
    return '<option value="' + esc(val) + '"' + (current === val ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function openScheduleModal(existing) {
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: uid('sch'),
      nome: '',
      attiva: true,
      createdAt: new Date().toISOString(),
      esercizi: [{ exerciseId: '', nome: '', serieTarget: 3, ripTarget: 10, riposoSec: 90, pesoTarget: '' }]
    };

    function renderBody() {
      var h =
        '<div class="wo-form">' +
        '<div class="wo-form-row"><label>Nome scheda</label>' +
        '<input type="text" id="woSchNome" value="' + esc(draft.nome || '') + '" placeholder="Es. Petto + Tricipiti" /></div>' +
        '<div class="wo-form-row"><label>Esercizi</label><div id="woSchExList">';
      (draft.esercizi || []).forEach(function (ex, i) {
        h +=
          '<div class="wo-form-ex" data-i="' + i + '">' +
          '<div class="wo-form-ex-top">' +
          '<input type="text" class="wo-sch-nome" value="' + esc(ex.nome || '') + '" placeholder="Nome esercizio" />' +
          '<button type="button" class="wo-btn wo-btn-ghost wo-sch-del" data-i="' + i + '">✕</button>' +
          '</div>' +
          '<div class="wo-form-ex-grid">' +
          '<input type="number" class="wo-sch-serie" inputmode="numeric" placeholder="Serie" value="' + esc(String(ex.serieTarget != null ? ex.serieTarget : '')) + '" />' +
          '<input type="number" class="wo-sch-rip" inputmode="numeric" placeholder="Reps" value="' + esc(String(ex.ripTarget != null ? ex.ripTarget : '')) + '" />' +
          '<input type="number" class="wo-sch-peso" inputmode="decimal" step="0.5" placeholder="Kg target" value="' + esc(String(ex.pesoTarget != null ? ex.pesoTarget : '')) + '" />' +
          '</div>' +
          '<div style="margin-top:6px;"><input type="number" class="wo-sch-riposo" inputmode="numeric" placeholder="Riposo sec" value="' + esc(String(ex.riposoSec != null ? ex.riposoSec : '')) + '" /></div>' +
          '</div>';
      });
      h += '</div><button type="button" class="wo-btn wo-btn-ghost" id="woSchAdd">+ esercizio</button></div></div>';
      return h;
    }

    function readDraft(box) {
      draft.nome = (box.querySelector('#woSchNome') || {}).value || '';
      var list = [];
      box.querySelectorAll('.wo-form-ex').forEach(function (row) {
        list.push({
          exerciseId: '',
          nome: (row.querySelector('.wo-sch-nome') || {}).value || '',
          serieTarget: (row.querySelector('.wo-sch-serie') || {}).value || '',
          ripTarget: (row.querySelector('.wo-sch-rip') || {}).value || '',
          pesoTarget: (row.querySelector('.wo-sch-peso') || {}).value || '',
          riposoSec: (row.querySelector('.wo-sch-riposo') || {}).value || ''
        });
      });
      draft.esercizi = list;
    }

    function bind(box) {
      box.querySelector('#woSchAdd').onclick = function () {
        readDraft(box);
        draft.esercizi.push({ exerciseId: '', nome: '', serieTarget: 3, ripTarget: 10, riposoSec: 90, pesoTarget: '' });
        box.querySelector('.wo-modal-body').innerHTML = renderBody();
        bind(box);
      };
      box.querySelectorAll('.wo-sch-del').forEach(function (btn) {
        btn.onclick = function () {
          readDraft(box);
          var i = Number(btn.getAttribute('data-i'));
          draft.esercizi.splice(i, 1);
          if (!draft.esercizi.length) {
            draft.esercizi.push({ exerciseId: '', nome: '', serieTarget: 3, ripTarget: 10, riposoSec: 90, pesoTarget: '' });
          }
          box.querySelector('.wo-modal-body').innerHTML = renderBody();
          bind(box);
        };
      });
    }

    openModal(existing ? 'Modifica scheda' : 'Nuova scheda', renderBody(), function (box) {
      readDraft(box);
      draft.nome = (draft.nome || '').trim() || 'Scheda';
      draft.esercizi = draft.esercizi.filter(function (e) { return (e.nome || '').trim(); }).map(function (e) {
        var linked = ensureExercise(e.nome);
        return {
          exerciseId: linked.id,
          nome: linked.nome,
          serieTarget: e.serieTarget !== '' ? Number(e.serieTarget) : null,
          ripTarget: e.ripTarget !== '' ? Number(e.ripTarget) : null,
          riposoSec: e.riposoSec !== '' ? Number(e.riposoSec) : null,
          pesoTarget: e.pesoTarget !== '' && e.pesoTarget != null ? Number(e.pesoTarget) : null
        };
      });
      if (!draft.esercizi.length) {
        showToast('Aggiungi almeno un esercizio', 'error');
        return;
      }
      data.schedules = data.schedules || [];
      draft.attiva = true;
      data.schedules.forEach(function (s) { if (s.id !== draft.id) s.attiva = false; });
      var idx = data.schedules.findIndex(function (s) { return s.id === draft.id; });
      if (idx >= 0) data.schedules[idx] = draft;
      else data.schedules.push(draft);
      state.session = null;
      save().then(function () {
        closeModal();
        state.tab = 'oggi';
        render();
      });
    }, function (box) {
      bind(box);
    });
  }

  var modalEl = null;
  function openModal(title, bodyHtml, onSave, onReady) {
    closeModal();
    modalEl = document.createElement('div');
    modalEl.className = 'wo-modal-overlay';
    modalEl.innerHTML =
      '<div class="wo-modal">' +
      '<h2>' + esc(title) + '</h2>' +
      '<div class="wo-modal-body">' + bodyHtml + '</div>' +
      '<div class="wo-modal-actions">' +
      '<button type="button" class="wo-btn wo-btn-primary" id="woModalSave">Salva</button>' +
      '<button type="button" class="wo-btn" id="woModalCancel">Annulla</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) closeModal();
    });
    modalEl.querySelector('#woModalCancel').addEventListener('click', closeModal);
    modalEl.querySelector('#woModalSave').addEventListener('click', function () {
      onSave(modalEl);
    });
    if (onReady) onReady(modalEl);
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  // ---------- Firebase ----------
  function startForUser(uid) {
    stop();
    currentUid = uid;
    if (!window.db) return;
    docRef = window.db.collection('users').doc(uid).collection('modules').doc('workouts');
    unsub = docRef.onSnapshot(function (snap) {
      if (snap.exists) {
        data = Object.assign(defaultData(), snap.data());
        if (!Array.isArray(data.schedules)) data.schedules = [];
        if (!Array.isArray(data.workoutLogs)) data.workoutLogs = [];
        if (!Array.isArray(data.exercises)) data.exercises = [];
      } else {
        data = defaultData();
        docRef.set(data).catch(function (err) { console.error(err); });
      }
      ready = true;
      var page = document.getElementById('page-workouts');
      if (page && page.style.display !== 'none') render();
    }, function (err) {
      console.error('Lettura workouts:', err);
      showToast('Errore lettura Allenamenti', 'error');
    });
  }

  function stop() {
    if (unsub) { unsub(); unsub = null; }
    docRef = null;
    currentUid = null;
    ready = false;
  }

  window.Workouts = {
    onShow: function () {
      if (!document.getElementById('page-workouts')) return;
      if (window.currentUser && window.currentUser.uid !== currentUid) {
        startForUser(window.currentUser.uid);
      }
      render();
    }
  };

  window.addEventListener('app:authReady', function (e) {
    if (e.detail && e.detail.uid) startForUser(e.detail.uid);
  });
  window.addEventListener('app:authLoggedOut', function () {
    stop();
    data = defaultData();
  });
  if (window.currentUser) startForUser(window.currentUser.uid);
})();
