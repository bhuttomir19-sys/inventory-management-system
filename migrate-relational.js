import {isDeepStrictEqual} from 'node:util';
import {writeRelational,relationalValues,insertSqlRow,userPermissions,numeric} from './relational.js';
import {saveUser} from './db.js';
export const legacyTables=['users','products','customers','vendors','settings','documents','movements','audit','sessions'];
const identity=new Set(['users','products','customers','vendors','documents','movements','audit']);
const normalizedPermissions=value=>Object.fromEntries(Object.entries(typeof value==='string'?JSON.parse(value):value).filter(([,actions])=>actions.length).sort(([a],[b])=>a.localeCompare(b)).map(([key,actions])=>[key,[...new Set(actions)].sort()]));
function assertEqual(expected,actual,label){if(!isDeepStrictEqual(expected,actual))throw Error(`Verification failed for ${label}; migration rolled back`);}
function parseData(record,table){const data=JSON.parse(record.data);if(!data||typeof data!=='object'||Array.isArray(data))throw Error(`Invalid ${table} JSON object`);return {...data,id:record.id,...(table==='documents'?{kind:record.kind,date:record.date}:{})};}
export async function importLegacyRecords(db,snapshot){
 const counts={};
 for(const table of legacyTables){
  if(!Array.isArray(snapshot[table]))throw Error(`Missing source table ${table}`);counts[table]=snapshot[table].length;
  if((await db.prepare(`SELECT COUNT(*) n FROM ${table} WITH (UPDLOCK,HOLDLOCK)`).get()).n)throw Error(`Destination ${table} is not empty. Migration refused.`);
 }
 for(const table of legacyTables){
  for(const record of snapshot[table]){
   if(identity.has(table)&&(!Number.isSafeInteger(record.id)||record.id<1||record.id>2147483647))throw Error(`Unsupported ID in ${table}; migration refused`);
   if(table==='users'){
    await saveUser(db,record,record.id,{insert:true});const copied=await db.prepare('SELECT * FROM users WHERE id=?').get(record.id);const {permissions,...base}=record;assertEqual(base,copied,`users #${record.id}`);assertEqual(normalizedPermissions(permissions),normalizedPermissions(await userPermissions(db,record.id)),`user permissions #${record.id}`);
   }else if(['products','customers','vendors','settings','documents'].includes(table)){
    const data=parseData(record,table);await writeRelational(db,table,data,record.id,{insert:true,strict:true});
    const expected={id:record.id,...relationalValues(table,data,{strict:true})};
    const actual=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(record.id);assertEqual(expected,actual,`${table} #${record.id}`);
    if(table==='documents'&&['sales','purchases'].includes(record.kind)){
     const expectedItems=data.items.map((item,i)=>({documentId:record.id,lineNo:i+1,productId:Number(item.productId),name:item.name||null,sku:item.sku||null,quantity:numeric(item.quantity,'quantity'),rate:numeric(item.rate,'rate')}));
     assertEqual(expectedItems,await db.prepare('SELECT * FROM document_items WHERE documentId=? ORDER BY [lineNo]').all(record.id),`document items #${record.id}`);
    }
   }else{
    const normalized={...record};if(table==='audit'&&normalized.date)normalized.date=new Date(normalized.date).toISOString();if(table==='sessions'&&normalized.duration===undefined)normalized.duration=86400000;
    await insertSqlRow(db,table,normalized);
    const key=table==='sessions'?'token':'id';const copied=await db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(record[key]);assertEqual(normalized,copied,`${table} record`);
   }
  }
  assertEqual(snapshot[table].length,(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).n,`${table} row count`);
 }
 return counts;
}
