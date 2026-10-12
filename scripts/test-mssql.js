import 'dotenv/config';import sql from'mssql';import{sqlServerConfig}from'../mssql-storage.js';import{spawn}from'node:child_process';import{once}from'node:events';
// Use an isolated, unique database. The application database is never cleared.
const local=['127.0.0.1','localhost'].includes(process.env.MSSQL_HOST);
const user=process.env.MSSQL_TEST_USER||(local&&process.env.MSSQL_SA_PASSWORD?'sa':process.env.MSSQL_USER);
const password=process.env.MSSQL_TEST_PASSWORD||(user==='sa'?process.env.MSSQL_SA_PASSWORD:process.env.MSSQL_PASSWORD);
const pool=await new sql.ConnectionPool(sqlServerConfig({...process.env,MSSQL_USER:user,MSSQL_PASSWORD:password},'master')).connect();
const database='tradeflow_test_'+Date.now();
try{
 await pool.request().query(`CREATE DATABASE [${database}]`);
 const child=spawn(process.execPath,['--test','tests/mssql.integration.js'],{stdio:'inherit',env:{...process.env,DB_CLIENT:'mssql',MSSQL_DATABASE:database,MSSQL_USER:user,MSSQL_PASSWORD:password,MSSQL_ALLOW_INITIALIZE:'true',ADMIN_PASSWORD:'Tradeflow2026!'}});
 const[code]=await once(child,'exit');process.exitCode=code||0;
}finally{await pool.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);await pool.close();}
