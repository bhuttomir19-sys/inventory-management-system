-- Relational SQL Server schema, version 2. No JSON business columns.
IF OBJECT_ID(N'dbo.products', N'U') IS NULL
CREATE TABLE dbo.products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    [sku] NVARCHAR(100) NULL,
    [name] NVARCHAR(200) NOT NULL,
    [category] NVARCHAR(100) NULL,
    [brand] NVARCHAR(100) NULL,
    [unit] NVARCHAR(50) NULL,
    [purchasePrice] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(purchasePrice>=0),
    [sellingPrice] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(sellingPrice>=0),
    [minStock] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(minStock>=0),
    [openingStock] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(openingStock>=0),
    [stock] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(stock>=0),
    [description] NVARCHAR(MAX) NULL,
    [status] VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),
    [date] DATE NULL
);
GO
IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
CREATE TABLE dbo.customers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    [name] NVARCHAR(200) NOT NULL,
    [company] NVARCHAR(200) NULL,
    [contact] NVARCHAR(200) NULL,
    [phone] NVARCHAR(60) NULL,
    [email] NVARCHAR(254) NULL,
    [address] NVARCHAR(MAX) NULL,
    [registration] NVARCHAR(120) NULL,
    [openingBalance] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(openingBalance>=0),
    [balance] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(balance>=0),
    [date] DATE NULL
);
GO
IF OBJECT_ID(N'dbo.vendors', N'U') IS NULL
CREATE TABLE dbo.vendors (
    id INT IDENTITY(1,1) PRIMARY KEY,
    [name] NVARCHAR(200) NOT NULL,
    [company] NVARCHAR(200) NULL,
    [contact] NVARCHAR(200) NULL,
    [phone] NVARCHAR(60) NULL,
    [email] NVARCHAR(254) NULL,
    [address] NVARCHAR(MAX) NULL,
    [registration] NVARCHAR(120) NULL,
    [openingBalance] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(openingBalance>=0),
    [balance] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(balance>=0),
    [date] DATE NULL
);
GO
IF OBJECT_ID(N'dbo.settings', N'U') IS NULL
CREATE TABLE dbo.settings (
    id INT PRIMARY KEY CHECK(id=1),
    [company] NVARCHAR(120) NOT NULL,
    [appName] NVARCHAR(60) NULL,
    [email] NVARCHAR(254) NULL,
    [phone] NVARCHAR(60) NULL,
    [address] NVARCHAR(MAX) NULL,
    [registration] NVARCHAR(120) NULL,
    [currency] NVARCHAR(12) NOT NULL DEFAULT 'USD',
    [tax] DECIMAL(12,8) NOT NULL DEFAULT 0 CHECK(tax BETWEEN 0 AND 100),
    [invoicePrefix] NVARCHAR(30) NULL,
    [logoMime] VARCHAR(30) NULL,
    [logoContent] VARBINARY(MAX) NULL
);
GO
IF OBJECT_ID(N'dbo.documents', N'U') IS NULL
CREATE TABLE dbo.documents (
    id INT IDENTITY(1,1) PRIMARY KEY,
    [kind] VARCHAR(20) NOT NULL CHECK(kind IN ('sales','purchases','payments','expenses','adjustments','cash')),
    [date] DATE NOT NULL,
    [number] NVARCHAR(100) NULL,
    [customerId] INT NULL REFERENCES dbo.customers(id),
    [vendorId] INT NULL REFERENCES dbo.vendors(id),
    [productId] INT NULL REFERENCES dbo.products(id),
    [partyName] NVARCHAR(200) NULL,
    [direction] VARCHAR(10) NULL CHECK(direction IN ('received','paid','in','out')),
    [method] NVARCHAR(60) NULL,
    [category] NVARCHAR(100) NULL,
    [description] NVARCHAR(MAX) NULL,
    [reference] NVARCHAR(200) NULL,
    [notes] NVARCHAR(MAX) NULL,
    [reason] NVARCHAR(255) NULL,
    [status] NVARCHAR(20) NULL,
    [receiptName] NVARCHAR(255) NULL,
    [receiptMime] VARCHAR(30) NULL,
    [receiptContent] VARBINARY(MAX) NULL,
    [subtotal] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(subtotal>=0),
    [discount] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(discount>=0),
    [tax] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(tax>=0),
    [charges] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(charges>=0),
    [total] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(total>=0),
    [paid] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(paid>=0),
    [outstanding] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(outstanding>=0),
    [revenue] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(revenue>=0),
    [cost] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(cost>=0),
    [amount] DECIMAL(28,8) NOT NULL DEFAULT 0 CHECK(amount>=0),
    CHECK((kind='sales' AND customerId IS NOT NULL AND vendorId IS NULL) OR (kind='purchases' AND vendorId IS NOT NULL AND customerId IS NULL) OR (kind='payments' AND ((direction='received' AND customerId IS NOT NULL AND vendorId IS NULL) OR (direction='paid' AND vendorId IS NOT NULL AND customerId IS NULL))) OR (kind IN ('expenses','adjustments','cash') AND customerId IS NULL AND vendorId IS NULL)),
    CHECK(kind<>'adjustments' OR productId IS NOT NULL)
);
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.products') AND name='product_sku') CREATE UNIQUE INDEX product_sku ON dbo.products(sku) WHERE sku IS NOT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.documents') AND name='document_number') CREATE UNIQUE INDEX document_number ON dbo.documents(number) WHERE number IS NOT NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.documents') AND name='document_kind_date') BEGIN CREATE INDEX document_kind_date ON dbo.documents(kind,date); CREATE INDEX document_customer ON dbo.documents(customerId,date); CREATE INDEX document_vendor ON dbo.documents(vendorId,date); END;
GO
IF OBJECT_ID(N'dbo.document_items',N'U') IS NULL
CREATE TABLE dbo.document_items (
 documentId INT NOT NULL REFERENCES dbo.documents(id) ON DELETE CASCADE,
 [lineNo] INT NOT NULL CHECK([lineNo]>0),
 productId INT NOT NULL REFERENCES dbo.products(id),
 name NVARCHAR(200) NULL,
 sku NVARCHAR(100) NULL,
 quantity DECIMAL(28,8) NOT NULL CHECK(quantity>0),
 rate DECIMAL(28,8) NOT NULL CHECK(rate>=0),
 PRIMARY KEY(documentId,[lineNo])
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.document_items') AND name='item_product') CREATE INDEX item_product ON dbo.document_items(productId);
GO
IF OBJECT_ID(N'dbo.movements',N'U') IS NULL BEGIN
 CREATE TABLE dbo.movements(id INT IDENTITY(1,1) PRIMARY KEY, productId INT NOT NULL REFERENCES dbo.products(id), date DATE NOT NULL, quantity DECIMAL(28,8) NOT NULL, reason NVARCHAR(255) NOT NULL);
 CREATE INDEX movement_date ON dbo.movements(date);
 CREATE INDEX movement_product_date ON dbo.movements(productId,date);
END;
GO
IF OBJECT_ID(N'dbo.users',N'U') IS NULL CREATE TABLE dbo.users(id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(120) NOT NULL, email NVARCHAR(255) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, role NVARCHAR(60) NOT NULL);
GO
IF OBJECT_ID(N'dbo.user_permissions',N'U') IS NULL CREATE TABLE dbo.user_permissions(
 userId INT NOT NULL REFERENCES dbo.users(id) ON DELETE CASCADE,
 module VARCHAR(40) NOT NULL,
 action VARCHAR(10) NOT NULL CHECK(action IN ('view','add','edit','delete','print','export')),
 PRIMARY KEY(userId,module,action)
);
GO
IF OBJECT_ID(N'dbo.sessions',N'U') IS NULL BEGIN CREATE TABLE dbo.sessions(token VARCHAR(64) COLLATE Latin1_General_100_BIN2 PRIMARY KEY, userId INT NOT NULL REFERENCES dbo.users(id), expires BIGINT NOT NULL, duration BIGINT NOT NULL DEFAULT 86400000); CREATE INDEX session_expiry ON dbo.sessions(expires); END;
GO
IF OBJECT_ID(N'dbo.audit',N'U') IS NULL CREATE TABLE dbo.audit(id INT IDENTITY(1,1) PRIMARY KEY, date DATETIME2(3), actor NVARCHAR(120), action NVARCHAR(255), details NVARCHAR(MAX));
GO
IF OBJECT_ID(N'dbo.schema_migrations',N'U') IS NULL CREATE TABLE dbo.schema_migrations(version INT PRIMARY KEY, appliedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME());
IF NOT EXISTS(SELECT 1 FROM dbo.schema_migrations WHERE version=2) INSERT INTO dbo.schema_migrations(version) VALUES(2);
