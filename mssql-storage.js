import sql from 'mssql';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';

export function sqlServerConfig(env=process.env, database=env.MSSQL_DATABASE) {
 for(const key of ['MSSQL_HOST','MSSQL_USER','MSSQL_PASSWORD'])if(!env[key])throw Error(`Set ${key} in .env before starting SQL Server mode`);
 if(!database)throw Error('Set MSSQL_DATABASE in .env');
 return {server:env.MSSQL_HOST,port:Number(env.MSSQL_PORT||1433),database,user:env.MSSQL_USER,password:env.MSSQL_PASSWORD,
  options:{encrypt:env.MSSQL_ENCRYPT!=='false',trustServerCertificate:env.MSSQL_TRUST_SERVER_CERTIFICATE==='true',abortTransactionOnError:true},
  pool:{max:10,min:0,idleTimeoutMillis:30000},requestTimeout:60000};
}
const identityTables=new Set(['products','customers','vendors','documents','movements','users','audit','finance_journals']);
// Translate the small shared query dialect; values always remain bound parameters.
export function compileSqlServer(statement, params=[], {run=false}={}) {
 let index=0;
 let text=statement.replace(/`([A-Za-z][A-Za-z0-9]*)`/g,'[$1]').replace(/\?/g,()=>`@p${index++}`);
 if(index!==params.length)throw Error('Database parameter count mismatch');
 text=text.replace(/\s+FOR UPDATE\s*$/i,'');
 const limit=text.match(/\s+LIMIT (\d+)\s*$/i);
 if(limit)text=text.replace(/^SELECT\s+/i,`SELECT TOP (${limit[1]}) `).replace(/\s+LIMIT \d+\s*$/i,'');
 const insert=text.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)/i);
 const identity=insert&&identityTables.has(insert[1]);
 const explicit=identity&&insert[2].split(',').some(k=>k.trim().replace(/[\[\]]/g,'').toLowerCase()==='id');
 if(run&&identity&&!explicit)text+='; SELECT CAST(SCOPE_IDENTITY() AS INT) AS lastInsertRowid';
 if(run&&explicit){const table=insert[1];text=`SET IDENTITY_INSERT dbo.${table} ON; BEGIN TRY ${text}; SET IDENTITY_INSERT dbo.${table} OFF; END TRY BEGIN CATCH SET IDENTITY_INSERT dbo.${table} OFF; THROW; END CATCH`;}
 return {text,identity:!!identity&&!explicit};
}
export async function connectSqlServer(env=process.env, {initialize=true}={}) {
 const pool=await new sql.ConnectionPool(sqlServerConfig(env)).connect();
 pool.on('error',()=>{}); // Request errors are propagated; do not crash on a pool event.
 const context=new AsyncLocalStorage();
 const execute=async(statement,params=[],run=false)=>{
  const compiled=compileSqlServer(statement,params,{run});
  const request=new sql.Request(context.getStore()?.transaction||pool);
  params.forEach((value,i)=>{
   if(typeof value==='string')request.input(`p${i}`,sql.NVarChar(sql.MAX),value);
   else if(typeof value==='number')request.input(`p${i}`,Number.isInteger(value)?sql.BigInt:sql.Decimal(28,8),value);
   else if(Buffer.isBuffer(value))request.input(`p${i}`,sql.VarBinary(sql.MAX),value);
   else request.input(`p${i}`,value??null);
  });
  const state=context.getStore();
  if(!state)return request.query(compiled.text);
  const result=state.queue.then(()=>request.query(compiled.text));state.queue=result.catch(()=>{});return result;
 };
 const db={driver:'mssql',get inTransaction(){return !!context.getStore()?.transaction;},
  prepare(statement){return {async all(...params){const records=(await execute(statement,params)).recordset||[];for(const record of records)for(const [key,column] of Object.entries(records.columns||{})){if(column.type===sql.BigInt&&record[key]!==null){const value=Number(record[key]);if(!Number.isSafeInteger(value))throw Error('SQL Server integer exceeds safe application range');record[key]=value;}if(record[key] instanceof Date)record[key]=column.type===sql.Date?record[key].toISOString().slice(0,10):record[key].toISOString();}return records;},async get(...params){return (await this.all(...params))[0];},async run(...params){const result=await execute(statement,params,true);return {lastInsertRowid:result.recordset?.[0]?.lastInsertRowid||0,changes:result.rowsAffected.reduce((a,b)=>a+b,0)};}};},
  async exec(statement){await execute(statement);},
  async request(fn,{transaction=false}={}){return transaction?db.transaction(fn):fn(db);},
  async transaction(fn){if(db.inTransaction)return fn(db);const transaction=new sql.Transaction(pool);let rolledBack=false;transaction.on('rollback',()=>{rolledBack=true;});await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const result=await context.run({transaction,queue:Promise.resolve()},()=>fn(db));await transaction.commit();return result;}catch(error){if(!rolledBack)await transaction.rollback().catch(()=>{});throw error;}},
  async close(){await pool.close();}
 };
 try{if(initialize)await initializeSqlServer(db);}
 catch(error){await pool.close();throw error;}
 return db;
}

export async function initializeSqlServer(db){
 const legacy=await db.prepare("SELECT COL_LENGTH('dbo.products','data') n").get();
 if(legacy.n!==null)throw Error('Legacy JSON schema detected. Stop the application, take a full backup, then run npm run db:normalize.');
 for(const batch of readFileSync(new URL('./mssql-schema.sql',import.meta.url),'utf8').split(/^GO\s*$/m).filter(s=>s.trim()))await db.exec(batch);
}
