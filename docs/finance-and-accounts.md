# Finance and accounts

The Finance workspace provides Overview, Cash flow, Profit & loss, Balance sheet, Trial balance, General ledger and Chart of accounts. Statements use balanced, persisted ledger postings rather than mutable invoice payment totals. The same financial statements are available from Reports to users with Finance view access.

## Enable the books locally

1. Back up SQL Server and stop the application.
2. Pull the update, run `npm.cmd ci`, and run `npm.cmd run db:normalize` against the existing `.env` connection. This idempotent schema command also creates the four new finance tables. Database DDL privileges may require IT assistance. Existing business records, company settings and users are preserved.
3. Start `npm.cmd run dev` and open Finance & accounts.
4. Pause transaction entry while you verify the opening snapshot. Choose a cutover date and enter verified cash, bank, fixed asset cost, accumulated depreciation, loans, tax balances and owner capital. Current inventory, receivables and payables are brought forward from business records.
5. Confirm the balances and initialize the books once. The remaining net opening balance is explicitly recorded in Opening balance equity. An accountant can reclassify this to capital/prior earnings using a journal.

**This is a cutover, not a reconstruction of earlier financial history.** Old invoices have cumulative paid amounts but not immutable, dated payment allocations. Reconstructing their original receipts would be ambiguous. Opening balances represent those earlier records; historical P&L and cash flow before the chosen books start date are not asserted. Pick the cutover date on which you verify the current operational balances, not a historical period whose balances differ. The cutover must be on or after the latest existing transaction and no later than today. Resolve existing future-dated transactions before opening books. New transactions dated before the books start are rejected and rolled back.

Currency follows Company settings. This is a single-currency ledger; changing the display currency does not convert balances. Statement currency precision is two decimal places. Review opening amounts and accounting classifications with the person responsible for your books.

## Automatic postings

All business updates and their financial journals commit or roll back together. Invoice/payment postings are immutable: settling an invoice later does not change its original cash receipt or expense posting.

| Business event | Ledger treatment |
|---|---|
| Sale | Debit cash/bank for the initial payment and receivables for the unpaid portion; credit revenue and output tax; debit COGS and credit inventory for the captured cost |
| Purchase | Debit inventory for its actual weighted-average valuation change, input tax, freight/charges; credit cash/bank and payables. Purchase discounts credit the cost-of-sales discount account. Average-cost rounding is posted separately |
| Customer receipt | Debit cash/bank; credit receivables |
| Vendor payment | Debit payables; credit cash/bank |
| Expense | Debit operating expenses; credit cash/bank |
| Cash/bank entry | Debit or credit the selected cash/bank account against income, expense, capital, drawings, loan principal or fixed assets as selected |
| Stock damage/adjustment | Post the stock's value to inventory and stock gain/loss accounts |
| New product/party opening balance | Bring inventory, receivables or payables into opening equity |
| Product cost edited | Post the corresponding stock valuation change, preventing catalogue edits from leaving ledger inventory inconsistent |

Payment methods Cash use Cash on hand; Bank transfer and Card use Bank accounts (the application assumes card amounts settle to the bank). Invoice tax follows existing business calculations; purchase charges are expensed as cost of sales rather than capitalized. These are explicit accounting policies, not jurisdiction-specific tax advice. Financing and investing entries are not sales revenue or operating expenses.

## Statements and journals

- **Profit & loss:** accrual revenue excluding output tax, cost of sales, gross profit, other income, operating expenses, net profit/loss for the selected period. Payments do not recognize income/expense a second time.
- **Balance sheet:** assets, liabilities, equity and accumulated retained earnings through the end date. The from-date does not remove brought-forward balances. A balance check verifies assets equal liabilities plus equity.
- **Cash flow:** operating, investing and financing effects of journals with cash/bank lines; excludes opening balances, noncash journals and internal transfers. Opening cash plus net movement reconciles to closing cash. Account rows explain the net cash effect of posted journals; they are not an inventory of all accrual account movements.
- **Trial balance:** opening debit balances, period debits/credits and closing debit/credit balances across all accounts.
- **General ledger:** date/reference/account search, account drill-down, running debit balance per selected account, pagination and opening balance.
- **Chart of accounts:** view the default chart and add accounts for additional expenses, income, assets, liabilities or equity. Choose a cash-flow category for new accounts.

Use a balanced journal for capital contributions, drawings, loans, equipment purchases, depreciation, tax settlements, transfers and correcting entries. The server rejects unbalanced or invalid entries. Receivables, payables and inventory are protected control accounts; use their business modules rather than manual entries to keep master balances and stock aligned. Account codes 1000/1010 are the cash and bank control accounts; additional accounts are non-cash accounts.

Posted journals cannot be edited/deleted through the app. Correct manual entries with another balanced entry. Financial document cancellations, tax filings, payroll, automatic depreciation schedules, bank-feed reconciliation and multi-currency conversion are separate workflows, not implemented by these statements. Overdrawn cash/bank balances are flagged but are not blocked, since overdrafts can be legitimate.

Search filters statement detail rows while totals continue to represent the full financial statement. CSV export preserves numeric values and protects text against spreadsheet formulas. Print/PDF includes all matching ledger/account rows rather than only the current screen page. View, add, edit (initialize books), print and export follow Finance permissions. Report financial tabs also respect Reports permissions.

## Database and backups

All new records are column-wise SQL Server tables:

- `finance_accounts`: code, name, type, groupName, cashFlow, isCash.
- `finance_books`: id, startDate, createdAt.
- `finance_journals`: id, date, reference, description, sourceType, sourceId.
- `finance_lines`: journalId, lineNumber, accountCode, debit, credit; foreign keys enforce journal/account relationships.

`schema_migrations` version 3 records this addition. Existing column-wise business tables remain in place. Journal source links and references identify the business event; audit logs record initialization, journals and account creation. A unique source constraint prevents duplicate automatic postings for a given source record.

Take **full native SQL Server backups** to preserve both operational records and books. The portable business JSON backup excludes financial journals and is clearly labelled accordingly. Once books are active, portable business-only restore is blocked because it would disconnect operational records from their ledger. Restore a complete database with IT instead. The legacy MySQL-to-MSSQL importer refuses sources with active books rather than silently dropping financial history.

```sql
SELECT code, name, type, groupName FROM dbo.finance_accounts;
SELECT * FROM dbo.finance_books;
SELECT j.date, j.reference, j.description, l.accountCode, a.name, l.debit, l.credit
FROM dbo.finance_journals j
JOIN dbo.finance_lines l ON l.journalId = j.id
JOIN dbo.finance_accounts a ON a.code = l.accountCode
ORDER BY j.date, j.id, l.lineNumber;

SELECT SUM(debit) AS TotalDebits, SUM(credit) AS TotalCredits
FROM dbo.finance_lines;
```

Grant the runtime account CRUD access to these tables (including initialization/chart seeding). A read-only Power BI account can SELECT approved financial reporting tables/views; do not grant it password/session access. The current reporting implementation reads the ledger in memory; very large ledgers need server-side aggregation/pagination.
