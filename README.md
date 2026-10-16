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

## Encoding your bank and card statements (Bank register)

Open **Bank register (encode)**, pick a bank account or card from the tiles at the top, and type each statement line into the entry row, much like the QuickBooks Online bank register:

| Date | Ref no. | Payee | Account | Memo | Payment | Deposit | Balance |
|------|---------|-------|---------|------|---------|---------|---------|

* **Account** can be any account. Pick the side of the entry that isn't the bank:
  * an **expense** (Groceries, Rent);
  * an **income** (Salary);
  * another **bank** (a transfer);
  * a **credit card** (paying the card);
  * a **loan** (a loan payment);
  * an **investment or other asset** (buying shares, putting a down payment on a car);
  * **equity**.
* If you type an account name that doesn't exist yet, the app offers to create it as a new expense or income category.
* For bank and cash accounts the amount columns are **Payment** (money out) and **Deposit** (money in). On credit cards they are **Charge** and **Payment**. On loans they are **Increase** and **Payment**.
* **Enter** saves the line and starts the next one. The date is kept so you can encode a whole statement quickly.
* Typing a payee you've used before fills in its account.
* **Click any line** to edit it in place. You can also **Delete** it or press **Esc** to cancel.
* **Split** sends one statement line to several accounts, e.g. a pharmacy receipt that is part Health and part Personal care.
* **Statement check**: enter the statement date and ending balance. The register tells you whether it matches, or shows the difference you still need to find.

Each line becomes a balanced journal entry. For example, a 1,500 grocery payment from BDO posts *Dr Groceries 1,500 / Cr BDO 1,500*, and paying the Visa from BDO posts *Dr Visa / Cr BDO*.

You can also use **Import CSV** in the register when your bank offers a CSV download. The **All transactions** page lists entries across every account.

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
