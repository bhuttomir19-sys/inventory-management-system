import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import { openDB as openSQLite } from './sqlite.js';
import { readFileSync } from 'node:fs';
export async function connectDatabase(env=process.env) {
 const driver=env.DB_CLIENT|| (env.MYSQL_HOST?'mysql':'sqlite');
 if(!['sqlite','mysql'].includes(driver))throw Error('DB_CLIENT must be mysql or sqlite');
 const context=new AsyncLocalStorage();let pool,local;let queue=Promise.resolve();
 if(driver==='mysql'){
  for(const key of ['MYSQL_HOST','MYSQL_USER','MYSQL_DATABASE'])if(!env[key])throw Error(`Set ${key} in .env before starting MySQL mode`);
  const ssl=env.MYSQL_SSL==='true'?{rejectUnauthorized:true,...(env.MYSQL_SSL_CA?{ca:readFileSync(env.MYSQL_SSL_CA,'utf8')}:{})}:undefined;
  pool=mysql.createPool({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT||3306),user:env.MYSQL_USER,password:env.MYSQL_PASSWORD||'',database:env.MYSQL_DATABASE,connectionLimit:10,charset:'utf8mb4',decimalNumbers:true,supportBigNumbers:true,dateStrings:true,ssl});
 }else local=openSQLite(env.DB_PATH||'data/tradeflow.sqlite');
 const db={driver,get inTransaction(){return context.getStore()?.transaction===true;},prepare(sql){return {async all(...params){if(driver==='sqlite')return local.prepare(sql).all(...params);const [result]=await (context.getStore()?.connection||pool).execute(sql,params);return result;},async get(...params){return (await this.all(...params))[0];},async run(...params){if(driver==='sqlite')return local.prepare(sql).run(...params);const [result]=await(context.getStore()?.connection||pool).execute(sql,params);return{lastInsertRowid:result.insertId,changes:result.affectedRows};}};},async exec(sql){if(driver==='sqlite')return local.exec(sql);await(context.getStore()?.connection||pool).query(sql);},async request(fn,{transaction=false}={}){
  if(context.getStore()){if(transaction&&!db.inTransaction)return db.transaction(fn);return fn(db);}
  const run=async()=>{const connection=pool?await pool.getConnection():null;const state={connection,transaction:false};try{return await context.run(state,()=>transaction?db.transaction(fn):fn(db));}finally{connection?.release();}};
  if(driver==='mysql')return run();const result=queue.then(run,run);queue=result.catch(()=>{});return result;
 },async transaction(fn){if(db.inTransaction)return fn(db);if(!context.getStore())return db.request(fn,{transaction:true});const state=context.getStore();if(driver==='mysql')await state.connection.beginTransaction();else local.exec('BEGIN IMMEDIATE');state.transaction=true;try{const result=await fn(db);if(driver==='mysql')await state.connection.commit();else local.exec('COMMIT');return result;}catch(error){if(driver==='mysql')await state.connection.rollback();else local.exec('ROLLBACK');throw error;}finally{state.transaction=false;}},async close(){if(pool)await pool.end();else local.close();}};
 if(driver==='mysql'){const schema=readFileSync(new URL('./mysql-schema.sql',import.meta.url),'utf8');for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await db.exec(sql);}
 return db;
}
export async function transaction(db,fn){if(db.transaction)return db.transaction(fn);db.exec('BEGIN IMMEDIATE');try{const result=await fn(db);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
