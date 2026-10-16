/* Personal Finance Ledger — UI layer. Depends on window.Ledger (js/ledger.js). */
(function () {
  'use strict';
  const L = window.Ledger;
  const STORAGE_KEY = 'pf-ledger-book-v1';
  const OLD_PRACTICE_KEY = 'pf-ledger-practice-v1'; // practice mode was removed; its leftover data is cleared on load
  const PREFS_KEY = 'pf-ledger-prefs-v1';

  // ---------------------------------------------------------------------------
  // State & persistence
  // ---------------------------------------------------------------------------

  let prefs = loadPrefs();
  if (prefs.practice !== undefined) {
    delete prefs.practice;
    try { localStorage.removeItem(OLD_PRACTICE_KEY); localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }
  let book = load();

  function load() {
    const b = readBook(STORAGE_KEY);
    b.people = b.people || [];
    // Books made before the peso became the default: switch unless the user picked USD themselves.
    if (b.currency === 'USD' && !b.currencyChosen) b.currency = 'PHP';
    return b;
  }

  function readBook(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const b = JSON.parse(raw);
        if (b && Array.isArray(b.accounts) && Array.isArray(b.entries)) return b;
      }
    } catch (e) { /* fall through to a fresh book */ }
    return L.emptyBook();
  }

  function save() {
    book.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(book)); }
    catch (e) { toast('Could not save to browser storage — export a backup from Settings.'); }
  }

  // ---------------------------------------------------------------------------
  // Backups: a JSON file the user keeps (Drive, Files, email…). We remember when the last one was made.
  // ---------------------------------------------------------------------------

  const BACKUP_KEY = 'pf-ledger-last-backup-v1';
  const BACKUP_REMIND_DAYS = 7;

  function lastBackupAt() { try { return localStorage.getItem(BACKUP_KEY); } catch (e) { return null; } }

  async function backupNow() {
    const stamp = new Date();
    const name = 'ledger-backup-' + today() + '-' + String(stamp.getHours()).padStart(2, '0') + String(stamp.getMinutes()).padStart(2, '0') + '.json';
    const payload = Object.assign({}, book, { backupCreatedAt: stamp.toISOString(), app: 'Personal Ledger' });
    await saveFile(name, JSON.stringify(payload, null, 2), 'application/json');
    try { localStorage.setItem(BACKUP_KEY, stamp.toISOString()); } catch (e) { /* ignore */ }
    toast('Backup saved — keep the file somewhere safe (Drive, Files, email)');
    rerender();
  }

  /** True when there is unbacked-up work: never backed up, or changed since a backup that is a week old. */
  function backupDue() {
    if (!book.entries.length) return false;
    const last = lastBackupAt();
    if (!last) return true;
    const changed = book.updatedAt && book.updatedAt > last;
    return changed && (Date.now() - new Date(last).getTime()) > BACKUP_REMIND_DAYS * 86400000;
  }

  function restoreBackup(file) {
    return file.text().then((text) => {
      let b;
      try { b = JSON.parse(text); } catch (e) { throw new Error('This file is not a backup (it is not valid JSON).'); }
      if (!b || !Array.isArray(b.accounts) || !Array.isArray(b.entries)) throw new Error('This file is not a Personal Ledger backup.');
      b.people = b.people || [];
      const when = b.backupCreatedAt ? new Date(b.backupCreatedAt).toLocaleString() : 'unknown date';
      const realAccounts = b.accounts.filter((a) => (a.type === 'asset' || a.type === 'liability') && !a.personId).length;
      if (!confirm('Restore this backup?\n\nMade: ' + when + '\n' + realAccounts + ' accounts & cards, ' + (b.people || []).length + ' people, ' + b.entries.length + ' entries\n\nThis REPLACES everything currently in the app.')) return false;
      delete b.backupCreatedAt; delete b.app;
      book = b; commit(); toast('Backup restored');
      return true;
    });
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Native app (Android via Capacitor) — the same code runs in the browser
  // ---------------------------------------------------------------------------

  const Native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
    ? window.Capacitor.Plugins : null;

  /** Save a file: a normal download in the browser, the Android share sheet in the app. */
  async function saveFile(name, text, type) {
    if (Native && Native.Filesystem && Native.Share) {
      try {
        const res = await Native.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
        await Native.Share.share({ title: name, url: res.uri, dialogTitle: 'Save or send ' + name });
      } catch (err) {
        if (!/cancel/i.test(String(err && err.message))) alert('Could not share the file: ' + (err.message || err));
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Print / PDF. Android's WebView cannot print, so the app shares the report as a page to open in Chrome. */
  function printPage() {
    if (!Native) { window.print(); return; }
    const title = ($('.st-head .title') || $('h1') || {}).textContent || 'Report';
    const css = Array.from(document.styleSheets).map((sh) => { try { return Array.from(sh.cssRules).map((r) => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title><style>' + css +
      '</style></head><body><main class="main" style="max-width:900px;margin:0 auto">' + main.innerHTML + '</main><script>setTimeout(function(){window.print()},400)<\/script></body></html>';
    saveFile(title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.html', html, 'text/html');
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const main = $('#main');
  const dialog = $('#dialog');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function money(cents, opts) { return L.formatMoney(cents, book.currency, opts); }
  function moneyCell(cents, opts) {
    opts = opts || {};
    const cls = opts.color ? (cents < 0 ? 'neg' : cents > 0 ? 'pos' : '') : '';
    return '<td class="num ' + cls + '">' + (cents === 0 && opts.blankZero ? '' : money(cents, { parens: opts.parens })) + '</td>';
  }
  function amt(cents) { return cents ? money(cents) : ''; }
  function centsToInput(c) { return c ? (c / 100).toFixed(2) : ''; }

  function acct(id) { return L.findAccount(book, id); }
  function acctName(id) { const a = acct(id); return a ? a.name : '(deleted account)'; }

  const today = () => L.todayISO();
  function monthStart(iso) { return iso.slice(0, 8) + '01'; }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtMonth(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }

  function toast(msg) {
    $$('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  const CLASS_LABEL = {
    cash: 'Cash', receivable: 'Receivable', investment: 'Investment', other_asset: 'Other asset',
    credit_card: 'Credit card', payable: 'Payable', loan: 'Loan', equity: 'Equity', income: 'Income', expense: 'Expense',
  };
  function classBadge(a) {
    const c = L.classify(a);
    const cls = c === 'cash' ? 'cash' : (c === 'credit_card' || c === 'loan' || c === 'payable') ? 'liab' : c === 'investment' ? 'inv' : '';
    return '<span class="badge ' + cls + '">' + esc(CLASS_LABEL[c] || c) + '</span>';
  }
  function kindBadge(kind) {
    const cls = kind === 'adjusting' ? 'adj' : kind === 'closing' ? 'liab' : kind === 'opening' ? 'inv' : '';
    return '<span class="badge ' + cls + '">' + esc(L.ENTRY_KINDS[kind] || kind) + '</span>';
  }

  const isBalanceSheet = (a) => ['asset', 'liability'].includes(a.type);
  const activeAccounts = (pred) => L.orderAccounts(book.accounts).filter((a) => !a.archived && (!pred || pred(a)));

  function accountOptions(selectedId, pred, opts) {
    opts = opts || {};
    const groups = [
      ['Bank, debit & cash (assets)', (a) => L.classify(a) === 'cash'],
      ['Credit cards (liabilities)', (a) => L.classify(a) === 'credit_card'],
      ['Investments', (a) => L.classify(a) === 'investment'],
      ['Other assets', (a) => ['other_asset', 'receivable'].includes(L.classify(a)) && !a.personId],
      ['Loans & other liabilities', (a) => L.classify(a) === 'loan' || (L.classify(a) === 'payable' && !a.personId)],
      ['People — receivables & payables', (a) => !!a.personId],
      ['Expense categories', (a) => a.type === 'expense'],
      ['Income categories', (a) => a.type === 'income'],
      ['Equity', (a) => a.type === 'equity'],
    ];
    if (opts.order) groups.sort((x, y) => opts.order.indexOf(x[0]) - opts.order.indexOf(y[0]));
    let html = opts.placeholder ? '<option value="">' + esc(opts.placeholder) + '</option>' : '';
    for (const [label, g] of groups) {
      const list = L.orderAccounts(book.accounts).filter((a) =>
        g(a) && (!pred || pred(a)) && (!a.archived || a.id === selectedId));
      if (!list.length) continue;
      html += '<optgroup label="' + esc(label) + '">' + list.map((a) =>
        '<option value="' + a.id + '"' + (a.id === selectedId ? ' selected' : '') + '>' + esc(a.name) +
        (a.last4 ? ' ••' + esc(a.last4) : '') + '</option>').join('') + '</optgroup>';
    }
    return html;
  }

  // Colours you can give a bank account or card (any custom colour is allowed too).
  const ACCOUNT_COLORS = [
    ['#15803d', 'Green'], ['#1d4ed8', 'Blue'], ['#0e7490', 'Teal'], ['#7c3aed', 'Violet'], ['#be185d', 'Pink'],
    ['#dc2626', 'Red'], ['#ea580c', 'Orange'], ['#ca8a04', 'Gold'], ['#475569', 'Slate'], ['#111827', 'Black'],
  ];
  const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
  /** A small coloured dot for an account (empty when it has no colour). */
  function colorDot(a) { return a && isHex(a.color) ? '<span class="acct-dot" style="--acct-color:' + a.color + '"></span>' : ''; }

  // Combined "account kind" choices for the add-account form.
  const ACCOUNT_KINDS = [
    ['asset:checking', 'Bank account / debit card — cash asset'],
    ['asset:savings', 'Savings account — cash asset'],
    ['asset:cash', 'Cash on hand / e-wallet — cash asset'],
    ['liability:credit_card', 'Credit card — liability'],
    ['asset:investment', 'Brokerage / stocks / funds — investment'],
    ['asset:retirement', 'Retirement account — investment'],
    ['asset:crypto', 'Crypto — investment'],
    ['asset:property', 'Real estate — other asset'],
    ['asset:vehicle', 'Vehicle — other asset'],
    ['asset:receivable', 'Money owed to me — other asset'],
    ['asset:other', 'Other asset (jewelry, collectibles…)'],
    ['liability:loan', 'Loan (auto, personal, student) — liability'],
    ['liability:mortgage', 'Mortgage — liability'],
    ['liability:other', 'Other liability'],
    ['expense:operating', 'Expense category'],
    ['income:operating', 'Income category'],
  ];

  // Period presets for reports.
  function periodRange(preset, custom) {
    const t = today();
    const y = +t.slice(0, 4), m = +t.slice(5, 7) - 1;
    switch (preset) {
      case 'this-month': return { from: monthStart(t), to: t };
      case 'last-month': {
        const ly = m === 0 ? y - 1 : y, lm = m === 0 ? 11 : m - 1;
        return { from: ly + '-' + String(lm + 1).padStart(2, '0') + '-01', to: L.monthEnd(ly, lm) };
      }
      case 'ytd': return { from: y + '-01-01', to: t };
      case 'last-year': return { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31' };
      case 'all': {
        const first = book.entries.reduce((d, e) => (!d || e.date < d ? e.date : d), null);
        return { from: first || t, to: t };
      }
      default: return { from: (custom && custom.from) || monthStart(t), to: (custom && custom.to) || t };
    }
  }

  const PRESETS = [['this-month', 'This month'], ['last-month', 'Last month'], ['ytd', 'Year to date'], ['last-year', 'Last year'], ['all', 'All time'], ['custom', 'Custom']];

  function periodToolbar(state, onChange) {
    const r = periodRange(state.preset, state);
    const html =
      '<label class="field">Period<select data-p="preset">' +
      PRESETS.map(([v, l]) => '<option value="' + v + '"' + (state.preset === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select></label>' +
      '<label class="field">From<input type="date" data-p="from" value="' + r.from + '"></label>' +
      '<label class="field">To<input type="date" data-p="to" value="' + r.to + '"></label>';
    const bind = (root) => {
      $$('[data-p]', root).forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.p;
        if (k === 'preset') {
          state.preset = el.value;
          if (el.value === 'custom') Object.assign(state, periodRange('custom', state));
        } else {
          state.preset = 'custom';
          state[k] = el.value;
        }
        onChange();
      }));
    };
    return { html, bind, range: r };
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------

  const routes = {
    dashboard: renderDashboard,
    accounts: renderAccounts,
    register: (p) => renderRegister(p.get('account')),
    transactions: renderTransactions,
    ledger: (p) => renderLedger(p),
    people: renderPeople,
    adjust: renderAdjust,
    statements: renderStatements,
    close: renderClose,
    settings: renderSettings,
  };

  function currentRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, query] = h.split('?');
    const params = new URLSearchParams(query || '');
    return { name: routes[name] ? name : 'dashboard', params };
  }

  function render() {
    const r = currentRoute();
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r.name));
    const tabFor = { dashboard: 'dashboard', register: 'register', people: 'people', statements: 'reports', ledger: 'reports' };
    $$('.tabbar [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (tabFor[r.name] || 'menu')));
    const navLink = $('.nav a[data-route="' + r.name + '"]');
    $('#bar-title').textContent = navLink ? navLink.textContent.trim() : 'Ledger';
    $('#app').classList.remove('nav-open');
    routes[r.name](r.params);
  }

  function rerender() { render(); }

  function commit() { save(); rerender(); }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  $('#nav-toggle').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
  // Desktop sidebar: collapsed to an icon rail by default; the choice is remembered.
  function applySidebar() {
    const collapsed = !prefs.sidebarExpanded;
    $('#app').classList.toggle('side-collapsed', collapsed);
    const t = $('#side-toggle');
    t.setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu');
    t.title = collapsed ? 'Expand menu' : 'Collapse menu';
    t.setAttribute('aria-expanded', String(!collapsed));
  }
  $('#side-toggle').addEventListener('click', () => { prefs.sidebarExpanded = !prefs.sidebarExpanded; savePrefs(); applySidebar(); });
  applySidebar();
  $('#tab-menu').addEventListener('click', (e) => { e.preventDefault(); $('#app').classList.toggle('nav-open'); });
  $('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  function renderDashboard() {
    const t = today();
    const bs = L.balanceSheet(book, t);
    const ms = monthStart(t);
    const is = L.incomeStatement(book, ms, t);
    const hasAccounts = book.accounts.some((a) => isBalanceSheet(a) && a.id !== 'acc_cash') || book.entries.length;

    const kpis =
      '<div class="kpis">' +
      kpi('Net worth', bs.netWorth, 'Assets − liabilities', true) +
      kpi('Cash (bank, debit, cash)', bs.totals.cash, countOf('cash')) +
      kpi('Investments', bs.totals.investments, countOf('investment')) +
      kpi('Other assets', bs.totals.otherAssets + bs.totals.receivables, 'Property, vehicles, receivables') +
      kpi('Liabilities', bs.totals.liabilities, money(bs.totals.creditCards) + ' on credit cards') +
      '</div>';

    const month =
      '<div class="card"><h2>This month</h2>' +
      '<div class="kpis" style="margin-bottom:0">' +
      kpi('Income', is.totalIncome, '') +
      kpi('Expenses', is.totalExpenses, '') +
      kpi('Net income', is.netIncome, is.savingsRate == null ? '' : 'Savings rate ' + Math.round(is.savingsRate * 100) + '%') +
      '</div></div>';

    // Only plot months from the first recorded entry onward.
    const firstDate = book.entries.reduce((d, e) => (!d || e.date < d ? e.date : d), null);
    let series = L.netWorthSeries(book, t, 12);
    if (firstDate) {
      const trimmed = series.filter((p) => p.date >= firstDate);
      series = trimmed.length >= 2 ? trimmed : series.slice(-2);
    }
    const chart = '<div class="card"><h2>Net worth, last 12 months</h2><div id="nw-chart" class="chart"></div>' +
      '<details class="small" style="margin-top:8px"><summary class="muted">Show as table</summary><div class="table-wrap"><table><thead><tr><th>Month end</th><th class="num">Assets</th><th class="num">Liabilities</th><th class="num">Net worth</th></tr></thead><tbody>' +
      series.map((p) => '<tr><td>' + fmtDate(p.date) + '</td><td class="num">' + money(p.assets) + '</td><td class="num">' + money(p.liabilities) + '</td><td class="num">' + money(p.netWorth) + '</td></tr>').join('') +
      '</tbody></table></div></details></div>';

    const topExp = is.expenses.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 7);
    const maxExp = topExp.length ? topExp[0].amount : 0;
    const spend = '<div class="card"><h2>Top spending this month</h2>' + (topExp.length
      ? '<div class="bar-list">' + topExp.map((r) =>
        '<div class="row"><span>' + esc(r.account.name) + '</span><span class="num">' + money(r.amount) + '</span>' +
        '<div class="track"><div class="fill" style="width:' + Math.max(2, (r.amount / maxExp) * 100) + '%"></div></div></div>').join('') + '</div>'
      : '<div class="empty">No expenses recorded this month.</div>') + '</div>';

    const groups = [
      ['Bank, debit & cash', 'cash'], ['Credit cards', 'credit_card'], ['Investments', 'investment'],
      ['Other assets', 'other_asset'], ['Loans', 'loan'],
    ];
    const bals = L.balances(book, { to: t });
    const accountsCard = '<div class="card"><div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Accounts</h2><a href="#/accounts" class="small">Manage</a></div>' +
      groups.map(([label, cls]) => {
        const list = activeAccounts((a) => L.classify(a) === cls && !a.personId);
        if (!list.length) return '';
        return '<h3 style="margin-top:12px">' + label + '</h3><table><tbody>' + list.map((a) =>
          '<tr class="click" data-href="#/transactions?account=' + a.id + '"><td>' + colorDot(a) + esc(a.name) +
          (a.last4 ? ' <span class="muted">••' + esc(a.last4) + '</span>' : '') + '</td>' +
          '<td class="num">' + money(bals.get(a.id).balance) + '</td></tr>').join('') + '</tbody></table>';
      }).join('') + '</div>';

    const ppl = L.peopleSummary(book, t).filter((x) => x.net !== 0).sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
    const peopleCard = '<div class="card"><div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">People</h2><a href="#/people" class="small">Open</a></div>' +
      (ppl.length ? '<table><tbody>' + ppl.slice(0, 6).map((x) =>
        '<tr class="click" data-href="#/people?person=' + x.person.id + '"><td>' + esc(x.person.name) + '</td><td>' +
        (x.net > 0 ? '<span class="badge cash">Owes you</span>' : '<span class="badge liab">You owe</span>') + '</td><td class="num">' + money(Math.abs(x.net)) + '</td></tr>').join('') + '</tbody></table>'
        : '<div class="empty small">No open receivables or payables. <a href="#/people">Add people</a> you lend to or borrow from.</div>') + '</div>';

    main.innerHTML =
      '<div class="page-head"><div><h1>Dashboard</h1><div class="sub">As of ' + fmtDate(t) +
      (L.closedThrough(book) ? ' · Books closed through ' + fmtDate(L.closedThrough(book)) : '') + '</div></div>' +
      '<div class="btn-row"><button id="add-tx">+ Quick transaction</button><button id="add-acct">+ Account / card</button><a class="btn primary" href="#/register">Encode bank transactions</a></div></div>' +
      (backupDue() ? '<div class="notice warn backup-nudge"><span>💾 ' + (lastBackupAt() ? 'You have changes since your last backup on ' + fmtDate(lastBackupAt().slice(0, 10)) + '.' : 'Your data is only on this device. Make a backup so you never lose it.') + '</span><button class="primary" id="dash-backup">Back up now</button></div>' : '') +
      (hasAccounts ? '' : '<div class="notice warn">Start by adding your bank accounts, debit and credit cards, investments and other assets — or load sample data in <a href="#/settings">Settings</a> to explore first.</div>') +
      kpis +
      '<div class="grid grid-2"><div>' + chart + month + peopleCard + '</div><div>' + accountsCard + spend + '</div></div>';

    drawLineChart($('#nw-chart'), series);
    bindRowLinks();
    $('#add-tx').onclick = () => openTxDialog({});
    $('#add-acct').onclick = () => openAccountDialog();
    if ($('#dash-backup')) $('#dash-backup').onclick = backupNow;

    function kpi(label, cents, hint, hero) {
      return '<div class="kpi' + (hero ? ' hero' : '') + '"><div class="label">' + esc(label) + '</div><div class="value">' +
        money(cents) + '</div>' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
    }
    function countOf(cls) { const n = activeAccounts((a) => L.classify(a) === cls).length; return n + (n === 1 ? ' account' : ' accounts'); }
  }

  function bindRowLinks(root) {
    $$('tr[data-href]', root).forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      location.hash = tr.dataset.href;
    }));
  }

  /** Single-series line chart with crosshair + tooltip. */
  function drawLineChart(el, series) {
    if (!el) return;
    const W = 640, H = 220, padL = 64, padR = 12, padT = 12, padB = 28;
    const vals = series.map((p) => p.netWorth);
    let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
    if (min === max) { max = min + 100; }
    const span = max - min;
    min -= span * 0.05; max += span * 0.05;
    const x = (i) => padL + (series.length === 1 ? 0 : (i / (series.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const ticks = niceTicks(min, max, 4);
    const grid = ticks.map((v) =>
      '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)" stroke-width="1"/>' +
      '<text x="' + (padL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + esc(shortMoney(v)) + '</text>').join('');
    const xl = series.map((p, i) => (i % 2 === series.length % 2 || series.length < 7)
      ? '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + esc(fmtMonth(p.date)) + '</text>' : '').join('');
    const path = series.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.netWorth).toFixed(1)).join(' ');
    const zero = min < 0 ? '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--muted)" stroke-width="1"/>' : '';
    el.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Net worth by month">' + grid + zero + xl +
      '<path d="' + path + '" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<line id="xh" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>' +
      '<circle id="dot" r="4.5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>' +
      '<rect x="' + padL + '" y="0" width="' + (W - padL - padR) + '" height="' + H + '" fill="transparent" id="hit"/>' +
      '</svg><div class="tip hidden"></div>';
    const svg = $('svg', el), tip = $('.tip', el), xh = $('#xh', el), dot = $('#dot', el);
    const show = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      let i = Math.round(((px - padL) / (W - padL - padR)) * (series.length - 1));
      i = Math.max(0, Math.min(series.length - 1, i));
      const p = series[i];
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.netWorth)); dot.setAttribute('visibility', 'visible');
      tip.classList.remove('hidden');
      tip.innerHTML = '<div class="muted">' + esc(fmtDate(p.date)) + '</div><b>' + esc(money(p.netWorth)) + '</b>';
      tip.style.left = (x(i) / W) * r.width + 'px';
      tip.style.top = (y(p.netWorth) / H) * r.height + 'px';
    };
    const hide = () => { tip.classList.add('hidden'); xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
    const hit = $('#hit', el);
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  function niceTicks(min, max, count) {
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v));
    return out;
  }

  function shortMoney(cents) {
    const v = cents / 100, a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : a.toFixed(0);
    return (v < 0 ? '-' : '') + s;
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  function renderAccounts() {
    const t = today();
    const bals = L.balances(book, { to: t });
    const sections = [
      ['Bank accounts, debit cards & cash', 'Cash assets', (a) => L.classify(a) === 'cash'],
      ['Credit cards', 'Liabilities', (a) => L.classify(a) === 'credit_card'],
      ['Investments', 'Assets', (a) => L.classify(a) === 'investment'],
      ['Other assets', 'Property, vehicles, receivables', (a) => ['other_asset', 'receivable'].includes(L.classify(a)) && !a.personId],
      ['Loans & other liabilities', 'Liabilities', (a) => (L.classify(a) === 'loan' || L.classify(a) === 'payable') && !a.personId],
    ];
    const showArchived = !!prefs.showArchived;
    const table = (pred, withRevalue) => {
      const list = L.orderAccounts(book.accounts).filter((a) => pred(a) && (showArchived || !a.archived));
      if (!list.length) return '<div class="empty small">None yet.</div>';
      return '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th class="num">Balance</th><th class="num no-print"></th></tr></thead><tbody>' +
        list.map((a) => '<tr class="click" data-href="#/transactions?account=' + a.id + '"><td>' + colorDot(a) + '<b>' + esc(a.name) + '</b>' +
          (a.institution || a.last4 ? '<div class="small muted">' + esc(a.institution || '') + (a.last4 ? ' ••' + esc(a.last4) : '') + '</div>' : '') +
          (a.archived ? ' <span class="badge">Archived</span>' : '') + '</td>' +
          '<td>' + esc(L.SUBTYPES[a.type][a.subtype] || a.subtype) + '</td>' +
          '<td class="num">' + money(bals.get(a.id).balance) + '</td>' +
          '<td class="num no-print">' + (withRevalue ? '<button class="link" data-reval="' + a.id + '">Revalue</button>' : '') +
          '<button class="link" data-edit="' + a.id + '">Edit</button></td></tr>').join('') +
        '</tbody></table></div>';
    };
    const cats = (type) => {
      const list = L.orderAccounts(book.accounts).filter((a) => a.type === type && (showArchived || !a.archived));
      return '<div class="table-wrap"><table><tbody>' + list.map((a) =>
        '<tr><td>' + esc(a.name) + (a.archived ? ' <span class="badge">Archived</span>' : '') +
        (a.subtype === 'unrealized' ? ' <span class="badge adj">Adjustments</span>' : '') + '</td>' +
        '<td class="num">' + money(L.balanceOf(book, a.id, { from: t.slice(0, 4) + '-01-01', to: t, excludeKinds: ['closing'] })) + '</td>' +
        '<td class="num"><button class="link" data-edit="' + a.id + '">Edit</button></td></tr>').join('') + '</tbody></table></div>';
    };

    main.innerHTML =
      '<div class="page-head"><div><h1>Accounts &amp; cards</h1><div class="sub">Debit cards and bank accounts are cash (assets), credit cards are liabilities, investments are investments.</div></div>' +
      '<div class="btn-row"><label class="small"><input type="checkbox" id="show-arch"' + (showArchived ? ' checked' : '') + '> Show archived</label>' +
      '<button class="primary" id="add-acct">+ Add account</button></div></div>' +
      '<div class="grid grid-2">' +
      sections.map(([title, sub, pred]) => '<div class="card"><h2>' + title + ' <span class="small muted">· ' + sub + '</span></h2>' +
        table(pred, title === 'Investments' || title === 'Other assets') + '</div>').join('') +
      '</div>' +
      '<div class="grid grid-2" style="margin-top:16px">' +
      '<div class="card"><h2>Expense categories <span class="small muted">· year to date</span></h2>' + cats('expense') + '</div>' +
      '<div class="card"><h2>Income categories <span class="small muted">· year to date</span></h2>' + cats('income') + '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h2>Equity</h2>' + table((a) => a.type === 'equity') +
      '<p class="small muted" style="margin-top:8px">Opening balances are recorded against Opening Balance Equity. Closing entries move net income into Retained Earnings. Together they make up your net worth.</p></div>';

    $('#add-acct').onclick = () => openAccountDialog();
    $('#show-arch').onchange = (e) => { prefs.showArchived = e.target.checked; savePrefs(); rerender(); };
    $$('[data-edit]').forEach((b) => b.onclick = () => openAccountDialog(b.dataset.edit));
    $$('[data-reval]').forEach((b) => b.onclick = () => { location.hash = '#/adjust?focus=' + b.dataset.reval; });
    bindRowLinks();
  }

  function openAccountDialog(id) {
    const a = id ? acct(id) : null;
    const used = a ? book.entries.some((e) => e.lines.some((l) => l.accountId === a.id)) : false;
    const kindVal = a ? a.type + ':' + a.subtype : 'asset:checking';
    const kindOptions = a
      ? Object.entries(L.SUBTYPES[a.type]).map(([k, v]) => '<option value="' + a.type + ':' + k + '"' + (a.subtype === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('')
      : ACCOUNT_KINDS.map(([v, l]) => '<option value="' + v + '">' + esc(l) + '</option>').join('');
    showDialog(
      (a ? 'Edit account' : 'Add account / card'),
      '<div class="form-grid">' +
      '<label class="field full">Name<input id="f-name" required value="' + esc(a ? a.name : '') + '" placeholder="e.g. BDO Savings, Chase Sapphire Visa, Toyota Vios"></label>' +
      '<label class="field full">Type<select id="f-kind"' + (a && a.system ? ' disabled' : '') + '>' + kindOptions + '</select></label>' +
      '<label class="field bs">Institution<input id="f-inst" value="' + esc(a && a.institution || '') + '" placeholder="Bank / broker"></label>' +
      '<label class="field bs">Last 4 digits<input id="f-last4" maxlength="4" inputmode="numeric" value="' + esc(a && a.last4 || '') + '"></label>' +
      '<div class="field full bs"><span>Colour</span><div class="swatches" role="radiogroup" aria-label="Account colour">' +
      '<button type="button" class="swatch none' + (a && isHex(a.color) ? '' : ' on') + '" data-color="" title="No colour" aria-label="No colour"></button>' +
      ACCOUNT_COLORS.map(([c, n]) => '<button type="button" class="swatch' + (a && a.color && a.color.toLowerCase() === c ? ' on' : '') + '" data-color="' + c + '" style="--acct-color:' + c + '" title="' + n + '" aria-label="' + n + '"></button>').join('') +
      '<label class="swatch custom' + (a && isHex(a.color) && !ACCOUNT_COLORS.some(([c]) => c === a.color.toLowerCase()) ? ' on' : '') + '" title="Custom colour"><input type="color" id="f-color-custom" value="' + (a && isHex(a.color) ? a.color : '#15803d') + '" aria-label="Custom colour"></label>' +
      '</div><input type="hidden" id="f-color" value="' + esc(a && isHex(a.color) ? a.color : '') + '"></div>' +
      (a ? '' :
        '<label class="field bs">Opening balance<input id="f-open" inputmode="decimal" placeholder="0.00"></label>' +
        '<label class="field bs">As of<input id="f-open-date" type="date" value="' + L.addDays(today(), -1) + '"></label>' +
        '<p class="small muted full bs" id="open-hint"></p>') +
      '</div>',
      [
        a && !a.system ? (used
          ? '<button class="danger" data-act="archive">' + (a.archived ? 'Unarchive' : 'Archive') + '</button>'
          : '<button class="danger" data-act="delete">Delete</button>') : '',
        '<button data-act="cancel">Cancel</button><button class="primary" data-act="save">Save</button>',
      ],
    );
    const kindSel = $('#f-kind', dialog);
    const updateKind = () => {
      const [type, sub] = kindSel.value.split(':');
      $$('.bs', dialog).forEach((el) => el.classList.toggle('hidden', !['asset', 'liability'].includes(type)));
      const hint = $('#open-hint', dialog);
      if (hint) hint.textContent = type === 'liability'
        ? 'For a credit card or loan, enter the amount you currently owe.'
        : (sub === 'property' || sub === 'vehicle' || L.INVESTMENT_SUBTYPES.includes(sub))
          ? 'Enter the current market value. You can revalue it later on the Adjustments page.'
          : 'Enter the current balance. It is posted against Opening Balance Equity.';
    };
    kindSel.onchange = updateKind;
    updateKind();
    const pickColor = (c, el) => {
      $('#f-color', dialog).value = c;
      $$('.swatch', dialog).forEach((x) => x.classList.toggle('on', x === el));
    };
    $$('.swatch[data-color]', dialog).forEach((b) => b.onclick = () => pickColor(b.dataset.color, b));
    $('#f-color-custom', dialog).addEventListener('input', (e) => pickColor(e.target.value, e.target.closest('.swatch')));
    $('#f-name', dialog).focus();

    dialogAction('cancel', closeDialog);
    dialogAction('delete', () => {
      if (!confirm('Delete "' + a.name + '"?')) return;
      book.accounts = book.accounts.filter((x) => x.id !== a.id);
      closeDialog(); commit();
    });
    dialogAction('archive', () => { a.archived = !a.archived; closeDialog(); commit(); });
    dialogAction('save', () => {
      const name = $('#f-name', dialog).value.trim();
      if (!name) return dialogError('Name is required.');
      const [type, subtype] = kindSel.value.split(':');
      const color = $('#f-color', dialog).value;
      const fields = { name, institution: $('#f-inst', dialog).value.trim() || undefined, last4: $('#f-last4', dialog).value.trim() || undefined, color: isHex(color) ? color : undefined };
      if (!['asset', 'liability'].includes(type)) { delete fields.institution; delete fields.last4; delete fields.color; }
      if (a) {
        Object.assign(a, fields);
        if (!a.system) { a.type = type; a.subtype = subtype; }
        closeDialog(); commit(); return;
      }
      const newAcct = Object.assign({ id: L.uid('acc'), type, subtype }, fields);
      const openRaw = $('#f-open', dialog).value;
      const openC = openRaw ? L.toCents(openRaw) : 0;
      if (openRaw && isNaN(openC)) return dialogError('Opening balance is not a valid amount.');
      book.accounts.push(newAcct);
      if (openC && ['asset', 'liability'].includes(type)) {
        try { L.postEntry(book, L.openingEntry(book, newAcct, $('#f-open-date', dialog).value, openC)); }
        catch (err) { book.accounts.pop(); return dialogError(err.message); }
      }
      closeDialog(); commit(); toast('Added ' + name);
    });
  }

  // ---------------------------------------------------------------------------
  // Transactions (account registers)
  // ---------------------------------------------------------------------------

  const txState = { preset: 'all', search: '', kind: '' };

  function renderTransactions(params) {
    const accountId = params.get('account') || '';
    const a = accountId ? acct(accountId) : null;
    if (a && isBalanceSheet(a)) { location.replace('#/register?account=' + a.id); return; }
    const pt = periodToolbar(txState, rerender);
    const r = pt.range;
    const q = txState.search.toLowerCase();
    const match = (e) => (!q || (e.description + ' ' + (e.memo || '') + ' ' + e.lines.map((l) => acctName(l.accountId)).join(' ')).toLowerCase().includes(q)) &&
      (!txState.kind || e.kind === txState.kind);

    let body;
    if (a) {
      const opening = L.balanceOf(book, a.id, { to: L.addDays(r.from, -1) });
      const rows = L.register(book, a.id, { from: r.from, to: r.to });
      let running = opening;
      const isLiab = a.type === 'liability';
      const isCat = !isBalanceSheet(a);
      const incLabel = isLiab ? 'Charge / borrow (+)' : isCat ? (a.type === 'expense' ? 'Spent (+)' : 'Earned (+)') : 'Money in (+)';
      const decLabel = isLiab ? 'Payment / refund (−)' : isCat ? 'Refund (−)' : 'Money out (−)';
      // Colour by effect on net worth: a credit card charge is bad news, a payment is good.
      const incCls = isCat ? '' : isLiab ? 'neg' : 'pos';
      const decCls = isCat ? '' : isLiab ? 'pos' : 'neg';
      const out = rows.map((row) => { running = opening + row.balance; return { row, running }; }).filter((x) => match(x.row.entry)).reverse();
      body = '<div class="kpis">' +
        '<div class="kpi"><div class="label">' + (isLiab ? 'Balance owed' : 'Balance') + ' (' + fmtDate(r.to) + ')</div><div class="value">' + money(opening + (rows.length ? rows[rows.length - 1].balance : 0)) + '</div><div class="hint">' + classBadge(a) + '</div></div>' +
        '<div class="kpi"><div class="label">Starting balance</div><div class="value">' + money(opening) + '</div><div class="hint">' + fmtDate(L.addDays(r.from, -1)) + '</div></div>' +
        '<div class="kpi"><div class="label">' + esc(incLabel) + '</div><div class="value">' + money(rows.reduce((s, x) => s + Math.max(0, x.delta), 0)) + '</div></div>' +
        '<div class="kpi"><div class="label">' + esc(decLabel) + '</div><div class="value">' + money(rows.reduce((s, x) => s + Math.max(0, -x.delta), 0)) + '</div></div>' +
        '</div>' +
        '<div class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Category / account</th><th class="num">' + esc(incLabel) + '</th><th class="num">' + esc(decLabel) + '</th><th class="num">Balance</th></tr></thead><tbody>' +
        (out.length ? out.map(({ row, running: bal }) =>
          '<tr class="click" data-entry="' + row.entry.id + '"><td>' + fmtDate(row.entry.date) + '</td><td>' + esc(row.entry.description || '—') +
          (row.entry.kind !== 'expense' && row.entry.kind !== 'income' ? ' ' + kindBadge(row.entry.kind) : '') + '</td>' +
          '<td>' + (row.counterIds.length === 1 ? esc(acctName(row.counterIds[0])) : row.counterIds.length ? 'Split (' + row.counterIds.length + ')' : '') + '</td>' +
          '<td class="num ' + incCls + '">' + (row.delta > 0 ? money(row.delta) : '') + '</td><td class="num ' + decCls + '">' + (row.delta < 0 ? money(-row.delta) : '') + '</td>' +
          '<td class="num">' + money(bal) + '</td></tr>').join('')
          : '<tr><td colspan="6" class="empty">No transactions in this period.</td></tr>') +
        '</tbody></table></div></div>';
    } else {
      const entries = L.sortedEntries(L.selectEntries(book, { from: r.from, to: r.to, filter: match, excludeKinds: ['closing'] })).reverse();
      body = '<div class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>From (credit)</th><th>To (debit)</th><th class="num">Amount</th><th>Type</th></tr></thead><tbody>' +
        (entries.length ? entries.map((e) => {
          const dr = e.lines.filter((l) => l.debit), cr = e.lines.filter((l) => l.credit);
          const names = (ls) => ls.length === 1 ? esc(acctName(ls[0].accountId)) : 'Split (' + ls.length + ')';
          return '<tr class="click" data-entry="' + e.id + '"><td>' + fmtDate(e.date) + '</td><td>' + esc(e.description || '—') + '</td><td>' + names(cr) + '</td><td>' + names(dr) + '</td>' +
            '<td class="num">' + money(L.sumLines(e.lines).debit) + '</td><td>' + kindBadge(e.kind) + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="empty">No transactions yet. Click “+ Transaction” to record one.</td></tr>') +
        '</tbody></table></div></div>';
    }

    main.innerHTML =
      '<div class="page-head"><div><h1>' + (a ? esc(a.name) : 'All transactions') + '</h1><div class="sub">' +
      (a ? esc(L.SUBTYPES[a.type][a.subtype] || '') + (a.institution ? ' · ' + esc(a.institution) : '') + (a.last4 ? ' ••' + esc(a.last4) : '') : 'Every entry across all your accounts and cards') + '</div></div>' +
      '<div class="btn-row"><button id="import-csv">Import CSV</button><button id="add-je">Split entry</button><button class="primary" id="add-tx">+ Transaction</button></div></div>' +
      '<div class="toolbar"><label class="field">Account / card<select id="tx-acct"><option value="">All accounts</option>' + accountOptions(accountId) + '</select></label>' +
      pt.html +
      '<label class="field">Type<select id="tx-kind"><option value="">All types</option>' +
      Object.entries(L.ENTRY_KINDS).filter(([k]) => k !== 'closing').map(([k, v]) => '<option value="' + k + '"' + (txState.kind === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
      '<label class="field" style="flex:1">Search<input id="tx-search" type="search" value="' + esc(txState.search) + '" placeholder="Description, memo, account"></label></div>' +
      body;

    pt.bind(main);
    $('#tx-acct').onchange = (e) => { location.hash = '#/transactions' + (e.target.value ? '?account=' + e.target.value : ''); };
    $('#tx-kind').onchange = (e) => { txState.kind = e.target.value; rerender(); };
    const search = $('#tx-search');
    search.oninput = debounce(() => { txState.search = search.value; rerender(); const s = $('#tx-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250);
    $('#add-tx').onclick = () => openTxDialog({ accountId: a && isBalanceSheet(a) ? a.id : '' });
    $('#add-je').onclick = () => openJournalDialog({});
    $('#import-csv').onclick = () => openImportDialog(a && isBalanceSheet(a) ? a.id : '');
    $$('tr[data-entry]').forEach((tr) => tr.onclick = () => editEntry(tr.dataset.entry, accountId));
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function editEntry(id, contextAccountId) {
    const e = book.entries.find((x) => x.id === id);
    if (!e) return;
    if (e.kind === 'closing') { location.hash = '#/close'; return; }
    if (['expense', 'income', 'transfer'].includes(e.kind) && e.lines.length === 2) {
      // Present from the perspective of the balance-sheet account.
      let ctx = contextAccountId && e.lines.some((l) => l.accountId === contextAccountId) && isBalanceSheet(acct(contextAccountId)) ? contextAccountId : null;
      if (!ctx) {
        const bsLines = e.lines.filter((l) => isBalanceSheet(acct(l.accountId) || {}));
        ctx = (e.kind === 'transfer' ? bsLines.find((l) => l.credit) : bsLines[0] || e.lines[0]).accountId;
      }
      const s = L.asSimple(e, ctx);
      if (e.kind === 'transfer') {
        // Show transfers as From (credited) → To (debited).
        const from = e.lines.find((l) => l.credit).accountId, to = e.lines.find((l) => l.debit).accountId;
        return openTxDialog({ entry: e, mode: 'transfer', accountId: from, counterId: to, amount: s.amount });
      }
      return openTxDialog({ entry: e, mode: s.direction, accountId: s.accountId, counterId: s.counterId, amount: s.amount });
    }
    openJournalDialog({ entry: e });
  }

  function openTxDialog(opts) {
    const e = opts.entry;
    let mode = opts.mode || 'out';
    const memoryHint = buildCategoryMemory();
    const render = () => {
      const isTransfer = mode === 'transfer';
      const counterOrder = mode === 'out'
        ? ['Expense categories', 'Income categories']
        : ['Income categories', 'Expense categories'];
      showDialog(e ? 'Edit transaction' : 'New transaction',
        '<div class="segmented" style="margin-bottom:14px">' +
        [['out', 'Money out / spend'], ['in', 'Money in / refund'], ['transfer', 'Transfer / payment']].map(([m, l]) =>
          '<button data-mode="' + m + '" class="' + (mode === m ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
        '<div class="form-grid">' +
        '<label class="field">' + (isTransfer ? 'From account' : mode === 'out' ? 'Paid with (account / card)' : 'Received into (account / card)') +
        '<select id="t-acct">' + accountOptions(opts.accountId, isBalanceSheet, { placeholder: 'Choose…' }) + '</select></label>' +
        '<label class="field">' + (isTransfer ? 'To account' : 'Category') + '<select id="t-counter">' +
        (isTransfer
          ? accountOptions(opts.counterId, isBalanceSheet, { placeholder: 'Choose…' })
          : accountOptions(opts.counterId, (a) => a.type === 'income' || a.type === 'expense', { placeholder: 'Choose…', order: counterOrder })) +
        '</select></label>' +
        '<label class="field">Amount<input id="t-amt" inputmode="decimal" placeholder="0.00" value="' + centsToInput(opts.amount) + '"></label>' +
        '<label class="field">Date<input id="t-date" type="date" value="' + (e ? e.date : opts.date || today()) + '"></label>' +
        '<label class="field full">Description<input id="t-desc" value="' + esc(e ? e.description : opts.description || '') + '" placeholder="' + (isTransfer ? 'e.g. Credit card payment, Move to savings, Buy ETF' : 'e.g. Grocery store, Salary') + '" list="desc-list"></label>' +
        '<label class="field full">Memo<input id="t-memo" value="' + esc(e ? e.memo : '') + '"></label>' +
        '</div>' +
        '<datalist id="desc-list">' + Object.keys(memoryHint).slice(0, 200).map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist>' +
        '<p class="small muted" style="margin-top:12px" id="t-explain"></p>',
        [e ? '<button class="danger" data-act="delete">Delete</button>' : '',
          '<button data-act="cancel">Cancel</button>' + (e ? '' : '<button data-act="save-new">Save &amp; add another</button>') + '<button class="primary" data-act="save">Save</button>']);

      $$('[data-mode]', dialog).forEach((b) => b.onclick = () => { captureForm(); mode = b.dataset.mode; opts.counterId = ''; render(); });
      const explain = () => {
        const a = acct($('#t-acct', dialog).value), c = acct($('#t-counter', dialog).value);
        const amtC = L.toCents($('#t-amt', dialog).value);
        if (!a || !c || !amtC || isNaN(amtC)) { $('#t-explain', dialog).textContent = ''; return; }
        const s = L.simpleEntry(book, { accountId: a.id, counterId: c.id, direction: mode === 'in' ? 'in' : 'out', amount: amtC });
        $('#t-explain', dialog).textContent = 'Journal entry: Dr ' + acctName(s.lines[0].accountId) + ' ' + money(amtC) + ' / Cr ' + acctName(s.lines[1].accountId) + ' ' + money(amtC) +
          '. ' + effectText(a, mode === 'in' ? 'in' : 'out') + (isTransfer ? ' ' + effectText(c, 'in') : '');
      };
      ['#t-acct', '#t-counter', '#t-amt'].forEach((s) => $(s, dialog).addEventListener('input', explain));
      $('#t-desc', dialog).addEventListener('change', () => {
        const hint = memoryHint[$('#t-desc', dialog).value.trim().toLowerCase()];
        if (hint && !isTransfer && !$('#t-counter', dialog).value && acct(hint)) { $('#t-counter', dialog).value = hint; explain(); }
      });
      explain();
      (opts.accountId ? $('#t-amt', dialog) : $('#t-acct', dialog)).focus();

      dialogAction('cancel', closeDialog);
      dialogAction('delete', () => {
        if (!confirm('Delete this transaction?')) return;
        try { L.deleteEntry(book, e.id); } catch (err) { return dialogError(err.message); }
        closeDialog(); commit();
      });
      const doSave = (again) => {
        const accountId = $('#t-acct', dialog).value, counterId = $('#t-counter', dialog).value;
        const amount = L.toCents($('#t-amt', dialog).value);
        if (!accountId || !counterId) return dialogError('Choose both accounts.');
        if (accountId === counterId) return dialogError('The two accounts must be different.');
        if (!amount || isNaN(amount)) return dialogError('Enter a valid amount.');
        const entry = L.simpleEntry(book, {
          id: e && e.id, date: $('#t-date', dialog).value, description: $('#t-desc', dialog).value,
          memo: $('#t-memo', dialog).value, accountId, counterId, direction: mode === 'in' ? 'in' : 'out', amount,
        });
        if (e) entry.createdAt = e.createdAt;
        try { L.postEntry(book, amount < 0 ? flip(entry) : entry); } catch (err) { return dialogError(err.message); }
        save();
        if (again) {
          opts = { accountId, date: $('#t-date', dialog).value };
          render(); toast('Saved');
          rerender();
        } else { closeDialog(); rerender(); toast('Saved'); }
      };
      dialogAction('save', () => doSave(false));
      dialogAction('save-new', () => doSave(true));
    };
    const captureForm = () => {
      opts.accountId = $('#t-acct', dialog).value;
      opts.amount = L.toCents($('#t-amt', dialog).value) || 0;
      opts.date = $('#t-date', dialog).value;
      opts.description = $('#t-desc', dialog).value;
    };
    render();
  }

  // Negative amount typed into the simple form: swap debit/credit sides.
  function flip(entry) {
    entry.lines = entry.lines.map((l) => ({ accountId: l.accountId, debit: Math.abs(l.credit), credit: Math.abs(l.debit) }));
    return entry;
  }

  function effectText(a, dir) {
    const c = L.classify(a);
    const up = dir === 'in';
    if (c === 'credit_card' || c === 'loan') return a.name + ' balance owed ' + (up ? 'decreases' : 'increases') + '.';
    if (a.type === 'asset') return a.name + ' ' + (up ? 'increases' : 'decreases') + '.';
    return '';
  }

  /** description (lower) -> most recent income/expense account used with it. */
  function buildCategoryMemory() {
    const m = {};
    for (const e of L.sortedEntries(book.entries)) {
      if (!e.description || e.lines.length !== 2) continue;
      const cat = e.lines.find((l) => { const a = acct(l.accountId); return a && (a.type === 'income' || a.type === 'expense') && !a.system; });
      if (cat) m[e.description.trim().toLowerCase()] = cat.accountId;
    }
    return m;
  }

  // ---------------------------------------------------------------------------
  // Bank register — QBO-style inline encoding, one line per statement entry
  // ---------------------------------------------------------------------------

  const regState = { accountId: null, editing: null, lastDate: null, search: '', error: '', errorRow: null, stmtDate: '', stmtBal: '' };

  /** Name shown (and typed) in the account picker; last4 keeps same-named cards apart. */
  function displayName(a) { return a.name + (a.last4 ? ' ••' + a.last4 : ''); }

  function typeLabel(a) {
    if (a.type === 'income') return 'Income';
    if (a.type === 'expense') return 'Expense';
    if (a.type === 'equity') return 'Equity';
    return CLASS_LABEL[L.classify(a)] + ' · ' + (a.type === 'asset' ? 'Asset' : 'Liability');
  }

  function findByDisplayName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    const list = book.accounts.filter((a) => !a.archived);
    return list.find((a) => displayName(a).toLowerCase() === n) || list.find((a) => a.name.toLowerCase() === n) || null;
  }

  /** payee (lower) -> last account used with it, from any register. */
  function buildPayeeMemory() {
    const m = {};
    for (const e of L.sortedEntries(book.entries)) {
      if (!e.description || e.lines.length !== 2 || ['closing', 'opening', 'adjusting'].includes(e.kind)) continue;
      const key = e.description.trim().toLowerCase();
      const cat = e.lines.find((l) => { const a = acct(l.accountId); return a && !a.system && (a.type === 'income' || a.type === 'expense'); });
      m[key] = m[key] || {};
      // Per register: the other side of the entry. "any": the category, for registers never used with this payee.
      m[key][e.lines[0].accountId] = e.lines[1].accountId;
      m[key][e.lines[1].accountId] = e.lines[0].accountId;
      if (cat) m[key].any = cat.accountId;
    }
    return m;
  }

  function columnLabels(a) {
    if (a.type === 'liability') {
      return L.classify(a) === 'credit_card'
        ? { out: 'Charge', in: 'Payment', outHint: 'Purchases, fees, interest (balance owed goes up)', inHint: 'Payments, refunds, credits (balance owed goes down)' }
        : { out: 'Increase', in: 'Payment', outHint: 'New borrowing, interest added', inHint: 'Payments made on this loan' };
    }
    return { out: 'Payment', in: 'Deposit', outHint: 'Money out: purchases, withdrawals, transfers out', inHint: 'Money in: salary, deposits, transfers in' };
  }

  function renderRegister(accountId) {
    const bsAccounts = activeAccounts((x) => isBalanceSheet(x) && !x.personId);
    const a = acct(accountId || regState.accountId || prefs.lastRegister) && isBalanceSheet(acct(accountId || regState.accountId || prefs.lastRegister))
      ? acct(accountId || regState.accountId || prefs.lastRegister)
      : bsAccounts.find((x) => L.classify(x) === 'cash' && x.id !== 'acc_cash') || bsAccounts[0];
    if (!a) { main.innerHTML = '<div class="card empty">Add a bank account or card first.</div>'; return; }
    if (regState.accountId !== a.id) {
      Object.assign(regState, { accountId: a.id, editing: null, error: '', draft: null, stmtDate: '', stmtBal: '' });
    }
    prefs.lastRegister = a.id; savePrefs();

    const cols = columnLabels(a);
    // Register deltas are in natural sign (a card charge is +). Flip liabilities so
    // the left column is always money out / charges and the right is money in / payments.
    const flow = (delta) => (a.type === 'liability' ? -delta : delta);
    const t = today();
    const bals = L.balances(book, { to: '9999-12-31' });
    const closed = L.closedThrough(book);
    const rows = L.register(book, a.id);
    const q = regState.search.toLowerCase();
    const shown = rows.slice().reverse().filter((r) => !q ||
      [r.entry.description, r.entry.memo, r.entry.ref, ...r.counterIds.map(acctName), String(Math.abs(r.delta) / 100)].join(' ').toLowerCase().includes(q));

    const others = L.orderAccounts(book.accounts).filter((x) => !x.archived && x.id !== a.id);
    const payees = Array.from(new Set(book.entries.map((e) => (e.description || '').trim()).filter(Boolean))).sort();

    // Strip of account tiles (QBO-style bank cards).
    const strip = '<div class="acct-strip">' + bsAccounts.map((x) =>
      '<a href="#/register?account=' + x.id + '" class="acct-tile' + (x.id === a.id ? ' on' : '') + (isHex(x.color) ? ' has-color' : '') + '"' + (isHex(x.color) ? ' style="--acct-color:' + x.color + '"' : '') + '>' +
      '<div class="small muted">' + esc(CLASS_LABEL[L.classify(x)]) + '</div><div class="nm">' + esc(displayName(x)) + '</div>' +
      '<div class="bal">' + money(bals.get(x.id).balance) + '</div></a>').join('') +
      '<a href="#/accounts" class="acct-tile add" id="reg-add-acct"><div class="nm">+ Add account / card</div></a></div>';

    const inputRow = (cls, v) =>
      '<tr class="' + cls + '"' + (v.id ? ' data-id="' + v.id + '"' : '') + '>' +
      '<td class="c-date" data-label="Date"><input type="date" class="r-date" value="' + esc(v.date) + '"></td>' +
      '<td class="c-ref" data-label="Ref no."><input class="r-ref" value="' + esc(v.ref || '') + '" placeholder="Ref no."></td>' +
      '<td class="c-payee" data-label="Payee"><input class="r-payee" list="reg-payees" value="' + esc(v.payee || '') + '" placeholder="Payee / description"></td>' +
      '<td class="c-acct" data-label="Account"><input class="r-acct" list="reg-accts" value="' + esc(v.account || '') + '" placeholder="Account (expense, income, asset, liability…)"></td>' +
      '<td class="c-memo" data-label="Memo"><input class="r-memo" value="' + esc(v.memo || '') + '" placeholder="Memo"></td>' +
      '<td class="c-out" data-label="' + cols.out + '"><input class="r-out num" inputmode="decimal" value="' + esc(v.out || '') + '" placeholder="' + cols.out + '"></td>' +
      '<td class="c-in" data-label="' + cols.in + '"><input class="r-in num" inputmode="decimal" value="' + esc(v.in || '') + '" placeholder="' + cols.in + '"></td>' +
      '<td class="r-actions c-act"><button class="primary r-save" title="Save (Enter)">Save</button>' +
      '<button class="r-split" title="Split across several accounts">Split</button>' +
      (v.id ? '<button class="r-cancel" title="Cancel (Esc)">Cancel</button><button class="danger r-del" title="Delete">Delete</button>' : '') +
      '</td></tr>' +
      (regState.error && regState.errorRow === (v.id || 'new') ? '<tr class="r-err"><td colspan="9"><div class="notice err" style="margin:0">' + esc(regState.error) + '</div></td></tr>' : '');

    const body = shown.map((r) => {
      const e = r.entry;
      const isSplit = r.counterIds.length !== 1 || e.lines.length !== 2;
      const locked = closed && e.date <= closed && e.kind !== 'closing';
      if (regState.editing === e.id && !isSplit) {
        return inputRow('r-edit', {
          id: e.id, date: e.date, ref: e.ref, payee: e.description, memo: e.memo,
          account: displayName(acct(r.counterIds[0]) || { name: '' }),
          out: flow(r.delta) < 0 ? centsToInput(-flow(r.delta)) : '', in: flow(r.delta) > 0 ? centsToInput(flow(r.delta)) : '',
        });
      }
      return '<tr class="click r-row" data-id="' + e.id + '"><td>' + fmtDate(e.date) + (locked ? ' <span title="Closed period" class="muted">🔒</span>' : '') + '</td>' +
        '<td>' + esc(e.ref || '') + '</td><td>' + esc(e.description || '') + '</td>' +
        '<td>' + (isSplit ? '<i>— Split (' + (e.lines.length - 1) + ') —</i>' : esc(acctName(r.counterIds[0]))) +
        (e.kind === 'opening' || e.kind === 'adjusting' || e.kind === 'closing' ? ' ' + kindBadge(e.kind) : '') + '</td>' +
        '<td class="muted">' + esc(e.memo || '') + '</td>' +
        '<td class="num">' + (flow(r.delta) < 0 ? money(-flow(r.delta)) : '') + '</td><td class="num">' + (flow(r.delta) > 0 ? money(flow(r.delta)) : '') + '</td>' +
        '<td class="num"><b>' + money(r.balance) + '</b></td>' +
        '<td class="c-mobile"><div class="m-top"><span class="m-payee">' + esc(e.description || '—') + '</span>' +
        '<span class="m-amt ' + (flow(r.delta) < 0 ? 'm-out' : 'm-in') + '">' + (flow(r.delta) < 0 ? '−' : '+') + money(Math.abs(r.delta)) + '</span></div>' +
        '<div class="m-bot"><span>' + (isSplit ? 'Split (' + (e.lines.length - 1) + ')' : esc(acctName(r.counterIds[0]))) + ' · ' + fmtDate(e.date) +
        (e.ref ? ' · #' + esc(e.ref) : '') + (e.memo ? ' · ' + esc(e.memo) : '') + (locked ? ' 🔒' : '') + '</span>' +
        '<span>Bal ' + money(r.balance) + '</span></div></td></tr>';
    }).join('');

    // Statement check: compare the register balance with the bank's figure.
    let stmt = '';
    if (regState.stmtDate && regState.stmtBal !== '') {
      const sb = L.toCents(regState.stmtBal);
      const rb = L.balanceOf(book, a.id, { to: regState.stmtDate });
      if (!isNaN(sb)) {
        const diff = rb - sb;
        stmt = '<div class="notice ' + (diff === 0 ? 'ok' : 'warn') + '" style="margin:8px 0 0">' +
          'Register balance on ' + fmtDate(regState.stmtDate) + ': <b>' + money(rb) + '</b> · Statement: <b>' + money(sb) + '</b> · ' +
          (diff === 0 ? '✓ Matches — everything on this statement is encoded.' : 'Difference <b>' + money(diff) + '</b> — something is missing or mistyped.') + '</div>';
      }
    }

    main.innerHTML =
      '<div class="page-head"><div><h1>Bank register</h1><div class="sub">Encode every line of your bank or card statement. Pick the account it belongs to — expense, income, another bank, a credit card, a loan, an asset — and the journal entry is made for you.</div></div>' +
      '<div class="btn-row"><button id="reg-import">Import CSV</button><a class="btn" href="#/ledger?account=' + a.id + '">General ledger</a></div></div>' +
      strip +
      '<div class="card reg-card">' +
      '<div class="reg-head"><div><h2 style="margin:0">' + colorDot(a) + esc(displayName(a)) + ' <button class="link small" id="reg-edit-acct" title="Edit name, colour…">Edit</button></h2><div class="small muted">' + esc(L.SUBTYPES[a.type][a.subtype] || '') + (a.institution ? ' · ' + esc(a.institution) : '') +
      ' · ' + (a.type === 'liability' ? 'Balance owed' : 'Balance') + ' today <b>' + money(L.balanceOf(book, a.id, { to: t })) + '</b></div></div>' +
      '<details class="reg-tools"' + (regState.search || regState.stmtDate || regState.stmtBal || window.innerWidth > 760 ? ' open' : '') + '><summary>Find &amp; statement check</summary>' +
      '<div class="toolbar" style="margin:0"><label class="field">Find<input type="search" id="reg-search" value="' + esc(regState.search) + '" placeholder="Payee, memo, amount"></label>' +
      '<label class="field">Statement date<input type="date" id="reg-sdate" value="' + esc(regState.stmtDate) + '"></label>' +
      '<label class="field">Statement ending balance<input id="reg-sbal" inputmode="decimal" value="' + esc(regState.stmtBal) + '" placeholder="0.00"></label></div></details></div>' +
      stmt +
      '<div class="table-wrap" style="margin-top:12px"><table class="reg-table"><colgroup><col style="width:124px"><col style="width:70px"><col style="width:16%"><col style="width:19%"><col><col style="width:104px"><col style="width:104px"><col style="width:140px"></colgroup>' +
      '<thead><tr><th>Date</th><th>Ref no.</th><th>Payee</th><th>Account</th><th>Memo</th><th class="num" title="' + esc(cols.outHint) + '">' + cols.out + '</th><th class="num" title="' + esc(cols.inHint) + '">' + cols.in + '</th><th class="num">Balance</th></tr></thead>' +
      '<tbody>' + inputRow('r-new', { date: regState.lastDate || t }) +
      (body || '<tr><td colspan="8" class="empty">Nothing encoded yet. Type your first statement line above and press Enter.</td></tr>') +
      '</tbody></table></div>' +
      '<p class="small muted" style="margin-top:10px"><b>' + cols.out + '</b>: ' + esc(cols.outHint) + '. <b>' + cols.in + '</b>: ' + esc(cols.inHint) +
      '. Press <kbd>Enter</kbd> to save a line; the date is kept for the next one. Click any line to edit it. Typing a payee you used before fills in its account.</p>' +
      '</div>' +
      '<datalist id="reg-accts">' + others.map((x) => '<option value="' + esc(displayName(x)) + '" label="' + esc(typeLabel(x)) + '">').join('') + '</datalist>' +
      '<datalist id="reg-payees">' + payees.slice(0, 500).map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>';

    // Toolbar
    const search = $('#reg-search');
    search.oninput = debounce(() => { regState.search = search.value; rerender(); const s = $('#reg-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250);
    $('#reg-sdate').onchange = (e) => { regState.stmtDate = e.target.value; rerender(); };
    $('#reg-sbal').onchange = (e) => { regState.stmtBal = e.target.value; rerender(); };
    $('#reg-import').onclick = () => openImportDialog(a.id);
    $('#reg-edit-acct').onclick = () => openAccountDialog(a.id);
    $('#reg-add-acct').onclick = (e) => { e.preventDefault(); openAccountDialog(); };

    // Read-only rows: click to edit inline (splits open the journal editor).
    $$('tr.r-row').forEach((tr) => tr.onclick = () => {
      const e = book.entries.find((x) => x.id === tr.dataset.id);
      if (!e) return;
      if (e.kind === 'closing') { location.hash = '#/close'; return; }
      if (e.lines.length !== 2 || e.lines.every((l) => l.accountId === a.id)) { openJournalDialog({ entry: e }); return; }
      regState.editing = e.id; regState.error = ''; regState.draft = null; rerender();
      const ed = $('tr.r-edit .r-payee'); if (ed) ed.focus();
    });

    const memory = buildPayeeMemory();
    $$('tr.r-new, tr.r-edit').forEach((tr) => {
      const f = (c) => $(c, tr);
      // Payee → remembered account.
      f('.r-payee').addEventListener('change', () => {
        if (f('.r-acct').value.trim()) return;
        const m = memory[f('.r-payee').value.trim().toLowerCase()];
        if (!m) return;
        const id = m[a.id] || m.any;
        const x = id && acct(id);
        if (x && x.id !== a.id) f('.r-acct').value = displayName(x);
      });
      // Typing in one amount column clears the other.
      f('.r-out').addEventListener('input', () => { if (f('.r-out').value) f('.r-in').value = ''; });
      f('.r-in').addEventListener('input', () => { if (f('.r-in').value) f('.r-out').value = ''; });
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); saveRow(tr); }
        if (ev.key === 'Escape' && tr.classList.contains('r-edit')) { regState.editing = null; regState.error = ''; regState.draft = null; rerender(); }
      });
      f('.r-save').onclick = () => saveRow(tr);
      f('.r-split').onclick = () => splitRow(tr);
      if (f('.r-cancel')) f('.r-cancel').onclick = () => { regState.editing = null; regState.error = ''; regState.draft = null; rerender(); };
      if (f('.r-del')) f('.r-del').onclick = () => {
        if (!confirm('Delete this transaction?')) return;
        try { L.deleteEntry(book, tr.dataset.id); } catch (err) { return rowError(tr, err.message); }
        regState.editing = null; regState.error = ''; commit(); toast('Deleted');
      };
    });

    if (!regState.editing) {
      const first = $('tr.r-new ' + (regState.error && regState.errorRow === 'new' ? '.r-acct' : '.r-payee'));
      if (first && document.activeElement === document.body) first.focus();
    }

    function readRow(tr) {
      const f = (c) => $(c, tr).value;
      return { id: tr.dataset.id || null, date: f('.r-date'), ref: f('.r-ref'), payee: f('.r-payee').trim(), account: f('.r-acct').trim(), memo: f('.r-memo'), out: f('.r-out').trim(), in: f('.r-in').trim() };
    }

    function rowError(tr, msg) {
      regState.error = msg; regState.errorRow = tr.dataset.id || 'new';
      regState.draft = readRow(tr); // keep what was typed
      rerender();
    }

    function resolveCounter(v, direction) {
      let c = findByDisplayName(v.account);
      if (!c && v.account) {
        const type = direction === 'out' ? 'expense' : 'income';
        if (!confirm('"' + v.account + '" is not an account yet.\n\nCreate it as a new ' + type + ' category?\n(For a new bank, card, loan or asset, use “+ Add account / card” instead.)')) return null;
        c = acct(ensureCategory(type, v.account));
      }
      return c;
    }

    function saveRow(tr) {
      const v = readRow(tr);
      if (!v.date) return rowError(tr, 'Enter a date.');
      const outC = v.out ? L.toCents(v.out) : 0, inC = v.in ? L.toCents(v.in) : 0;
      if (isNaN(outC) || isNaN(inC)) return rowError(tr, 'Amounts must be numbers, e.g. 1,250.00');
      if (!outC && !inC) return rowError(tr, 'Enter an amount under ' + cols.out + ' or ' + cols.in + '.');
      if (outC && inC) return rowError(tr, 'Use either ' + cols.out + ' or ' + cols.in + ', not both.');
      if (!v.account) return rowError(tr, 'Choose the account this ' + (outC ? cols.out.toLowerCase() : cols.in.toLowerCase()) + ' belongs to.');
      let direction = outC ? 'out' : 'in';
      let amount = outC || inC;
      if (amount < 0) { amount = -amount; direction = direction === 'out' ? 'in' : 'out'; }
      const c = resolveCounter(v, direction);
      if (!c) return;
      if (c.id === a.id) return rowError(tr, 'The account must be different from ' + a.name + '.');
      const old = v.id && book.entries.find((x) => x.id === v.id);
      const entry = L.simpleEntry(book, { id: v.id || undefined, date: v.date, description: v.payee, memo: v.memo, ref: v.ref, accountId: a.id, counterId: c.id, direction, amount });
      if (old) { entry.createdAt = old.createdAt; if (['opening', 'adjusting', 'journal'].includes(old.kind)) entry.kind = old.kind; }
      try { L.postEntry(book, entry); } catch (err) { return rowError(tr, err.message); }
      regState.error = ''; regState.draft = null; regState.editing = null;
      if (!v.id) regState.lastDate = v.date;
      commit();
      if (!v.id) { const p = $('tr.r-new .r-payee'); if (p) p.focus(); }
      toast(v.id ? 'Updated' : 'Saved · ' + money(amount) + ' → ' + c.name);
    }

    function splitRow(tr) {
      const v = readRow(tr);
      const old = v.id && book.entries.find((x) => x.id === v.id);
      if (old) { regState.editing = null; return openJournalDialog({ entry: old }); }
      const outC = L.toCents(v.out) || 0, inC = L.toCents(v.in) || 0;
      const amtC = Math.abs(outC || inC);
      const c = findByDisplayName(v.account);
      const bankLine = outC ? { accountId: a.id, debit: 0, credit: amtC } : { accountId: a.id, debit: amtC, credit: 0 };
      const firstLine = { accountId: c ? c.id : '', debit: outC ? amtC : 0, credit: outC ? 0 : amtC };
      openJournalDialog({ date: v.date, description: v.payee, ref: v.ref, memo: v.memo, kind: 'journal',
        lines: [firstLine, { accountId: '', debit: 0, credit: 0 }, bankLine] });
    }

    // Restore a draft that failed validation.
    const draftRow = regState.draft && (regState.draft.id ? $('tr.r-edit[data-id="' + regState.draft.id + '"]') : $('tr.r-new'));
    if (draftRow) {
      const tr = draftRow, d = regState.draft;
      $('.r-date', tr).value = d.date; $('.r-ref', tr).value = d.ref; $('.r-payee', tr).value = d.payee;
      $('.r-acct', tr).value = d.account; $('.r-memo', tr).value = d.memo; $('.r-out', tr).value = d.out; $('.r-in', tr).value = d.in;
    }
  }

  // ---------------------------------------------------------------------------
  // Journal entry dialog (multi-line / split / adjusting)
  // ---------------------------------------------------------------------------

  function openJournalDialog(opts) {
    const e = opts.entry;
    let lines = e ? e.lines.map((l) => ({ ...l })) : opts.lines || [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }];
    const kind = e ? e.kind : opts.kind || 'journal';
    const kindChoices = ['journal', 'adjusting', 'opening', 'expense', 'income', 'transfer'];
    const render = () => {
      showDialog(e ? 'Edit journal entry' : (kind === 'adjusting' ? 'New adjusting entry' : 'New journal entry'),
        '<div class="form-grid">' +
        '<label class="field">Date<input id="j-date" type="date" value="' + (e ? e.date : opts.date || today()) + '"></label>' +
        '<label class="field">Entry type<select id="j-kind">' + kindChoices.map((k) => '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + L.ENTRY_KINDS[k] + '</option>').join('') + '</select></label>' +
        '<label class="field full">Description<input id="j-desc" value="' + esc(e ? e.description : opts.description || '') + '"></label>' +
        '</div>' +
        '<div class="table-wrap" style="margin-top:12px"><table class="lines-table"><thead><tr><th style="width:52%">Account</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead><tbody id="j-lines">' +
        lines.map((l, i) => '<tr><td><select data-i="' + i + '" data-f="accountId">' + accountOptions(l.accountId, null, { placeholder: 'Choose account…' }) + '</select></td>' +
          '<td><input data-i="' + i + '" data-f="debit" inputmode="decimal" class="num" value="' + centsToInput(l.debit) + '"></td>' +
          '<td><input data-i="' + i + '" data-f="credit" inputmode="decimal" class="num" value="' + centsToInput(l.credit) + '"></td>' +
          '<td><button class="link" data-rm="' + i + '" title="Remove line">✕</button></td></tr>').join('') +
        '</tbody><tfoot><tr><td><button class="link" id="j-add">+ Add line</button></td><td class="num"><b id="j-dr"></b></td><td class="num"><b id="j-cr"></b></td><td></td></tr></tfoot></table></div>' +
        '<div id="j-status" class="small" style="margin-top:6px"></div>' +
        '<p class="small muted" style="margin-top:10px">Debits increase assets &amp; expenses; credits increase liabilities, equity &amp; income. Use this for split purchases, paychecks with deductions, accruals, depreciation and other adjustments.</p>',
        [e ? '<button class="danger" data-act="delete">Delete</button>' : '', '<button data-act="cancel">Cancel</button><button class="primary" data-act="save">Save entry</button>']);

      const totals = () => {
        let dr = 0, cr = 0;
        lines.forEach((l) => { dr += l.debit || 0; cr += l.credit || 0; });
        $('#j-dr', dialog).textContent = money(dr);
        $('#j-cr', dialog).textContent = money(cr);
        const st = $('#j-status', dialog);
        st.className = 'small notice ' + (dr === cr && dr ? 'ok' : 'warn');
        st.textContent = dr === cr ? (dr ? 'Balanced.' : 'Enter amounts.') : 'Out of balance by ' + money(Math.abs(dr - cr)) + '.';
      };
      $$('[data-f]', dialog).forEach((el) => el.addEventListener('input', () => {
        const i = +el.dataset.i, f = el.dataset.f;
        if (f === 'accountId') lines[i].accountId = el.value;
        else {
          const c = L.toCents(el.value);
          lines[i][f] = isNaN(c) ? 0 : Math.abs(c);
          if (lines[i][f]) { const o = f === 'debit' ? 'credit' : 'debit'; lines[i][o] = 0; const other = $('[data-i="' + i + '"][data-f="' + o + '"]', dialog); if (other) other.value = ''; }
        }
        totals();
      }));
      $$('[data-rm]', dialog).forEach((b) => b.onclick = () => { capture(); if (lines.length > 2) { lines.splice(+b.dataset.rm, 1); render(); } });
      $('#j-add', dialog).onclick = () => {
        capture();
        let dr = 0, cr = 0;
        lines.forEach((l) => { dr += l.debit || 0; cr += l.credit || 0; });
        lines.push({ accountId: '', debit: cr > dr ? cr - dr : 0, credit: dr > cr ? dr - cr : 0 });
        render();
      };
      totals();
      dialogAction('cancel', closeDialog);
      dialogAction('delete', () => {
        if (!confirm('Delete this entry?')) return;
        try { L.deleteEntry(book, e.id); } catch (err) { return dialogError(err.message); }
        closeDialog(); commit();
      });
      dialogAction('save', () => {
        capture();
        const entry = {
          id: e && e.id, createdAt: e && e.createdAt, date: $('#j-date', dialog).value,
          ref: e ? e.ref : opts.ref, memo: e ? e.memo : opts.memo,
          kind: $('#j-kind', dialog).value, description: $('#j-desc', dialog).value,
          lines: lines.filter((l) => l.accountId || l.debit || l.credit),
        };
        try { L.postEntry(book, entry); } catch (err) { return dialogError(err.message); }
        closeDialog(); commit(); toast('Entry posted');
      });
    };
    const capture = () => {
      opts.date = $('#j-date', dialog).value;
      opts.description = $('#j-desc', dialog).value;
    };
    render();
  }

  // ---------------------------------------------------------------------------
  // CSV import
  // ---------------------------------------------------------------------------

  function openImportDialog(accountId) {
    let rows = null;
    const step1 = () => {
      showDialog('Import transactions from CSV',
        '<div class="form-grid">' +
        '<label class="field full">Into account / card<select id="i-acct">' + accountOptions(accountId, isBalanceSheet, { placeholder: 'Choose…' }) + '</select></label>' +
        '<label class="field full">CSV file<input id="i-file" type="file" accept=".csv,text/csv,text/plain"></label>' +
        '<label class="field full">…or paste CSV text<textarea id="i-text" rows="7" placeholder="Date,Description,Amount&#10;2026-10-01,Grocery store,-54.20&#10;2026-10-02,Salary,2500.00"></textarea></label>' +
        '</div>',
        ['', '<button data-act="cancel">Cancel</button><button class="primary" data-act="next">Next</button>']);
      dialogAction('cancel', closeDialog);
      dialogAction('next', async () => {
        accountId = $('#i-acct', dialog).value;
        if (!accountId) return dialogError('Choose the account these transactions belong to.');
        const f = $('#i-file', dialog).files[0];
        const text = f ? await f.text() : $('#i-text', dialog).value;
        rows = L.parseCSV(text || '');
        if (rows.length < 2) return dialogError('Need a header row and at least one transaction.');
        step2();
      });
    };
    const step2 = () => {
      const header = rows[0];
      const guess = (re) => header.findIndex((h) => re.test(h));
      const g = {
        date: guess(/date|posted/i), desc: guess(/desc|payee|merchant|details|name|narrat|memo/i),
        amount: guess(/^amount$|amount|amt/i), debit: guess(/debit|withdraw|out|charge/i), credit: guess(/credit|deposit|in$|payment/i),
        cat: guess(/categ/i),
      };
      const useSplit = g.amount < 0 && g.debit >= 0 && g.credit >= 0;
      const colSel = (id, sel, optional) => '<select id="' + id + '">' + (optional ? '<option value="-1">(none)</option>' : '') +
        header.map((h, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(h || 'Column ' + (i + 1)) + '</option>').join('') + '</select>';
      const a = acct(accountId);
      showDialog('Map CSV columns',
        '<div class="form-grid">' +
        '<label class="field">Date column' + colSel('m-date', g.date) + '</label>' +
        '<label class="field">Date format<select id="m-dfmt"><option value="mdy">Month/Day/Year</option><option value="dmy">Day/Month/Year</option></select></label>' +
        '<label class="field full">Description column' + colSel('m-desc', g.desc) + '</label>' +
        '<label class="field full">Amount layout<select id="m-layout"><option value="single"' + (useSplit ? '' : ' selected') + '>One amount column</option><option value="split"' + (useSplit ? ' selected' : '') + '>Separate money-out and money-in columns</option></select></label>' +
        '<label class="field single">Amount column' + colSel('m-amt', g.amount >= 0 ? g.amount : 0) + '</label>' +
        '<label class="field single">Positive amounts mean<select id="m-sign"><option value="in">' + (a.type === 'liability' ? 'Payment / refund (reduces balance)' : 'Money in') + '</option><option value="out"' + (a.type === 'liability' ? ' selected' : '') + '>' + (a.type === 'liability' ? 'Charge (increases balance)' : 'Money out') + '</option></select></label>' +
        '<label class="field split">Money-out / charges column' + colSel('m-out', g.debit, true) + '</label>' +
        '<label class="field split">Money-in / payments column' + colSel('m-in', g.credit, true) + '</label>' +
        '<label class="field">Category column (optional)' + colSel('m-cat', g.cat, true) + '</label>' +
        '<label class="field">Skip duplicates<select id="m-dupe"><option value="1">Yes (same date, amount &amp; description)</option><option value="0">No</option></select></label>' +
        '</div><p class="small muted" style="margin-top:10px">Categories are matched by name, then by past transactions with the same description; anything else goes to “Uncategorized” so you can fix it later.</p>' +
        '<div id="m-preview" class="small"></div>',
        ['<button data-act="back">Back</button>', '<button data-act="cancel">Cancel</button><button class="primary" data-act="import">Import</button>']);
      const layout = () => {
        const split = $('#m-layout', dialog).value === 'split';
        $$('.single', dialog).forEach((el) => el.classList.toggle('hidden', split));
        $$('.split', dialog).forEach((el) => el.classList.toggle('hidden', !split));
        preview();
      };
      const preview = () => {
        const parsed = parseRows();
        $('#m-preview', dialog).innerHTML = '<div class="notice ' + (parsed.ok.length ? 'ok' : 'warn') + '" style="margin-top:10px">' +
          parsed.ok.length + ' transactions ready' + (parsed.dupes ? ', ' + parsed.dupes + ' duplicates skipped' : '') + (parsed.bad ? ', ' + parsed.bad + ' rows unreadable' : '') + '.</div>' +
          (parsed.ok.length ? '<table><tbody>' + parsed.ok.slice(0, 5).map((x) => '<tr><td>' + x.date + '</td><td>' + esc(x.description) + '</td><td>' + esc(acctName(x.counterId)) + '</td><td class="num ' + (x.direction === 'in' ? 'pos' : 'neg') + '">' + (x.direction === 'in' ? '+' : '−') + money(x.amount) + '</td></tr>').join('') + '</tbody></table>' : '');
      };
      const parseRows = () => {
        const idx = (id) => +$(id, dialog).value;
        const dayFirst = $('#m-dfmt', dialog).value === 'dmy';
        const split = $('#m-layout', dialog).value === 'split';
        const posIsIn = $('#m-sign', dialog).value === 'in';
        const catIdx = idx('#m-cat');
        const memory = buildCategoryMemory();
        const byName = {};
        book.accounts.forEach((x) => { if (x.type === 'income' || x.type === 'expense') byName[x.name.toLowerCase()] = x; });
        const existing = new Set(L.register(book, accountId).map((r) => r.entry.date + '|' + Math.abs(r.delta) + '|' + (r.entry.description || '').toLowerCase()));
        const skipDupes = $('#m-dupe', dialog).value === '1';
        const out = { ok: [], bad: 0, dupes: 0 };
        for (const r of rows.slice(1)) {
          const date = L.parseDate(r[idx('#m-date')], dayFirst);
          let signed;
          if (split) {
            const o = idx('#m-out') >= 0 ? L.toCents(r[idx('#m-out')] || '') : NaN;
            const i = idx('#m-in') >= 0 ? L.toCents(r[idx('#m-in')] || '') : NaN;
            signed = (isNaN(i) ? 0 : Math.abs(i)) - (isNaN(o) ? 0 : Math.abs(o));
          } else {
            const v = L.toCents(r[idx('#m-amt')]);
            signed = isNaN(v) ? NaN : posIsIn ? v : -v;
          }
          if (!date || !signed || isNaN(signed)) { out.bad++; continue; }
          const description = (r[idx('#m-desc')] || '').trim();
          const direction = signed > 0 ? 'in' : 'out';
          const amount = Math.abs(signed);
          if (skipDupes && existing.has(date + '|' + amount + '|' + description.toLowerCase())) { out.dupes++; continue; }
          let counter = catIdx >= 0 ? byName[(r[catIdx] || '').trim().toLowerCase()] : null;
          if (!counter && memory[description.toLowerCase()]) counter = acct(memory[description.toLowerCase()]);
          if (!counter) counter = acct(direction === 'in' ? 'inc_uncat' : 'exp_uncat') ||
            book.accounts.find((x) => x.type === (direction === 'in' ? 'income' : 'expense'));
          out.ok.push({ date, description, direction, amount, counterId: counter.id });
        }
        return out;
      };
      $$('select', dialog).forEach((s) => s.addEventListener('change', layout));
      layout();
      dialogAction('back', step1);
      dialogAction('cancel', closeDialog);
      dialogAction('import', () => {
        const parsed = parseRows();
        let n = 0; const errs = [];
        for (const x of parsed.ok) {
          try { L.postEntry(book, L.simpleEntry(book, Object.assign({ accountId }, x))); n++; }
          catch (err) { errs.push(x.date + ': ' + err.message); }
        }
        save(); closeDialog(); rerender();
        toast('Imported ' + n + ' transactions' + (errs.length ? ', ' + errs.length + ' rejected (closed period?)' : ''));
      });
    };
    step1();
  }

  // ---------------------------------------------------------------------------
  // General ledger (presentation report)
  // ---------------------------------------------------------------------------

  const glState = { preset: 'ytd', account: '' };

  const GL_FILTERS = [
    ['', 'All accounts with activity'],
    ['@bs', 'Balance sheet accounts (assets, liabilities, equity)'],
    ['@pl', 'Income & expense accounts'],
    ['@people', 'People — receivables & payables'],
  ];

  function renderLedger(params) {
    if (params && params.get('account')) glState.account = params.get('account');
    const pt = periodToolbar(glState, rerender);
    const r = pt.range;
    const f = glState.account;
    const pred = f === '@bs' ? (a) => isBalanceSheet(a) || a.type === 'equity'
      : f === '@pl' ? (a) => L.isTemporary(a)
        : f === '@people' ? (a) => !!a.personId
          : f ? (a) => a.id === f : () => true;
    const groups = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity (net worth)'], ['income', 'Income'], ['expense', 'Expenses']];
    let accountsShown = 0;
    const body = groups.map(([type, title]) => {
      const sections = L.orderAccounts(book.accounts).filter((a) => a.type === type && pred(a)).map((a) => {
        const open = L.balanceOf(book, a.id, { to: L.addDays(r.from, -1) });
        const rows = L.register(book, a.id, { from: r.from, to: r.to });
        if (!rows.length && !open) return '';
        accountsShown++;
        let bal = open, dr = 0, cr = 0;
        const tr = rows.map((x) => {
          bal = open + x.balance; dr += x.debit; cr += x.credit;
          const e = x.entry;
          return '<tr class="click" data-entry="' + e.id + '"><td>' + fmtDate(e.date) + '</td><td>' + esc(e.ref || '') + '</td>' +
            '<td>' + esc(e.description || '—') + (e.kind === 'adjusting' || e.kind === 'closing' || e.kind === 'opening' ? ' ' + kindBadge(e.kind) : '') + '</td>' +
            '<td>' + (x.counterIds.length === 1 ? esc(acctName(x.counterIds[0])) : x.counterIds.length ? 'Split' : '') + '</td>' +
            '<td class="num">' + amt(x.debit) + '</td><td class="num">' + amt(x.credit) + '</td><td class="num">' + money(bal, { parens: true }) + '</td></tr>';
        }).join('');
        return '<tr class="gl-acct"><td colspan="7">' + esc(a.name) + ' <span class="muted small">· normal ' + (L.isDebitNormal(a) ? 'debit' : 'credit') + ' balance</span></td></tr>' +
          '<tr class="muted"><td>' + fmtDate(L.addDays(r.from, -1)) + '</td><td></td><td>Beginning balance</td><td></td><td></td><td></td><td class="num">' + money(open, { parens: true }) + '</td></tr>' + tr +
          '<tr class="subtotal rule"><td></td><td></td><td>Total ' + esc(a.name) + '</td><td></td><td class="num">' + money(dr) + '</td><td class="num">' + money(cr) + '</td><td class="num">' + money(bal, { parens: true }) + '</td></tr>';
      }).join('');
      return sections ? '<tr class="section"><td colspan="7">' + title + '</td></tr>' + sections : '';
    }).join('');

    main.innerHTML =
      '<div class="page-head"><div><h1>General ledger</h1><div class="sub">Every account with its transactions and running balance — ready to print or export.</div></div>' +
      '<div class="btn-row"><button id="gl-csv">Export CSV</button><button data-print>Print / PDF</button></div></div>' +
      '<div class="toolbar"><label class="field">Accounts<select id="gl-acct">' +
      GL_FILTERS.map(([v, l]) => '<option value="' + v + '"' + (f === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      accountOptions(f.startsWith('@') ? '' : f) + '</select></label>' + pt.html + '</div>' +
      '<div class="card">' +
      '<div class="statement" style="max-width:none">' + stHead('General Ledger', fmtDate(r.from) + ' – ' + fmtDate(r.to)) +
      (body ? '<div class="table-wrap"><table class="gl-table"><thead><tr><th style="width:110px">Date</th><th style="width:70px">Ref</th><th>Description</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>' +
        body + '</tbody></table></div><p class="small muted" style="margin-top:10px">' + accountsShown + ' accounts. Balances are shown in each account’s normal direction; amounts in parentheses are opposite to normal.</p>'
        : '<div class="empty">No activity in this period.</div>') +
      '</div></div>';
    pt.bind(main);
    $('#gl-acct').onchange = (e) => { glState.account = e.target.value; rerender(); };
    $('#gl-csv').onclick = () => exportTableCSV('.gl-table', 'general-ledger-' + r.from + '-to-' + r.to + '.csv');
    $$('tr[data-entry]').forEach((tr) => tr.onclick = () => editEntry(tr.dataset.entry));
  }

  function exportTableCSV(selector, filename) {
    const rows = $$(selector + ' tr').map((tr) => $$('th, td', tr).map((td) => '"' + td.textContent.trim().replace(/"/g, '""') + '"').join(','));
    download(filename, rows.join('\n'), 'text/csv');
  }

  // ---------------------------------------------------------------------------
  // People — receivables (they owe me) and payables (I owe them)
  // ---------------------------------------------------------------------------

  const peopleState = { preset: 'all' };

  function renderPeople(params) {
    const personId = params.get('person');
    if (personId && (book.people || []).some((p) => p.id === personId)) return renderPersonStatement(personId);
    const t = today();
    const sum = L.peopleSummary(book, t).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.person.name.localeCompare(b.person.name));
    const showArch = !!prefs.showArchivedPeople;
    const list = sum.filter((x) => showArch || !x.person.archived);
    const totOwed = sum.reduce((s, x) => s + x.owedToMe, 0), totIOwe = sum.reduce((s, x) => s + x.iOwe, 0);
    main.innerHTML =
      '<div class="page-head"><div><h1>People</h1><div class="sub">Money other people owe you (receivables) and money you owe them (payables), person by person.</div></div>' +
      '<div class="btn-row"><button data-print>Print / PDF</button><button id="p-add">+ Add person</button><button class="primary" id="p-record">Record lend / borrow / repayment</button></div></div>' +
      '<div class="kpis">' +
      '<div class="kpi"><div class="label">Owed to me (receivables)</div><div class="value pos">' + money(totOwed) + '</div><div class="hint">' + plural(sum.filter((x) => x.owedToMe).length, 'person', 'people') + '</div></div>' +
      '<div class="kpi"><div class="label">I owe (payables)</div><div class="value neg">' + money(totIOwe) + '</div><div class="hint">' + plural(sum.filter((x) => x.iOwe).length, 'person', 'people') + '</div></div>' +
      '<div class="kpi"><div class="label">Net position</div><div class="value">' + money(totOwed - totIOwe, { parens: true }) + '</div><div class="hint">' + (totOwed >= totIOwe ? 'Others owe you more' : 'You owe others more') + '</div></div>' +
      '</div>' +
      '<div class="card">' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>Person</th><th class="num">Owes me</th><th class="num">I owe</th><th class="num">Net</th><th>Status</th><th>Last activity</th><th class="no-print"></th></tr></thead><tbody>' +
        list.map((x) => '<tr class="click" data-href="#/people?person=' + x.person.id + '"><td><b>' + esc(x.person.name) + '</b>' + (x.person.notes ? '<div class="small muted">' + esc(x.person.notes) + '</div>' : '') + (x.person.archived ? ' <span class="badge">Archived</span>' : '') + '</td>' +
          '<td class="num">' + amt(x.owedToMe) + '</td><td class="num">' + amt(x.iOwe) + '</td>' +
          '<td class="num ' + (x.net > 0 ? 'pos' : x.net < 0 ? 'neg' : '') + '"><b>' + money(x.net, { parens: true }) + '</b></td>' +
          '<td>' + (x.net > 0 ? '<span class="badge cash">Owes you</span>' : x.net < 0 ? '<span class="badge liab">You owe</span>' : '<span class="badge">Settled</span>') + '</td>' +
          '<td>' + (x.lastActivity ? fmtDate(x.lastActivity) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num no-print"><button class="link" data-rec="' + x.person.id + '">Record</button><button class="link" data-edit-person="' + x.person.id + '">Edit</button></td></tr>').join('') +
        '</tbody><tfoot><tr class="total"><td>Total</td><td class="num">' + money(totOwed) + '</td><td class="num">' + money(totIOwe) + '</td><td class="num">' + money(totOwed - totIOwe, { parens: true }) + '</td><td colspan="3"></td></tr></tfoot></table></div>'
        : '<div class="empty">No one yet. Add the people you lend to or borrow from — friends, family, a co-worker who split a bill.</div>') +
      '<div class="btn-row no-print" style="margin-top:10px"><label class="small"><input type="checkbox" id="p-arch"' + (showArch ? ' checked' : '') + '> Show archived</label></div>' +
      '</div>' +
      '<div class="card no-print"><h2>How it works</h2><p class="small muted">Each person gets a <b>Receivable – name</b> account (an asset: they owe you) and a <b>Payable – name</b> account (a liability: you owe them). ' +
      'Use <b>Record</b> here, or pick those accounts in the Bank register — e.g. a BDO payment to “Receivable – Juan” when you lend Juan money, and a deposit from it when he pays you back. ' +
      'They appear on the balance sheet under Receivables and Payables, so your net worth always includes them.</p></div>';
    bindRowLinks();
    $('#p-add').onclick = () => openPersonDialog();
    $('#p-record').onclick = () => openPersonTxDialog({});
    $('#p-arch').onchange = (e) => { prefs.showArchivedPeople = e.target.checked; savePrefs(); rerender(); };
    $$('[data-rec]').forEach((b) => b.onclick = () => openPersonTxDialog({ personId: b.dataset.rec }));
    $$('[data-edit-person]').forEach((b) => b.onclick = () => openPersonDialog(b.dataset.editPerson));
  }

  function renderPersonStatement(personId) {
    const p = book.people.find((x) => x.id === personId);
    const pt = periodToolbar(peopleState, rerender);
    const r = pt.range;
    const before = L.personStatement(book, personId, { to: L.addDays(r.from, -1) });
    const opening = before.length ? before[before.length - 1].net : 0;
    const rows = L.personStatement(book, personId, { from: r.from, to: r.to });
    const s = L.peopleSummary(book, r.to).find((x) => x.person.id === personId);
    const describe = (x) => x.receivable > 0 ? 'Lent / paid for them' : x.receivable < 0 ? 'They paid me back' : x.payable > 0 ? 'Borrowed / they paid for me' : 'I paid them back';
    main.innerHTML =
      '<div class="page-head"><div><a href="#/people" class="small no-print">← All people</a><h1>' + esc(p.name) + '</h1><div class="sub">Statement of account</div></div>' +
      '<div class="btn-row"><button id="ps-csv">Export CSV</button><button data-print>Print / PDF</button><button id="ps-edit">Edit</button><button class="primary" id="ps-rec">Record transaction</button></div></div>' +
      '<div class="kpis">' +
      '<div class="kpi"><div class="label">Owes me</div><div class="value">' + money(s.owedToMe) + '</div><div class="hint">' + esc(s.accounts.receivable ? s.accounts.receivable.name : '') + '</div></div>' +
      '<div class="kpi"><div class="label">I owe</div><div class="value">' + money(s.iOwe) + '</div><div class="hint">' + esc(s.accounts.payable ? s.accounts.payable.name : '') + '</div></div>' +
      '<div class="kpi hero"><div class="label">Net balance (' + fmtDate(r.to) + ')</div><div class="value">' + money(Math.abs(s.net)) + '</div><div class="hint">' + (s.net > 0 ? esc(p.name) + ' owes you' : s.net < 0 ? 'You owe ' + esc(p.name) : 'Settled') + '</div></div>' +
      '</div>' +
      '<div class="toolbar">' + pt.html + '</div>' +
      '<div class="card"><div class="statement" style="max-width:none">' + stHead('Statement of Account — ' + p.name, fmtDate(r.from) + ' – ' + fmtDate(r.to)) +
      '<div class="table-wrap"><table class="ps-table"><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Paid / received through</th><th class="num">They owe me (+)</th><th class="num">I owe them (−)</th><th class="num">Net balance</th></tr></thead><tbody>' +
      '<tr class="muted"><td>' + fmtDate(L.addDays(r.from, -1)) + '</td><td>Beginning balance</td><td></td><td></td><td></td><td></td><td class="num">' + money(opening, { parens: true }) + '</td></tr>' +
      rows.map((x) => '<tr class="click" data-entry="' + x.entry.id + '"><td>' + fmtDate(x.entry.date) + '</td><td>' + esc(x.entry.description || '—') + (x.entry.memo ? '<div class="small muted">' + esc(x.entry.memo) + '</div>' : '') + '</td>' +
        '<td>' + describe(x) + '</td><td>' + x.counterIds.map((id) => esc(acctName(id))).join(', ') + '</td>' +
        '<td class="num">' + (x.delta > 0 ? money(x.delta) : '') + '</td><td class="num">' + (x.delta < 0 ? money(-x.delta) : '') + '</td>' +
        '<td class="num"><b>' + money(opening + x.net, { parens: true }) + '</b></td></tr>').join('') +
      '<tr class="total"><td></td><td colspan="5">Ending balance — ' + (s.net > 0 ? esc(p.name) + ' owes you' : s.net < 0 ? 'you owe ' + esc(p.name) : 'settled') + '</td><td class="num">' + money(opening + (rows.length ? rows[rows.length - 1].net : 0), { parens: true }) + '</td></tr>' +
      '</tbody></table></div></div></div>';
    pt.bind(main);
    $('#ps-rec').onclick = () => openPersonTxDialog({ personId });
    $('#ps-edit').onclick = () => openPersonDialog(personId);
    $('#ps-csv').onclick = () => exportTableCSV('.ps-table', 'statement-' + p.name.replace(/\W+/g, '-') + '-' + r.to + '.csv');
    $$('tr[data-entry]').forEach((tr) => tr.onclick = () => openJournalDialog({ entry: book.entries.find((e) => e.id === tr.dataset.entry) }));
  }

  function openPersonDialog(id) {
    const p = id ? book.people.find((x) => x.id === id) : null;
    const pa = p ? L.personAccounts(book, p.id) : null;
    const used = pa && book.entries.some((e) => e.lines.some((l) => l.accountId === (pa.receivable || {}).id || l.accountId === (pa.payable || {}).id));
    showDialog(p ? 'Edit person' : 'Add person',
      '<div class="form-grid"><label class="field full">Name<input id="pp-name" value="' + esc(p ? p.name : '') + '" placeholder="e.g. Juan dela Cruz, Mom, Office mate"></label>' +
      '<label class="field full">Notes<input id="pp-notes" value="' + esc(p && p.notes || '') + '" placeholder="Phone, relationship, agreement…"></label></div>' +
      (p ? '' : '<p class="small muted" style="margin-top:10px">Creates two accounts: “Receivable – name” (they owe you) and “Payable – name” (you owe them).</p>'),
      [p ? (used ? '<button class="danger" data-act="archive">' + (p.archived ? 'Unarchive' : 'Archive') + '</button>' : '<button class="danger" data-act="delete">Delete</button>') : '',
        '<button data-act="cancel">Cancel</button><button class="primary" data-act="save">Save</button>']);
    $('#pp-name', dialog).focus();
    dialogAction('cancel', closeDialog);
    dialogAction('save', () => {
      const name = $('#pp-name', dialog).value.trim(), notes = $('#pp-notes', dialog).value.trim();
      if (!name) return dialogError('Name is required.');
      try {
        if (p) {
          if (book.people.some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) throw new Error(name + ' is already in your list.');
          L.renamePerson(book, p.id, name); p.notes = notes || undefined;
        } else L.addPerson(book, name, notes);
      } catch (err) { return dialogError(err.message); }
      closeDialog(); commit(); toast(p ? 'Saved' : 'Added ' + name);
    });
    dialogAction('archive', () => {
      p.archived = !p.archived;
      [pa.receivable, pa.payable].forEach((a) => { if (a) a.archived = p.archived; });
      closeDialog(); commit();
    });
    dialogAction('delete', () => {
      if (!confirm('Delete ' + p.name + '?')) return;
      book.people = book.people.filter((x) => x !== p);
      book.accounts = book.accounts.filter((a) => a.personId !== p.id);
      closeDialog(); location.hash = '#/people'; commit();
    });
  }

  const PERSON_TX = {
    lend: { label: 'I lent money / paid for them', hint: 'They owe you more.', side: 'receivable', dir: 'debit', via: 'Paid from' },
    collect: { label: 'They paid me back', hint: 'They owe you less.', side: 'receivable', dir: 'credit', via: 'Received into' },
    borrow: { label: 'I borrowed / they paid for me', hint: 'You owe them more.', side: 'payable', dir: 'credit', via: 'Received into / spent on' },
    repay: { label: 'I paid them back', hint: 'You owe them less.', side: 'payable', dir: 'debit', via: 'Paid from' },
  };

  function openPersonTxDialog(opts) {
    const people = (book.people || []).filter((p) => !p.archived || p.id === opts.personId);
    if (!people.length) { openPersonDialog(); return; }
    let type = opts.type || 'lend';
    const render = () => {
      const tt = PERSON_TX[type];
      // "They paid for me": the other side is usually an expense. Otherwise a bank, card or cash account.
      const viaPred = type === 'borrow' ? (a) => !a.personId && (isBalanceSheet(a) || a.type === 'expense')
        : type === 'lend' ? (a) => !a.personId && (isBalanceSheet(a) || a.type === 'income')
          : (a) => !a.personId && isBalanceSheet(a);
      showDialog('Record with a person',
        '<div class="segmented" style="margin-bottom:14px;flex-wrap:wrap">' + Object.entries(PERSON_TX).map(([k, v]) =>
          '<button data-pt="' + k + '" class="' + (k === type ? 'on' : '') + '">' + v.label + '</button>').join('') + '</div>' +
        '<div class="form-grid">' +
        '<label class="field">Person<select id="pt-person">' + people.map((p) => '<option value="' + p.id + '"' + (p.id === opts.personId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
        '<label class="field">' + tt.via + '<select id="pt-via">' + accountOptions(opts.viaId, viaPred, { placeholder: 'Choose account…' }) + '</select></label>' +
        '<label class="field">Amount<input id="pt-amt" inputmode="decimal" placeholder="0.00" value="' + centsToInput(opts.amount) + '"></label>' +
        '<label class="field">Date<input id="pt-date" type="date" value="' + (opts.date || today()) + '"></label>' +
        '<label class="field full">Description<input id="pt-desc" value="' + esc(opts.description || '') + '" placeholder="e.g. Lent for tuition, Shared dinner bill"></label>' +
        '</div><p class="small muted" style="margin-top:10px" id="pt-explain">' + tt.hint + '</p>',
        ['', '<button data-act="cancel">Cancel</button><button class="primary" data-act="save">Save</button>']);
      $$('[data-pt]', dialog).forEach((b) => b.onclick = () => { capture(); type = b.dataset.pt; render(); });
      const explain = () => {
        const p = book.people.find((x) => x.id === $('#pt-person', dialog).value);
        const via = acct($('#pt-via', dialog).value), a = L.toCents($('#pt-amt', dialog).value);
        const pa = L.personAccounts(book, p.id), side = pa[tt.side];
        $('#pt-explain', dialog).textContent = tt.hint + (via && a > 0 ? ' Journal entry: ' + (tt.dir === 'debit'
          ? 'Dr ' + side.name + ' / Cr ' + via.name : 'Dr ' + via.name + ' / Cr ' + side.name) + ' ' + money(a) + '.' : '');
      };
      ['#pt-person', '#pt-via', '#pt-amt'].forEach((sel) => $(sel, dialog).addEventListener('input', explain));
      explain();
      dialogAction('cancel', closeDialog);
      dialogAction('save', () => {
        capture();
        const p = book.people.find((x) => x.id === opts.personId);
        const via = acct(opts.viaId), amount = opts.amount;
        if (!via) return dialogError('Choose the account the money went through.');
        if (!amount || amount < 0) return dialogError('Enter a valid amount.');
        const side = L.personAccounts(book, p.id)[tt.side];
        const lines = tt.dir === 'debit'
          ? [{ accountId: side.id, debit: amount, credit: 0 }, { accountId: via.id, debit: 0, credit: amount }]
          : [{ accountId: via.id, debit: amount, credit: 0 }, { accountId: side.id, debit: 0, credit: amount }];
        const kind = via.type === 'expense' ? 'expense' : via.type === 'income' ? 'income' : 'transfer';
        try { L.postEntry(book, { date: opts.date, description: opts.description || tt.label + ' — ' + p.name, kind, lines }); }
        catch (err) { return dialogError(err.message); }
        closeDialog(); commit(); toast('Saved for ' + p.name);
      });
    };
    const capture = () => {
      opts.personId = $('#pt-person', dialog).value;
      opts.viaId = $('#pt-via', dialog).value;
      opts.amount = L.toCents($('#pt-amt', dialog).value) || 0;
      opts.date = $('#pt-date', dialog).value;
      opts.description = $('#pt-desc', dialog).value.trim();
    };
    render();
  }

  // ---------------------------------------------------------------------------
  // 4. Adjustments
  // ---------------------------------------------------------------------------

  const adjState = { date: null };

  function renderAdjust(params) {
    const date = adjState.date || today();
    const focus = params.get('focus');
    const bals = L.balances(book, { to: date });
    const revAccts = activeAccounts((a) => ['investment', 'other_asset', 'receivable'].includes(L.classify(a)));
    const closed = L.closedThrough(book);
    const recent = L.sortedEntries(L.selectEntries(book, { kinds: ['adjusting'], filter: (e) => !closed || e.date > closed })).reverse();
    main.innerHTML =
      '<div class="page-head"><div><h1>Adjustments</h1><div class="sub">Bring balances up to date before preparing statements: mark investments and assets to market value, record depreciation, accruals and corrections.</div></div>' +
      '<div class="btn-row"><button class="primary" id="add-adj">+ Adjusting journal entry</button></div></div>' +
      '<div class="card"><h2>Revalue investments &amp; assets to market</h2>' +
      '<div class="toolbar"><label class="field">Valuation date<input type="date" id="adj-date" value="' + date + '"></label></div>' +
      (revAccts.length ? '<div class="table-wrap"><table><thead><tr><th>Account</th><th>Type</th><th class="num">Book value</th><th class="num" style="width:170px">Market value</th><th class="num">Gain / (loss)</th></tr></thead><tbody>' +
        revAccts.map((a) => '<tr><td>' + esc(a.name) + '</td><td>' + esc(L.SUBTYPES[a.type][a.subtype]) + '</td><td class="num">' + money(bals.get(a.id).balance) + '</td>' +
          '<td class="num"><input class="num" style="width:150px" inputmode="decimal" data-mv="' + a.id + '" data-book="' + bals.get(a.id).balance + '" placeholder="' + centsToInput(bals.get(a.id).balance) + '"></td>' +
          '<td class="num" data-gl="' + a.id + '"></td></tr>').join('') +
        '</tbody></table></div><div class="btn-row" style="margin-top:12px"><button class="primary" id="post-mv">Post market value adjustments</button>' +
        '<span class="small muted">Each change posts an adjusting entry against “Market Value Gains (Losses)”, which appears under Other income on the P&amp;L.</span></div>'
        : '<div class="empty">Add investment or other-asset accounts to revalue them.</div>') +
      '</div>' +
      '<div class="card"><h2>Common adjusting entries</h2><div class="btn-row">' +
      '<button data-tpl="depr">Depreciation of a vehicle / asset</button>' +
      '<button data-tpl="interest">Accrued interest on a loan</button>' +
      '<button data-tpl="receivable">Income earned, not yet received</button>' +
      '<button data-tpl="prepaid">Use up a prepaid expense</button>' +
      '</div></div>' +
      '<div class="card"><h2>Adjusting entries in the open period</h2>' +
      (recent.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Accounts</th><th class="num">Amount</th></tr></thead><tbody>' +
        recent.map((e) => '<tr class="click" data-entry="' + e.id + '"><td>' + fmtDate(e.date) + '</td><td>' + esc(e.description) + '</td><td>' + e.lines.map((l) => esc(acctName(l.accountId))).join(', ') + '</td><td class="num">' + money(L.sumLines(e.lines).debit) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty small">No adjusting entries since the last close.</div>') + '</div>';

    $('#adj-date').onchange = (e) => { adjState.date = e.target.value; rerender(); };
    $('#add-adj').onclick = () => openJournalDialog({ kind: 'adjusting', date });
    $$('[data-mv]').forEach((inp) => inp.addEventListener('input', () => {
      const v = L.toCents(inp.value), cell = $('[data-gl="' + inp.dataset.mv + '"]');
      if (isNaN(v)) { cell.textContent = ''; return; }
      const d = v - +inp.dataset.book;
      cell.className = 'num ' + (d < 0 ? 'neg' : d > 0 ? 'pos' : '');
      cell.textContent = money(d, { parens: true });
    }));
    if (focus) { const f = $('[data-mv="' + focus + '"]'); if (f) f.focus(); }
    const post = $('#post-mv');
    if (post) post.onclick = () => {
      let n = 0; const errs = [];
      $$('[data-mv]').forEach((inp) => {
        if (!inp.value.trim()) return;
        const v = L.toCents(inp.value);
        if (isNaN(v)) { errs.push(acctName(inp.dataset.mv) + ': invalid amount'); return; }
        const e = L.revaluationEntry(book, inp.dataset.mv, date, v);
        if (!e) return;
        try { L.postEntry(book, e); n++; } catch (err) { errs.push(err.message); }
      });
      commit();
      toast(n ? 'Posted ' + n + ' adjustment' + (n > 1 ? 's' : '') : 'No changes to post');
      if (errs.length) alert(errs.join('\n'));
    };
    $$('[data-tpl]').forEach((b) => b.onclick = () => {
      const find = (pred) => (activeAccounts(pred)[0] || {}).id || '';
      const tpl = {
        depr: { description: 'Depreciation for the period', lines: [
          { accountId: ensureCategory('expense', 'Depreciation'), debit: 0, credit: 0 },
          { accountId: find((a) => L.classify(a) === 'other_asset'), debit: 0, credit: 0 }] },
        interest: { description: 'Accrued interest', lines: [
          { accountId: 'exp_interest', debit: 0, credit: 0 },
          { accountId: find((a) => L.classify(a) === 'loan'), debit: 0, credit: 0 }] },
        receivable: { description: 'Income earned, not yet received', lines: [
          { accountId: find((a) => L.classify(a) === 'receivable'), debit: 0, credit: 0 },
          { accountId: 'inc_other', debit: 0, credit: 0 }] },
        prepaid: { description: 'Prepaid expense used up', lines: [
          { accountId: 'exp_insurance', debit: 0, credit: 0 },
          { accountId: find((a) => a.subtype === 'other' && a.type === 'asset'), debit: 0, credit: 0 }] },
      }[b.dataset.tpl];
      openJournalDialog(Object.assign({ kind: 'adjusting', date }, tpl));
    });
    $$('tr[data-entry]').forEach((tr) => tr.onclick = () => editEntry(tr.dataset.entry));
  }

  function ensureCategory(type, name) {
    let a = book.accounts.find((x) => x.type === type && x.name.toLowerCase() === name.toLowerCase());
    if (!a) { a = { id: L.uid(type === 'expense' ? 'exp' : 'inc'), name, type, subtype: 'operating' }; book.accounts.push(a); save(); }
    return a.id;
  }

  // ---------------------------------------------------------------------------
  // 5. Financial statements
  // ---------------------------------------------------------------------------

  const stState = { tab: 'income', preset: 'ytd' };

  function renderStatements(params) {
    if (params.get('tab')) stState.tab = params.get('tab');
    const pt = periodToolbar(stState, rerender);
    const r = pt.range;
    const tabs = [['income', 'Income statement (P&L)'], ['balance', 'Balance sheet'], ['cashflow', 'Cash flow statement']];
    let content;
    if (stState.tab === 'income') content = incomeStatementHTML(r);
    else if (stState.tab === 'balance') content = balanceSheetHTML(r.to);
    else content = cashFlowHTML(r);
    main.innerHTML =
      '<div class="page-head"><div><h1>Financial statements</h1><div class="sub">Income statement, balance sheet and cash flow — ready to print or export.</div></div>' +
      '<div class="btn-row"><button id="st-csv">Export CSV</button><button data-print>Print / PDF</button></div></div>' +
      '<div class="toolbar"><div class="segmented">' + tabs.map(([k, l]) => '<button data-tab="' + k + '" class="' + (stState.tab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      pt.html + '</div>' +
      '<div class="card statement-card">' + content + '</div>';
    pt.bind(main);
    $$('[data-tab]').forEach((b) => b.onclick = () => { stState.tab = b.dataset.tab; rerender(); });
    $('#st-csv').onclick = () => {
      const rows = $$('.statement tr').map((tr) => $$('td', tr).map((td) => '"' + td.textContent.trim().replace(/"/g, '""') + '"').join(','));
      download('statement-' + stState.tab + '-' + r.to + '.csv', rows.join('\n'), 'text/csv');
    };
  }

  function stHead(title, sub) {
    return '<div class="st-head"><div class="muted small">' + esc(book.ownerName ? book.ownerName + ' — personal financial statements' : 'Personal financial statements') + '</div><div class="title">' + esc(title) + '</div><div class="muted">' + esc(sub) + '</div></div>';
  }
  function line(label, cents, cls, opts) {
    opts = opts || {};
    return '<tr class="' + (cls || '') + '"><td class="' + (opts.indent || '') + '">' + esc(label) + '</td><td class="num">' + (cents == null ? '' : money(cents, { parens: true })) + '</td></tr>';
  }

  function incomeStatementHTML(r) {
    const is = L.incomeStatement(book, r.from, r.to);
    let h = '<div class="statement">' + stHead('Income Statement (Profit & Loss)', 'For the period ' + fmtDate(r.from) + ' – ' + fmtDate(r.to)) + '<table><tbody>';
    h += line('Income', null, 'section');
    h += is.income.map((x) => line(x.account.name, x.amount, '', { indent: 'indent' })).join('') || line('No income recorded', null, 'muted', { indent: 'indent' });
    h += line('Total income', is.totalIncome, 'subtotal rule');
    h += line('Expenses', null, 'section');
    h += is.expenses.map((x) => line(x.account.name, x.amount, '', { indent: 'indent' })).join('') || line('No expenses recorded', null, 'muted', { indent: 'indent' });
    h += line('Total expenses', is.totalExpenses, 'subtotal rule');
    h += line('Operating surplus (deficit)', is.operatingIncome, 'subtotal rule');
    if (is.other.length) {
      h += line('Other income (expense)', null, 'section');
      h += is.other.map((x) => line(x.account.name, x.amount, '', { indent: 'indent' })).join('');
      h += line('Total other income (expense)', is.totalOther, 'subtotal rule');
    }
    h += line(is.netIncome >= 0 ? 'Net income (profit)' : 'Net loss', is.netIncome, 'total double');
    h += '</tbody></table>';
    if (is.savingsRate != null) h += '<p class="small muted" style="margin-top:12px;text-align:center">Savings rate (operating surplus ÷ income): ' + (is.savingsRate * 100).toFixed(1) + '%</p>';
    return h + '</div>';
  }

  function balanceSheetHTML(asOf) {
    const bs = L.balanceSheet(book, asOf);
    const rows = (list) => list.map((x) => line(x.account.name, x.amount, '', { indent: 'indent-2' })).join('');
    let h = '<div class="statement">' + stHead('Balance Sheet (Statement of Net Worth)', 'As of ' + fmtDate(asOf)) + '<table><tbody>';
    h += line('Assets', null, 'section');
    const grp = (label, list, total) => list.length ? line(label, null, 'subtotal', { indent: 'indent' }) + rows(list) + line('Total ' + label.toLowerCase(), total, 'rule', { indent: 'indent' }) : '';
    h += grp('Cash & cash equivalents', bs.assets.cash, bs.totals.cash);
    h += grp('Receivables (owed to me)', bs.assets.receivables.filter((x) => x.amount !== 0 || !x.account.personId), bs.totals.receivables);
    h += grp('Investments', bs.assets.investments, bs.totals.investments);
    h += grp('Other assets', bs.assets.otherAssets, bs.totals.otherAssets);
    h += line('Total assets', bs.totals.assets, 'total double');
    h += line('Liabilities', null, 'section');
    h += grp('Credit cards', bs.liabilities.creditCards, bs.totals.creditCards);
    h += grp('Payables (owed to people)', bs.liabilities.payables.filter((x) => x.amount !== 0 || !x.account.personId), bs.totals.payables);
    h += grp('Loans & other liabilities', bs.liabilities.loans, bs.totals.loans);
    h += line('Total liabilities', bs.totals.liabilities, 'subtotal rule');
    h += line('Net worth (equity)', null, 'section');
    h += bs.equity.accounts.map((x) => line(x.account.name, x.amount, '', { indent: 'indent' })).join('');
    h += line('Net income not yet closed', bs.equity.unclosedNetIncome, '', { indent: 'indent' });
    h += line('Total net worth', bs.totals.equity, 'subtotal rule');
    h += line('Total liabilities & net worth', bs.totals.liabilities + bs.totals.equity, 'total double');
    h += '</tbody></table>';
    h += '<div class="notice ' + (bs.balanced ? 'ok' : 'err') + '" style="margin-top:14px">' + (bs.balanced ? '✓ Assets = Liabilities + Net worth' : '✕ Balance sheet does not balance') +
      ' · Net worth ' + money(bs.netWorth) + '</div>';
    return h + '</div>';
  }

  function cashFlowHTML(r) {
    const cf = L.cashFlowStatement(book, r.from, r.to);
    const sec = (title, list, total, labeler) =>
      line(title, null, 'section') +
      (list.map((x) => line(labeler(x), x.amount, '', { indent: 'indent' })).join('') || line('None', null, 'muted', { indent: 'indent' })) +
      line('Net cash from ' + title.toLowerCase().replace('cash flows from ', ''), total, 'subtotal rule');
    const opLabel = (x) => x.account.type === 'income' ? 'Received: ' + x.account.name
      : x.account.type === 'expense' ? 'Paid: ' + x.account.name
        : L.classify(x.account) === 'credit_card' ? (x.amount < 0 ? 'Credit card payments: ' : 'Credit card cash advances: ') + x.account.name
          : x.account.name;
    const person = (x) => (book.people || []).find((p) => p.id === x.account.personId);
    const invLabel = (x) => person(x) ? (x.amount < 0 ? 'Money lent to ' : 'Collected from ') + person(x).name
      : (x.amount < 0 ? 'Purchase of / contribution to ' : 'Sale of / withdrawal from ') + x.account.name;
    const finLabel = (x) => x.account.type === 'equity' ? 'Opening balances recorded'
      : person(x) ? (x.amount < 0 ? 'Repaid to ' : 'Borrowed from ') + person(x).name
        : (x.amount < 0 ? 'Repayment of ' : 'Proceeds from ') + x.account.name;
    let h = '<div class="statement">' + stHead('Statement of Cash Flows', 'For the period ' + fmtDate(r.from) + ' – ' + fmtDate(r.to) + ' · direct method') + '<table><tbody>';
    h += sec('Operating activities', cf.operating, cf.totals.operating, opLabel);
    h += sec('Investing activities', cf.investing, cf.totals.investing, invLabel);
    h += sec('Financing activities', cf.financing, cf.totals.financing, finLabel);
    h += line('Net increase (decrease) in cash', cf.netChange, 'total');
    h += line('Cash at beginning of period', cf.beginning, '');
    h += line('Cash at end of period', cf.ending, 'total double');
    h += '</tbody></table>';
    h += '<div class="notice ' + (cf.reconciles ? 'ok' : 'err') + '" style="margin-top:14px">' + (cf.reconciles ? '✓ Reconciles to the cash balances on the balance sheet.' : '✕ Does not reconcile.') + '</div>';
    h += '<p class="small muted">Cash = bank accounts, debit cards, savings and cash on hand. Transfers between cash accounts net to zero. Spending on a credit card is not a cash outflow until you pay the card.</p>';
    return h + '</div>';
  }

  // ---------------------------------------------------------------------------
  // 6. Close the period
  // ---------------------------------------------------------------------------

  const closeState = { date: null };

  function renderClose() {
    const closed = L.closedThrough(book);
    const t = today();
    const y = +t.slice(0, 4), m = +t.slice(5, 7) - 1;
    const defaultDate = m === 0 ? L.monthEnd(y - 1, 11) : L.monthEnd(y, m - 1);
    const date = closeState.date || (closed && closed >= defaultDate ? t : defaultDate);
    const preview = (!closed || date > closed) ? L.buildClosingEntry(book, date) : null;
    const tbAdj = L.trialBalance(book, date, 'adjusted');
    const adjCount = L.selectEntries(book, { kinds: ['adjusting'], from: closed ? L.addDays(closed, 1) : null, to: date }).length;
    const closings = L.sortedEntries(L.selectEntries(book, { kinds: ['closing'] })).reverse();
    const check = (ok, text) => '<li style="margin-bottom:6px">' + (ok ? '✅' : '⬜') + ' ' + text + '</li>';
    main.innerHTML =
      '<div class="page-head"><div><h1>Close the period</h1><div class="sub">Closing entries zero out income and expense accounts and move net income into Retained Earnings. Closed periods are locked.</div></div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><h2>Close the books</h2>' +
      (closed ? '<div class="notice ok">Books are closed through <b>' + fmtDate(closed) + '</b>.</div>' : '<div class="notice warn">No period has been closed yet.</div>') +
      '<div class="toolbar"><label class="field">Close through<input type="date" id="cl-date" value="' + date + '"></label></div>' +
      '<ul style="list-style:none;padding:0;margin:0 0 12px">' +
      check(tbAdj.balanced, 'Books are in balance (debits = credits: ' + money(tbAdj.totalDebit) + ')') +
      check(adjCount > 0, adjCount + ' adjusting entr' + (adjCount === 1 ? 'y' : 'ies') + ' this period — <a href="#/adjust">review adjustments</a>') +
      check(true, '<a href="#/statements">Prepare statements</a> before closing') +
      '</ul>' +
      (closed && date <= closed ? '<div class="notice warn">Choose a date after ' + fmtDate(closed) + '.</div>'
        : preview ? '<h3>Closing entry preview</h3><div class="table-wrap"><table><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>' +
          preview.lines.map((l) => '<tr><td class="' + (l.credit ? 'je-credit' : '') + '">' + esc(acctName(l.accountId)) + '</td><td class="num">' + amt(l.debit) + '</td><td class="num">' + amt(l.credit) + '</td></tr>').join('') +
          '</tbody></table></div><p style="margin-top:10px">Net income closed to retained earnings: <b>' + money(preview.netIncome, { parens: true }) + '</b></p>' +
          '<button class="primary" id="cl-post">Post closing entry</button>'
          : '<div class="empty small">Nothing to close — no income or expense balances through this date.</div>') +
      '</div>' +
      '<div class="card"><h2>Closing history</h2>' +
      (closings.length ? '<div class="table-wrap"><table><thead><tr><th>Closed through</th><th class="num">Net income</th></tr></thead><tbody>' +
        closings.map((e) => {
          const re = e.lines.find((l) => acct(l.accountId) && acct(l.accountId).type === 'equity');
          return '<tr><td>' + fmtDate(e.date) + '</td><td class="num">' + money(re ? re.credit - re.debit : 0, { parens: true }) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="btn-row" style="margin-top:12px"><button class="danger" id="cl-reopen">Reopen ' + fmtDate(closed) + '</button><span class="small muted">Removes the latest closing entry so you can edit that period.</span></div>'
        : '<div class="empty small">No closings yet.</div>') +
      '<h3 style="margin-top:18px">What closing does</h3><p class="small muted">Income and expense accounts are temporary: they measure one period. Closing debits each income account and credits each expense account for its balance, with the difference (net income) credited to Retained Earnings. After closing, only permanent accounts — assets, liabilities and equity — carry balances.</p>' +
      '</div>' +
      '</div>';
    $('#cl-date').onchange = (e) => { closeState.date = e.target.value; rerender(); };
    const post = $('#cl-post');
    if (post) post.onclick = () => {
      if (!confirm('Close the books through ' + fmtDate(date) + '? Entries on or before this date will be locked.')) return;
      try { L.closePeriod(book, date); } catch (err) { return alert(err.message); }
      closeState.date = null; commit(); toast('Period closed through ' + fmtDate(date));
    };
    const reopen = $('#cl-reopen');
    if (reopen) reopen.onclick = () => {
      if (!confirm('Reopen the period closed through ' + fmtDate(closed) + '?')) return;
      L.reopenLastPeriod(book); commit(); toast('Period reopened');
    };
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  function renderSettings() {
    main.innerHTML =
      '<div class="page-head"><div><h1>Settings &amp; backup</h1><div class="sub">Your data is stored only on this device. Back it up regularly.</div></div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><h2>Preferences</h2><div class="form-grid">' +
      '<label class="field">Currency code<input id="s-cur" value="' + esc(book.currency) + '" maxlength="3" placeholder="PHP, USD, EUR…"></label>' +
      '<label class="field full">Name on reports<input id="s-owner" value="' + esc(book.ownerName || '') + '" placeholder="e.g. Maria Santos — shown at the top of printed statements"></label>' +
      '<label class="field">Theme<select id="s-theme"><option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>' +
      '</div></div>' +
      '<div class="card"><h2>Backup &amp; restore</h2>' +
      '<p class="small muted">Your data is stored only on this device. A backup is one file with everything — accounts, cards, people and every transaction. Save it to Google Drive, Files or email, and use it to restore on a new phone, tablet or computer.</p>' +
      (backupDue() ? '<div class="notice warn">' + (lastBackupAt() ? 'You have changes since your last backup.' : 'You have not made a backup yet.') + '</div>' : '') +
      '<div class="btn-row"><button id="s-export" class="primary">Back up now</button>' +
      '<label class="btn">Restore from backup<input type="file" id="s-import" accept=".json,application/json" class="hidden"></label>' +
      '<button id="s-csv">Export transactions (CSV)</button></div>' +
      '<p class="small muted" style="margin-top:10px">Last backup: <b>' + (lastBackupAt() ? new Date(lastBackupAt()).toLocaleString() : 'never') + '</b> · ' + book.accounts.filter((a) => (a.type === 'asset' || a.type === 'liability') && !a.personId).length + ' accounts &amp; cards · ' + book.entries.length + ' entries</p></div>' +
      '<div class="card"><h2>Sample data</h2><p class="small muted">Loads demo accounts, cards, people and three months of transactions so you can explore every report. <b>Replaces your current data</b> — back up first.</p><button id="s-sample">Load sample data</button></div>' +
      '<div class="card"><h2>Reset</h2><p class="small muted">Erase all accounts and transactions on this device.</p><button class="danger" id="s-reset">Erase everything</button></div>' +
      '</div>';
    $('#s-theme').value = prefs.theme || '';
    $('#s-owner').onchange = (e) => { book.ownerName = e.target.value.trim() || undefined; commit(); toast('Saved'); };
    $('#s-theme').onchange = (e) => { prefs.theme = e.target.value; savePrefs(); applyTheme(); };
    $('#s-cur').onchange = (e) => {
      const c = e.target.value.trim().toUpperCase();
      try { new Intl.NumberFormat(undefined, { style: 'currency', currency: c }); } catch (err) { return alert('Unknown currency code: ' + c); }
      book.currency = c; book.currencyChosen = true; commit(); toast('Currency set to ' + c);
    };
    $('#s-export').onclick = backupNow;
    $('#s-import').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await restoreBackup(f); } catch (err) { alert('Could not restore: ' + err.message); }
      e.target.value = '';
    };
    $('#s-csv').onclick = () => {
      const rows = [['Date', 'Entry ID', 'Type', 'Description', 'Account', 'Account type', 'Debit', 'Credit', 'Memo']];
      for (const e of L.sortedEntries(book.entries)) for (const l of e.lines) {
        const a = acct(l.accountId) || {};
        rows.push([e.date, e.id, L.ENTRY_KINDS[e.kind], e.description, a.name, a.type, (l.debit / 100).toFixed(2), (l.credit / 100).toFixed(2), e.memo || '']);
      }
      download('ledger-transactions-' + today() + '.csv', rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');
    };
    $('#s-sample').onclick = () => {
      if (book.entries.length && !confirm('Replace ALL your current data with sample data? This cannot be undone — export a backup first.')) return;
      book = sampleBook(); commit(); location.hash = '#/dashboard'; toast('Sample data loaded');
    };
    $('#s-reset').onclick = () => {
      if (!confirm('Erase all data? This cannot be undone (export a backup first).')) return;
      book = L.emptyBook(); commit(); toast('All data erased');
    };
  }

  function download(name, text, type) { return saveFile(name, text, type); }

  function applyTheme() {
    if (prefs.theme) document.documentElement.setAttribute('data-theme', prefs.theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  // ---------------------------------------------------------------------------
  // Sample data
  // ---------------------------------------------------------------------------

  function sampleBook() {
    const b = L.emptyBook();
    const add = (id, name, type, subtype, extra) => { b.accounts.push(Object.assign({ id, name, type, subtype }, extra || {})); return id; };
    add('s_chk', 'Everyday Checking (Debit)', 'asset', 'checking', { institution: 'First Bank', last4: '4821', color: '#1d4ed8' });
    add('s_sav', 'High-Yield Savings', 'asset', 'savings', { institution: 'First Bank', last4: '9930', color: '#0e7490' });
    add('s_visa', 'Rewards Visa', 'liability', 'credit_card', { institution: 'Card Co', last4: '1007', color: '#111827' });
    add('s_mc', 'Travel Mastercard', 'liability', 'credit_card', { institution: 'Travel Bank', last4: '5562', color: '#dc2626' });
    add('s_brk', 'Brokerage Account', 'asset', 'investment', { institution: 'Broker Inc', color: '#7c3aed' });
    add('s_401k', 'Retirement Fund', 'asset', 'retirement', { color: '#ca8a04' });
    add('s_car', 'Car', 'asset', 'vehicle');
    add('s_carloan', 'Car Loan', 'liability', 'loan', { institution: 'Auto Finance' });
    const t = today();
    const start = L.addDays(monthStart(t), -1);
    const startMonth = new Date(start + 'T00:00:00Z');
    const months = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() - i + 1, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const opening = L.addDays(months[0] + '-01', -1);
    const post = (e) => { try { L.postEntry(b, e); } catch (err) { /* skip future-dated */ } };
    const op = (id, v) => post(L.openingEntry(b, L.findAccount(b, id), opening, v));
    op('acc_cash', 15000); op('s_chk', 420000); op('s_sav', 1200000); op('s_visa', 63000); op('s_mc', 12000);
    op('s_brk', 1850000); op('s_401k', 3400000); op('s_car', 1800000); op('s_carloan', 1100000);
    const tx = (date, desc, accountId, counterId, direction, amount) => {
      if (date > t) return;
      post(L.simpleEntry(b, { date, description: desc, accountId, counterId, direction, amount }));
    };
    months.forEach((m, i) => {
      const d = (day) => m + '-' + String(day).padStart(2, '0');
      tx(d(1), 'Rent', 's_chk', 'exp_housing', 'out', 180000);
      tx(d(2), 'Car loan payment', 's_chk', 's_carloan', 'out', 32000);
      tx(d(3), 'Streaming services', 's_visa', 'exp_subs', 'out', 2799);
      tx(d(5), 'Supermarket', 's_visa', 'exp_groceries', 'out', 14320 + i * 850);
      tx(d(7), 'Electric & internet', 's_chk', 'exp_utilities', 'out', 15400);
      tx(d(9), 'Coffee shop', 'acc_cash', 'exp_dining', 'out', 1250);
      tx(d(10), 'Gas station', 's_visa', 'exp_transport', 'out', 5200);
      tx(d(12), 'Restaurant dinner', 's_mc', 'exp_dining', 'out', 8640);
      tx(d(14), 'Paycheck', 's_chk', 'inc_salary', 'in', 325000);
      tx(d(15), 'Pay Rewards Visa', 's_chk', 's_visa', 'out', i === 0 ? 63000 : 30000);
      tx(d(16), 'Transfer to savings', 's_chk', 's_sav', 'out', 50000);
      tx(d(18), 'Buy index fund', 's_chk', 's_brk', 'out', 40000);
      tx(d(19), 'Supermarket', 's_visa', 'exp_groceries', 'out', 11875);
      tx(d(20), 'Online shopping', 's_mc', 'exp_shopping', 'out', 6499 + i * 1200);
      tx(d(22), 'Pharmacy', 's_chk', 'exp_health', 'out', 2350);
      tx(d(24), 'Movie night', 's_visa', 'exp_entertain', 'out', 3600);
      tx(d(25), 'Savings interest', 's_sav', 'inc_interest', 'in', 4100);
      tx(d(26), 'ATM withdrawal', 's_chk', 'acc_cash', 'out', 10000);
      tx(d(28), 'Paycheck', 's_chk', 'inc_salary', 'in', 325000);
      tx(d(28), 'Pay Travel Mastercard', 's_chk', 's_mc', 'out', 12000);
      tx(d(28), 'Freelance project', 's_chk', 'inc_business', 'in', 45000 + i * 5000);
      const end = L.monthEnd(+m.slice(0, 4), +m.slice(5, 7) - 1);
      if (end <= t) {
        const brk = L.revaluationEntry(b, 's_brk', end, L.balanceOf(b, 's_brk', { to: end }) + (i === 1 ? -22000 : 31000));
        if (brk) post(brk);
        post(L.revaluationEntry(b, 's_car', end, L.balanceOf(b, 's_car', { to: end }) - 15000, 'Depreciation of car to market value'));
      }
    });
    const juan = L.addPerson(b, 'Juan dela Cruz', 'Office mate');
    const mom = L.addPerson(b, 'Mom');
    const ana = L.addPerson(b, 'Ana', 'Shared trip expenses');
    const pj = L.personAccounts(b, juan.id), pm = L.personAccounts(b, mom.id), pa = L.personAccounts(b, ana.id);
    const m0 = months[1] || months[0], m1 = months[2] || m0;
    tx(m0 + '-06', 'Lent to Juan for tuition', 's_chk', pj.receivable.id, 'out', 500000);
    tx(m1 + '-05', 'Juan partial repayment', 's_chk', pj.receivable.id, 'in', 200000);
    tx(m0 + '-11', 'Borrowed from Mom for car repair', 's_chk', pm.payable.id, 'in', 1500000);
    tx(m1 + '-11', 'Repaid Mom', 's_chk', pm.payable.id, 'out', 500000);
    tx(m1 + '-03', 'Paid Ana\'s share of hotel', 's_mc', pa.receivable.id, 'out', 420000);
    if (m1 + '-04' <= t) post({ date: m1 + '-04', kind: 'expense', description: 'Ana paid my share of dinner', lines: [
      { accountId: 'exp_dining', debit: 180000, credit: 0 }, { accountId: pa.payable.id, debit: 0, credit: 180000 }] });
    if (months.length >= 2) {
      const firstEnd = L.monthEnd(+months[0].slice(0, 4), +months[0].slice(5, 7) - 1);
      try { L.closePeriod(b, firstEnd); } catch (e) { /* nothing to close */ }
    }
    return b;
  }

  // ---------------------------------------------------------------------------
  // Dialog helpers
  // ---------------------------------------------------------------------------

  function showDialog(title, body, footer) {
    dialog.innerHTML =
      '<form method="dialog" onsubmit="return false"><div class="dlg-head"><h2>' + esc(title) + '</h2><button type="button" class="link" data-act="x" aria-label="Close">✕</button></div>' +
      '<div class="dlg-body"><div id="dlg-err" class="notice err hidden"></div>' + body + '</div>' +
      '<div class="dlg-foot"><div>' + (footer[0] || '') + '</div><div class="right">' + (footer[1] || '') + '</div></div></form>';
    $$('button', dialog).forEach((b) => { if (!b.getAttribute('type')) b.type = 'button'; });
    dialogAction('x', closeDialog);
    if (!dialog.open) dialog.showModal();
  }
  function dialogAction(act, fn) { const b = $('[data-act="' + act + '"]', dialog); if (b) b.onclick = fn; }
  function dialogError(msg) { const el = $('#dlg-err', dialog); el.textContent = msg; el.classList.remove('hidden'); el.scrollIntoView({ block: 'nearest' }); }
  function closeDialog() { dialog.close(); dialog.innerHTML = ''; }

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'file') {
      e.preventDefault();
      const primary = $('.dlg-foot button.primary', dialog);
      if (primary) primary.click();
    }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  // Print / PDF buttons on every report.
  document.addEventListener('click', (e) => { if (e.target.closest('[data-print]')) { e.preventDefault(); printPage(); } });

  // Android hardware back button: close the menu or dialog, go back a page, or leave the app.
  if (Native && Native.App) {
    Native.App.addListener('backButton', ({ canGoBack }) => {
      if (dialog.open) { closeDialog(); return; }
      if ($('#app').classList.contains('nav-open')) { $('#app').classList.remove('nav-open'); return; }
      if (canGoBack && currentRoute().name !== 'dashboard') window.history.back();
      else Native.App.exitApp();
    });
  }

  // Offline support when served over http(s) (not needed inside the Android app, which bundles its files).
  if ('serviceWorker' in navigator && !Native && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
  }

  applyTheme();
  render();
})();
