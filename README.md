# Personal Finance Ledger

A personal finance app built on real double-entry accounting. You record each transaction on whichever card or account it happened on, and the app runs the complete accounting cycle to produce a **Profit & Loss statement**, a **Balance Sheet (net worth)** and a **Cash Flow Statement**.

There's nothing to install and no build step, and your data never leaves your browser.

## Run it

Open `index.html` in a browser. You can also serve the folder:

```bash
npm start            # python3 -m http.server 8080 → http://localhost:8080
```

To explore with demo data, go to **Settings & backup → Load sample data**.

## How accounts are classified

| You add…                                            | Recorded as     | Shows up in                                      |
|-----------------------------------------------------|-----------------|--------------------------------------------------|
| Bank account, debit card, savings, cash, e-wallet   | Cash (asset)    | Balance sheet → Cash; drives the cash flow statement |
| Credit card                                         | Liability       | Balance sheet → Credit cards                     |
| Brokerage, retirement, crypto                       | Investment      | Balance sheet → Investments                      |
| Real estate, vehicle, receivable, other             | Other asset     | Balance sheet → Other assets                     |
| Loan, mortgage                                      | Liability       | Balance sheet → Loans                            |
| Income / expense categories                         | Income / Expense| Profit & loss                                    |

Each new account can have an opening balance, which is posted against *Opening Balance Equity*. Your **net worth** is assets minus liabilities, and it always equals total equity.

## Recording transactions

* **Money out / spend**: e.g. groceries on your Visa. *Dr Groceries, Cr Visa*, so the card balance owed goes up.
* **Money in / refund**: e.g. a paycheck into checking. *Dr Checking, Cr Salary*.
* **Transfer / payment**: between any two balance-sheet accounts. This covers paying a credit card, moving money to savings, buying investments, a loan payment or an ATM withdrawal.
* **Split / journal entry**: any number of debit and credit lines, such as a paycheck with tax deductions or a split purchase.
* **Import CSV**: bank or card statement exports. You map the columns, choose the sign convention and skip duplicates. Categories are matched by name or by past descriptions.

Each account register shows a running balance with plus and minus columns. For credit cards and loans the balance is the amount owed.

## The accounting cycle

1. **General journal**: every transaction as a balanced debit/credit entry. Unbalanced entries are rejected.
2. **General ledger**: entries posted to each account, with beginning and running balances.
3. **Trial balance**: unadjusted, adjusted and post-closing views, plus a full worksheet (Unadjusted → Adjustments → Adjusted → Post-closing).
4. **Adjustments**:
   * Revalue investments and assets to market value. The gain or loss goes to *Market Value Gains (Losses)*.
   * Templates for depreciation, accrued interest, accrued income and prepaid expenses.
5. **Financial statements** for any period, with Print/PDF and CSV export:
   * **Income statement (P&L)**: income, expenses, operating surplus, other income (market value changes), net income and savings rate.
   * **Balance sheet**: cash, investments, other assets, credit cards and loans, with net worth broken down into opening equity, retained earnings and unclosed net income.
   * **Cash flow statement** (direct method):
     * **Operating**: income received, expenses paid in cash, credit card payments.
     * **Investing**: buying and selling investments and assets.
     * **Financing**: loan proceeds and repayments, opening balances.
     * It reconciles to the change in cash.
6. **Close the period**: a closing entry zeroes income and expenses into *Retained Earnings*, and the period is then locked. **Reopen** removes the latest closing entry.

## Data & backup

* Data is stored in your browser's `localStorage`.
* Use **Settings → Export backup** to save a JSON file, and **Restore backup** to load it on another device or browser.
* You can also export every journal line as CSV.

## Development

```
index.html        app shell
css/styles.css    styles (light and dark)
js/ledger.js      accounting engine: entries, balances, trial balance, closing, statements, CSV parsing
js/app.js         UI
tests/            engine unit tests (node:test)
```

```bash
npm test
```

Amounts are stored as integer cents. Debit-normal accounts are assets and expenses. Credit-normal accounts are liabilities, equity and income.
