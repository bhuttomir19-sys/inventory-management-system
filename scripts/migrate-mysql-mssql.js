import 'dotenv/config';
import mysql from 'mysql2/promise';
import {readFileSync}from'node:fs';
import {connectSqlServer}from'../mssql-storage.js';
import {isDeepStrictEqual}from'node:util';
const tables=['users','products','customers','vendors','settings','documents','movements','audit','sessions'];
const identity=new Set(['users','products','customers','vendors','documents','movements','audit']);
let source,target;
try{
 for(const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'])if(!process.env[key])throw Error(`Missing source ${key}. Keep your existing MySQL settings in .env.`);
 source=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,dateStrings:true,ssl:process.env.MYSQL_SSL==='true'?{rejectUnauthorized:true,...(process.env.MYSQL_SSL_CA?{ca:readFileSync(process.env.MYSQL_SSL_CA,'utf8')}:{})}:undefined});
 const [engines]=await source.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [process.env.MYSQL_DATABASE]);
 for(const table of tables)if(!engines.some(r=>r.TABLE_NAME===table&&r.ENGINE==='InnoDB'))throw Error(`Source table ${table} must exist and use InnoDB for a consistent snapshot.`);
 await source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await source.query('SET TRANSACTION READ ONLY');
 await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
 target=await connectSqlServer();const counts={};
 await target.transaction(async()=>{
  for(const table of tables)if((await target.prepare(`SELECT COUNT(*) n FROM ${table} WITH (UPDLOCK,HOLDLOCK)`).get()).n)throw Error(`Destination ${table} is not empty. Migration refused; use a new SQL Server database.`);
  for(const table of tables){
   const [records]=await source.query(`SELECT * FROM \`${table}\``);counts[table]=records.length;
   for(const record of records){
    if(identity.has(table)&&(!Number.isSafeInteger(record.id)||record.id<1||record.id>2147483647))throw Error(`Unsupported ID in ${table}; migration refused.`);
    const keys=Object.keys(record);if(!keys.every(k=>/^[A-Za-z][A-Za-z0-9]*$/.test(k)))throw Error('Unexpected source column');
    await target.prepare(`INSERT INTO ${table}(${keys.map(k=>'['+k+']').join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>record[k]));
   }
   const copied=await target.prepare(`SELECT * FROM ${table}`).all();
   const key=table==='sessions'?'token':'id';const sort=rows=>rows.map(r=>({...r})).sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
   if(!isDeepStrictEqual(sort(records),sort(copied)))throw Error(`Record verification failed for ${table}; transaction rolled back.`);
  }
 });
 await source.commit();console.log('MySQL → SQL Server migration committed and every record verified. Source MySQL was not modified.');console.log(JSON.stringify(counts));
 console.log('Set DB_CLIENT=mssql in .env, then start the application. Keep the MySQL database and a full backup until you verify the migration.');
}catch(error){await source?.rollback().catch(()=>{});console.error('Migration failed: '+error.message);process.exitCode=1;}finally{await source?.end();await target?.close();}
