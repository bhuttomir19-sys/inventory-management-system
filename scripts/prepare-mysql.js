import 'dotenv/config';import{existsSync}from'node:fs';import{spawn}from'node:child_process';import{once}from'node:events';import{connectDatabase}from'../storage.js';
const db=await connectDatabase();let populated;try{if(db.driver!=='mysql')throw Error('Set DB_CLIENT=mysql in .env');populated=Number((await db.prepare('SELECT COUNT(*) n FROM users').get()).n)>0;}finally{await db.close();}
const source=process.env.SQLITE_SOURCE||process.env.DB_PATH||'data/tradeflow.sqlite';
if(populated)console.log('MySQL already contains users. Existing records were preserved.');
else if(existsSync(source)){const child=spawn(process.execPath,['scripts/migrate-sqlite.js',source],{stdio:'inherit',env:process.env});const[code]=await once(child,'exit');process.exitCode=code||0;}
else console.log('MySQL schema prepared. No SQLite source found; first application startup will initialize a fresh workspace.');
