import 'dotenv/config';
import mysql from 'mysql2/promise';
import {readFileSync}from'node:fs';
import {connectSqlServer}from'../mssql-storage.js';
import {importLegacyRecords,legacyTables} from '../migrate-relational.js';
const tables=legacyTables;
let source,target;
try{
 for(const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'])if(!process.env[key])throw Error(`Missing source ${key}. Keep your existing MySQL settings in .env.`);
 source=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,dateStrings:true,ssl:process.env.MYSQL_SSL==='true'?{rejectUnauthorized:true,...(process.env.MYSQL_SSL_CA?{ca:readFileSync(process.env.MYSQL_SSL_CA,'utf8')}:{})}:undefined});
 const [engines]=await source.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [process.env.MYSQL_DATABASE]);
 for(const table of tables)if(!engines.some(r=>r.TABLE_NAME===table&&r.ENGINE==='InnoDB'))throw Error(`Source table ${table} must exist and use InnoDB for a consistent snapshot.`);
 if(engines.some(r=>r.TABLE_NAME==='finance_books')){const [books]=await source.query('SELECT id FROM finance_books');if(books.length)throw Error('Source has active financial books. This legacy migration does not copy the financial ledger; use a full ledger migration before switching databases.');}
 await source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await source.query('SET TRANSACTION READ ONLY');
 await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
 target=await connectSqlServer();const counts={};
 await target.transaction(async()=>{
  const snapshot={};for(const table of tables){const [records]=await source.query(`SELECT * FROM \`${table}\``);snapshot[table]=records;}
  Object.assign(counts,await importLegacyRecords(target,snapshot));
 });
 await source.commit();console.log('MySQL → SQL Server migration committed and every record verified. Source MySQL was not modified.');console.log(JSON.stringify(counts));
 console.log('Set DB_CLIENT=mssql in .env, then start the application. Keep the MySQL database and a full backup until you verify the migration.');
}catch(error){await source?.rollback().catch(()=>{});console.error('Migration failed: '+error.message);process.exitCode=1;}finally{await source?.end();await target?.close();}
