# SQL Server relational schema (version 2)

Application fields are ordinary typed columns. There is no JSON `data` or `permissions` column. JSON is still the HTTP API and portable backup format; it is not the SQL Server storage format.

| Table | Primary key | Business columns / relationships |
|---|---|---|
| products | id, identity | sku (unique when supplied), name, category, brand, unit, purchasePrice, sellingPrice, minStock, openingStock, stock, description, status, date |
| customers | id, identity | name, company, contact, phone, email, address, registration, openingBalance, balance, date |
| vendors | id, identity | Same contact/balance columns as customers |
| documents | id, identity | kind, date, number (unique), customerId → customers, vendorId → vendors, productId → products for adjustments; partyName snapshot, subtotal, discount, tax, charges, total, paid, outstanding, revenue, cost, amount, direction, method, category, description, reference, notes, reason, status, receiptName, receiptMime, receiptContent |
| document_items | documentId + lineNo | documentId → documents (cascade delete), productId → products, name/sku snapshots, quantity, rate; lineNo preserves item order |
| movements | id, identity | productId → products, date, quantity (signed), reason |
| settings | id = 1 | company, appName, email, phone, address, registration, currency, tax, invoicePrefix, logoMime, logoContent |
| users | id, identity | name, email (unique), password (salted scrypt hash), role |
| user_permissions | userId + module + action | userId → users (cascade delete); one row per permission, such as reports / export |
| sessions | token | userId → users, expires and duration (epoch/duration milliseconds) |
| audit | id, identity | date, actor, action, details (free-text history) |
| schema_migrations | version | appliedAt; version 2 records this schema |

Use `mssql-schema.sql` for complete column definitions, indexes and constraints. Monetary values, quantities, balances and rates use fixed-point `DECIMAL(28,8)` (settings tax is `DECIMAL(12,8)`); business dates use `DATE`, audit timestamps use `DATETIME2(3)`, Unicode text uses `NVARCHAR`, and image bytes use `VARBINARY(MAX)` with separate MIME/name columns. API amounts remain JavaScript numbers and are restricted to its safe numeric range; this is not arbitrary-precision accounting. Inputs with more than 8 meaningful decimal places fail instead of silently rounding. Display currency precision remains two decimal places.

Sales and purchases share the document header/item structure. Payments, expenses, cash entries and adjustments use the same header with the relevant columns populated. Customer and vendor foreign keys are separate (not a polymorphic ID). Constraints enforce the party type for each transaction kind. Header `cost` retains the existing invoice's cost snapshot; migration does not invent historical per-line costs or payment allocations that the original database never recorded.

## Migrate the existing local SQL Server database

1. Stop every running app instance, including other computers that write to this database.
2. Ask your DBA/IT team to take a **full native SQL Server backup**, and verify the server/database name in your local `.env`. The business JSON export excludes users and is not a full backup.
3. Update the project, install dependencies, and run `npm.cmd run db:normalize` on Windows. Docker is **not** required for an already installed SQL Server instance.
4. Start the application and check company details, users, stock, invoice totals and balances. In SSMS refresh Tables, then expand Columns. New child tables are document_items and user_permissions.

The migration requires database DDL permissions (typically run once by a DBA with db_owner on this database). Normal startup never migrates an old schema automatically. It reports the migration command instead.

Migration obtains an exclusive migration lock, takes table locks, renames the original tables inside one SQL transaction, creates the typed schema, copies and verifies all supported business fields, images, invoice lines, permissions and row counts, preserves primary keys and identity high-water marks, and removes the old tables only after verification. Any error rolls back the renames, schema changes and copies together. The retained native backup is the recovery path after a successful migration. Re-running the command on version 2 leaves business records unchanged. Stop writers before running it; the migration lock coordinates migrations, not old application processes.

Unmapped custom business fields, invalid references, duplicate SKUs/numbers, out-of-range IDs or values, and incompatible data abort migration instead of being silently lost. Unused defaults the original shared form submitted for unrelated modules are omitted; these are not business fields for that table. Empty permission arrays become no permission rows, which has the same access behavior. Current stock and balances are copied, not recalculated. No demonstration records are added by migration.

## Queries for SSMS / Power BI

```sql
SELECT id, sku, name, category, purchasePrice, sellingPrice, stock
FROM dbo.products;

SELECT id, company, appName, currency FROM dbo.settings;

SELECT id, name, email, role FROM dbo.users; -- Do not expose password hashes.

SELECT d.number, d.date, c.name AS Customer,
       i.[lineNo], p.sku, i.name AS InvoicedProduct,
       i.quantity, i.rate, i.quantity * i.rate AS LineAmount
FROM dbo.documents AS d
JOIN dbo.customers AS c ON c.id = d.customerId
JOIN dbo.document_items AS i ON i.documentId = d.id
JOIN dbo.products AS p ON p.id = i.productId
WHERE d.kind = 'sales'
ORDER BY d.date, d.id, i.[lineNo];

SELECT d.id, d.number, d.date, d.total, d.paid, d.outstanding
FROM dbo.documents AS d
WHERE d.kind = 'sales';
```

Use a separate read-only reporting account. Do not grant Power BI access to passwords, sessions or unrestricted user information. Schema migration adds child-table foreign keys: for an authorized all-demo cleanup, delete movements and documents (which cascades document_items) before deleting products/customers/vendors. Keep users and settings to preserve login/branding. Do not use earlier JSON_VALUE queries on the new schema.

For runtime permissions, grant SELECT/INSERT/UPDATE/DELETE on the application tables, including document_items and user_permissions. Explicit-ID business restores also need ALTER on products, customers, vendors, documents and movements; migrations additionally need schema DDL and temporary ALTER on users/audit for preserved IDs. Revoke migration-only permissions after cutover. Tables remain in dbo; do not change schema ownership during migration.
