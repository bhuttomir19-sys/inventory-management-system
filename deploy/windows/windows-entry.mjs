import {loadProductionConfig} from './runtime-config.mjs';
try{
 loadProductionConfig();
 const mode=process.argv[2]||'--start';
 if(mode==='--start')await import('./server.js');
 else if(mode==='--normalize')await import('./scripts/normalize-mssql.js');
 else if(mode==='--check-db'){
  const sql=(await import('mssql')).default;const{sqlServerConfig}=await import('./mssql-storage.js');
  const pool=await new sql.ConnectionPool(sqlServerConfig()).connect();
  try{
   const state=(await pool.request().query("SELECT COL_LENGTH('dbo.products','data') AS legacy, OBJECT_ID('dbo.users') AS usersTable, OBJECT_ID('dbo.schema_migrations') AS migrationsTable")).recordset[0];
   const users=state.usersTable?(await pool.request().query('SELECT COUNT(*) n FROM dbo.users')).recordset[0].n:0;
   const version=state.migrationsTable?(await pool.request().query('SELECT MAX(version) n FROM dbo.schema_migrations')).recordset[0].n:0;
   let records=0;for(const table of ['products','documents','customers','vendors','settings','finance_journals']){const exists=(await pool.request().input('table',sql.NVarChar(128),'dbo.'+table).query('SELECT OBJECT_ID(@table) id')).recordset[0].id;if(exists)records+=(await pool.request().query(`SELECT COUNT(*) n FROM dbo.${table}`)).recordset[0].n;}
   console.log(JSON.stringify({connected:true,legacy:state.legacy!==null,users,schemaVersion:version||0,businessRecords:records}));
  }finally{await pool.close();}
 }else if(mode==='--create-admin'){
  const {createFirstAdmin}=await import('./create-admin.mjs');await createFirstAdmin();
 }else throw Error('Unknown deployment command');
}catch(error){console.error(`Deployment command failed: ${error.code||error.message}`);process.exitCode=1;}
