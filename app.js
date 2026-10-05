/* רשימת לידה: הלוגיקה של האפליקציה.
   הכל נשמר במכשיר עצמו: localStorage הוא המקור, ו-IndexedDB מחזיק עותק שני לביטחון. */
(function () {
    'use strict';

    const APP_VERSION = '1.0.0';
    const STORE_KEY = 'shuli.state';
    const PREV_KEY = 'shuli.state.prev';
    const DAY = 86400000;
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // --- Categorization Configuration ---
    const STATUSES = {
        need: { icon: '🛒', label: 'צריך לקנות', short: 'לקנות', done: 'קניתי' },
        ordered: { icon: '📦', label: 'הוזמן / בדרך', short: 'בדרך', done: 'הגיע' },
        have: { icon: '✅', label: 'יש!', short: 'יש' },
        gift: { icon: '🎁', label: 'לבקש מתנה', short: 'מתנה', done: 'קיבלנו' },
        maybe: { icon: '🤔', label: 'מתלבטת', short: 'מתלבטת' }
    };
    const STATUS_KEYS = ['need', 'ordered', 'have', 'gift', 'maybe'];

    const LISTS = {
        home: {
            title: 'ציוד לבית', icon: '🏠',
            cats: {
                bath: { icon: '🛁', title: 'אמבטיה וטיפוח' },
                sleep: { icon: '🛏️', title: 'ריהוט ושינה' },
                cloth: { icon: '👕', title: 'טקסטיל וביגוד' },
                feed: { icon: '🍼', title: 'האכלה והרגעה' },
                diaper: { icon: '🧴', title: 'החתלה ופארם' },
                travel: { icon: '🚗', title: 'נסיעות וטיולים' },
                mom: { icon: '👩', title: 'ציוד ליולדת' },
                toys: { icon: '🧸', title: 'התפתחות וצעצועים' }
            }
        },
        bag: {
            title: 'תיק לידה', icon: '🏥',
            cats: {
                delivery: { icon: '👜', title: 'תיק לחדר לידה', hint: 'איתי בלידה' },
                trolley: { icon: '🧳', title: 'טרולי למחלקה', hint: 'לאחרי הלידה' },
                diaper_bag: { icon: '👶', title: 'תיק החתלה', hint: 'לתינוק וליציאה' },
                other: { icon: '🚙', title: 'לרכב / שונות' }
            }
        }
    };
    const LIST_KEYS = ['home', 'bag'];
    const TABS = ['home', 'bag', 'dash', 'settings'];

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

    const env = (function () {
        const ua = navigator.userAgent || '';
        const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const android = /Android/.test(ua);
        const standalone = navigator.standalone === true
            || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        return { ios, android, mobile: ios || android, standalone };
    })();

    let state = null;
    const ui = { tab: 'home', q: '', qn: '', filter: 'all', open: new Set(), pick: 'need', scroll: {}, lastPct: 0, installEvt: null };

    // ---------- כלים קטנים ----------
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : (typeof v === 'number' ? String(v) : ''); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

    /** קורא מספר שהוקלד: "12.5", "12,5" (פסיק עשרוני) וגם "1,250" (מפריד אלפים). */
    function parseNum(v) {
        let s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
        if (/^\d*,\d{1,2}$/.test(s)) s = s.replace(',', '.');
        else s = s.replace(/,/g, '');
        const n = parseFloat(s);
        return Number.isFinite(n) && n >= 0 ? Math.min(n, 9999999) : null;
    }
    function parseQty(v) {
        const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n >= 1 ? Math.min(n, 9999) : null;
    }
    function numStr(n) { return n == null ? '' : String(round2(n)); }
    function money(n) {
        const v = round2(n || 0);
        return '₪' + v.toLocaleString('he-IL', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
    }
    function moneyHtml(n) { return '<bdi class="money">' + money(n) + '</bdi>'; }
    function norm(s) {
        return String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/["'״׳`]/g, '').replace(/\s+/g, ' ').trim();
    }

    // ---------- הוצאות ----------
    const qtyOf = it => it.qty || 1;
    const plannedOf = it => (it.unit == null ? 0 : round2(qtyOf(it) * it.unit));
    const isBought = it => it.status === 'have' || it.status === 'ordered';
    /** מה שיצא מהכיס: המחיר ששולם בפועל, ואם לא הוזן אז הסה״כ המתוכנן. */
    const spentOf = it => (isBought(it) ? (it.paid != null ? it.paid : plannedOf(it)) : 0);
    const isPacked = it => it.status === 'have' && it.packed === true;

    // ---------- תאריכים ----------
    function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function daysUntil(dateStr, now) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        if (!m) return null;
        const t = now || new Date();
        return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / DAY);
    }
    function heItems(n) { return n === 1 ? 'פריט אחד' : n + ' פריטים'; }
    function heDays(n) { return n === 1 ? 'יום' : n === 2 ? 'יומיים' : n + ' ימים'; }
    function heWeeks(n) { return n === 1 ? 'שבוע' : n === 2 ? 'שבועיים' : n + ' שבועות'; }
    function countdownText(d) {
        if (d == null) return '';
        if (d === 0) return 'היום התאריך המשוער!';
        if (d === 1) return 'מחר התאריך המשוער!';
        if (d === -1) return 'התאריך המשוער היה אתמול';
        if (d < 0) return 'התאריך המשוער עבר לפני ' + heDays(-d);
        const w = Math.floor(d / 7), r = d % 7;
        if (w === 0) return 'עוד ' + heDays(r);
        if (r === 0) return 'עוד ' + heWeeks(w);
        return 'עוד ' + heWeeks(w) + ' ו' + (r <= 2 ? heDays(r) : '-' + heDays(r));
    }
    /** שבוע ההריון לפי התאריך המשוער (40 שבועות), למשל "31+2" או "30". */
    function pregnancyWeek(d) {
        if (d == null) return '';
        const ga = 280 - d;
        return ga < 0 || ga > 300 ? '' : Math.floor(ga / 7) + (ga % 7 ? '+' + ga % 7 : '');
    }
    function fmtDate(ts) {
        try { return new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }); }
        catch (e) { return new Date(ts).toDateString(); }
    }
    function fmtDue(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        return m ? fmtDate(new Date(+m[1], +m[2] - 1, +m[3]).getTime()) : '';
    }

    // ---------- מצב: יצירה, ניקוי, טעינה ושמירה ----------
    function makeItem(o) {
        return Object.assign({ id: uid(), list: 'home', cat: 'bath', name: '', status: 'need', notes: '', qty: null, unit: null, paid: null, store: '', packed: false }, o);
    }
    function seedItems() {
        const seed = window.SHULI_SEED || {};
        const out = [];
        [['home', 'h'], ['bag', 'b']].forEach(pair => {
            (seed[pair[0]] || []).forEach((r, i) => out.push(makeItem({
                id: pair[1] + (i + 1), list: pair[0], cat: r[0], name: r[1], status: r[2], notes: r[3] || '', qty: r[4] || null
            })));
        });
        return out;
    }
    function freshState() {
        const now = Date.now();
        return {
            v: 1, items: seedItems(),
            settings: { title: '', dueDate: '', budget: null, collapsed: {}, lastBackupAt: null, welcomed: false, installDismissedAt: null },
            meta: { createdAt: now, updatedAt: now }
        };
    }

    /** מקבל כל דבר (קובץ גיבוי, נתונים ישנים) ומחזיר מצב תקין, או null אם זה לא נתונים של הרשימה. */
    function normalizeState(raw) {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
        const cleanNum = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 9999999) : null);
        const seen = new Set();
        const items = [];
        raw.items.forEach(r => {
            if (!r || typeof r !== 'object') return;
            const name = str(r.name, 200).trim();
            if (!name) return;
            let cat = typeof r.cat === 'string' ? r.cat : '';
            let list = r.list === 'bag' || r.list === 'home' ? r.list : (LISTS.bag.cats[cat] ? 'bag' : 'home');
            if (!LISTS[list].cats[cat]) {
                const other = list === 'home' ? 'bag' : 'home';
                if (LISTS[other].cats[cat]) list = other; else cat = Object.keys(LISTS[list].cats)[0];
            }
            let id = str(r.id, 60) || uid();
            while (seen.has(id)) id = uid();
            seen.add(id);
            const qty = typeof r.qty === 'number' && Number.isFinite(r.qty) && r.qty >= 1 ? Math.min(Math.floor(r.qty), 9999) : null;
            items.push({
                id, list, cat, name,
                status: STATUSES[r.status] ? r.status : 'need',
                notes: str(r.notes, 2000), qty, unit: cleanNum(r.unit), paid: cleanNum(r.paid),
                store: str(r.store, 80).trim(), packed: r.packed === true
            });
        });
        const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
        const m = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
        const ts = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
        const collapsed = {};
        if (s.collapsed && typeof s.collapsed === 'object') {
            Object.keys(s.collapsed).forEach(k => { if (s.collapsed[k] === true && (LISTS.home.cats[k] || LISTS.bag.cats[k])) collapsed[k] = true; });
        }
        const now = Date.now();
        return {
            v: 1, items,
            settings: {
                title: str(s.title, 30),
                dueDate: /^\d{4}-\d{2}-\d{2}$/.test(s.dueDate || '') ? s.dueDate : '',
                budget: cleanNum(s.budget) || null,
                collapsed,
                lastBackupAt: ts(s.lastBackupAt),
                welcomed: s.welcomed === true,
                installDismissedAt: ts(s.installDismissedAt)
            },
            meta: { createdAt: ts(m.createdAt) || now, updatedAt: ts(m.updatedAt) || now }
        };
    }

    function idbOpen() {
        return new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open('shuli', 1); } catch (e) { reject(e); return; }
            req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('blocked'));
        });
    }
    function idbGet(key) {
        return idbOpen().then(db => new Promise((resolve, reject) => {
            const rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
            rq.onsuccess = () => { resolve(rq.result); db.close(); };
            rq.onerror = () => { reject(rq.error); db.close(); };
        }));
    }
    function idbSet(key, val) {
        return idbOpen().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(val, key);
            tx.oncomplete = () => { resolve(); db.close(); };
            tx.onerror = tx.onabort = () => { reject(tx.error); db.close(); };
        }));
    }
    function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    }

    function readLocal() {
        let raw = null;
        try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
        if (raw == null) return null;
        try {
            const s = normalizeState(JSON.parse(raw));
            if (s) return s;
        } catch (e) { /* נופלים לשמירת העותק הפגום */ }
        // לא דורסים נתונים שלא הצלחנו לקרוא: שומרים אותם בצד.
        try { localStorage.setItem(STORE_KEY + '.unreadable.' + Date.now(), raw); } catch (e) { /* אין מקום */ }
        return null;
    }

    let mirrorTimer = null, mirrorJson = null, warnedStorage = false;
    function flushMirror() {
        clearTimeout(mirrorTimer); mirrorTimer = null;
        if (mirrorJson == null) return;
        const json = mirrorJson; mirrorJson = null;
        idbSet('state', json).catch(() => { /* מצב פרטי או דפדפן בלי IndexedDB */ });
    }
    function persist() {
        const json = JSON.stringify(state);
        let ok = true;
        try { localStorage.setItem(STORE_KEY, json); } catch (e) { ok = false; }
        mirrorJson = json;
        clearTimeout(mirrorTimer);
        mirrorTimer = setTimeout(flushMirror, 350);
        if (!ok && !warnedStorage) {
            warnedStorage = true;
            toast('לא הצלחתי לשמור במכשיר. כדאי לשמור גיבוי מההגדרות.', { ms: 9000 });
        }
        return ok;
    }
    function commit(opts) {
        state.meta.updatedAt = Date.now();
        persist();
        if (opts && opts.saved) flashSaved();
    }

    const byId = id => state.items.find(i => i.id === id);
    const rowEl = id => $$('#list .item').find(a => a.dataset.id === id);
    const catEl = ck => $$('#list .cat').find(a => a.dataset.cat === ck);

    // ---------- כותרת והודעות ----------
    function renderHeader() {
        const title = state.settings.title.trim();
        $('#appTitle').innerHTML = title ? 'רשימת לידה <span class="sep">|</span> ' + esc(title) : 'רשימת לידה';
        document.title = title ? 'רשימת לידה | ' + title : 'רשימת לידה';
        const d = daysUntil(state.settings.dueDate);
        $('#heroSub').textContent = d == null ? 'שולי עוזרת להתארגן 🐾' : countdownText(d);
    }

    const IOS_SHARE = '<svg class="ios-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="שיתוף"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>';

    function installSteps() {
        return '<ol><li>לוחצים על כפתור השיתוף ' + IOS_SHARE + ' בסרגל של Safari</li>'
            + '<li>גוללים ובוחרים <b>״הוסף למסך הבית״</b></li>'
            + '<li>פותחים מהאייקון החדש, וממלאים שם</li></ol>';
    }
    function installHtml() {
        if (env.ios) {
            return '<section class="notice" data-notice="install"><h2>📲 קודם כל: להוסיף למסך הבית</h2>'
                + '<p>ככה זה נפתח כמו אפליקציה, והנתונים נשמרים לאורך זמן.</p>' + installSteps()
                + '<p class="notice-note">מה שממלאים כאן בדפדפן לא עובר לאפליקציה שבמסך הבית, אז עדיף להתקין לפני שמתחילים למלא. בנוסף, Safari עלול למחוק נתונים של אתר שלא נפתח שבוע; באפליקציה שבמסך הבית זה לא קורה.</p>'
                + '<div class="notice-row"><button type="button" class="btn btn-soft btn-sm" data-action="install-later">אחר כך</button></div></section>';
        }
        return '<section class="notice" data-notice="install"><h2>📲 אפשר להתקין כאפליקציה</h2>'
            + '<p>נפתח במסך מלא מהאייקון, ועובד גם בלי אינטרנט.</p>'
            + '<div class="notice-row"><button type="button" class="btn btn-primary btn-sm" data-action="install-now">התקנה</button>'
            + '<button type="button" class="btn btn-soft btn-sm" data-action="install-later">אחר כך</button></div></section>';
    }
    function welcomeHtml() {
        const s = state.settings;
        return '<section class="notice welcome" data-notice="welcome">'
            + '<div class="welcome-top">' + window.Shuli.full() + '<div><h2>היי, אני שולי!</h2><p>הרשימה כבר מוכנה. שני פרטים קטנים ומתחילים (לא חובה):</p></div></div>'
            + '<div class="welcome-fields">'
            + '<label class="f"><span>שם לכותרת</span><input id="wTitle" type="text" maxlength="30" autocomplete="off" placeholder="למשל שם התינוק/ת" value="' + esc(s.title) + '"></label>'
            + '<label class="f"><span>תאריך לידה משוער</span><input id="wDue" type="date" value="' + esc(s.dueDate) + '"></label>'
            + '</div><div class="notice-row"><button type="button" class="btn btn-primary" data-action="welcome-done">יאללה, מתחילים</button></div></section>';
    }
    function renderNotices() {
        const s = state.settings;
        const dismissed = s.installDismissedAt && Date.now() - s.installDismissedAt < 3 * DAY;
        let html = '';
        if (!env.standalone && !dismissed && (env.ios || ui.installEvt)) html = installHtml();
        else if (!s.welcomed) html = welcomeHtml();
        $('#notices').innerHTML = html;
    }

    // ---------- רשימות ----------
    function matches(it) {
        if (ui.filter === 'topack') { if (it.status !== 'have' || it.packed) return false; }
        else if (ui.filter !== 'all' && it.status !== ui.filter) return false;
        return !ui.qn || norm(it.name + ' ' + it.notes + ' ' + it.store).indexOf(ui.qn) !== -1;
    }
    const isFiltering = () => ui.filter !== 'all' || !!ui.qn;

    function renderChips() {
        const items = state.items.filter(i => i.list === ui.tab);
        const counts = { all: items.length };
        STATUS_KEYS.forEach(k => { counts[k] = 0; });
        items.forEach(i => { counts[i.status]++; });
        const chip = (key, label, n) => '<button type="button" class="chip' + (ui.filter === key ? ' is-on' : '') + '" data-filter="' + key + '" aria-pressed="' + (ui.filter === key) + '">' + label + '<b>' + n + '</b></button>';
        let html = chip('all', 'הכל', counts.all);
        STATUS_KEYS.forEach(k => { html += chip(k, STATUSES[k].icon + ' ' + STATUSES[k].short, counts[k]); });
        if (ui.tab === 'bag') html += chip('topack', '🧳 נשאר לארוז', items.filter(i => i.status === 'have' && !i.packed).length);
        $('#chips').innerHTML = html;
    }

    function catStats(all) {
        const st = { total: all.length, have: 0, maybe: 0, packed: 0 };
        all.forEach(i => { if (i.status === 'have') st.have++; if (i.status === 'maybe') st.maybe++; if (isPacked(i)) st.packed++; });
        st.mandatory = st.total - st.maybe;
        st.pct = st.mandatory ? Math.round(st.have / st.mandatory * 100) : 0;
        return st;
    }
    function catMetaHtml(listKey, st) {
        return '<span class="pill" title="יש מתוך מה שצריך">✓ ' + st.have + '/' + st.mandatory + '</span>'
            + (listKey === 'bag' ? '<span class="pill" title="ארוזים">🧳 ' + st.packed + '</span>' : '');
    }

    function nameHtml(it) {
        return '<span class="tw" aria-hidden="true"></span>' + esc(it.name) + (it.qty > 1 ? '<span class="qty">×' + it.qty + '</span>' : '');
    }
    function subHtml(it) {
        const bits = [];
        if (isBought(it)) { if (it.paid != null || it.unit != null) bits.push('<span class="sub-cost">שולם ' + moneyHtml(spentOf(it)) + '</span>'); }
        else if (it.unit != null) bits.push('<span class="sub-cost">' + moneyHtml(plannedOf(it)) + '</span>');
        if (it.store) bits.push('<span>' + esc(it.store) + '</span>');
        if (it.notes.trim()) bits.push('<span>' + esc(it.notes.trim().split('\n')[0]) + '</span>');
        return bits.join('<span class="dot" aria-hidden="true">·</span>');
    }
    function statusControl(it) {
        const st = STATUSES[it.status];
        return '<label class="status" data-status="' + it.status + '"><span aria-hidden="true">' + st.icon + ' ' + st.short + '</span>'
            + '<select data-action="status" aria-label="סטטוס: ' + esc(it.name) + '">'
            + STATUS_KEYS.map(k => '<option value="' + k + '"' + (k === it.status ? ' selected' : '') + '>' + STATUSES[k].icon + ' ' + STATUSES[k].label + '</option>').join('')
            + '</select></label>';
    }
    function packControl(it) {
        if (it.list !== 'bag' || it.status !== 'have') return '';
        return '<label class="pack' + (it.packed ? ' is-on' : '') + '"><input type="checkbox" data-action="pack"' + (it.packed ? ' checked' : '')
            + ' aria-label="ארוז בתיק: ' + esc(it.name) + '"><span aria-hidden="true">' + (it.packed ? 'ארוז' : 'לארוז') + '</span></label>';
    }
    function field(label, control, cls, attrs) {
        return '<label class="f' + (cls ? ' ' + cls : '') + '"' + (attrs || '') + '><span>' + label + '</span>' + control + '</label>';
    }
    function moneyInput(name, value, placeholder) {
        return '<span class="money-in"><input data-field="' + name + '" type="text" inputmode="decimal" dir="ltr" maxlength="10" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '"><i aria-hidden="true">₪</i></span>';
    }
    function catOptions(it) {
        return LIST_KEYS.map(lk => '<optgroup label="' + esc(LISTS[lk].title) + '">'
            + Object.keys(LISTS[lk].cats).map(ck => '<option value="' + ck + '"' + (ck === it.cat ? ' selected' : '') + '>' + esc(LISTS[lk].cats[ck].title) + '</option>').join('')
            + '</optgroup>').join('');
    }
    function detailsHtml(it) {
        const total = it.unit == null ? '' : numStr(plannedOf(it));
        return '<div class="d-grid">'
            + field('הערות', '<textarea data-field="notes" rows="2" maxlength="2000" placeholder="מידה, צבע, המלצה, מה לבדוק…">' + esc(it.notes) + '</textarea>', 'f-wide')
            + field('כמות', '<input data-field="qty" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="1" value="' + (it.qty == null ? '' : it.qty) + '">')
            + field('מחיר ליחידה', moneyInput('unit', numStr(it.unit), '0'))
            + field('סה״כ', moneyInput('total', total, '0'))
            + '<div class="d-row">'
            + field('חנות', '<input data-field="store" type="text" list="stores" maxlength="80" autocomplete="off" placeholder="איפה קונים" value="' + esc(it.store) + '">')
            + field('שולם בפועל', moneyInput('paid', numStr(it.paid), total || '0'), 'f-paid', ' data-role="paid-wrap"' + (isBought(it) ? '' : ' hidden'))
            + '</div>'
            + '<details class="d-more"><summary>שינוי שם או קטגוריה</summary><div class="d-more-body">'
            + field('שם הפריט', '<input data-field="name" type="text" maxlength="200" autocomplete="off" value="' + esc(it.name) + '">')
            + field('קטגוריה', '<select data-field="cat">' + catOptions(it) + '</select>')
            + '</div></details>'
            + '<div class="d-actions"><button type="button" class="btn btn-danger btn-sm" data-action="delete">🗑 מחיקת הפריט</button></div>'
            + '</div>';
    }
    function rowHtml(it) {
        const open = ui.open.has(it.id);
        return '<article class="item' + (open ? ' is-open' : '') + (isPacked(it) ? ' is-packed' : '') + '" data-id="' + esc(it.id) + '" data-list="' + it.list + '" data-status="' + it.status + '">'
            + '<div class="item-top"><button type="button" class="item-main" data-action="toggle" aria-expanded="' + open + '">'
            + '<span class="item-name">' + nameHtml(it) + '</span><span class="item-sub" data-role="sub">' + subHtml(it) + '</span></button>'
            + '<div class="item-side">' + packControl(it) + statusControl(it) + '</div></div>'
            + '<div class="item-details" data-role="details"' + (open ? '' : ' hidden') + '>' + (open ? detailsHtml(it) : '') + '</div></article>';
    }
    function addHtml() {
        return '<div class="add" data-role="add"><button type="button" class="add-btn" data-action="add-open">+ פריט חדש</button></div>';
    }
    function catHtml(listKey, ck, all, vis, filtering) {
        const c = LISTS[listKey].cats[ck];
        const collapsed = !filtering && state.settings.collapsed[ck] === true;
        const st = catStats(all);
        return '<section class="cat' + (collapsed ? ' is-collapsed' : '') + '" data-cat="' + ck + '">'
            + '<h2 class="cat-h"><button type="button" class="cat-head" data-action="collapse" aria-expanded="' + !collapsed + '">'
            + '<span class="cat-ico" aria-hidden="true">' + c.icon + '</span>'
            + '<span class="cat-title">' + esc(c.title) + (c.hint ? '<small>' + esc(c.hint) + '</small>' : '') + '</span>'
            + '<span class="cat-meta" data-role="cat-meta">' + catMetaHtml(listKey, st) + '</span>'
            + '<span class="chev" aria-hidden="true"></span></button></h2>'
            + '<div class="cat-bar"><i data-role="cat-bar" style="width:' + st.pct + '%"></i></div>'
            + '<div class="cat-body"' + (collapsed ? ' hidden' : '') + '>' + vis.map(rowHtml).join('') + (filtering ? '' : addHtml()) + '</div></section>';
    }
    function emptyHtml() {
        const q = ui.q.trim();
        const cats = LISTS[ui.tab].cats;
        return '<div class="empty">' + window.Shuli.full() + '<b>שולי לא מצאה כלום</b>'
            + '<span>' + (q ? 'אין פריט שמתאים ל״' + esc(q) + '״' + (ui.filter !== 'all' ? ' בסינון הזה' : '') : 'אין פריטים בסינון הזה') + '</span>'
            + (q ? '<form class="add-form" data-action="add-found" style="margin-top:14px"><select name="cat" aria-label="קטגוריה לפריט החדש">'
                + Object.keys(cats).map(ck => '<option value="' + ck + '">' + esc(cats[ck].title) + '</option>').join('')
                + '</select><button type="submit" class="btn btn-primary btn-sm">הוספת ״' + esc(q.slice(0, 18)) + '״</button></form>' : '')
            + '<div><button type="button" class="btn btn-soft btn-sm" data-action="clear-filters">ניקוי החיפוש והסינון</button></div></div>';
    }
    function renderList() {
        const listKey = ui.tab;
        if (!LISTS[listKey]) return;
        const filtering = isFiltering();
        let html = '', shown = 0;
        Object.keys(LISTS[listKey].cats).forEach(ck => {
            const all = state.items.filter(i => i.list === listKey && i.cat === ck);
            const vis = filtering ? all.filter(matches) : all;
            if (filtering && !vis.length) return;
            shown += vis.length;
            html += catHtml(listKey, ck, all, vis, filtering);
        });
        $('#list').innerHTML = filtering && !shown ? emptyHtml() : html;
        refreshStores();
    }

    function patchRow(art, it) {
        art.dataset.status = it.status;
        art.classList.toggle('is-packed', isPacked(it));
        $('.item-name', art).innerHTML = nameHtml(it);
        $('[data-role="sub"]', art).innerHTML = subHtml(it);
        const wrap = $('[data-role="paid-wrap"]', art);
        if (wrap) {
            wrap.hidden = !isBought(it);
            const input = $('input', wrap);
            if (input) {
                input.placeholder = it.unit == null ? '0' : numStr(plannedOf(it));
                if (input !== document.activeElement) input.value = numStr(it.paid);
            }
        }
    }
    function patchSide(art, it) { $('.item-side', art).innerHTML = packControl(it) + statusControl(it); }
    function patchCat(ck) {
        const el = catEl(ck);
        if (!el) return;
        const st = catStats(state.items.filter(i => i.cat === ck));
        $('[data-role="cat-meta"]', el).innerHTML = catMetaHtml(LISTS.bag.cats[ck] ? 'bag' : 'home', st);
        $('[data-role="cat-bar"]', el).style.width = st.pct + '%';
    }
    function refreshStores() {
        const count = {};
        state.items.forEach(i => { if (i.store) count[i.store] = (count[i.store] || 0) + 1; });
        $('#stores').innerHTML = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 40).map(s => '<option value="' + esc(s) + '"></option>').join('');
    }

    function setStatus(it, next) {
        const prev = it.status;
        if (prev === next || !STATUSES[next]) return false;
        const wasBought = isBought(it);
        it.status = next;
        // מה שחיכה למתנה והגיע: לא יצא מהכיס.
        if (prev === 'gift' && next === 'have' && it.paid == null && it.unit != null) it.paid = 0;
        if (wasBought && !isBought(it) && it.paid === 0) it.paid = null;
        return true;
    }

    /** טביעת כף רגל קטנה על שורה שסומנה. */
    function stamp(art) {
        const old = $('.stamp', art);
        if (old) old.remove();
        art.insertAdjacentHTML('beforeend', window.Shuli.paw('stamp'));
        const el = $('.stamp', art);
        setTimeout(() => { if (el) el.remove(); }, 900);
    }

    function toggleItem(art) {
        const it = byId(art.dataset.id);
        if (!it) return;
        const open = !ui.open.has(it.id);
        if (open) ui.open.add(it.id); else ui.open.delete(it.id);
        art.classList.toggle('is-open', open);
        const d = $('[data-role="details"]', art);
        d.innerHTML = open ? detailsHtml(it) : '';
        d.hidden = !open;
        $('.item-main', art).setAttribute('aria-expanded', String(open));
    }

    function addItem(listKey, cat, name) {
        const it = makeItem({ list: listKey, cat, name: name.slice(0, 200) });
        let pos = -1;
        state.items.forEach((x, i) => { if (x.cat === cat) pos = i; });
        if (pos >= 0) state.items.splice(pos + 1, 0, it); else state.items.push(it);
        commit();
        return it;
    }

    function deleteItem(id) {
        const idx = state.items.findIndex(i => i.id === id);
        if (idx < 0) return;
        const it = state.items[idx];
        state.items.splice(idx, 1);
        ui.open.delete(id);
        commit();
        renderChips(); renderList();
        toast('״' + it.name + '״ נמחק', {
            action: {
                label: 'ביטול', fn: () => {
                    if (byId(it.id)) return;
                    state.items.splice(Math.min(idx, state.items.length), 0, it);
                    commit(); refreshView();
                }
            }
        });
    }

    function jumpTo(id) {
        const it = byId(id);
        if (!it) return;
        ui.q = ''; ui.qn = ''; ui.filter = 'all';
        $('#q').value = ''; $('#qClear').hidden = true;
        if (state.settings.collapsed[it.cat]) { delete state.settings.collapsed[it.cat]; commit(); }
        ui.open.add(id);
        setTab(it.list, { keepScroll: true });
        const el = rowEl(id);
        if (!el) return;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1500);
    }

    // ---------- אירועים ברשימה ----------
    function onListClick(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn || btn.tagName === 'SELECT' || btn.tagName === 'INPUT' || btn.tagName === 'FORM') return;
        const action = btn.dataset.action;
        const art = btn.closest('.item');
        if (action === 'toggle' && art) toggleItem(art);
        else if (action === 'delete' && art) deleteItem(art.dataset.id);
        else if (action === 'collapse') {
            const sec = btn.closest('.cat');
            const ck = sec.dataset.cat;
            const collapsed = !sec.classList.contains('is-collapsed');
            sec.classList.toggle('is-collapsed', collapsed);
            $('.cat-body', sec).hidden = collapsed;
            btn.setAttribute('aria-expanded', String(!collapsed));
            if (collapsed) state.settings.collapsed[ck] = true; else delete state.settings.collapsed[ck];
            commit();
        } else if (action === 'add-open') {
            const box = btn.closest('[data-role="add"]');
            box.innerHTML = '<form class="add-form" data-action="add" novalidate>'
                + '<input name="name" type="text" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="שם הפריט החדש" aria-label="שם הפריט החדש">'
                + '<button type="submit" class="btn btn-primary btn-sm">הוספה</button>'
                + '<button type="button" class="btn-x" data-action="add-close" aria-label="סגירה">✕</button></form>';
            $('input', box).focus();
        } else if (action === 'add-close') {
            btn.closest('[data-role="add"]').outerHTML = addHtml();
        } else if (action === 'clear-filters') {
            ui.q = ''; ui.qn = ''; ui.filter = 'all';
            $('#q').value = ''; $('#qClear').hidden = true;
            renderChips(); renderList();
        }
    }
    function onListSubmit(e) {
        const form = e.target;
        if (!form.dataset || !form.dataset.action) return;
        e.preventDefault();
        if (form.dataset.action === 'add') {
            const input = form.elements.name;
            const name = input.value.trim();
            if (!name) {
                input.classList.remove('is-bad'); void input.offsetWidth; input.classList.add('is-bad');
                input.focus();
                return;
            }
            const sec = form.closest('.cat');
            const it = addItem(ui.tab, sec.dataset.cat, name);
            form.closest('[data-role="add"]').insertAdjacentHTML('beforebegin', rowHtml(it));
            const el = rowEl(it.id);
            if (el) el.classList.add('is-new');
            input.value = ''; input.classList.remove('is-bad'); input.focus();
            patchCat(it.cat); renderChips();
        } else if (form.dataset.action === 'add-found') {
            const name = ui.q.trim();
            if (!name) return;
            const it = addItem(ui.tab, form.elements.cat.value, name);
            toast('״' + it.name + '״ נוסף לרשימה');
            jumpTo(it.id);
        }
    }
    function syncMoney(art, it, source) {
        const set = (name, value) => { const el = $('[data-field="' + name + '"]', art); if (el && el !== document.activeElement) el.value = value; };
        const total = it.unit == null ? '' : numStr(plannedOf(it));
        if (source !== 'total') set('total', total);
        if (source !== 'unit') set('unit', numStr(it.unit));
    }
    function onListInput(e) {
        const t = e.target;
        const f = t.dataset.field;
        const art = t.closest('.item');
        if (!f || !art) return;
        const it = byId(art.dataset.id);
        if (!it) return;
        if (f === 'notes') it.notes = t.value;
        else if (f === 'store') it.store = t.value.slice(0, 80);
        else if (f === 'name') { if (!t.value.trim()) return; it.name = t.value.trim(); }
        else if (f === 'qty') { it.qty = parseQty(t.value); syncMoney(art, it, 'qty'); }
        else if (f === 'unit') { it.unit = parseNum(t.value); syncMoney(art, it, 'unit'); }
        else if (f === 'total') { const tot = parseNum(t.value); it.unit = tot == null ? null : tot / qtyOf(it); syncMoney(art, it, 'total'); }
        else if (f === 'paid') it.paid = parseNum(t.value);
        else return;
        commit({ saved: true });
        patchRow(art, it);
    }
    function onListChange(e) {
        const t = e.target;
        const art = t.closest('.item');
        if (!art) return;
        const it = byId(art.dataset.id);
        if (!it) return;
        const f = t.dataset.field;
        if (t.dataset.action === 'status') {
            if (!setStatus(it, t.value)) return;
            commit();
            patchRow(art, it); patchSide(art, it); patchCat(it.cat); renderChips();
            if (it.status === 'have') stamp(art);
            const sel = $('.status select', art);
            if (sel && !env.mobile) sel.focus();
        } else if (t.dataset.action === 'pack') {
            it.packed = t.checked;
            commit();
            if (it.packed) stamp(art);
            patchRow(art, it); patchSide(art, it); patchCat(it.cat); renderChips();
        } else if (f === 'cat') {
            const ck = t.value;
            const listKey = LISTS.bag.cats[ck] ? 'bag' : LISTS.home.cats[ck] ? 'home' : null;
            if (!listKey || ck === it.cat) return;
            it.cat = ck; it.list = listKey;
            commit();
            if (listKey !== ui.tab) {
                ui.open.delete(it.id);
                renderChips(); renderList();
                toast('הועבר ל' + LISTS[listKey].title, { action: { label: 'הצגה', fn: () => jumpTo(it.id) } });
            } else {
                renderChips(); renderList();
                const el = rowEl(it.id);
                if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
            }
        } else if (f === 'qty') t.value = it.qty == null ? '' : it.qty;
        else if (f === 'unit') t.value = numStr(it.unit);
        else if (f === 'total') t.value = it.unit == null ? '' : numStr(plannedOf(it));
        else if (f === 'paid') t.value = numStr(it.paid);
        else if (f === 'store') { it.store = t.value.trim().slice(0, 80); t.value = it.store; commit(); patchRow(art, it); refreshStores(); }
        else if (f === 'name') t.value = it.name;
    }

    // ---------- דשבורד ----------
    function computeStats() {
        const s = {
            counts: {}, total: state.items.length, spent: 0, upcoming: 0, maybeCost: 0, giftValue: 0,
            needPriced: 0, needUnpriced: 0, byCat: {}, byStore: {}, anyMoney: false,
            pack: { total: 0, packed: 0, toGet: 0, byCat: {} }
        };
        STATUS_KEYS.forEach(k => { s.counts[k] = 0; });
        state.items.forEach(it => {
            s.counts[it.status]++;
            const planned = plannedOf(it), spent = spentOf(it);
            const cat = s.byCat[it.cat] || (s.byCat[it.cat] = { spent: 0, upcoming: 0 });
            if (it.unit != null || it.paid != null) s.anyMoney = true;
            if (isBought(it)) { s.spent += spent; cat.spent += spent; }
            else if (it.status === 'need') { s.upcoming += planned; cat.upcoming += planned; if (it.unit != null) s.needPriced++; else s.needUnpriced++; }
            else if (it.status === 'maybe') s.maybeCost += planned;
            else if (it.status === 'gift') s.giftValue += planned;
            if (it.store && (isBought(it) || it.status === 'need')) {
                const st = s.byStore[it.store] || (s.byStore[it.store] = { total: 0, count: 0 });
                st.total += isBought(it) ? spent : planned; st.count++;
            }
            if (it.list === 'bag' && it.status !== 'maybe') {
                const pc = s.pack.byCat[it.cat] || (s.pack.byCat[it.cat] = { total: 0, packed: 0 });
                s.pack.total++; pc.total++;
                if (isPacked(it)) { s.pack.packed++; pc.packed++; }
                if (it.status !== 'have') s.pack.toGet++;
            }
        });
        ['spent', 'upcoming', 'maybeCost', 'giftValue'].forEach(k => { s[k] = round2(s[k]); });
        Object.keys(s.byCat).forEach(k => { s.byCat[k].spent = round2(s.byCat[k].spent); s.byCat[k].upcoming = round2(s.byCat[k].upcoming); });
        Object.keys(s.byStore).forEach(k => { s.byStore[k].total = round2(s.byStore[k].total); });
        s.forecast = round2(s.spent + s.upcoming);
        s.mandatory = s.total - s.counts.maybe;
        s.pct = s.mandatory ? Math.round(s.counts.have / s.mandatory * 100) : 0;
        return s;
    }

    function pickGroups(status) {
        const groups = [];
        LIST_KEYS.forEach(lk => Object.keys(LISTS[lk].cats).forEach(ck => {
            const items = state.items.filter(i => i.list === lk && i.cat === ck && i.status === status);
            if (items.length) groups.push({ list: lk, cat: ck, icon: LISTS[lk].cats[ck].icon, title: LISTS[lk].cats[ck].title, items });
        }));
        return groups;
    }
    function shareText() {
        const head = { need: '🛒 רשימת קניות', ordered: '📦 הזמנות שבדרך', gift: '🎁 רשימת מתנות' }[ui.pick];
        const name = state.settings.title.trim();
        let out = head + (name ? ' | ' + name : '') + '\n';
        pickGroups(ui.pick).forEach(g => {
            out += '\n' + g.icon + ' ' + g.title + (g.list === 'bag' ? ' (תיק לידה)' : '') + '\n';
            g.items.forEach(it => { out += '▫️ ' + it.name + (it.qty > 1 ? ' ×' + it.qty : '') + (it.store ? ' (' + it.store + ')' : '') + '\n'; });
        });
        return out.trim();
    }
    function pickHtml() {
        const groups = pickGroups(ui.pick);
        const done = STATUSES[ui.pick].done;
        if (!groups.length) {
            const msg = { need: 'אין מה לקנות כרגע 🎉', ordered: 'אין הזמנות בדרך', gift: 'אין פריטים שמחכים למתנה' }[ui.pick];
            return '<p class="pick-empty">' + msg + '</p>';
        }
        return '<ul class="pick-list">' + groups.map(g => '<li class="pick-group">' + g.icon + ' ' + esc(g.title) + (g.list === 'bag' ? ' · תיק לידה' : '') + '</li>'
            + g.items.map(it => {
                const cost = it.unit != null ? '<span class="pick-cost">' + moneyHtml(plannedOf(it)) + '</span>' : '';
                return '<li class="pick"><button type="button" class="pick-check" data-action="pick-done" data-id="' + esc(it.id) + '" aria-label="' + done + ': ' + esc(it.name) + '" title="' + done + '"></button>'
                    + '<button type="button" class="pick-name" data-action="jump" data-id="' + esc(it.id) + '">' + esc(it.name) + (it.qty > 1 ? '<span class="qty">×' + it.qty + '</span>' : '') + '</button>' + cost + '</li>';
            }).join('')).join('') + '</ul>';
    }

    function dogbarHtml(p) {
        const S = window.Shuli;
        return '<div class="dogbar"><span class="dogbar-goal" aria-hidden="true">🍼</span>'
            + '<div class="dog" id="dog" style="--p:' + p + '">' + S.bodyFill()
            + '<div class="dog-spots" style="background-image:' + S.bodyTiles().join(',').replace(/"/g, "'") + '"></div>' + S.front() + S.rear() + '</div></div>';
    }

    function renderDash() {
        const st = computeStats();
        const s = state.settings;
        const c = st.counts;
        let html = '';

        // התקדמות
        html += '<section class="card main-stat is-full"><h2>התקדמות ההתארגנות</h2><div class="pct">' + st.pct + '%</div>'
            + dogbarHtml(ui.lastPct / 100)
            + '<p>' + (st.mandatory && c.have === st.mandatory ? 'הכל מוכן! 🎉' : 'יש כבר <b>' + c.have + '</b> מתוך <b>' + st.mandatory + '</b> פריטים') + '</p>'
            + (c.maybe ? '<p class="muted" style="margin-top:2px">לא כולל ' + heItems(c.maybe) + ' בהתלבטות</p>' : '') + '</section>';

        // ספירה לאחור
        const d = daysUntil(s.dueDate);
        if (d != null) {
            const week = pregnancyWeek(d);
            html += '<section class="card is-countdown"><div class="countdown"><span class="countdown-ico" aria-hidden="true">👶</span><div><b>' + countdownText(d) + '</b>'
                + '<span class="muted">' + esc(fmtDue(s.dueDate)) + (week && d > 0 ? ' · שבוע ' + week : '') + '</span></div></div></section>';
        }

        // סטטוס כללי
        html += '<section class="card' + (d == null ? ' is-full' : '') + '"><h2>סטטוס כללי</h2><div class="tiles">'
            + STATUS_KEYS.map(k => '<div class="tile" data-status="' + k + '"><span class="tile-ico" aria-hidden="true">' + STATUSES[k].icon + '</span><b>' + c[k] + '</b><span>' + STATUSES[k].short + '</span></div>').join('')
            + '</div></section>';

        // הוצאות
        html += '<section class="card is-full"><h2>💰 הוצאות</h2>';
        if (!st.anyMoney) {
            html += '<p class="muted">עוד לא הוזנו מחירים. פותחים פריט ברשימה, מוסיפים מחיר, והסיכום מופיע כאן.</p>';
        } else {
            html += '<div class="money-rows">'
                + '<div class="money-row is-big"><span>שולם עד עכשיו</span><b>' + moneyHtml(st.spent) + '</b></div>'
                + '<div class="money-row"><span>עוד צפוי<small>' + heItems(st.needPriced) + ' לקנייה עם מחיר' + (st.needUnpriced ? ', ועוד ' + st.needUnpriced + ' בלי מחיר' : '') + '</small></span><b>' + moneyHtml(st.upcoming) + '</b></div>'
                + '<div class="money-row is-total"><span>סה״כ צפוי</span><b>' + moneyHtml(st.forecast) + '</b></div></div>';
            const extra = [];
            if (st.maybeCost) extra.push('בהתלבטות: ' + moneyHtml(st.maybeCost));
            if (st.giftValue) extra.push('שווי המתנות שביקשנו: ' + moneyHtml(st.giftValue));
            if (extra.length) html += '<p class="muted" style="margin-top:6px">לא נכלל בסיכום: ' + extra.join(' · ') + '</p>';
        }
        if (s.budget) {
            const used = Math.min(st.spent / s.budget, 1) * 100;
            const next = Math.max(Math.min(st.forecast / s.budget, 1) * 100 - used, 0);
            const left = round2(s.budget - st.forecast);
            html += '<div class="budget"><div class="budget-text"><span>תקציב: ' + moneyHtml(s.budget) + '</span><span>נוצל ' + Math.round(st.spent / s.budget * 100) + '%</span></div>'
                + '<div class="meter' + (st.spent > s.budget ? ' is-over' : '') + '" role="img" aria-label="ניצול התקציב"><i style="width:' + used + '%"></i><i class="is-next" style="width:' + next + '%"></i></div>'
                + (left < 0 ? '<p class="budget-warn">הצפי חורג מהתקציב ב-' + moneyHtml(-left) + '</p>'
                    : '<p class="muted" style="margin-top:6px">אחרי כל מה שצפוי יישארו ' + moneyHtml(left) + '</p>') + '</div>';
        } else {
            html += '<button type="button" class="btn-link" data-action="go-budget">הגדרת תקציב כולל</button>';
        }
        html += '</section>';

        // רשימות: לקנות / בדרך / מתנות
        html += '<section class="card is-full"><h2>מה עוד חסר</h2><div class="seg" role="group" aria-label="איזו רשימה להציג">'
            + ['need', 'ordered', 'gift'].map(k => '<button type="button" class="chip' + (ui.pick === k ? ' is-on' : '') + '" data-action="pick-tab" data-pick="' + k + '" aria-pressed="' + (ui.pick === k) + '">' + STATUSES[k].icon + ' ' + STATUSES[k].short + '<b>' + c[k] + '</b></button>').join('')
            + '</div>' + pickHtml()
            + (c[ui.pick] ? '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn btn-primary" data-action="share">שיתוף הרשימה</button><button type="button" class="btn btn-soft" data-action="copy">העתקה</button></div>' : '')
            + '</section>';

        // אריזת התיק
        const pk = st.pack;
        html += '<section class="card"><h2>🧳 אריזת התיק</h2>'
            + '<div class="budget-text"><span>ארוזים ' + pk.packed + ' מתוך ' + pk.total + '</span><span>' + (pk.total ? Math.round(pk.packed / pk.total * 100) : 0) + '%</span></div>'
            + '<div class="bars">' + Object.keys(LISTS.bag.cats).filter(ck => pk.byCat[ck]).map(ck => {
                const b = pk.byCat[ck];
                return '<div class="bar-row"><span class="bar-label">' + LISTS.bag.cats[ck].icon + ' ' + esc(LISTS.bag.cats[ck].title) + '</span><span class="bar-amt">' + b.packed + '/' + b.total + '</span>'
                    + '<div class="bar-track"><i class="is-pack" style="width:' + (b.packed / b.total * 100) + '%"></i></div></div>';
            }).join('') + '</div>'
            + (pk.toGet ? '<p class="muted" style="margin-top:10px">' + heItems(pk.toGet) + ' לתיק עוד לא אצלנו</p>' : '')
            + '<button type="button" class="btn-link" data-action="go-pack">מה נשאר לארוז</button></section>';

        // הוצאות לפי קטגוריה
        const catRows = [];
        LIST_KEYS.forEach(lk => Object.keys(LISTS[lk].cats).forEach(ck => {
            const b = st.byCat[ck];
            if (b && b.spent + b.upcoming > 0) catRows.push({ icon: LISTS[lk].cats[ck].icon, title: LISTS[lk].cats[ck].title, spent: b.spent, upcoming: b.upcoming, sum: b.spent + b.upcoming });
        }));
        if (catRows.length) {
            catRows.sort((a, b) => b.sum - a.sum);
            const max = catRows[0].sum;
            html += '<section class="card"><h2>הוצאות לפי קטגוריה</h2><div class="legend"><span>שולם</span><span class="is-next">עוד צפוי</span></div><div class="bars">'
                + catRows.map(r => '<div class="bar-row"><span class="bar-label">' + r.icon + ' ' + esc(r.title) + '</span><span class="bar-amt">' + moneyHtml(r.sum) + '</span>'
                    + '<div class="bar-track"><i style="width:' + (r.spent / max * 100) + '%"></i><i class="is-next" style="width:' + (r.upcoming / max * 100) + '%"></i></div></div>').join('')
                + '</div></section>';
        }

        // לפי חנות
        const stores = Object.keys(st.byStore).map(k => ({ name: k, total: st.byStore[k].total, count: st.byStore[k].count })).sort((a, b) => b.total - a.total || b.count - a.count);
        if (stores.length) {
            html += '<section class="card"><h2>לפי חנות</h2>' + stores.slice(0, 12).map(r => '<div class="store-row"><span>' + esc(r.name) + '<small>' + heItems(r.count) + '</small></span><b>' + moneyHtml(r.total) + '</b></div>').join('') + '</section>';
        }

        // תזכורת גיבוי
        const since = s.lastBackupAt || state.meta.createdAt;
        if (state.meta.updatedAt > since + 60000 && Date.now() - since > 14 * DAY) {
            html += '<section class="card is-full"><h2>💾 כדאי לשמור גיבוי</h2><p class="muted">' + (s.lastBackupAt ? 'הגיבוי האחרון נשמר ב-' + esc(fmtDate(s.lastBackupAt)) + '.' : 'עוד לא נשמר גיבוי.')
                + ' הנתונים שמורים רק במכשיר הזה.</p><div class="btn-row" style="margin-top:10px"><button type="button" class="btn btn-dark" data-action="backup">שמירת גיבוי</button></div></section>';
        }

        $('#view-dash').innerHTML = '<div class="dash">' + html + '</div>';
        const target = st.pct;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const dog = $('#dog');
            if (dog) dog.style.setProperty('--p', String(target / 100));
        }));
        ui.lastPct = target;
    }

    function onDashClick(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        if (a === 'pick-tab') { ui.pick = btn.dataset.pick; renderDash(); }
        else if (a === 'jump') jumpTo(btn.dataset.id);
        else if (a === 'pick-done') {
            const it = byId(btn.dataset.id);
            if (!it) return;
            const snap = { status: it.status, paid: it.paid };
            setStatus(it, 'have');
            commit(); renderDash();
            toast('״' + it.name + '״ סומן כ״יש״', { action: { label: 'ביטול', fn: () => { it.status = snap.status; it.paid = snap.paid; commit(); refreshView(); } } });
        }
        else if (a === 'share') doShare();
        else if (a === 'copy') copyText(shareText());
        else if (a === 'backup') doBackup();
        else if (a === 'go-budget') { setTab('settings', { top: true }); const el = $('#setBudget'); if (el) el.focus(); }
        else if (a === 'go-pack') { ui.q = ''; ui.qn = ''; $('#q').value = ''; $('#qClear').hidden = true; ui.filter = 'topack'; setTab('bag', { top: true }); }
    }

    // ---------- שיתוף, קבצים, גיבוי ----------
    function copyText(text) {
        const ok = () => toast('הרשימה הועתקה');
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
            document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
            let done = false;
            try { done = document.execCommand('copy'); } catch (err) { done = false; }
            ta.remove();
            if (done) ok(); else toast('לא הצלחתי להעתיק. אפשר לנסות את כפתור השיתוף.');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
        else fallback();
    }
    function doShare() {
        const text = shareText();
        if (env.mobile && navigator.share) { navigator.share({ text }).catch(() => { /* המשתמש סגר את חלון השיתוף */ }); return; }
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    }

    /** מוסר קובץ למשתמש: בנייד דרך חלון השיתוף (שמירה בקבצים, וואטסאפ), במחשב כהורדה. */
    function deliverFile(blob, filename) {
        let file = null;
        try { file = new File([blob], filename, { type: blob.type }); } catch (e) { file = null; }
        if (env.mobile && file && navigator.canShare && navigator.canShare({ files: [file] })) {
            return navigator.share({ files: [file] }).then(() => 'shared', err => (err && err.name === 'AbortError' ? 'cancelled' : download(blob, filename)));
        }
        return Promise.resolve(download(blob, filename));
    }
    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return 'downloaded';
    }

    function backupPayload() { return { app: 'shuli-list', format: 1, exportedAt: new Date().toISOString(), state }; }
    function doBackup() {
        const blob = new Blob([JSON.stringify(backupPayload(), null, 1)], { type: 'application/json' });
        return deliverFile(blob, 'גיבוי רשימת לידה ' + todayStr() + '.json').then(res => {
            if (res === 'cancelled') return res;
            state.settings.lastBackupAt = Date.now();
            commit(); refreshView();
            toast(res === 'shared' ? 'הגיבוי נמסר לשמירה' : 'קובץ הגיבוי ירד למכשיר');
            return res;
        });
    }
    function parseBackup(text) {
        let data;
        try { data = JSON.parse(text); } catch (e) { return null; }
        if (!data || data.app !== 'shuli-list' || !data.state) return null;
        const next = normalizeState(data.state);
        return next ? { state: next, exportedAt: Date.parse(data.exportedAt) || null } : null;
    }
    function replaceState(next, msg) {
        const prev = JSON.stringify(state);
        try { localStorage.setItem(PREV_KEY, prev); } catch (e) { /* אין מקום לעותק הקודם */ }
        state = next;
        ui.open.clear();
        commit(); renderAll();
        toast(msg, {
            ms: 10000,
            action: { label: 'ביטול', fn: () => { const back = normalizeState(JSON.parse(prev)); if (back) { state = back; commit(); renderAll(); toast('המצב הקודם הוחזר'); } } }
        });
    }
    function onRestoreFile(e) {
        const input = e.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => toast('לא הצלחתי לקרוא את הקובץ');
        reader.onload = () => {
            const parsed = parseBackup(String(reader.result || ''));
            if (!parsed) { toast('זה לא קובץ גיבוי של הרשימה'); return; }
            confirmDlg({
                title: 'לשחזר מהגיבוי?',
                body: 'הגיבוי' + (parsed.exportedAt ? ' מ-' + fmtDate(parsed.exportedAt) : '') + ' כולל ' + heItems(parsed.state.items.length) + '. השחזור יחליף את כל מה ששמור כרגע במכשיר.',
                ok: 'שחזור', danger: true
            }).then(yes => { if (yes) { parsed.state.settings.welcomed = true; replaceState(parsed.state, 'הגיבוי שוחזר'); } });
        };
        reader.readAsText(file);
    }
    function doReset() {
        confirmDlg({
            title: 'לחזור לרשימה ההתחלתית?',
            body: 'כל הסטטוסים, המחירים, ההערות והפריטים שנוספו יימחקו, והרשימה תחזור למצב שבו התחילה. השם, התאריך והתקציב נשארים.',
            ok: 'איפוס הרשימה', danger: true
        }).then(yes => {
            if (!yes) return;
            const next = freshState();
            next.settings = Object.assign({}, state.settings, { collapsed: {} });
            next.meta.createdAt = state.meta.createdAt;
            replaceState(next, 'הרשימה חזרה למצב ההתחלתי');
        });
    }

    // ---------- ייצוא לאקסל (קובץ xlsx אמיתי, נבנה כאן בלי ספריות) ----------
    const crcTable = (function () {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    /** ארכיון zip בלי דחיסה: זה כל מה שקובץ xlsx צריך. */
    function zipStore(files) {
        const enc = new TextEncoder();
        const now = new Date();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const parts = [], central = [];
        let offset = 0;
        files.forEach(f => {
            const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
            local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
            parts.push(new Uint8Array(local.buffer), name, data);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
            cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true);
            cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true);
            cen.setUint32(42, offset, true);
            central.push(new Uint8Array(cen.buffer), name);
            offset += 30 + name.length + data.length;
        });
        const cenSize = central.reduce((n, p) => n + p.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: XLSX_MIME });
    }
    function colName(i) {
        let s = '';
        for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
    }
    function xmlEsc(v) {
        return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    function sheetXml(sheet) {
        const rows = sheet.rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((cell, c) => {
            const obj = cell != null && typeof cell === 'object';
            const v = obj ? cell.v : cell, s = obj && cell.s ? ' s="' + cell.s + '"' : '';
            const ref = colName(c) + (r + 1);
            if (v == null || v === '') return s ? '<c r="' + ref + '"' + s + '/>' : '';
            if (typeof v === 'number') return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
            return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
        }).join('') + '</row>').join('');
        return XML_HEAD + '<worksheet xmlns="' + NS_MAIN + '"><sheetViews><sheetView rightToLeft="1" workbookViewId="0">'
            + (sheet.freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '')
            + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>'
            + sheet.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('')
            + '</cols><sheetData>' + rows + '</sheetData></worksheet>';
    }
    /** תוכן הגיליונות: ציוד לבית, תיק לידה וסיכום הוצאות. */
    function exportSheets() {
        const H = v => ({ v, s: 1 }), M = v => ({ v, s: 2 }), B = v => ({ v, s: 3 }), BM = v => ({ v, s: 4 });
        const sheets = [];
        LIST_KEYS.forEach(lk => {
            const bag = lk === 'bag';
            const head = [bag ? 'תיק' : 'קטגוריה', bag ? 'מה להביא' : 'מוצר', 'סטטוס'].concat(bag ? ['ארוז'] : [], ['כמות', 'מחיר ליחידה', 'סה״כ', 'שולם בפועל', 'חנות', 'הערות']);
            const rows = [head.map(H)];
            let sumTotal = 0, sumPaid = 0;
            Object.keys(LISTS[lk].cats).forEach(ck => state.items.filter(i => i.list === lk && i.cat === ck).forEach(it => {
                const total = it.unit == null ? null : plannedOf(it);
                const paid = isBought(it) && (it.paid != null || it.unit != null) ? spentOf(it) : null;
                if (total != null) sumTotal += total;
                if (paid != null) sumPaid += paid;
                rows.push([LISTS[lk].cats[ck].title, it.name, STATUSES[it.status].label].concat(bag ? [isPacked(it) ? 'כן' : ''] : [], [
                    it.qty == null ? '' : it.qty, it.unit == null ? '' : M(round2(it.unit)), total == null ? '' : M(total),
                    paid == null ? '' : M(paid), it.store, it.notes.replace(/\s*\n\s*/g, ' ').trim()
                ]));
            }));
            const totals = head.map(() => '');
            totals[0] = B('סה״כ'); totals[head.indexOf('סה״כ')] = BM(round2(sumTotal)); totals[head.indexOf('שולם בפועל')] = BM(round2(sumPaid));
            rows.push(totals);
            sheets.push({ name: LISTS[lk].title, rows, freeze: true, widths: bag ? [20, 44, 15, 7, 7, 13, 12, 13, 18, 46] : [20, 40, 15, 7, 13, 12, 13, 18, 46] });
        });
        const st = computeStats();
        const rows = [[H('סיכום הוצאות'), H('')], ['עודכן', fmtDate(Date.now())], ['שולם עד עכשיו', M(st.spent)], ['עוד צפוי (צריך לקנות)', M(st.upcoming)], [B('סה״כ צפוי'), BM(st.forecast)]];
        if (state.settings.budget) rows.push(['תקציב', M(state.settings.budget)], ['נשאר מהתקציב אחרי הצפי', M(round2(state.settings.budget - st.forecast))]);
        rows.push([], [H('קטגוריה'), H('שולם'), H('עוד צפוי'), H('סה״כ')]);
        LIST_KEYS.forEach(lk => Object.keys(LISTS[lk].cats).forEach(ck => {
            const b = st.byCat[ck];
            if (b && b.spent + b.upcoming > 0) rows.push([LISTS[lk].cats[ck].title, M(b.spent), M(b.upcoming), M(round2(b.spent + b.upcoming))]);
        }));
        sheets.push({ name: 'סיכום', rows, freeze: false, widths: [30, 16, 16, 16] });
        return sheets;
    }
    function buildXlsx() {
        const sheets = exportSheets();
        const files = [{
            name: '[Content_Types].xml',
            text: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
                + '</Types>'
        }, {
            name: '_rels/.rels',
            text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        }, {
            name: 'xl/workbook.xml',
            text: XML_HEAD + '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>'
                + sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name).replace(/"/g, '&quot;') + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'
        }, {
            name: 'xl/_rels/workbook.xml.rels',
            text: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
                + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + NS_REL + '/styles" Target="styles.xml"/></Relationships>'
        }, {
            name: 'xl/styles.xml',
            text: XML_HEAD + '<styleSheet xmlns="' + NS_MAIN + '"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₪&quot;#,##0.00"/></numFmts>'
                + '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>'
                + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3B662"/><bgColor indexed="64"/></patternFill></fill></fills>'
                + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                + '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
                + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
                + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
                + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
                + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>'
                + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
        }];
        sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s) }));
        return zipStore(files);
    }
    function doExcel() {
        return deliverFile(buildXlsx(), 'רשימת לידה ' + todayStr() + '.xlsx').then(res => {
            if (res !== 'cancelled') toast(res === 'shared' ? 'הקובץ נמסר' : 'קובץ האקסל ירד למכשיר');
            return res;
        });
    }

    // ---------- הגדרות ----------
    function backupInfo() {
        const t = state.settings.lastBackupAt;
        return t ? 'הגיבוי האחרון נשמר ב-' + fmtDate(t) + '.' : 'עוד לא נשמר גיבוי.';
    }
    function renderSettings() {
        const s = state.settings;
        let html = '<section class="card"><h2>הפרטים שלנו</h2>'
            + field('שם לכותרת', '<input id="setTitle" type="text" maxlength="30" autocomplete="off" placeholder="למשל שם התינוק/ת" value="' + esc(s.title) + '">')
            + '<div class="f"><label class="f-label" for="setDue">תאריך לידה משוער</label><div class="with-clear"><input id="setDue" type="date" value="' + esc(s.dueDate) + '">'
            + '<button type="button" class="btn btn-soft btn-sm" data-action="clear-due">ניקוי</button></div></div>'
            + field('תקציב כולל (לא חובה)', '<span class="money-in"><input id="setBudget" type="text" inputmode="decimal" dir="ltr" maxlength="10" autocomplete="off" placeholder="0" value="' + numStr(s.budget) + '"><i aria-hidden="true">₪</i></span>')
            + '</section>';

        html += '<section class="card"><h2>גיבוי ושחזור</h2>'
            + '<p>הכל נשמר אוטומטית, במכשיר הזה בלבד. גיבוי שומר עותק בקובץ, למקרה שמחליפים טלפון או מוחקים את האפליקציה.</p>'
            + '<p class="muted" id="backupInfo">' + esc(backupInfo()) + '</p>'
            + '<div class="btn-row"><button type="button" class="btn btn-dark" data-action="backup">שמירת גיבוי</button>'
            + '<label class="btn btn-soft file-btn">שחזור מגיבוי<input type="file" id="restoreFile" aria-label="בחירת קובץ גיבוי לשחזור"></label></div>'
            + '<div class="btn-row"><button type="button" class="btn btn-soft" data-action="excel">📊 ייצוא לאקסל</button></div></section>';

        if (!env.standalone) {
            html += '<section class="card"><h2>📲 התקנה למסך הבית</h2>'
                + (env.ios ? installSteps() + '<p class="muted">מה שממלאים בדפדפן לא עובר לאפליקציה שבמסך הבית. כדי להעביר: שומרים גיבוי כאן, ומשחזרים אותו שם.</p>'
                    : ui.installEvt ? '<p>נפתח במסך מלא מהאייקון, ועובד גם בלי אינטרנט.</p><div class="btn-row"><button type="button" class="btn btn-primary" data-action="install-now">התקנה</button></div>'
                        : '<p class="muted">בתפריט הדפדפן בוחרים ״התקנת האפליקציה״ או ״הוספה למסך הבית״.</p>')
                + '</section>';
        }

        html += '<section class="card"><h2>התחלה מחדש</h2><p class="muted">מחזיר את הרשימה למצב שבו התחילה. אפשר לבטל מיד אחרי.</p>'
            + '<div class="btn-row"><button type="button" class="btn btn-danger" data-action="reset">חזרה לרשימה ההתחלתית</button></div></section>';

        html += '<p class="about is-full">' + window.Shuli.paw() + ' שולי שומרת על הרשימה · גרסה ' + APP_VERSION + '</p>';
        $('#view-settings').innerHTML = '<div class="settings">' + html + '</div>';
    }
    function setDueDate(value) {
        state.settings.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
        commit({ saved: true }); renderHeader();
    }
    function onSettingsInput(e) {
        const t = e.target;
        if (t.id === 'setTitle' || t.id === 'wTitle') { state.settings.title = t.value.slice(0, 30); commit({ saved: true }); renderHeader(); }
        else if (t.id === 'setDue' || t.id === 'wDue') setDueDate(t.value);
        else if (t.id === 'setBudget') { state.settings.budget = parseNum(t.value) || null; commit({ saved: true }); }
    }
    function onSettingsChange(e) {
        const t = e.target;
        if (t.id === 'restoreFile') onRestoreFile(e);
        else if (t.id === 'setBudget') t.value = numStr(state.settings.budget);
        else onSettingsInput(e);
    }
    function onSettingsClick(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        if (a === 'backup') doBackup();
        else if (a === 'excel') doExcel();
        else if (a === 'reset') doReset();
        else if (a === 'clear-due') { const el = $('#setDue'); if (el) el.value = ''; setDueDate(''); }
        else if (a === 'install-now') promptInstall();
    }
    function onNoticeClick(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        if (a === 'install-later') { state.settings.installDismissedAt = Date.now(); commit(); renderNotices(); }
        else if (a === 'install-now') promptInstall();
        else if (a === 'welcome-done') { state.settings.welcomed = true; commit(); renderNotices(); refreshView(); }
    }
    function promptInstall() {
        const evt = ui.installEvt;
        if (!evt) return;
        ui.installEvt = null;
        evt.prompt();
        if (evt.userChoice) evt.userChoice.then(() => { renderNotices(); refreshView(); }, () => { /* אין מה לעשות */ });
    }

    // ---------- טוסט, חיווי שמירה, דיאלוג אישור ----------
    let toastTimer = null;
    function hideToast() { clearTimeout(toastTimer); $('#toast').classList.remove('is-on'); }
    function toast(msg, opts) {
        const o = opts || {};
        const el = $('#toast');
        el.textContent = '';
        const span = document.createElement('span');
        span.textContent = msg;
        el.appendChild(span);
        if (o.action) {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = o.action.label;
            b.addEventListener('click', () => { hideToast(); o.action.fn(); });
            el.appendChild(b);
        }
        el.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, o.ms || (o.action ? 6500 : 2800));
    }
    let savedShow = null, savedHide = null;
    function flashSaved() {
        clearTimeout(savedShow);
        savedShow = setTimeout(() => {
            const el = $('#saved');
            el.classList.add('is-on');
            clearTimeout(savedHide);
            savedHide = setTimeout(() => el.classList.remove('is-on'), 1300);
        }, 500);
    }
    function confirmDlg(o) {
        const dlg = $('#dlg');
        if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(o.title + '\n\n' + o.body));
        $('#dlgTitle').textContent = o.title;
        $('#dlgBody').textContent = o.body;
        const ok = $('#dlgOk'), cancel = $('#dlgCancel');
        ok.textContent = o.ok || 'אישור';
        ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
        return new Promise(resolve => {
            const done = v => {
                ok.onclick = cancel.onclick = dlg.oncancel = null;
                if (dlg.open) dlg.close();
                resolve(v);
            };
            ok.onclick = () => done(true);
            cancel.onclick = () => done(false);
            dlg.oncancel = ev => { ev.preventDefault(); done(false); };
            dlg.showModal();
            cancel.focus();
        });
    }

    // ---------- ניווט ----------
    function setTab(tab, opts) {
        if (TABS.indexOf(tab) === -1) return;
        const o = opts || {};
        ui.scroll[ui.tab] = window.scrollY;
        ui.tab = tab;
        $$('.tab').forEach(b => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('active', on);
            if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        const isList = tab === 'home' || tab === 'bag';
        $('#view-list').hidden = !isList;
        $('#view-list').setAttribute('aria-labelledby', 'tab-' + (isList ? tab : 'home'));
        $('#view-dash').hidden = tab !== 'dash';
        $('#view-settings').hidden = tab !== 'settings';
        if (isList && ui.filter === 'topack' && tab !== 'bag') ui.filter = 'all';
        refreshView();
        if (isList) {
            const on = $('#chips .chip.is-on');
            if (ui.filter === 'all' || !on) $('#chips').scrollLeft = 0; else on.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
        if (!o.keepScroll) window.scrollTo(0, o.top ? 0 : (ui.scroll[tab] || 0));
        try { sessionStorage.setItem('shuli.tab', tab); } catch (e) { /* לא קריטי */ }
    }
    function refreshView() {
        if (ui.tab === 'dash') renderDash();
        else if (ui.tab === 'settings') renderSettings();
        else { renderChips(); renderList(); }
    }
    function renderAll() { renderHeader(); renderNotices(); refreshView(); }

    // ---------- שולי ----------
    const BARKS = ['הב הב!', 'אני שומרת', 'עוד קצת!', 'יש חטיף?', 'יאללה!', 'הכי ארוכה'];
    let barkAt = 0, barkTimer = null;
    function bark() {
        const dog = $('#heroDog'), bubble = $('#bubble');
        dog.classList.remove('is-happy'); void dog.offsetWidth; dog.classList.add('is-happy');
        bubble.textContent = BARKS[barkAt++ % BARKS.length];
        bubble.classList.add('is-on');
        clearTimeout(barkTimer);
        barkTimer = setTimeout(() => { bubble.classList.remove('is-on'); dog.classList.remove('is-happy'); }, 2000);
    }

    // ---------- הפעלה ----------
    function bind() {
        const list = $('#list');
        list.addEventListener('click', onListClick);
        list.addEventListener('submit', onListSubmit);
        list.addEventListener('input', onListInput);
        list.addEventListener('change', onListChange);

        $('#view-dash').addEventListener('click', onDashClick);
        const settings = $('#view-settings');
        settings.addEventListener('click', onSettingsClick);
        settings.addEventListener('input', onSettingsInput);
        settings.addEventListener('change', onSettingsChange);
        const notices = $('#notices');
        notices.addEventListener('click', onNoticeClick);
        notices.addEventListener('input', onSettingsInput);
        notices.addEventListener('change', onSettingsInput);

        $('.tabbar').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab, b.dataset.tab === ui.tab ? { top: true } : null); });
        $('#chips').addEventListener('click', e => {
            const b = e.target.closest('.chip');
            if (!b) return;
            ui.filter = ui.filter === b.dataset.filter ? 'all' : b.dataset.filter;
            renderChips(); renderList();
        });

        const q = $('#q'), qClear = $('#qClear');
        let qTimer = null;
        q.addEventListener('input', () => {
            ui.q = q.value; ui.qn = norm(q.value);
            qClear.hidden = !q.value;
            clearTimeout(qTimer); qTimer = setTimeout(renderList, 110);
        });
        q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
        qClear.addEventListener('click', () => { q.value = ''; ui.q = ''; ui.qn = ''; qClear.hidden = true; renderList(); q.focus(); });

        $('#heroDog').addEventListener('click', bark);

        const toolbar = $('#toolbar');
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => { ticking = false; toolbar.classList.toggle('is-stuck', window.scrollY > 8 && toolbar.getBoundingClientRect().top <= 1); });
        }, { passive: true });

        // שומרים את העותק השני מיד כשהאפליקציה יורדת לרקע או נסגרת.
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushMirror(); });
        window.addEventListener('pagehide', flushMirror);
        window.addEventListener('storage', e => {
            if (e.key !== STORE_KEY || !e.newValue) return;
            try { const s = normalizeState(JSON.parse(e.newValue)); if (s) { state = s; renderAll(); } } catch (err) { /* מתעלמים מעדכון לא קריא */ }
        });
        window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.installEvt = e; renderNotices(); if (ui.tab === 'settings') renderSettings(); });
        window.addEventListener('appinstalled', () => { ui.installEvt = null; renderNotices(); });
    }

    function registerSW() {
        if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
        const hadController = !!navigator.serviceWorker.controller;
        const register = () => { navigator.serviceWorker.register('sw.js').catch(() => { /* אין שירות רקע, ממשיכים בלעדיו */ }); };
        if (document.readyState === 'complete') register(); else window.addEventListener('load', register);
        let told = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadController || told) return;
            told = true;
            toast('יש גרסה חדשה של הרשימה', { ms: 12000, action: { label: 'רענון', fn: () => location.reload() } });
        });
    }

    function boot() {
        $('#heroDog').innerHTML = window.Shuli.full();
        const local = readLocal();
        return withTimeout(idbGet('state'), local ? 600 : 2500).then(raw => {
            try { return typeof raw === 'string' ? normalizeState(JSON.parse(raw)) : null; } catch (e) { return null; }
        }, () => null).then(mirror => {
            let restored = false;
            if (local && mirror) state = mirror.meta.updatedAt > local.meta.updatedAt ? mirror : local;
            else if (local) state = local;
            else if (mirror) { state = mirror; restored = true; }
            else state = freshState();
            persist();

            let tab = 'home';
            try { tab = sessionStorage.getItem('shuli.tab') || 'home'; } catch (e) { tab = 'home'; }
            ui.tab = TABS.indexOf(tab) === -1 ? 'home' : tab;
            ui.lastPct = 0;
            bind();
            renderHeader(); renderNotices();
            setTab(ui.tab, { top: true });
            document.documentElement.classList.add('is-ready');
            if (restored) toast('הנתונים שוחזרו מהעותק הפנימי במכשיר', { ms: 6000 });
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { /* הדפדפן מחליט */ });
            registerSW();
        });
    }

    // חלון הצצה לבדיקות ולאיתור תקלות.
    window.ShuliApp = {
        version: APP_VERSION, ready: null, env, ui,
        get state() { return state; },
        parseNum, parseQty, money, plannedOf, spentOf, daysUntil, countdownText, pregnancyWeek,
        normalizeState, freshState, computeStats, shareText, buildXlsx, backupPayload, parseBackup, setTab, flushMirror
    };
    window.ShuliApp.ready = boot();
})();
