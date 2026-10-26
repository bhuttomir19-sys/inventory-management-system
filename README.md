# Tradeflow — Trading Business Management

A responsive React application with an Express API and persistent Microsoft SQL Server database, with MySQL/SQLite compatibility during migration. Includes a seeded demo company, dashboard, catalog, stock movements, customers, suppliers, sales, purchases, payments, cash/bank entries, expenses with image receipts, reports, printable invoices, configurable user permissions, company settings, audit logs, and business-data backup/restore.

## One-package Windows / IIS deployment

Run `npm run package:windows` on the development checkout to build a Windows x64 ZIP containing the compiled frontend, backend, production dependencies, portable Node.js and Windows service setup. The target server does not need Git/npm/a separate Node installation. IIS/ARR/URL Rewrite, an HTTPS certificate and SQL Server remain server prerequisites. The installer preserves existing records or initializes a clean administrator/company with no demo data. See [Windows package setup](deploy/windows/README-FIRST.md) for installation, updates, protected configuration, backup and recovery.

## Financial statements and accounting books

Finance & accounts now includes cash flow, accrual P&L, balance sheet, trial balance, account drill-down, general ledger, chart of accounts, balanced journals, and CSV/print exports. Opening balances are verified once, then business transactions post automatically and atomically. Read [the financial setup and accounting guide](docs/finance-and-accounts.md) before initializing the books on an existing company. Full SQL Server backups are required to preserve financial history; business-only restore is blocked once books are active.

## Column-wise SQL Server storage

SQL Server now uses relational columns for products, contacts, settings and transaction headers, plus `document_items` and `user_permissions` child tables. JSON is used for API responses/portable backups only. See [the schema, relationships, SQL queries and migration guide](docs/database-schema.md).

For your existing Windows installation, stop Node.js and take a **full database backup** first. Then, in PowerShell:

```powershell
cd "D:\New folder\inventory-management-system"
git pull origin main
npm.cmd ci
npm.cmd run db:normalize
npm.cmd run dev
```

Use the same `.env` database connection. Docker is not needed for this migration. It preserves existing IDs, users/password hashes, permissions, sessions, company/logo/currency, stock, balances and transactions; it does not add demo data. The migration requires database DDL privileges, so IT may need to run it. If unmapped or inconsistent data is found, the complete transaction rolls back. Normal startup refuses an old JSON schema until this command succeeds. Do not delete/recreate the database to upgrade.

## SQL Server in GitHub Codespaces

Requires an x86-64 Codespace with at least 4 GB RAM, Node.js 24, and Docker. SQL Server 2022 Developer is for development/testing only; production requires a suitable licensed edition or Express within its limits.

### Move existing MySQL data safely

Use your existing Codespace containing the correct company and users. Stop the app with **Ctrl+C**, and take a full MySQL backup including users and sessions (the app's business JSON backup excludes these). Keep the original MySQL volume and `.env`; never run `docker compose down -v`.

```sh
git pull origin main
npm ci
npm run db:setup
npm run db:up
npm run db:prepare
npm run db:mysql:up
npm run db:migrate
```

`db:setup` adds SQL Server credentials to ignored `.env`, without printing passwords or changing existing values. It preserves `DB_CLIENT=mysql` and all MySQL credentials. `db:up` now starts **only SQL Server**, using `compose.mssql.yaml`; the original MySQL Compose file and volume remain unchanged. If Compose reports the other service as an orphan, do not use `--remove-orphans` while both databases are needed. `db:prepare` provisions the local application login/database and creates the schema. It does not seed or replace records. `db:mysql:up` starts the old MySQL service for migration.

`db:migrate` reads a consistent, read-only InnoDB snapshot, copies all nine tables in one SQL Server transaction, and verifies every copied record before committing. It preserves company settings/logo, users/password hashes, permissions, sessions, product IDs, stock, invoice IDs, balances, documents, movements, and audit history. It refuses any nonempty destination and does not modify the MySQL source. Keep writes stopped throughout the migration and cutover. Very large/out-of-range IDs or values cause a rollback instead of silent truncation.

After migration succeeds, edit `.env` to set **`DB_CLIENT=mssql`**, then:

```sh
npm run dev
```

Check `/api/health` reports `"database":"mssql"`, sign in with your existing password, and check company, users, invoices and stock. Retain your MySQL database and full backup until the cutover is verified. Reverting to MySQL after new SQL Server transactions requires reconciling those transactions; it is not a two-way sync.

### Fresh development workspace

```sh
npm ci
npm run db:setup
npm run db:up
npm run db:prepare
```

Only for an intentional new demonstration workspace, set `MSSQL_ALLOW_INITIALIZE=true` in `.env`, then `npm run dev`. Without this opt-in, an empty SQL Server database refuses app startup rather than silently creating demo records. Remove the flag after initialization. Default demo login: `admin@tradeflow.local` / `Tradeflow2026!`; change it before sharing the app. `ADMIN_PASSWORD` overrides the initial password only, never an existing account.

On subsequent starts, run `npm run db:up` followed by `npm run dev`. SQL Server data lives in the persistent `mssql-data` Docker volume; deleting a Codespace or its volume can delete that data. A different Codespace does not share the database. Take regular full database backups outside the Codespace.

### View tables

`npm run db:shell` opens the local SQL Server client. Enter `SELECT name FROM sys.tables;` followed by `GO`. For a table: `SELECT id, sku, name, stock FROM products;` followed by `GO`. SQL Server Management Studio (SSMS), VS Code's MSSQL extension, and Power BI can also connect to your office SQL Server. Do not expose the development database port publicly.

### Your office SQL Server

Use SQL Server 2019 or newer, database compatibility level 150 or newer, and a fixed TCP port (1433 by default). A DBA should create the database and a dedicated SQL-authenticated app login, apply `mssql-schema.sql` using SSMS, and grant CRUD access to the app tables. Grant CRUD on all application tables including document_items and user_permissions. Explicit ID restoration also requires table ALTER permissions for products, customers, vendors, documents, and movements. See docs/database-schema.md for migration permissions. Avoid connecting the app as `sa`. Grant only SELECT on approved reporting tables/views to a separate Power BI account; exclude password hashes and session tokens.

Configure `.env` using `.env.example`: `DB_CLIENT=mssql`, `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_DATABASE`, `MSSQL_USER`, and `MSSQL_PASSWORD`. Set `MSSQL_ENCRYPT=true` and `MSSQL_TRUST_SERVER_CERTIFICATE=false` with a trusted server certificate whose identity matches the connection address. The local setup script opts into the development container's self-signed certificate; do not copy that exception into production. Restrict database access to the app server and approved Power BI/gateway machines. The app's browser origin is separate: set `APP_ORIGIN` to its exact HTTPS address.

Deploy the Node application as a persistent service, run `npm run build` then `npm start`, set `COOKIE_SECURE=true` behind HTTPS, and use a reverse proxy. Back up SQL Server using native full backups with regular restore tests, including users/login recovery instructions. Keep `.env` securely backed up and out of Git. The included Docker service uses Developer edition, **not a production license**.

### Validation and compatibility

`npm test` runs business, API, session, reports, branding, and SQL dialect checks. `npm run test:mssql` creates an isolated temporary SQL Server database, exercises real transactions, concurrent stock protection, HTTP flows, restore/rollback, imported IDs, Unicode, and restart persistence, then removes only that test database. It requires a test account allowed to create/drop databases; local development uses the local `sa` credential solely for this purpose. Remote tests use `MSSQL_TEST_USER` / `MSSQL_TEST_PASSWORD`.

MySQL and SQLite remain available solely for compatibility and migration: use `DB_CLIENT=mysql` with existing MySQL settings, or explicitly `DB_CLIENT=sqlite`. SQL Server is the default for an unconfigured checkout, and missing credentials cause a clear error rather than a fallback to an unexpected database. The old SQLite-to-MySQL migrator is `npm run db:migrate:sqlite-mysql`. `npm run test:mysql` retains the old MySQL checks.

## Business flows

- Purchases increase stock, recalculate weighted-average unit cost, and increase supplier payables by the unpaid amount.
- Sales check available stock, reduce it, snapshot item cost, and increase customer receivables by the unpaid amount.
- Invoice discount is an absolute amount; tax is a percentage of the discounted subtotal; other charges are added after tax.
- Payments reduce customer/vendor balances and settle unpaid invoices oldest-first. Opening balances are included in the party's balance.
- Transactions run in the configured database: any validation failure rolls back the entire invoice, its stock movements, and balances.
- Stock adjustments cover damage, returns, and opening-stock corrections. Stock cannot become negative.
- Cash/bank entries record additional money in/out. Expenses also appear in financial history and cash-flow reports.
- Financial documents are immutable through the API; linked master records cannot be deleted. Use corrective stock entries when needed. Invoice cancellation and credit-note workflows are not implemented.
- Profit uses sales excluding tax, less captured cost of sold products and operating expenses. It is a management summary, not a statutory double-entry accounting system.

## Administration and reports

Users receive action-level permissions for each module: view, add, edit, delete, print, export. Role labels are customizable through the six supplied role types; access is controlled by the permission matrix, not the label. All API mutations verify permissions. Passwords use salted scrypt hashes; sessions use random HttpOnly, SameSite cookies with a rolling one-day expiry, or seven days when “Keep me signed in” is selected. Sessions persist in the configured database across server restarts. Active sessions renew, expired or revoked sessions return users to sign-in, and sign-out revokes the session and clears the browser cookie. Sign-out buttons are available in the header and sidebar, including on mobile. Browser tabs synchronize sign-out without storing authentication tokens in local storage. The login screen does not display credentials or prefill an email address. Codespaces cookies use the Secure attribute. Login attempts are rate-limited. Changing a user's permissions revokes their sessions.

Reports include sales, purchases, stock, movements, customer/vendor ledgers, receivables/payables, expenses, profit/loss, cash flow, and product/customer/vendor summaries. Filter dates and search, paginate and sort, export CSV (Excel compatible), or print/save PDF through the browser. Invoice numbering uses unique transaction IDs. The company currency is a display currency; no currency conversion is performed.

Backup downloads contain business data, including receipts, but exclude accounts/passwords/sessions. Restore requires explicit confirmation and replaces business data within a database transaction. Keep secure database backups for complete disaster recovery, including users. For SQL Server, use native database backups; for legacy MySQL, use mysqldump; the portable business backup excludes users and sessions. The audit log stays on the current database across portable business-data restores.

## Project structure

- `db.js`: shared asynchronous business transactions and seeding.
- `storage.js`: database selection and MySQL/SQLite compatibility.
- `mssql-storage.js`: SQL Server pooling, serializable transactions, bound parameters, and identity handling.
- `mssql-schema.sql`: typed relational SQL Server schema, foreign keys and indexes.
- `relational.js`: column/child-row mapping for the existing HTTP API.
- `scripts/normalize-mssql.js`: atomic, verified legacy SQL Server schema upgrade.
- `scripts/migrate-mysql-mssql.js`: verified, atomic MySQL-to-SQL Server migration.
- `mysql-schema.sql`: InnoDB schema.
- `scripts/migrate-sqlite.js`: checked, atomic SQLite-to-MySQL import.
- `sqlite.js`: original SQLite schema and password utilities.
- `server.js`: API, authentication, permissions, audit, development/production serving.
- `src/main.jsx`: responsive application and forms.
- `src/style.css`: visual design, breakpoints, print layout.
- `tests/business.test.js`: business-rule and rollback tests.

## Deployment scope

This is a working single-company application suitable for development and evaluation. Production use needs a deployment review, HTTPS, private credentials, backup operations, and requirements specific to your tax jurisdiction. SQL Server uses pooled connections, serializable transactions and update locks to protect stock and balances during concurrent requests. SQLite compatibility mode supports a single application instance. Multi-instance production deployments also need shared login rate limiting; the current limiter is process-local. The API currently reads collections in memory, while the frontend paginates. For large datasets, add server-side queries and pagination. PDF uses browser printing, CSV opens in Excel; native `.xlsx` files are not generated. Receipts support images up to 1 MB. Multi-company accounting, bank reconciliation, credit notes, sales returns with financial reversal, and tax filings need further implementation.

## GitHub Codespaces

Open the repository in a Codespace, use Node.js 24, and follow the SQL Server setup/migration steps above before running `npm run dev`. Open the forwarded **3000** port from the Ports panel and keep its visibility **Private**. The server derives this Codespace's exact HTTPS origin from the standard `CODESPACES`, `CODESPACE_NAME`, and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` variables. Login and other writes accept that origin and the exact `https://localhost:<PORT>` origin that Codespaces' HTTPS proxy may send. The localhost HTTPS alias is enabled only when running in Codespaces, and unrelated sites or other ports remain blocked. Vite uses the same port for live reload and accepts this Codespace's exact host.

After pulling a server update, stop the existing process with Ctrl+C and restart `npm run dev`. Refresh the forwarded browser URL. Do not use your computer's localhost URL for a Codespace-hosted server.

For a different reverse proxy, set `APP_ORIGIN` to the exact public origin, for example `https://trade.example`, before startup. Do not include a path. The application does not trust arbitrary client-supplied forwarding headers for origin checks.

### Troubleshooting a forwarded URL

If login reports an invalid origin, copy only the origin from your browser (scheme and hostname, no trailing path). Stop the old server and run:

```sh
APP_ORIGIN="https://YOUR-CODESPACE-3000.app.github.dev" npm run dev
```

Startup prints the accepted public origins. Opening `/api/health` on the forwarded website shows `version: codespaces-2` and the configured origins, without credentials. If it instead asks for sign-in or shows a different version, the browser is reaching an older process or checkout. A port-in-use error now exits instead of displaying a misleading startup message. Stop the old process before restarting; do not change the port unless you also forward the new port and update the origin.

## Company branding

Go to **Settings & admin → Company settings**. Edit **Company name** (used for business details and invoice company information) and **Application name** (shown in navigation, sign-in, browser title, and invoice branding). Upload a PNG, JPEG, or WebP logo up to 512 KB, review the preview, then click **Save settings**. Use **Remove logo** and save to return to the initial-letter mark. Changes persist in the configured database and are included in business-data backups. Only users with admin edit permission can update these settings. The unauthenticated branding endpoint exposes only the name and logo required by the login screen; contact and financial settings remain private.
