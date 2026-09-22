(function () {
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function errorMessage(code) {
    const map = {
      'auth/invalid-email': 'Email non valida.',
      'auth/user-not-found': 'Nessun account con questa email.',
      'auth/wrong-password': 'Password sbagliata.',
      'auth/invalid-credential': 'Email o password sbagliati.',
      'auth/email-already-in-use': 'Esiste già un account con questa email.',
      'auth/weak-password': 'La password deve avere almeno 6 caratteri.',
      'auth/too-many-requests': 'Troppi tentativi. Riprova tra qualche minuto.',
      'auth/network-request-failed': 'Problema di connessione. Controlla la rete.'
    };
    return map[code] || 'Qualcosa è andato storto. Riprova.';
  }

  function renderAuthGate() {
    const gate = document.getElementById('authGate');
    let mode = 'login';

    function draw() {
      gate.innerHTML =
        '<div class="auth-card">' +
          '<div class="auth-logo">' +
            '<div class="brand-mark" style="width:40px;height:40px;">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z"/></svg>' +
            '</div>' +
          '</div>' +
          '<div class="auth-tabs">' +
            '<button class="auth-tab' + (mode === 'login' ? ' active' : '') + '" id="tabLogin">Accedi</button>' +
            '<button class="auth-tab' + (mode === 'register' ? ' active' : '') + '" id="tabRegister">Registrati</button>' +
          '</div>' +
          '<label class="field-label">Email</label>' +
          '<input type="email" id="authEmail" autocomplete="email" />' +
          '<label class="field-label">Password</label>' +
          '<input type="password" id="authPassword" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '" />' +
          '<p class="auth-error" id="authError" style="display:none;"></p>' +
          '<button class="btn btn-primary" id="authSubmit" style="width:100%;margin-top:14px;">' + (mode === 'login' ? 'Accedi' : 'Crea account') + '</button>' +
        '</div>';

      document.getElementById('tabLogin').onclick = () => { mode = 'login'; draw(); };
      document.getElementById('tabRegister').onclick = () => { mode = 'register'; draw(); };

      const submit = document.getElementById('authSubmit');
      const errEl = document.getElementById('authError');

      function showError(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }

      submit.onclick = () => {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        if (!email || !password) { showError('Inserisci email e password.'); return; }
        errEl.style.display = 'none';
        submit.disabled = true;
        submit.textContent = mode === 'login' ? 'Accesso...' : 'Creazione...';

        const done = () => { submit.disabled = false; submit.textContent = mode === 'login' ? 'Accedi' : 'Crea account'; };

        if (mode === 'login') {
          window.auth.signInWithEmailAndPassword(email, password).catch(err => { showError(errorMessage(err.code)); done(); });
        } else {
          window.auth.createUserWithEmailAndPassword(email, password).catch(err => { showError(errorMessage(err.code)); done(); });
        }
      };

      document.getElementById('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submit.click(); });
    }

    draw();
  }

  function showGate() {
    document.getElementById('authGate').style.display = 'flex';
    document.getElementById('appShell').style.display = 'none';
  }
  function showApp() {
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';
  }

  function init() {
    renderAuthGate();
    window.auth.onAuthStateChanged(user => {
      if (user) { window.currentUser = user; showApp(); }
      else { window.currentUser = null; showGate(); }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => window.auth.signOut());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
