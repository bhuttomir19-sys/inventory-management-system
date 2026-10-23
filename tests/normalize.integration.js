import test from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connectSqlServer,sqlServerConfig} from '../mssql-storage.js';
import {seed,rows,put,settings,users,createDocument} from '../db.js';
const png='data:image/png;base64,iVBORw0KGgo=';
async function fixture(fn){
 const name=process.env.MSSQL_DATABASE+'_normalize_'+Math.random().toString(36).slice(2,8);
 const admin=await new sql.ConnectionPool(sqlServerConfig(process.env,'master')).connect();let db;
 try{
  await admin.request().query(`CREATE DATABASE [${name}]`);db=await connectSqlServer({...process.env,MSSQL_DATABASE:name},{initialize:false});
  for(const batch of readFileSync(new URL('../migrations/001-legacy-schema.sql',import.meta.url),'utf8').split(/^GO\s*$/m).filter(s=>s.trim()))await db.exec(batch);
  // Exercise the actual old JSON business format with the original dialect helpers.
  const legacy={...db,driver:'sqlite'};await db.transaction(()=>seed(legacy));
  const cfg=await settings(legacy);await put(legacy,'settings',{...cfg,company:'Saved Company شرکت',appName:'Saved ERP',currency:'PKR',logo:png},1);
  await db.prepare('INSERT INTO sessions(token,userId,expires,duration) VALUES(?,?,?,?)').run('persisted-token',1,Date.now()+86400000,86400000);
  await createDocument(legacy,'expenses',{amount:12.25,date:'2026-10-23',category:'Office',method:'Cash',receipt:{name:'receipt.png',data:png},notes:'Saved note'});
  const migrate=async()=>{const child=spawn(process.execPath,['scripts/normalize-mssql.js'],{env:{...process.env,MSSQL_DATABASE:name},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const[code]=await once(child,'exit');return{code,output};};
  await fn({db,legacy,name,migrate});
 }finally{await db?.close();await admin.request().query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]`);await admin.close();}
}
test('Legacy MSSQL migration creates real typed columns, preserves data and identity counters, is repeatable',async()=>fixture(async({db,legacy,name,migrate})=>{
 const firstProduct=(await rows(legacy,'products'))[0];await put(legacy,'products',{...firstProduct,stock:0.1+0.2},firstProduct.id);
 const before={products:await rows(legacy,'products'),customers:await rows(legacy,'customers'),documents:await rows(legacy,'documents'),settings:await settings(legacy),users:await users(legacy)};
 await db.prepare('INSERT INTO products(id,data) VALUES(?,?)').run(9000,JSON.stringify({name:'Deleted product'}));await db.prepare('DELETE FROM products WHERE id=?').run(9000);
 await assert.rejects(()=>connectSqlServer({...process.env,MSSQL_DATABASE:name}),/db:normalize/);
 const result=await migrate();assert.equal(result.code,0,result.output);
 const normalized=await connectSqlServer({...process.env,MSSQL_DATABASE:name});try{
  const columns=await normalized.prepare('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=?').all('dbo');
  assert.ok(!columns.some(c=>['data','permissions'].includes(c.COLUMN_NAME)));
  assert.equal(columns.find(c=>c.TABLE_NAME==='products'&&c.COLUMN_NAME==='purchasePrice').DATA_TYPE,'decimal');
  assert.equal(columns.find(c=>c.TABLE_NAME==='documents'&&c.COLUMN_NAME==='date').DATA_TYPE,'date');
  assert.ok(columns.some(c=>c.TABLE_NAME==='document_items'&&c.COLUMN_NAME==='quantity'));
  assert.ok(columns.some(c=>c.TABLE_NAME==='user_permissions'&&c.COLUMN_NAME==='action'));
  assert.equal((await normalized.prepare('SELECT COUNT(*) n FROM products').get()).n,before.products.length);
  for(const p of before.products){const actual=(await rows(normalized,'products')).find(r=>r.id===p.id);assert.equal(actual.stock,Number(p.stock.toFixed(8)));assert.equal(actual.purchasePrice,p.purchasePrice);}
  for(const d of before.documents){const actual=(await rows(normalized,'documents')).find(r=>r.id===d.id);assert.equal(actual.total,d.total);assert.equal(actual.outstanding,d.outstanding||0);if(d.items)assert.deepEqual(actual.items,d.items.map(i=>({...i,quantity:Number(i.quantity),rate:Number(i.rate)})));if(d.receipt)assert.deepEqual(actual.receipt,d.receipt);}
  assert.equal((await settings(normalized)).company,before.settings.company);assert.equal((await settings(normalized)).logo,png);assert.equal((await settings(normalized)).currency,'PKR');
  assert.equal((await users(normalized))[0].password,before.users[0].password);assert.ok(JSON.parse((await users(normalized))[0].permissions).admin.includes('edit'));
  assert.equal((await normalized.prepare('SELECT userId FROM sessions WHERE token=?').get('persisted-token')).userId,1);
  assert.equal((await put(normalized,'products',{name:'New real product',sku:'REAL-1',stock:0})),9001);
  assert.ok((await normalized.prepare('SELECT COUNT(*) n FROM sys.foreign_keys').get()).n>=8);
  assert.equal((await migrate()).code,0);
  assert.equal((await normalized.prepare('SELECT COUNT(*) n FROM products').get()).n,before.products.length+1);
 }finally{await normalized.close();}
}));
test('Unmapped legacy data aborts and rolls back the complete schema migration',async()=>fixture(async({db,legacy,migrate})=>{
 const product=(await rows(legacy,'products'))[0];await put(legacy,'products',{...product,customBusinessField:'must not disappear'},product.id);
 const original=(await db.prepare('SELECT data FROM products WHERE id=?').get(product.id)).data;
 const result=await migrate();assert.equal(result.code,1);assert.match(result.output,/Unmapped products.customBusinessField/);
 assert.equal((await db.prepare('SELECT data FROM products WHERE id=?').get(product.id)).data,original);
 assert.equal((await db.prepare("SELECT OBJECT_ID('dbo.document_items') id").get()).id,null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').get()).n,1);
 assert.equal((await db.prepare("SELECT OBJECT_ID('dbo.__old_products') id").get()).id,null);
}));
test('Cleared demo workspace stays empty after migration and preserves deleted identity counters',async()=>fixture(async({db,name,migrate})=>{
 const productCounter=(await db.prepare("SELECT CAST(IDENT_CURRENT('dbo.products') AS INT) n").get()).n;
 const documentCounter=(await db.prepare("SELECT CAST(IDENT_CURRENT('dbo.documents') AS INT) n").get()).n;
 for(const table of ['movements','documents','products','customers','vendors'])await db.exec(`DELETE FROM ${table}`);
 const result=await migrate();assert.equal(result.code,0,result.output);
 const normalized=await connectSqlServer({...process.env,MSSQL_DATABASE:name});try{
  await seed(normalized);
  for(const table of ['products','customers','vendors','documents','movements'])assert.equal((await normalized.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).n,0);
  assert.equal((await settings(normalized)).company,'Saved Company شرکت');assert.equal((await users(normalized)).length,1);
  assert.equal(await put(normalized,'products',{name:'First real product',sku:'FIRST-REAL'}),productCounter+1);
  const expense=await createDocument(normalized,'expenses',{date:'2026-10-23',amount:1,description:'First real expense'});assert.equal(expense.id,documentCounter+1);
 }finally{await normalized.close();}
}));
