(function () {
    const FORMAT = 'app-personale';
    const MODULES = ['todo', 'diario', 'finanze'];
    const REQUIRED = {
        todo: ['tasks', 'categories'],
        diario: ['entries'],
        finanze: ['accounts', 'categories', 'transactions', 'items']
    };

    function pad2(n) { return String(n).padStart(2, '0'); }
    function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    function modulesRef() {
        const u = window.currentUser;
        return u ? window.db.collection('users').doc(u.uid).collection('modules') : null;
    }

    function download(filename, text) {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---------- Esporta ----------
    async function exportData() {
        const ref = modulesRef();
        if (!ref) return;
        try {
            const modules = {};
            for (const name of MODULES) {
                const snap = await ref.doc(name).get();
                if (snap.exists) modules[name] = snap.data();
            }
            const backup = { app: FORMAT, version: 1, exportedAt: new Date().toISOString(), modules };
            download('backup-app-personale-' + todayStr() + '.json', JSON.stringify(backup, null, 2));
        } catch (err) {
            console.error('Errore esportazione:', err);
            alert('Esportazione non riuscita: ' + err.message);
        }
    }

    // ---------- Ripristina ----------
    function validate(obj) {
        if (!obj || obj.app !== FORMAT || !obj.modules) throw new Error('Il file non è un backup di questa app.');
        const valid = {};
        MODULES.forEach(name => {
            const m = obj.modules[name];
            if (m && REQUIRED[name].every(k => Array.isArray(m[k]))) valid[name] = m;
        });
        if (!Object.keys(valid).length) throw new Error('Il backup non contiene dati utilizzabili.');
        return valid;
    }

    function summary(valid) {
        const parts = [];
        if (valid.todo) parts.push(valid.todo.tasks.length + ' attività');
        if (valid.diario) parts.push(valid.diario.entries.length + ' voci di diario');
        if (valid.finanze) parts.push(valid.finanze.transactions.length + ' movimenti');
        return parts.join(', ');
    }

    async function restoreFromFile(file) {
        const ref = modulesRef();
        if (!ref || !file) return;

        let valid;
        try {
            valid = validate(JSON.parse(await file.text()));
        } catch (err) {
            alert(err instanceof SyntaxError ? 'File non valido.' : err.message);
            return;
        }

        const ok = confirm('Ripristinare il backup (' + summary(valid) + ')?\n\n' +
            'I dati attuali di questi moduli verranno sovrascritti. Se non l\u2019hai già fatto, esporta prima un backup.');
        if (!ok) return;

        try {
            const batch = window.db.batch();
            Object.keys(valid).forEach(name => batch.set(ref.doc(name), valid[name]));
            await batch.commit();
            alert('Backup ripristinato.');
        } catch (err) {
            console.error('Errore ripristino:', err);
            alert('Ripristino non riuscito: ' + err.message);
        }
    }

    // ---------- Interfaccia ----------
    function makeButton(id, label, iconPath) {
        const b = document.createElement('button');
        b.className = 'theme-toggle';
        b.id = id;
        b.title = label;
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + iconPath + '</svg><span>' + label + '</span>';
        return b;
    }

    function addButtons() {
        const footer = document.querySelector('.sidebar-footer');
        const logout = document.getElementById('logoutBtn');
        if (!footer || !logout || document.getElementById('exportBtn')) return;

        const exportBtn = makeButton('exportBtn', 'Esporta dati', '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>');
        const importBtn = makeButton('importBtn', 'Ripristina', '<path d="M12 16V5M7 9l5-5 5 5"/><path d="M5 20h14"/>');

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files[0];
            input.value = '';
            restoreFromFile(file);
        });

        exportBtn.addEventListener('click', exportData);
        importBtn.addEventListener('click', () => input.click());

        footer.insertBefore(exportBtn, logout);
        footer.insertBefore(importBtn, logout);
        footer.appendChild(input);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons);
    else addButtons();
})();