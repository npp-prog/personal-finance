'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/ledger.js');

function setup() {
  const book = L.emptyBook();
  const add = (id, name, type, subtype) => { book.accounts.push({ id, name, type, subtype }); return id; };
  add('chk', 'Checking', 'asset', 'checking');
  add('sav', 'Savings', 'asset', 'savings');
  add('cc', 'Visa', 'liability', 'credit_card');
  add('brk', 'Brokerage', 'asset', 'investment');
  add('car', 'Car', 'asset', 'vehicle');
  add('loan', 'Car Loan', 'liability', 'loan');
  const post = (e) => L.postEntry(book, e);
  const s = (o) => post(L.simpleEntry(book, o));

  post(L.openingEntry(book, L.findAccount(book, 'chk'), '2025-12-31', 500000));
  post(L.openingEntry(book, L.findAccount(book, 'cc'), '2025-12-31', 80000));
  post(L.openingEntry(book, L.findAccount(book, 'car'), '2025-12-31', 2000000));
  post(L.openingEntry(book, L.findAccount(book, 'loan'), '2025-12-31', 1200000));

  s({ date: '2026-01-05', description: 'Paycheck', accountId: 'chk', counterId: 'inc_salary', direction: 'in', amount: 400000 });
  s({ date: '2026-01-06', description: 'Groceries', accountId: 'cc', counterId: 'exp_groceries', direction: 'out', amount: 15000 });
  s({ date: '2026-01-07', description: 'Rent', accountId: 'chk', counterId: 'exp_housing', direction: 'out', amount: 150000 });
  s({ date: '2026-01-10', description: 'Pay Visa', accountId: 'chk', counterId: 'cc', direction: 'out', amount: 80000 });
  s({ date: '2026-01-11', description: 'To savings', accountId: 'chk', counterId: 'sav', direction: 'out', amount: 50000 });
  s({ date: '2026-01-12', description: 'Invest', accountId: 'chk', counterId: 'brk', direction: 'out', amount: 100000 });
  s({ date: '2026-01-15', description: 'Loan payment', accountId: 'chk', counterId: 'loan', direction: 'out', amount: 30000 });
  post(L.revaluationEntry(book, 'brk', '2026-01-31', 110000));
  return book;
}

test('toCents parses common formats', () => {
  assert.equal(L.toCents('1,234.56'), 123456);
  assert.equal(L.toCents('$12'), 1200);
  assert.equal(L.toCents('(5.10)'), -510);
  assert.equal(L.toCents('-0.5'), -50);
  assert.equal(L.toCents('abc'), NaN);
});

test('unbalanced entries are rejected', () => {
  const book = setup();
  assert.throws(() => L.postEntry(book, { date: '2026-02-01', lines: [
    { accountId: 'chk', debit: 100, credit: 0 }, { accountId: 'exp_misc', debit: 0, credit: 90 }] }));
});

test('account balances follow natural signs', () => {
  const book = setup();
  const b = L.balances(book, { to: '2026-01-31' });
  assert.equal(b.get('chk').balance, 500000 + 400000 - 150000 - 80000 - 50000 - 100000 - 30000);
  assert.equal(b.get('cc').balance, 15000); // owed
  assert.equal(b.get('brk').balance, 110000);
  assert.equal(b.get('loan').balance, 1170000);
});

test('trial balances balance in every mode', () => {
  const book = setup();
  for (const mode of ['unadjusted', 'adjusted', 'post-closing']) {
    assert.ok(L.trialBalance(book, '2026-01-31', mode).balanced, mode);
  }
  const un = L.trialBalance(book, '2026-01-31', 'unadjusted');
  assert.equal(un.rows.find((r) => r.account.id === 'brk').debit, 100000);
});

test('income statement and balance sheet tie out', () => {
  const book = setup();
  const is = L.incomeStatement(book, '2026-01-01', '2026-01-31');
  assert.equal(is.totalIncome, 400000);
  assert.equal(is.totalExpenses, 165000);
  assert.equal(is.totalOther, 10000);
  assert.equal(is.netIncome, 245000);
  const bs = L.balanceSheet(book, '2026-01-31');
  assert.ok(bs.balanced);
  assert.equal(bs.netWorth, bs.totals.equity);
  assert.equal(bs.equity.unclosedNetIncome, 245000);
  // Opening net worth 5000 - 800 + 20000 - 12000 = 12200, plus net income 2450.
  assert.equal(bs.netWorth, 1220000 + 245000);
});

test('cash flow statement reconciles to cash balances', () => {
  const book = setup();
  const cf = L.cashFlowStatement(book, '2026-01-01', '2026-01-31');
  assert.ok(cf.reconciles);
  assert.equal(cf.beginning, 500000);
  assert.equal(cf.totals.operating, 400000 - 150000 - 80000);
  assert.equal(cf.totals.investing, -100000);
  assert.equal(cf.totals.financing, -30000);
  assert.equal(cf.ending, cf.beginning + cf.netChange);
  // Savings transfer is cash-to-cash and does not appear anywhere.
  assert.ok(![...cf.operating, ...cf.investing, ...cf.financing].some((r) => r.account.id === 'sav'));
});

test('closing moves net income to retained earnings and locks the period', () => {
  const book = setup();
  L.closePeriod(book, '2026-01-31');
  const post = L.trialBalance(book, '2026-01-31', 'post-closing');
  assert.ok(post.balanced);
  assert.ok(!post.rows.some((r) => L.isTemporary(r.account)));
  assert.equal(L.balanceOf(book, 'eq_retained', { to: '2026-01-31' }), 245000);
  // P&L still reports the period after closing.
  assert.equal(L.incomeStatement(book, '2026-01-01', '2026-01-31').netIncome, 245000);
  // Adjusted TB on the closing date still shows the income accounts.
  assert.ok(L.trialBalance(book, '2026-01-31', 'adjusted').rows.some((r) => r.account.id === 'inc_salary'));
  const bs = L.balanceSheet(book, '2026-01-31');
  assert.ok(bs.balanced);
  assert.equal(bs.equity.unclosedNetIncome, 0);
  assert.throws(() => L.postEntry(book, L.simpleEntry(book, { date: '2026-01-20', accountId: 'chk', counterId: 'exp_misc', direction: 'out', amount: 100 })));
  L.reopenLastPeriod(book);
  assert.equal(L.closedThrough(book), null);
});

test('CSV and date parsing', () => {
  const rows = L.parseCSV('Date,Desc,Amount\n01/02/2026,"Coffee, large",-4.50\r\n2026-01-03,Pay,100\n');
  assert.deepEqual(rows[1], ['01/02/2026', 'Coffee, large', '-4.50']);
  assert.equal(L.parseDate('01/02/2026'), '2026-01-02');
  assert.equal(L.parseDate('01/02/26', true), '2026-02-01');
  assert.equal(L.parseDate('2026-01-03'), '2026-01-03');
});

test('receivables and payables per person', () => {
  const book = setup();
  const juan = L.addPerson(book, 'Juan');
  const mom = L.addPerson(book, 'Mom');
  const pj = L.personAccounts(book, juan.id), pm = L.personAccounts(book, mom.id);
  const s = (o) => L.postEntry(book, L.simpleEntry(book, o));
  s({ date: '2026-02-01', description: 'Lent to Juan', accountId: 'chk', counterId: pj.receivable.id, direction: 'out', amount: 500000 });
  s({ date: '2026-02-10', description: 'Juan repaid', accountId: 'chk', counterId: pj.receivable.id, direction: 'in', amount: 200000 });
  s({ date: '2026-02-03', description: 'Borrowed from Mom', accountId: 'chk', counterId: pm.payable.id, direction: 'in', amount: 1000000 });
  // Mom paid for my groceries: Dr Groceries, Cr Payable – Mom
  L.postEntry(book, { date: '2026-02-05', kind: 'expense', description: 'Mom paid groceries', lines: [
    { accountId: 'exp_groceries', debit: 30000, credit: 0 }, { accountId: pm.payable.id, debit: 0, credit: 30000 }] });

  const sum = L.peopleSummary(book, '2026-02-28');
  const j = sum.find((x) => x.person.name === 'Juan'), m = sum.find((x) => x.person.name === 'Mom');
  assert.equal(j.owedToMe, 300000);
  assert.equal(m.iOwe, 1030000);
  assert.equal(m.net, -1030000);

  const st = L.personStatement(book, juan.id);
  assert.deepEqual(st.map((r) => r.net), [500000, 300000]);

  const bs = L.balanceSheet(book, '2026-02-28');
  assert.ok(bs.balanced);
  assert.equal(bs.totals.receivables, 300000);
  assert.equal(bs.totals.payables, 1030000);

  const cf = L.cashFlowStatement(book, '2026-02-01', '2026-02-28');
  assert.ok(cf.reconciles);
  assert.equal(cf.investing.find((r) => r.account.id === pj.receivable.id).amount, -300000);
  assert.equal(cf.financing.find((r) => r.account.id === pm.payable.id).amount, 1000000);

  L.renamePerson(book, juan.id, 'Juan dela Cruz');
  assert.equal(L.personAccounts(book, juan.id).receivable.name, 'Receivable – Juan dela Cruz');
  assert.throws(() => L.addPerson(book, 'mom'));
});
