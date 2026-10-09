import 'dotenv/config';
import {DatabaseSync}from'node:sqlite';
import {existsSync}from'node:fs';
import {resolve}from'node:path';
import {connectDatabase}from'../storage.js';
const sourcePath=resolve(process.argv[2]||process.env.SQLITE_SOURCE||'data/tradeflow.sqlite');
if(!existsSync(sourcePath))throw Error('SQLite source does not exist. Supply its path: npm run db:migrate -- path/to/tradeflow.sqlite');
const source=new DatabaseSync(sourcePath,{readOnly:true});
const tables=['users','products','customers','vendors','settings','documents','movements','audit','sessions'];
let target;
try{
 source.exec('BEGIN');
 const available=source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
 for(const table of tables)if(!available.includes(table))throw Error(`Source is missing table: ${table}`);
 target=await connectDatabase({...process.env,DB_CLIENT:'mysql'});
 const counts={};
 await target.transaction(async()=>{
  for(const table of tables){if((await target.prepare(`SELECT * FROM ${table} FOR UPDATE`).all()).length)throw Error(`Target MySQL table ${table} is not empty. Migration refused; use a new database.`);}
  for(const table of tables){const records=source.prepare(`SELECT * FROM ${table}`).all();counts[table]=records.length;
   for(const raw of records){const record={...raw};if(table==='sessions'&&record.duration===undefined)record.duration=86400000;const keys=Object.keys(record);if(!keys.every(k=>/^[A-Za-z][A-Za-z0-9]*$/.test(k)))throw Error('Unexpected source column');await target.prepare(`INSERT INTO ${table}(${keys.map(k=>'`'+k+'`').join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>record[k]));}
   const count=await target.prepare(`SELECT COUNT(*) n FROM ${table}`).get();if(Number(count.n)!==records.length)throw Error(`Migration count mismatch: ${table}`);
  }
 });
 source.exec('COMMIT');
 console.log('SQLite → MySQL migration committed. Source SQLite file was not modified.');
 console.log(JSON.stringify(counts));
}catch(error){try{source.exec('ROLLBACK');}catch{}console.error('Migration failed: '+(error.code||error.message));process.exitCode=1;}finally{source.close();await target?.close();}
