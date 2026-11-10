// utils.js - Funzioni condivise da tutti i moduli
(function () {
    // ---------- Stringhe e sicurezza ----------
    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function uid(prefix) {
        return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // ---------- Date ----------
    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatDate(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function todayStr() {
        return formatDate(new Date());
    }

    function parseDateStr(s) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function addDaysToDate(dateStr, n) {
        const d = parseDateStr(dateStr);
        d.setDate(d.getDate() + n);
        return formatDate(d);
    }

    function addDaysToToday(n) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + n);
        return formatDate(d);
    }

    // ---------- UI helpers ----------
    function showToast(message, type) {
        type = type || 'info';
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      border-radius: 8px;
      background: ${type === 'error' ? '#e53e3e' : type === 'success' ? '#38a169' : '#4a5568'};
      color: white;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: toastSlideIn 0.3s ease;
    `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastSlideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Aggiungi animazioni CSS per il toast
    const style = document.createElement('style');
    style.textContent = `
    @keyframes toastSlideIn {
      from { transform: translateX(-50%) translateY(100px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    @keyframes toastSlideOut {
      from { transform: translateX(-50%) translateY(0); opacity: 1; }
      to { transform: translateX(-50%) translateY(100px); opacity: 0; }
    }
  `;
    document.head.appendChild(style);

    // ---------- Export ----------
    window.Utils = {
        esc: esc,
        uid: uid,
        pad2: pad2,
        formatDate: formatDate,
        todayStr: todayStr,
        parseDateStr: parseDateStr,
        addDaysToDate: addDaysToDate,
        addDaysToToday: addDaysToToday,
        showToast: showToast
    };
})();