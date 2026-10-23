import {fields} from './relational-fields.js';

// These were unrelated defaults sent by the original shared frontend form.
const formFields=new Set(['date','status','unit','direction','method','discount','charges','paid','purchasePrice','sellingPrice','minStock','openingStock','openingBalance','tax','items','role','permissions']);
const placeholder=key=>['logoContent','receiptContent'].includes(key)?'CONVERT(VARBINARY(MAX), ?)':'?';
export function numeric(value,key){const number=Number(value??0);if(!Number.isFinite(number)||Math.abs(number)>Number.MAX_SAFE_INTEGER)throw Error(`Invalid or out-of-range ${key}`);if(Math.abs(number-Number(number.toFixed(8)))>Math.max(Number.EPSILON*Math.abs(number)*2,1e-12))throw Error(`${key} supports at most 8 decimal places`);return Number(number.toFixed(8));}
function image(value){if(!value)return {mime:null,content:null};const match=/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!match)throw Error('Invalid stored image');const content=Buffer.from(match[2],'base64');if(content.toString('base64')!==match[2])throw Error('Invalid image encoding');return {mime:match[1],content};}
const dataUri=(mime,content)=>content?`data:${mime};base64,${content.toString('base64')}`:'';
export function relationalValues(table,data,{strict=false}={}){
 const descriptor=fields[table];if(!descriptor)throw Error('Unknown relational table');
 if(strict)for(const [key,value]of Object.entries(data))if(!Object.hasOwn(descriptor,key)&&!['id','kind','partyId','logo','receipt','inventoryChange'].includes(key)&&!formFields.has(key)&&value!==undefined)throw Error(`Unmapped ${table}.${key}; migration stopped to prevent data loss`);
 const row={};for(const [key,type]of Object.entries(descriptor)){
  let value=data[key];
  if(type==='decimal')value=numeric(value,key);
  else if(type==='integer')value=value==null||value===''?null:Number(value);
  else if(type==='binary')value=value??null;
  else value=value==null||value===''?null:String(value);
  row[key]=value;
 }
 if(table==='products'){row.sku=row.sku?.trim()||null;row.status=row.status||'Active';}
 if(table==='settings'){row.currency=row.currency||'USD';const logo=image(data.logo);row.logoMime=logo.mime;row.logoContent=logo.content;}
 if(table==='documents'){
  const customer=data.kind==='sales'||(data.kind==='payments'&&data.direction==='received');
  const vendor=data.kind==='purchases'||(data.kind==='payments'&&data.direction==='paid');
  row.customerId=customer?Number(data.partyId??data.customerId):null;row.vendorId=vendor?Number(data.partyId??data.vendorId):null;
  const receipt=image(data.receipt?.data);row.receiptName=data.receipt?.name||null;row.receiptMime=receipt.mime;row.receiptContent=receipt.content;
 }
 return row;
}
export function relationalObject(table,row,items=[]){
 const record={...row};
 if(table==='settings'){record.logo=dataUri(row.logoMime,row.logoContent);delete record.logoMime;delete record.logoContent;}
 if(table==='documents'){
  record.partyId=row.customerId??row.vendorId??undefined;
  if(row.receiptContent)record.receipt={name:row.receiptName||'',data:dataUri(row.receiptMime,row.receiptContent)};
  for(const key of ['customerId','vendorId','receiptName','receiptMime','receiptContent'])delete record[key];
  if(['sales','purchases'].includes(row.kind))record.items=items.map(({documentId,lineNo,...item})=>item);
 }
 for(const key of Object.keys(record))if(record[key]==null)delete record[key];
 return record;
}
export async function relationalRows(db,table){
 if(!fields[table])throw Error('Unknown relational table');
 const lock=db.inTransaction?' WITH (UPDLOCK,HOLDLOCK)':'';
 const records=await db.prepare(`SELECT * FROM ${table}${lock} ORDER BY id DESC`).all();
 const items=table==='documents'?await db.prepare(`SELECT * FROM document_items${lock} ORDER BY documentId,[lineNo]`).all():[];
 const byDocument=new Map();for(const item of items){if(!byDocument.has(item.documentId))byDocument.set(item.documentId,[]);byDocument.get(item.documentId).push(item);}
 return records.map(row=>relationalObject(table,row,byDocument.get(row.id)));
}
export async function insertSqlRow(db,table,record){
 const keys=Object.keys(record);if(!keys.every(k=>/^[A-Za-z][A-Za-z0-9]*$/.test(k)))throw Error('Invalid database column');
 return db.prepare(`INSERT INTO ${table}(${keys.map(k=>`[${k}]`).join(',')}) VALUES(${keys.map(placeholder).join(',')})`).run(...keys.map(k=>record[k]));
}
export async function writeRelational(db,table,data,id,{insert=false,strict=false}={}){
 return db.transaction(async()=>{
  const record=relationalValues(table,data,{strict});const keys=Object.keys(record);
  if(id&&(!Number.isSafeInteger(Number(id))||id<1||id>2147483647))throw Error('Unsupported ID; migration refused');
  if(id&&!insert){
   const result=await db.prepare(`UPDATE ${table} SET ${keys.map(k=>`[${k}]=${placeholder(k)}`).join(',')} WHERE id=?`).run(...keys.map(k=>record[k]),id);
   if(!result.changes){if(table==='settings')await insertSqlRow(db,table,{id,...record});else throw Error('Record not found');}
  }else{id=Number((await insertSqlRow(db,table,{...(id?{id:Number(id)}:{}),...record})).lastInsertRowid)||Number(id);}
  if(table==='documents'){
   await db.prepare('DELETE FROM document_items WHERE documentId=?').run(id);
   if(!['sales','purchases'].includes(data.kind)&&data.items?.some(i=>i.productId))throw Error('Only invoices can contain product lines');
   if(['sales','purchases'].includes(data.kind)&&!data.items?.length)throw Error('Invoice requires product lines');
   for(const [index,item]of (['sales','purchases'].includes(data.kind)?data.items:[]).entries()){
    if(strict)for(const key of Object.keys(item))if(!['productId','name','sku','quantity','rate'].includes(key))throw Error(`Unmapped invoice line ${key}`);
    await insertSqlRow(db,'document_items',{documentId:id,lineNo:index+1,productId:Number(item.productId),name:item.name||null,sku:item.sku||null,quantity:numeric(item.quantity,'quantity'),rate:numeric(item.rate,'rate')});
   }
  }
  return id;
 });
}
export async function userPermissions(db,userId){
 const permissions={};for(const row of await db.prepare('SELECT module,action FROM user_permissions WHERE userId=? ORDER BY module,action').all(userId))(permissions[row.module]??=[]).push(row.action);return permissions;
}
export async function replacePermissions(db,userId,input){
 const permissions=typeof input==='string'?JSON.parse(input):input;
 if(!permissions||typeof permissions!=='object'||Array.isArray(permissions))throw Error('Permissions must be an object');
 const modules=new Set(['dashboard','products','inventory','customers','vendors','sales','purchases','finance','expenses','reports','admin']);
 await db.prepare('DELETE FROM user_permissions WHERE userId=?').run(userId);
 for(const [module,actions]of Object.entries(permissions)){
  if(!modules.has(module)||!Array.isArray(actions))throw Error('Invalid permissions module');
  for(const action of new Set(actions)){if(!['view','add','edit','delete','print','export'].includes(action))throw Error('Invalid permission action');await db.prepare('INSERT INTO user_permissions(userId,module,action) VALUES(?,?,?)').run(userId,module,action);}
 }
}
