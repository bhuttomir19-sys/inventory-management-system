import 'dotenv/config';
import sql from 'mssql';
import {sqlServerConfig,connectSqlServer}from'../mssql-storage.js';
// Provision only the local development database. Remote servers are provisioned by their administrator.
const local=['127.0.0.1','localhost'].includes(process.env.MSSQL_HOST);
if(local&&process.env.MSSQL_SA_PASSWORD){
 const database=process.env.MSSQL_DATABASE,login=process.env.MSSQL_USER;
 if(!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(database||'')||!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(login||'')||login==='sa')throw Error('Use a valid dedicated application database and login.');
 const pool=await new sql.ConnectionPool(sqlServerConfig({...process.env,MSSQL_USER:'sa',MSSQL_PASSWORD:process.env.MSSQL_SA_PASSWORD},'master')).connect();
 try{
  await pool.request().input('database',sql.NVarChar(128),database).query("IF DB_ID(@database) IS NULL BEGIN DECLARE @statement NVARCHAR(MAX)=N'CREATE DATABASE '+QUOTENAME(@database); EXEC(@statement); END");
  await pool.request().input('login',sql.NVarChar(128),login).input('password',sql.NVarChar(128),process.env.MSSQL_PASSWORD).query("IF NOT EXISTS(SELECT 1 FROM sys.server_principals WHERE name=@login) BEGIN DECLARE @statement NVARCHAR(MAX)=N'CREATE LOGIN '+QUOTENAME(@login)+N' WITH PASSWORD='+QUOTENAME(@password,'''')+N', CHECK_POLICY=ON'; EXEC(@statement); END");
  await pool.request().input('login',sql.NVarChar(128),login).query(`USE [${database}]; IF NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE name=@login) BEGIN DECLARE @statement NVARCHAR(MAX)=N'CREATE USER '+QUOTENAME(@login)+N' FOR LOGIN '+QUOTENAME(@login)+N'; ALTER ROLE db_owner ADD MEMBER '+QUOTENAME(@login); EXEC(@statement); END`);
 }finally{await pool.close();}
}
const db=await connectSqlServer();try{const count=(await db.prepare('SELECT COUNT(*) n FROM users').get()).n;console.log(count?'SQL Server contains users; existing records preserved.':'SQL Server schema prepared. Migrate existing MySQL records before starting the application. For a new demo only, set MSSQL_ALLOW_INITIALIZE=true.');}finally{await db.close();}
