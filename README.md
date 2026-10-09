# Tradeflow — Trading Business Management

A responsive React application with an Express API and persistent MySQL database, with SQLite compatibility during migration. Includes a seeded demo company, dashboard, catalog, stock movements, customers, suppliers, sales, purchases, payments, cash/bank entries, expenses with image receipts, reports, printable invoices, configurable user permissions, company settings, audit logs, and business-data backup/restore.

## MySQL in GitHub Codespaces

Stop the application with **Ctrl+C** before migrating. Keep a downloaded business backup, and keep the original SQLite file. In your existing Codespaces terminal run:

```sh
git pull origin main
npm ci
npm run db:setup
npm run db:up
npm run db:migrate
npm run dev
```

`db:setup` generates MySQL credentials in the ignored `.env` file without printing them. `db:up` starts MySQL **8.4** with a persistent Docker volume, bound to loopback only. `.env` sets `DB_CLIENT=mysql`; the server loads it automatically. Keep MySQL port 3306 private; only forward the application's port 3000.

`db:migrate` imports the complete existing SQLite database, preserving IDs, users/password hashes, sessions, settings/logo, inventory, balances, movements and audit history. It reads a consistent source snapshot, uses a MySQL transaction, verifies row counts, and refuses a nonempty destination. It never changes the original SQLite file. Supply a custom source path with `npm run db:migrate -- path/to/source.sqlite`. Run migration once, before the first MySQL application startup. If you accidentally seeded the destination first, create a new empty MySQL database; do not delete business records to bypass the guard.

For a **fresh Codespace without SQLite data**, omit `db:migrate`; first app startup initializes schema and demonstration data. A new devcontainer definition provides Node.js 24 and Docker support for future Codespaces; an existing Codespace with Docker can use the commands directly without a rebuild.

`npm run db:prepare` is a repeatable preparation command: it migrates an existing SQLite file only into an empty MySQL database, and otherwise preserves the current MySQL data.

On subsequent starts:

```sh
npm run db:up
npm run dev
```

To access the database:

```sh
npm run db:shell
```

This opens the MySQL client using the local service's configured account, without putting the password in command arguments. Run `SHOW TABLES;`, then queries such as `SELECT id, data FROM products;`. MySQL data is stored in the Docker volume, not in `data/tradeflow.sqlite`. The SQLite file is retained for recovery. Stop MySQL with `npm run db:down`. Do not run `docker compose down -v` or delete your Codespace without a current backup: those operations can remove its database storage. Back up the `.env` credentials securely as well.

### Existing/remote MySQL

Copy `.env.example` to `.env` and fill in `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`. The database must already exist; the account needs schema and record permissions within it. Use MySQL 8.0.16+ (8.4 recommended) with InnoDB. For remote TLS, set `MYSQL_SSL=true` and optionally `MYSQL_SSL_CA` to a trusted CA file; certificate verification stays enabled. Never put MySQL credentials in frontend variables or commit `.env`.

### Validation

`npm test` runs the SQLite compatibility, API, session, reports and branding checks. `npm run test:mysql` runs the real MySQL transaction/concurrency, HTTP and migration suite against separate temporary databases that it creates and removes. It never clears the application database. Local Docker tests use the generated root credential solely to create disposable test databases; the app uses its restricted `tradeflow` account. For a remote test service, set `MYSQL_TEST_USER` and `MYSQL_TEST_PASSWORD` for an account allowed to create disposable databases.

## SQLite compatibility / local development

Requires Node.js 22.13+ (Node.js 24 recommended) and npm.

```sh
npm ci
npm run dev
```

The application listens on port 3000. `PORT` overrides the port. Both frontend and API use the same server. Without MySQL configuration, compatibility mode retains data in `data/tradeflow.sqlite`. Set `DB_CLIENT=sqlite` to select this explicitly. With MySQL configured, records are retained in the MySQL service instead.

Demo login: `admin@tradeflow.local` / `Tradeflow2026!`. This is an explicitly public demonstration credential. Set `ADMIN_PASSWORD` before first startup to override the initial password, or change it in **Settings & admin → Security**. A later change to `ADMIN_PASSWORD` does not replace an existing user's password.

```sh
npm test
npm run build
npm start
```

`npm start` serves the production build. Set `COOKIE_SECURE=true` behind HTTPS. Put the service behind an HTTPS reverse proxy before public deployment. SQLite's built-in Node driver currently emits an experimental-feature warning on some Node releases.

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

Backup downloads contain business data, including receipts, but exclude accounts/passwords/sessions. Restore requires explicit confirmation and replaces business data within a database transaction. Keep secure database backups for complete disaster recovery, including users. For MySQL, use mysqldump or managed database backups; the portable business backup excludes users and sessions. The audit log stays on the current database across portable business-data restores.

## Project structure

- `db.js`: shared asynchronous business transactions and seeding.
- `storage.js`: pooled MySQL connections, per-request transactions, and SQLite compatibility.
- `mysql-schema.sql`: InnoDB schema.
- `scripts/migrate-sqlite.js`: checked, atomic SQLite-to-MySQL import.
- `sqlite.js`: original SQLite schema and password utilities.
- `server.js`: API, authentication, permissions, audit, development/production serving.
- `src/main.jsx`: responsive application and forms.
- `src/style.css`: visual design, breakpoints, print layout.
- `tests/business.test.js`: business-rule and rollback tests.

## Deployment scope

This is a working single-company application suitable for development and evaluation. Production use needs a deployment review, HTTPS, private credentials, backup operations, and requirements specific to your tax jurisdiction. MySQL uses pooled connections and InnoDB transactions with row locks to protect stock and balances during concurrent requests. SQLite compatibility mode supports a single application instance. Multi-instance production deployments also need shared login rate limiting; the current limiter is process-local. The API currently reads collections in memory, while the frontend paginates. For large datasets, add server-side queries and pagination. PDF uses browser printing, CSV opens in Excel; native `.xlsx` files are not generated. Receipts support images up to 1 MB. Multi-company accounting, bank reconciliation, credit notes, sales returns with financial reversal, and tax filings need further implementation.

## GitHub Codespaces

Open the repository in a Codespace, use Node.js 24, and run `npm ci` followed by `npm run dev`. Open the forwarded **3000** port from the Ports panel and keep its visibility **Private**. The server derives this Codespace's exact HTTPS origin from the standard `CODESPACES`, `CODESPACE_NAME`, and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` variables. Login and other writes accept that origin and the exact `https://localhost:<PORT>` origin that Codespaces' HTTPS proxy may send. The localhost HTTPS alias is enabled only when running in Codespaces, and unrelated sites or other ports remain blocked. Vite uses the same port for live reload and accepts this Codespace's exact host.

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
