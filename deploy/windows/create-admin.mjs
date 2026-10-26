import {connectSqlServer} from './mssql-storage.js';
import {saveUser,put,hashPassword} from './db.js';
import {initializeFinance} from './finance.js';
import {readFileSync} from 'node:fs';
export async function createFirstAdmin(){
 const input=JSON.parse(readFileSync(0,'utf8').replace(/^\uFEFF/,''));
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email||'')||input.email.length>254)throw Error('Enter a valid administrator email');
 if(typeof input.password!=='string'||input.password.length<14||input.password.length>256)throw Error('Administrator password must contain 14–256 characters');
 if(typeof input.company!=='string'||!input.company.trim()||input.company.trim().length>120)throw Error('Company name must contain 1–120 characters');
 if(!/^[A-Z]{3}$/.test(input.currency||''))throw Error('Use a three-letter currency code');
 const db=await connectSqlServer();
 try{await initializeFinance(db);await db.transaction(async()=>{
  if((await db.prepare('SELECT COUNT(*) n FROM users WITH (UPDLOCK,HOLDLOCK)').get()).n)throw Error('Users already exist; administrator creation refused');
  for(const table of ['products','documents','customers','vendors','settings','finance_journals'])if((await db.prepare(`SELECT COUNT(*) n FROM ${table} WITH (UPDLOCK,HOLDLOCK)`).get()).n)throw Error('Existing company records detected without users. Ask IT to recover access instead of resetting them');
  const modules=['dashboard','products','inventory','customers','vendors','sales','purchases','finance','expenses','reports','admin'];
  await saveUser(db,{name:'Administrator',email:input.email.toLowerCase(),password:hashPassword(input.password),role:'Super Admin',permissions:Object.fromEntries(modules.map(m=>[m,['view','add','edit','delete','print','export']]))});
  await put(db,'settings',{company:input.company.trim(),appName:input.company.trim().slice(0,60),currency:input.currency,tax:0,invoicePrefix:'INV'},1);
 });console.log('Administrator and company created. No demonstration records were added.');}finally{await db.close();}
}
