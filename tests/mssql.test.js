import test from 'node:test';import assert from 'node:assert/strict';
import{compileSqlServer,sqlServerConfig}from'../mssql-storage.js';
test('SQL Server binds login values and adapts audit pagination',()=>{
 const value="x' OR 1=1 --";const q=compileSqlServer('SELECT * FROM users WHERE email=?',[value]);assert.equal(q.text,'SELECT * FROM users WHERE email=@p0');assert.ok(!q.text.includes(value));
 assert.equal(compileSqlServer('SELECT * FROM audit ORDER BY id DESC LIMIT 200').text,'SELECT TOP (200) * FROM audit ORDER BY id DESC');
 assert.throws(()=>compileSqlServer('SELECT * FROM users WHERE id=?',[]),/count mismatch/);
});
test('SQL Server returns invoice IDs and preserves explicit imported IDs',()=>{
 assert.match(compileSqlServer('INSERT INTO documents(kind,date,data) VALUES(?,?,?)',['sales','2026-10-12','{}'],{run:true}).text,/SCOPE_IDENTITY/);
 const imported=compileSqlServer('INSERT INTO products([id],[data]) VALUES(?,?)',[900,'{}'],{run:true}).text;assert.match(imported,/SET IDENTITY_INSERT dbo.products ON/);assert.match(imported,/BEGIN CATCH/);assert.match(imported,/IDENTITY_INSERT dbo.products OFF/);assert.doesNotMatch(imported,/SCOPE_IDENTITY/);
 assert.doesNotMatch(compileSqlServer('INSERT INTO settings(id,data) VALUES(?,?)',[1,'{}'],{run:true}).text,/IDENTITY_INSERT/);
});
test('SQL Server verifies certificates by default and requires connection configuration',()=>{
 const config=sqlServerConfig({MSSQL_HOST:'db.example.com',MSSQL_USER:'app',MSSQL_PASSWORD:'example',MSSQL_DATABASE:'tradeflow'});assert.equal(config.options.encrypt,true);assert.equal(config.options.trustServerCertificate,false);assert.equal(config.port,1433);
 assert.throws(()=>sqlServerConfig({}),/MSSQL_HOST/);
});
import{relationalValues}from'../relational.js';
test('Column mapping converts numeric form input, separates parties and refuses unmapped migration fields',()=>{
 const product=relationalValues('products',{name:'Item',sku:' A-1 ',stock:'2.25',sellingPrice:'35.50',items:[{productId:''}],role:'Sales User'},{strict:true});assert.equal(product.stock,2.25);assert.equal(product.sellingPrice,35.5);assert.equal(product.sku,'A-1');assert.equal(relationalValues('products',{stock:0.1+0.2}).stock,0.3);assert.ok(!Object.hasOwn(product,'data'));
 const sale=relationalValues('documents',{kind:'sales',partyId:'12',date:'2026-10-23'});assert.equal(sale.customerId,12);assert.equal(sale.vendorId,null);
 const payment=relationalValues('documents',{kind:'payments',direction:'paid',partyId:'14'});assert.equal(payment.vendorId,14);assert.equal(payment.customerId,null);
 assert.throws(()=>relationalValues('products',{name:'Item',custom:'preserve this'},{strict:true}),/Unmapped products.custom/);
 assert.throws(()=>relationalValues('products',{stock:0.123456789}),/decimal places/);
});
