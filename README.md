# Tradeflow — Trading Business Management

A responsive React application with an Express API and persistent SQLite database. Includes a seeded demo company, dashboard, catalog, stock movements, customers, suppliers, sales, purchases, payments, cash/bank entries, expenses with image receipts, reports, printable invoices, configurable user permissions, company settings, audit logs, and business-data backup/restore.

## Run locally

Requires Node.js 22.13+ (Node.js 24 recommended) and npm.

```sh
npm ci
npm run dev
```

The application listens on port 3000. `PORT` overrides the port. Both frontend and API use the same server. Data is retained in `data/tradeflow.sqlite`; restart processes without deleting this directory.

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
- Transactions run in SQLite transactions: any validation failure rolls back the entire invoice, its stock movements, and balances.
- Stock adjustments cover damage, returns, and opening-stock corrections. Stock cannot become negative.
- Cash/bank entries record additional money in/out. Expenses also appear in financial history and cash-flow reports.
- Financial documents are immutable through the API; linked master records cannot be deleted. Use corrective stock entries when needed. Invoice cancellation and credit-note workflows are not implemented.
- Profit uses sales excluding tax, less captured cost of sold products and operating expenses. It is a management summary, not a statutory double-entry accounting system.

## Administration and reports

Users receive action-level permissions for each module: view, add, edit, delete, print, export. Role labels are customizable through the six supplied role types; access is controlled by the permission matrix, not the label. All API mutations verify permissions. Passwords use salted scrypt hashes; sessions use random HttpOnly, SameSite cookies with a one-day expiry. Login attempts are rate-limited. Changing a user's permissions revokes their sessions.

Reports include sales, purchases, stock, movements, customer/vendor ledgers, receivables/payables, expenses, profit/loss, cash flow, and product/customer/vendor summaries. Filter dates and search, paginate and sort, export CSV (Excel compatible), or print/save PDF through the browser. Invoice numbering uses unique transaction IDs. The company currency is a display currency; no currency conversion is performed.

Backup downloads contain business data, including receipts, but exclude accounts/passwords/sessions. Restore requires explicit confirmation and replaces business data within a database transaction. Keep secure, offline backups of the SQLite database for complete disaster recovery, including users. The audit log stays on the current database across portable business-data restores.

## Project structure

- `db.js`: database initialization, seeding, atomic business transactions.
- `server.js`: API, authentication, permissions, audit, development/production serving.
- `src/main.jsx`: responsive application and forms.
- `src/style.css`: visual design, breakpoints, print layout.
- `tests/business.test.js`: business-rule and rollback tests.

## Deployment scope

This is a working single-company application suitable for development and evaluation. Production use needs a deployment review, HTTPS, private credentials, backup operations, and requirements specific to your tax jurisdiction. SQLite supports a single application instance; a multi-instance deployment should migrate storage and sessions to a managed relational database. The API currently reads collections in memory, while the frontend paginates. For large datasets, add server-side queries and pagination. PDF uses browser printing, CSV opens in Excel; native `.xlsx` files are not generated. Receipts support images up to 1 MB. Multi-company accounting, bank reconciliation, credit notes, sales returns with financial reversal, and tax filings need further implementation.

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
