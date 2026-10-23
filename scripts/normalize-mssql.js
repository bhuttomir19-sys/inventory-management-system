import 'dotenv/config';
import {connectSqlServer,initializeSqlServer} from '../mssql-storage.js';
import {importLegacyRecords,legacyTables} from '../migrate-relational.js';
// Explicit migration only. Stop all application writers and take a native backup first.
const db=await connectSqlServer(process.env,{initialize:false});
try{
 const result=await db.transaction(async()=>{
  const lock=await db.prepare("DECLARE @result INT; EXEC @result=sys.sp_getapplock @Resource=N'TradeflowSchemaMigration',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0; SELECT @result AS result").get();if(lock.result<0)throw Error('Another schema migration is running');
  const old=await db.prepare("SELECT COL_LENGTH('dbo.products','data') n").get();
  if(old.n===null){await initializeSqlServer(db);return null;}
  const snapshot={},identities={};
  for(const table of legacyTables){
   snapshot[table]=await db.prepare(`SELECT * FROM ${table} WITH (TABLOCKX,HOLDLOCK)`).all();
   const value=await db.prepare('SELECT last_value FROM sys.identity_columns WHERE object_id=OBJECT_ID(?)').get('dbo.'+table);if(value?.last_value!=null)identities[table]=Number(value.last_value);
  }
  for(const table of legacyTables)await db.exec(`EXEC sys.sp_rename N'dbo.${table}', N'__old_${table}', N'OBJECT'`);
  await initializeSqlServer(db);
  const counts=await importLegacyRecords(db,snapshot);
  for(const [table,last]of Object.entries(identities)){
   if(!Number.isSafeInteger(last)||last<0||last>2147483646)throw Error('Unsupported identity counter');
   const max=snapshot[table].reduce((maximum,row)=>Math.max(maximum,row.id),0);
   if(last>max)await db.exec(`DBCC CHECKIDENT ('dbo.${table}', RESEED, ${counts[table]?last:last+1}) WITH NO_INFOMSGS`);
  }
  // Remove the old tables only after every new row, invoice item and permission is verified.
  for(const table of ['sessions','movements','documents','settings','products','customers','vendors','users','audit'])await db.exec(`DROP TABLE dbo.__old_${table}`);
  return counts;
 });
 console.log(result?'Relational migration committed. Records, IDs, users, permissions and company settings verified.':'Database already uses relational schema. No business records were changed.');
 if(result)console.log(JSON.stringify(result));
}catch(error){console.error('Migration failed; transaction rolled back: '+error.message);process.exitCode=1;}finally{await db.close();}
