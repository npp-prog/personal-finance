# Pundo — Personal Finance

A personal finance app built on real double-entry accounting. You encode each bank and card transaction in a register, much like QuickBooks Online, and track who owes you and whom you owe. The app produces a **Profit & Loss statement**, a **Balance Sheet (net worth)**, a **Cash Flow Statement** and a **General Ledger**.

There's nothing to install and no build step, and your data never leaves your browser.

## Android app (Google Play)

The same app is packaged for Android with Capacitor.
* GitHub Actions builds a test APK and a signed Play Store bundle.
* **[PLAYSTORE.md](PLAYSTORE.md)** has the step-by-step publishing guide.
* `store/` holds the listing texts, icon, feature graphic and screenshots.

## Run it

Open `index.html` in a browser. You can also serve the folder:

```bash
npm start            # python3 -m http.server 8080 → http://localhost:8080
```

To explore with demo data, go to **Settings & backup → Load sample data**. This replaces your current data, so export a backup first.

### On a tablet

The app is built for touch on iPads and Android tablets:

* **Upright:**
  * The menu is a slide-out drawer.
  * A **bottom tab bar** holds Home, Register, People, Reports and Menu, with a **+ Encode** button at the top.
  * The Bank register turns into a stacked entry form with two-line transaction cards, so there's no sideways scrolling.
* **Sideways:** the full register table fits next to a slimmer sidebar.
* **Touch:** buttons and fields are at least 44px tall, and input text is 16px, so iPad Safari doesn't zoom in when you tap a field.
* **Home screen:** use **Share → Add to Home Screen** for a full-screen, app-like experience.

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

## People — receivables and payables per person

The **People** page tracks money that specific people owe you and money you owe them.

* Adding a person creates two accounts:
  * **Receivable – name**: an asset, money they owe you.
  * **Payable – name**: a liability, money you owe them.
* **Record lend / borrow / repayment** covers four cases:
  * **I lent money / paid for them**: *Dr Receivable – name / Cr bank or card*.
  * **They paid me back**: *Dr bank / Cr Receivable – name*.
  * **I borrowed / they paid for me**: *Dr bank or expense / Cr Payable – name*. If a friend paid for your dinner, the expense is still yours.
  * **I paid them back**: *Dr Payable – name / Cr bank*.
* You can also pick those accounts directly in the Bank register.
* The People page shows, for each person, what they owe you, what you owe them, the net, and the last activity.
* Each person has a printable **statement of account** with a running balance.
* On the **balance sheet** they appear under *Receivables (owed to me)* and *Payables (owed to people)*.
* On the **cash flow statement**, money lent and collected is investing, and money borrowed and repaid is financing.

## Reports for presentation

* **Financial statements**, for any period:
  * **Income statement (P&L)**: income, expenses, operating surplus, market value changes, net income and savings rate.
  * **Balance sheet (net worth)**: cash, receivables, investments, other assets, credit cards, payables, loans and net worth.
  * **Cash flow statement** (direct method): operating, investing and financing. It reconciles to the change in cash.
* **General ledger**: every account with its transactions, the other account in each entry, and a running balance. You can filter it to balance sheet accounts, income & expense accounts, people, or a single account.
* Every report has **Print / PDF** and **Export CSV**. Printing hides the menus and buttons.
* Set **Settings → Name on reports** to put your name on the printed statements.

## Period end

* **Revalue & adjust**:
  * Mark investments, property and vehicles to market value.
  * Post depreciation and accruals.
* **Close the period**:
  * Moves net income into Retained Earnings and locks the period.
  * **Reopen** undoes the latest close.

## Data & backup

* Everything is stored on your device: the browser's `localStorage`, or the app's own storage on Android.
* **Automatic backup (Android app):**
  * Pundo saves a complete backup copy after every change.
  * Android's backup service copies it to the user's Google account about once a day, while the phone is charging and on Wi-Fi.
  * When Pundo is installed on a new phone, it offers to restore that backup.
  * Nothing to set up, as long as **Phone Settings → Google → Backup** is on.
  * The rules are in `android/app/src/main/res/xml/data_extraction_rules.xml`.
* **Settings & backup → Back up now** saves one `.json` file with all your accounts, cards, people and transactions. On Android it opens the share sheet, so you can save it to Google Drive or Files, or email it.
* The dashboard reminds you to back up if you never have, or if you've made changes and your last backup is more than a week old.
* **Restore from backup** shows what's inside the file (accounts, entries, the date it was made) before it replaces anything. Use it to move to a new phone, tablet or computer.
* **Export transactions (CSV)** saves every journal line as a spreadsheet.

## Account colours

Give each bank account or card a colour: pick one of ten presets or any custom colour. Edit the account from **Accounts & cards** or with the **Edit** link in the Bank register. The colour shows as a stripe on the register tiles and a dot in the account lists.

## Development

```
index.html        app shell
css/styles.css    styles (light and dark)
js/ledger.js      accounting engine: entries, balances, people, closing, statements, CSV parsing
js/app.js         UI
tests/            engine unit tests (node:test)
```

```bash
npm test
```

The default currency is the Philippine peso (₱). You can change it in Settings.

Amounts are stored as integer cents. Debit-normal accounts are assets and expenses. Credit-normal accounts are liabilities, equity and income.
