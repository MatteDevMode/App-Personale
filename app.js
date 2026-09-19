const root = document.documentElement;
    const toggle = document.getElementById('themeToggle');
    const themeLabel = document.getElementById('themeLabel');
    const themeIcon = document.getElementById('themeIcon');

    const sunPath = '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4.5"/>';
    const moonPath = '<path d="M21 12.5A8.5 8.5 0 1111.5 3 7 7 0 0021 12.5z"/>';

    function applyTheme(theme) {
      root.setAttribute('data-theme', theme);
      themeLabel.textContent = theme === 'dark' ? 'Tema scuro' : 'Tema chiaro';
      themeIcon.innerHTML = theme === 'dark' ? moonPath : sunPath;
    }

    let saved = 'dark';
    try {
      saved = localStorage.getItem('app-personale-theme') || 'dark';
    } catch (e) {}
    applyTheme(saved);

    toggle.addEventListener('click', () => {
      const current = root.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('app-personale-theme', next); } catch (e) {}
    });

    function switchPage(page) {
      document.getElementById('page-home').style.display = page === 'home' ? 'block' : 'none';
      document.getElementById('page-todo').style.display = page === 'todo' ? 'block' : 'none';
      document.querySelectorAll('.nav-item[data-target]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-target') === page);
      });
      try { localStorage.setItem('app-personale-page', page); } catch (e) {}
      if (page === 'todo' && window.Todo) window.Todo.onShow();
    }

    let startPage = 'todo';
    try { startPage = localStorage.getItem('app-personale-page') || 'todo'; } catch (e) {}
    switchPage(startPage);
