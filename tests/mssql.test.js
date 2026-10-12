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
