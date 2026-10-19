/*
 * Ledger core: double-entry bookkeeping engine and financial reports.
 *
 * All amounts are integer cents. Every journal entry must balance
 * (total debits === total credits). Works in the browser (window.Ledger)
 * and in Node (module.exports) so it can be unit tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ledger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Chart of accounts metadata
  // ---------------------------------------------------------------------------

  const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

  // Subtypes decide where an account appears on the statements.
  const SUBTYPES = {
    asset: {
      cash: 'Cash on hand',
      checking: 'Checking / debit card',
      savings: 'Savings',
      investment: 'Investment',
      retirement: 'Retirement',
      crypto: 'Crypto',
      receivable: 'Money owed to me',
      property: 'Real estate',
      vehicle: 'Vehicle',
      other: 'Other asset',
    },
    liability: {
      credit_card: 'Credit card',
      payable: 'Owed to a person',
      loan: 'Loan',
      mortgage: 'Mortgage',
      other: 'Other liability',
    },
    equity: {
      opening: 'Opening balance equity',
      retained: 'Retained earnings',
      other: 'Other equity',
    },
    income: { operating: 'Income', unrealized: 'Market value adjustment' },
    expense: { operating: 'Expense' },
  };

  const CASH_SUBTYPES = ['cash', 'checking', 'savings'];
  const INVESTMENT_SUBTYPES = ['investment', 'retirement', 'crypto'];

  /** Balance-sheet / cash-flow class of an account. */
  function classify(acct) {
    if (!acct) return 'unknown';
    switch (acct.type) {
      case 'asset':
        if (CASH_SUBTYPES.includes(acct.subtype)) return 'cash';
        if (INVESTMENT_SUBTYPES.includes(acct.subtype)) return 'investment';
        if (acct.subtype === 'receivable') return 'receivable';
        return 'other_asset';
      case 'liability':
        if (acct.subtype === 'credit_card') return 'credit_card';
        if (acct.subtype === 'payable') return 'payable';
        return 'loan';
      default:
        return acct.type;
    }
  }

  function isDebitNormal(acct) {
    return acct.type === 'asset' || acct.type === 'expense';
  }

  function isTemporary(acct) {
    return acct.type === 'income' || acct.type === 'expense';
  }

  const ENTRY_KINDS = {
    expense: 'Expense',
    income: 'Income',
    transfer: 'Transfer',
    journal: 'Journal',
    opening: 'Opening balance',
    adjusting: 'Adjusting',
    closing: 'Closing',
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  let idCounter = 0;
  function uid(prefix) {
    idCounter = (idCounter + 1) % 1e6;
    return (
      (prefix || 'id') + '_' + Date.now().toString(36) + idCounter.toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }

  /** Parse a user-typed money string into integer cents. Returns NaN if invalid. */
  function toCents(input) {
    if (typeof input === 'number') return Math.round(input * 100);
    if (input == null) return NaN;
    let s = String(input).trim();
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[\s$€£¥₱,]/g, '');
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    else if (s.startsWith('+')) s = s.slice(1);
    if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return NaN;
    const [whole, frac = ''] = s.split('.');
    const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) +
      (Number(frac.charAt(2) || 0) >= 5 ? 1 : 0);
    return neg ? -cents : cents;
  }

  function formatMoney(cents, currency, opts) {
    opts = opts || {};
    const value = (cents || 0) / 100;
    let str;
    try {
      str = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'PHP',
        minimumFractionDigits: 2,
      }).format(Math.abs(value));
    } catch (e) {
      str = Math.abs(value).toFixed(2);
    }
    if (cents < 0) return opts.parens ? '(' + str + ')' : '-' + str;
    return str;
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function monthEnd(year, monthIndex) {
    const d = new Date(Date.UTC(year, monthIndex + 1, 0));
    return d.toISOString().slice(0, 10);
  }

  function sumLines(lines) {
    let debit = 0, credit = 0;
    for (const l of lines) { debit += l.debit || 0; credit += l.credit || 0; }
    return { debit, credit };
  }

  // ---------------------------------------------------------------------------
  // Default book
  // ---------------------------------------------------------------------------

  function defaultAccounts() {
    const a = (id, name, type, subtype, extra) =>
      Object.assign({ id, name, type, subtype }, extra || {});
    return [
      a('acc_cash', 'Cash on Hand', 'asset', 'cash'),
      a('eq_opening', 'Opening Balance Equity', 'equity', 'opening', { system: true }),
      a('eq_retained', 'Retained Earnings (Accumulated Net Worth)', 'equity', 'retained', { system: true }),
      a('inc_salary', 'Salary & Wages', 'income', 'operating'),
      a('inc_business', 'Business / Side Income', 'income', 'operating'),
      a('inc_interest', 'Interest & Dividends', 'income', 'operating'),
      a('inc_gifts', 'Gifts Received', 'income', 'operating'),
      a('inc_other', 'Other Income', 'income', 'operating'),
      a('inc_uncat', 'Uncategorized Income', 'income', 'operating', { system: true }),
      a('inc_mva', 'Market Value Gains (Losses)', 'income', 'unrealized', { system: true }),
      a('exp_housing', 'Housing & Rent', 'expense', 'operating'),
      a('exp_utilities', 'Utilities & Phone', 'expense', 'operating'),
      a('exp_groceries', 'Groceries', 'expense', 'operating'),
      a('exp_dining', 'Dining Out', 'expense', 'operating'),
      a('exp_transport', 'Transportation & Fuel', 'expense', 'operating'),
      a('exp_health', 'Health & Medical', 'expense', 'operating'),
      a('exp_insurance', 'Insurance', 'expense', 'operating'),
      a('exp_shopping', 'Shopping', 'expense', 'operating'),
      a('exp_entertain', 'Entertainment', 'expense', 'operating'),
      a('exp_subs', 'Subscriptions', 'expense', 'operating'),
      a('exp_travel', 'Travel', 'expense', 'operating'),
      a('exp_education', 'Education', 'expense', 'operating'),
      a('exp_personal', 'Personal Care', 'expense', 'operating'),
      a('exp_gifts', 'Gifts & Donations', 'expense', 'operating'),
      a('exp_interest', 'Interest & Bank Fees', 'expense', 'operating'),
      a('exp_taxes', 'Taxes', 'expense', 'operating'),
      a('exp_misc', 'Miscellaneous', 'expense', 'operating'),
      a('exp_uncat', 'Uncategorized Expense', 'expense', 'operating', { system: true }),
    ];
  }

  function emptyBook() {
    return { version: 1, currency: 'PHP', accounts: defaultAccounts(), entries: [], people: [] };
  }

  // ---------------------------------------------------------------------------
  // Book operations
  // ---------------------------------------------------------------------------

  function accountMap(book) {
    const m = new Map();
    for (const a of book.accounts) m.set(a.id, a);
    return m;
  }

  function findAccount(book, id) {
    return book.accounts.find((a) => a.id === id);
  }

  function systemAccount(book, type, subtype) {
    return book.accounts.find((a) => a.type === type && a.subtype === subtype && a.system) ||
      book.accounts.find((a) => a.type === type && a.subtype === subtype);
  }

  /** Latest date the books have been closed through (or null). */
  function closedThrough(book) {
    let d = null;
    for (const e of book.entries) if (e.kind === 'closing' && (!d || e.date > d)) d = e.date;
    return d;
  }

  /** Validate an entry; returns an array of error strings (empty when valid). */
  function validateEntry(book, entry, opts) {
    opts = opts || {};
    const errors = [];
    if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) errors.push('A valid date is required.');
    if (!entry.lines || entry.lines.length < 2) errors.push('An entry needs at least two lines.');
    const accts = accountMap(book);
    for (const l of entry.lines || []) {
      if (!accts.has(l.accountId)) errors.push('Every line needs a valid account.');
      const d = l.debit || 0, c = l.credit || 0;
      if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) errors.push('Amounts must be positive numbers.');
      if (d && c) errors.push('A line cannot have both a debit and a credit.');
      if (!d && !c) errors.push('Every line needs a debit or a credit amount.');
    }
    const t = sumLines(entry.lines || []);
    if (t.debit !== t.credit) {
      errors.push('Debits (' + formatMoney(t.debit, book.currency) + ') must equal credits (' +
        formatMoney(t.credit, book.currency) + ').');
    }
    if (t.debit === 0) errors.push('Entry total cannot be zero.');
    const closed = closedThrough(book);
    if (!opts.allowClosed && entry.kind !== 'closing' && closed && entry.date <= closed) {
      errors.push('The books are closed through ' + closed +
        '. Reopen that period (Close Period page) to post on or before that date.');
    }
    return Array.from(new Set(errors));
  }

  function normalizeEntry(entry) {
    return {
      id: entry.id || uid('je'),
      date: entry.date,
      description: (entry.description || '').trim(),
      memo: (entry.memo || '').trim(),
      ref: (entry.ref || '').trim() || undefined,
      kind: entry.kind || 'journal',
      lines: entry.lines
        .filter((l) => (l.debit || 0) || (l.credit || 0))
        .map((l) => ({
          accountId: l.accountId,
          debit: l.debit || 0,
          credit: l.credit || 0,
          memo: l.memo || undefined,
        })),
      createdAt: entry.createdAt || new Date().toISOString(),
    };
  }

  /** Add or replace an entry. Throws an Error with .errors on validation failure. */
  function postEntry(book, entry, opts) {
    const e = normalizeEntry(entry);
    // When editing, validate against the book without the old version.
    const others = { ...book, entries: book.entries.filter((x) => x.id !== e.id) };
    const old = book.entries.find((x) => x.id === e.id);
    const closed = closedThrough(others);
    const errors = validateEntry(others, e, opts);
    if (old && old.kind !== 'closing' && closed && old.date <= closed && !(opts && opts.allowClosed)) {
      errors.push('The original entry is in a closed period (through ' + closed + ').');
    }
    if (errors.length) {
      const err = new Error(errors.join(' '));
      err.errors = errors;
      throw err;
    }
    const idx = book.entries.findIndex((x) => x.id === e.id);
    if (idx >= 0) book.entries[idx] = e;
    else book.entries.push(e);
    return e;
  }

  function deleteEntry(book, id) {
    const e = book.entries.find((x) => x.id === id);
    if (!e) return;
    const closed = closedThrough(book);
    if (e.kind !== 'closing' && closed && e.date <= closed) {
      throw new Error('This entry is in a closed period (through ' + closed + '). Reopen the period first.');
    }
    if (e.kind === 'closing' && closed && e.date < closed) {
      throw new Error('Reopen later periods first (books closed through ' + closed + ').');
    }
    book.entries = book.entries.filter((x) => x.id !== id);
  }

  /**
   * Build a simple two-line entry from "money in / money out" terms.
   * direction 'out': money leaves `accountId` toward `counterId` (Dr counter, Cr account)
   * direction 'in' : money arrives in `accountId` from `counterId` (Dr account, Cr counter)
   */
  function simpleEntry(book, { id, date, description, memo, ref, accountId, counterId, direction, amount }) {
    const amt = Math.abs(amount);
    const debitId = direction === 'in' ? accountId : counterId;
    const creditId = direction === 'in' ? counterId : accountId;
    const counter = findAccount(book, counterId);
    const self = findAccount(book, accountId);
    let kind = 'transfer';
    if (counter && counter.type === 'expense') kind = 'expense';
    else if (counter && counter.type === 'income') kind = 'income';
    else if (counter && counter.type === 'equity') kind = self && self.type === 'equity' ? 'journal' : 'opening';
    return {
      id, date, description, memo, ref, kind,
      lines: [
        { accountId: debitId, debit: amt, credit: 0 },
        { accountId: creditId, debit: 0, credit: amt },
      ],
    };
  }

  /** Describe a two-line entry from the perspective of one account (for editing). */
  function asSimple(entry, accountId) {
    if (entry.lines.length !== 2) return null;
    const mine = entry.lines.find((l) => l.accountId === accountId) || entry.lines.find((l) => l.credit) ;
    const other = entry.lines.find((l) => l !== mine);
    if (!mine || !other) return null;
    return {
      accountId: mine.accountId,
      counterId: other.accountId,
      direction: mine.debit ? 'in' : 'out',
      amount: mine.debit || mine.credit,
    };
  }

  /** Opening balance entry for a balance-sheet account. `amount` is in natural sign. */
  function openingEntry(book, acct, date, amount) {
    const eq = systemAccount(book, 'equity', 'opening');
    const amt = Math.abs(amount);
    const increase = amount >= 0;
    const debitAcct = isDebitNormal(acct) === increase ? acct.id : eq.id;
    const creditAcct = debitAcct === acct.id ? eq.id : acct.id;
    return {
      date,
      kind: 'opening',
      description: 'Opening balance — ' + acct.name,
      lines: [
        { accountId: debitAcct, debit: amt, credit: 0 },
        { accountId: creditAcct, debit: 0, credit: amt },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // People: a receivable and a payable account per person
  // ---------------------------------------------------------------------------

  function personAccounts(book, personId) {
    return {
      receivable: book.accounts.find((a) => a.personId === personId && a.type === 'asset'),
      payable: book.accounts.find((a) => a.personId === personId && a.type === 'liability'),
    };
  }

  function addPerson(book, name, notes) {
    name = String(name || '').trim();
    if (!name) throw new Error('Name is required.');
    book.people = book.people || [];
    if (book.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(name + ' is already in your list.');
    const person = { id: uid('per'), name, notes: (notes || '').trim() || undefined };
    book.people.push(person);
    book.accounts.push(
      { id: uid('acc'), name: 'Receivable – ' + name, type: 'asset', subtype: 'receivable', personId: person.id },
      { id: uid('acc'), name: 'Payable – ' + name, type: 'liability', subtype: 'payable', personId: person.id });
    return person;
  }

  function renamePerson(book, personId, name) {
    const p = (book.people || []).find((x) => x.id === personId);
    name = String(name || '').trim();
    if (!p || !name) return;
    p.name = name;
    const pa = personAccounts(book, personId);
    if (pa.receivable) pa.receivable.name = 'Receivable – ' + name;
    if (pa.payable) pa.payable.name = 'Payable – ' + name;
  }

  /**
   * Per-person summary as of a date. owedToMe / iOwe are natural balances,
   * net > 0 means the person owes you overall.
   */
  function peopleSummary(book, asOf) {
    const bals = balances(book, { to: asOf });
    return (book.people || []).map((p) => {
      const pa = personAccounts(book, p.id);
      const owedToMe = pa.receivable ? bals.get(pa.receivable.id).balance : 0;
      const iOwe = pa.payable ? bals.get(pa.payable.id).balance : 0;
      let last = null;
      for (const e of book.entries) {
        if (e.date <= asOf && e.lines.some((l) => l.accountId === (pa.receivable || {}).id || l.accountId === (pa.payable || {}).id) && (!last || e.date > last)) last = e.date;
      }
      return { person: p, owedToMe, iOwe, net: owedToMe - iOwe, lastActivity: last, accounts: pa };
    });
  }

  /** Statement of account for one person: every entry, running net (+ they owe me). */
  function personStatement(book, personId, f) {
    const pa = personAccounts(book, personId);
    const ids = [pa.receivable && pa.receivable.id, pa.payable && pa.payable.id].filter(Boolean);
    let running = 0;
    const rows = [];
    for (const e of sortedEntries(selectEntries(book, f))) {
      let rec = 0, pay = 0;
      for (const l of e.lines) {
        if (pa.receivable && l.accountId === pa.receivable.id) rec += l.debit - l.credit;
        if (pa.payable && l.accountId === pa.payable.id) pay += l.credit - l.debit;
      }
      if (!e.lines.some((l) => ids.includes(l.accountId))) continue;
      const delta = rec - pay;
      running += delta;
      const counterIds = Array.from(new Set(e.lines.filter((l) => !ids.includes(l.accountId)).map((l) => l.accountId)));
      rows.push({ entry: e, receivable: rec, payable: pay, delta, net: running, counterIds });
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Balances
  // ---------------------------------------------------------------------------

  function sortedEntries(entries) {
    return entries.slice().sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 :
      (a.createdAt || '') < (b.createdAt || '') ? -1 : (a.createdAt || '') > (b.createdAt || '') ? 1 : 0);
  }

  /**
   * Entry filter: { from, to, kinds, excludeKinds, filter(entry) }.
   * `from`/`to` are inclusive ISO dates.
   */
  function selectEntries(book, f) {
    f = f || {};
    return book.entries.filter((e) =>
      (!f.from || e.date >= f.from) &&
      (!f.to || e.date <= f.to) &&
      (!f.kinds || f.kinds.includes(e.kind)) &&
      (!f.excludeKinds || !f.excludeKinds.includes(e.kind)) &&
      (!f.filter || f.filter(e)));
  }

  /** Map accountId -> { debit, credit, balance } where balance is natural-sign. */
  function balances(book, f) {
    const accts = accountMap(book);
    const out = new Map();
    for (const a of book.accounts) out.set(a.id, { debit: 0, credit: 0, balance: 0 });
    for (const e of selectEntries(book, f)) {
      for (const l of e.lines) {
        const b = out.get(l.accountId);
        if (!b) continue;
        b.debit += l.debit || 0;
        b.credit += l.credit || 0;
      }
    }
    for (const [id, b] of out) {
      const a = accts.get(id);
      b.balance = isDebitNormal(a) ? b.debit - b.credit : b.credit - b.debit;
    }
    return out;
  }

  function balanceOf(book, accountId, f) {
    return balances(book, f).get(accountId).balance;
  }

  /** Register rows for one account with running balance (natural sign). */
  function register(book, accountId, f) {
    const acct = findAccount(book, accountId);
    const debitNormal = isDebitNormal(acct);
    let running = 0;
    const rows = [];
    for (const e of sortedEntries(selectEntries(book, f))) {
      let delta = 0;
      let touched = false;
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        touched = true;
        delta += debitNormal ? (l.debit - l.credit) : (l.credit - l.debit);
      }
      if (!touched) continue;
      running += delta;
      const others = e.lines.filter((l) => l.accountId !== accountId).map((l) => l.accountId);
      const t = sumLines(e.lines.filter((l) => l.accountId === accountId));
      rows.push({ entry: e, delta, balance: running, debit: t.debit, credit: t.credit, counterIds: Array.from(new Set(others)) });
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Accounting cycle: trial balances and closing
  // ---------------------------------------------------------------------------

  /**
   * Trial balance as of a date.
   * mode: 'unadjusted' | 'adjusted' | 'post-closing'
   *  - unadjusted: excludes adjusting entries of the current (unclosed) period and
   *    the closing entry dated on the as-of date.
   *  - adjusted: excludes only the closing entry dated on the as-of date.
   *  - post-closing: everything.
   */
  function trialBalance(book, asOf, mode) {
    let priorClose = null;
    for (const e of book.entries) {
      if (e.kind === 'closing' && e.date < asOf && (!priorClose || e.date > priorClose)) priorClose = e.date;
    }
    const filter = (e) => {
      if (mode !== 'post-closing' && e.kind === 'closing' && e.date === asOf) return false;
      if (mode === 'unadjusted' && e.kind === 'adjusting' && (!priorClose || e.date > priorClose)) return false;
      return true;
    };
    const bals = balances(book, { to: asOf, filter });
    const rows = [];
    let totalDebit = 0, totalCredit = 0;
    for (const a of orderAccounts(book.accounts)) {
      const b = bals.get(a.id);
      const net = b.debit - b.credit;
      if (net === 0) continue;
      const row = { account: a, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
      totalDebit += row.debit;
      totalCredit += row.credit;
      rows.push(row);
    }
    return { asOf, mode, rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }

  function orderAccounts(accounts) {
    const typeOrder = { asset: 0, liability: 1, equity: 2, income: 3, expense: 4 };
    const classOrder = { cash: 0, receivable: 1, investment: 2, other_asset: 3, credit_card: 0, payable: 1, loan: 2 };
    return accounts.slice().sort((a, b) =>
      typeOrder[a.type] - typeOrder[b.type] ||
      (classOrder[classify(a)] || 0) - (classOrder[classify(b)] || 0) ||
      a.name.localeCompare(b.name));
  }

  /** Build (not post) the closing entry that zeroes income & expense through `date`. */
  function buildClosingEntry(book, date) {
    const re = systemAccount(book, 'equity', 'retained');
    const bals = balances(book, { to: date });
    const lines = [];
    let net = 0; // natural credit (net income)
    for (const a of orderAccounts(book.accounts)) {
      if (!isTemporary(a)) continue;
      const b = bals.get(a.id);
      const raw = b.debit - b.credit; // debit balance positive
      if (raw === 0) continue;
      // Zero it: credit a debit balance, debit a credit balance.
      lines.push({ accountId: a.id, debit: raw < 0 ? -raw : 0, credit: raw > 0 ? raw : 0 });
      net -= raw;
    }
    if (!lines.length) return null;
    if (net !== 0) lines.push({ accountId: re.id, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 });
    return {
      date,
      kind: 'closing',
      description: 'Closing entry — close income & expenses to retained earnings through ' + date,
      lines,
      netIncome: net,
    };
  }

  function closePeriod(book, date) {
    const later = book.entries.find((e) => e.kind === 'closing' && e.date >= date);
    if (later) throw new Error('Books are already closed through ' + closedThrough(book) + '.');
    const entry = buildClosingEntry(book, date);
    if (!entry) throw new Error('Nothing to close: no income or expense balances through ' + date + '.');
    delete entry.netIncome;
    return postEntry(book, entry, { allowClosed: true });
  }

  /** Remove the most recent closing entry, reopening that period. */
  function reopenLastPeriod(book) {
    const d = closedThrough(book);
    if (!d) return null;
    book.entries = book.entries.filter((e) => !(e.kind === 'closing' && e.date === d));
    return d;
  }

  /** Adjusting entry that revalues an asset (or liability) to a new market value. */
  function revaluationEntry(book, accountId, date, newValue, description) {
    const acct = findAccount(book, accountId);
    const mva = systemAccount(book, 'income', 'unrealized');
    const current = balanceOf(book, accountId, { to: date });
    const diff = newValue - current; // natural sign change
    if (diff === 0) return null;
    // Asset up => gain (Dr asset, Cr MVA). Liability up => loss (Dr MVA, Cr liability).
    const acctDebit = isDebitNormal(acct) ? diff > 0 : diff < 0;
    const amt = Math.abs(diff);
    return {
      date,
      kind: 'adjusting',
      description: description || ('Revalue ' + acct.name + ' to market value'),
      lines: [
        { accountId: acct.id, debit: acctDebit ? amt : 0, credit: acctDebit ? 0 : amt },
        { accountId: mva.id, debit: acctDebit ? 0 : amt, credit: acctDebit ? amt : 0 },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Financial statements
  // ---------------------------------------------------------------------------

  /** Profit & loss (income statement) for [from, to]. Closing entries excluded. */
  function incomeStatement(book, from, to) {
    const bals = balances(book, { from, to, excludeKinds: ['closing'] });
    const section = (pred) => orderAccounts(book.accounts)
      .filter(pred)
      .map((a) => ({ account: a, amount: bals.get(a.id).balance }))
      .filter((r) => r.amount !== 0);
    const income = section((a) => a.type === 'income' && a.subtype !== 'unrealized');
    const expenses = section((a) => a.type === 'expense');
    const other = section((a) => a.type === 'income' && a.subtype === 'unrealized');
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
    const totalOther = other.reduce((s, r) => s + r.amount, 0);
    const operatingIncome = totalIncome - totalExpenses;
    return {
      from, to, income, expenses, other,
      totalIncome, totalExpenses, totalOther, operatingIncome,
      netIncome: operatingIncome + totalOther,
      savingsRate: totalIncome ? (totalIncome - totalExpenses) / totalIncome : null,
    };
  }

  /** Balance sheet as of a date. Equity = net worth. */
  function balanceSheet(book, asOf) {
    const bals = balances(book, { to: asOf });
    const group = (pred) => orderAccounts(book.accounts)
      .filter(pred)
      .map((a) => ({ account: a, amount: bals.get(a.id).balance }))
      .filter((r) => r.amount !== 0 || !r.account.archived);
    const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);

    const cash = group((a) => classify(a) === 'cash');
    const receivables = group((a) => classify(a) === 'receivable');
    const investments = group((a) => classify(a) === 'investment');
    const otherAssets = group((a) => classify(a) === 'other_asset');
    const creditCards = group((a) => classify(a) === 'credit_card');
    const loans = group((a) => classify(a) === 'loan');
    const payables = group((a) => classify(a) === 'payable');
    const equityAccts = group((a) => a.type === 'equity').filter((r) => r.amount !== 0);

    // Income/expense not yet closed into retained earnings.
    let unclosed = 0;
    for (const a of book.accounts) {
      if (a.type === 'income') unclosed += bals.get(a.id).balance;
      if (a.type === 'expense') unclosed -= bals.get(a.id).balance;
    }

    const totalAssets = sum(cash) + sum(receivables) + sum(investments) + sum(otherAssets);
    const totalLiabilities = sum(creditCards) + sum(payables) + sum(loans);
    const totalEquity = sum(equityAccts) + unclosed;
    return {
      asOf,
      assets: { cash, receivables, investments, otherAssets },
      liabilities: { creditCards, payables, loans },
      equity: { accounts: equityAccts, unclosedNetIncome: unclosed },
      totals: {
        cash: sum(cash), receivables: sum(receivables), investments: sum(investments),
        otherAssets: sum(otherAssets), creditCards: sum(creditCards), payables: sum(payables), loans: sum(loans),
        assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity,
      },
      netWorth: totalAssets - totalLiabilities,
      balanced: totalAssets === totalLiabilities + totalEquity,
    };
  }

  /** Money lent to a person is investing; money borrowed from a person is financing. */
  function cashFlowSection(a) {
    const c = classify(a);
    if (a.personId && c === 'receivable') return 'investing';
    if (c === 'payable') return 'financing';
    return CF_SECTION[c] || 'operating';
  }

  const CF_SECTION = {
    income: 'operating', expense: 'operating', credit_card: 'operating', receivable: 'operating',
    investment: 'investing', other_asset: 'investing',
    loan: 'financing', equity: 'financing',
  };

  /**
   * Cash flow statement (direct method) for [from, to].
   * "Cash" = cash on hand + checking/debit + savings accounts.
   * For each entry, the net change in cash equals the sum of (credit − debit) over
   * its non-cash lines, so each non-cash line is attributed exactly to a section.
   */
  function cashFlowStatement(book, from, to) {
    const accts = accountMap(book);
    const isCash = (id) => classify(accts.get(id)) === 'cash';
    const beginning = cashTotal(book, from ? addDays(from, -1) : null);
    const lines = { operating: new Map(), investing: new Map(), financing: new Map() };
    let entriesCounted = 0;
    for (const e of selectEntries(book, { from, to })) {
      let delta = 0;
      for (const l of e.lines) if (isCash(l.accountId)) delta += l.debit - l.credit;
      if (delta === 0 && !e.lines.some((l) => isCash(l.accountId))) continue;
      entriesCounted++;
      for (const l of e.lines) {
        if (isCash(l.accountId)) continue;
        const a = accts.get(l.accountId);
        const sec = cashFlowSection(a);
        const m = lines[sec];
        m.set(a.id, (m.get(a.id) || 0) + (l.credit - l.debit));
      }
    }
    const toRows = (m) => orderAccounts(Array.from(m.keys()).map((id) => accts.get(id)))
      .map((a) => ({ account: a, amount: m.get(a.id) }))
      .filter((r) => r.amount !== 0);
    const operating = toRows(lines.operating);
    const investing = toRows(lines.investing);
    const financing = toRows(lines.financing);
    const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
    const net = sum(operating) + sum(investing) + sum(financing);
    const ending = cashTotal(book, to);
    return {
      from, to, operating, investing, financing,
      totals: { operating: sum(operating), investing: sum(investing), financing: sum(financing) },
      netChange: net, beginning, ending,
      reconciles: beginning + net === ending,
      entriesCounted,
    };
  }

  function cashTotal(book, asOf) {
    if (asOf === null) return 0;
    const bals = balances(book, { to: asOf });
    let t = 0;
    for (const a of book.accounts) if (classify(a) === 'cash') t += bals.get(a.id).balance;
    return t;
  }

  /** Month-end net worth series for the last `months` months ending at `asOf`'s month. */
  function netWorthSeries(book, asOf, months) {
    const end = new Date(asOf + 'T00:00:00Z');
    const series = [];
    for (let i = months - 1; i >= 0; i--) {
      const y = end.getUTCFullYear();
      const m = end.getUTCMonth() - i;
      let date = monthEnd(y + Math.floor(m / 12), ((m % 12) + 12) % 12);
      if (date > asOf) date = asOf;
      const bs = balanceSheet(book, date);
      series.push({ date, netWorth: bs.netWorth, assets: bs.totals.assets, liabilities: bs.totals.liabilities });
    }
    return series;
  }

  // ---------------------------------------------------------------------------
  // CSV import
  // ---------------------------------------------------------------------------

  /**
   * Parses CSV, semicolon-separated or tab-separated text (rows copied from Excel or Google Sheets
   * paste as tab-separated). The separator is detected from the first line unless given.
   */
  function parseCSV(text, sep) {
    text = String(text || '').replace(/^\uFEFF/, '');
    if (!sep) {
      const first = (text.match(/^[^\r\n]*/) || [''])[0].replace(/"[^"]*"/g, '');
      const count = (c) => first.split(c).length - 1;
      sep = count('\t') ? '\t' : count(';') > count(',') ? ';' : ',';
    }
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }

  /** Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY, YYYY/MM/DD, DD-Mon-YYYY. */
  function parseDate(s, dayFirst) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return dayFirst ? iso(y, +m[2], +m[1]) : iso(y, +m[1], +m[2]);
    }
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const d = new Date(t);
      return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    return null;
    function iso(y, mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }

  return {
    TYPES, SUBTYPES, ENTRY_KINDS, CASH_SUBTYPES, INVESTMENT_SUBTYPES,
    classify, isDebitNormal, isTemporary,
    uid, toCents, formatMoney, todayISO, addDays, monthEnd, sumLines,
    addPerson, renamePerson, personAccounts, peopleSummary, personStatement, cashFlowSection,
    emptyBook, defaultAccounts, findAccount, systemAccount, accountMap, orderAccounts,
    closedThrough, validateEntry, postEntry, deleteEntry, simpleEntry, asSimple, openingEntry,
    sortedEntries, selectEntries, balances, balanceOf, register,
    trialBalance, buildClosingEntry, closePeriod, reopenLastPeriod, revaluationEntry,
    incomeStatement, balanceSheet, cashFlowStatement, cashTotal, netWorthSeries,
    parseCSV, parseDate,
  };
});
