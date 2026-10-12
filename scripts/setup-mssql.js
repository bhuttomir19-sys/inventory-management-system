import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parse} from 'dotenv';
const file='.env';const text=existsSync(file)?readFileSync(file,'utf8'):'';const env=parse(text);
const password=()=>`Tf!9${randomBytes(24).toString('hex')}`;
const defaults={DB_CLIENT:'mssql',MSSQL_HOST:'127.0.0.1',MSSQL_PORT:'1433',MSSQL_DATABASE:'tradeflow',MSSQL_USER:'tradeflow',MSSQL_PASSWORD:password(),MSSQL_SA_PASSWORD:password(),MSSQL_ENCRYPT:'true',MSSQL_TRUST_SERVER_CERTIFICATE:'true'};
const additions=Object.entries(defaults).filter(([key])=>env[key]===undefined||env[key]==='').map(([key,value])=>`${key}=${value}`);
if(additions.length){writeFileSync(file,text+(text&&!text.endsWith('\n')?'\n':'')+additions.join('\n')+'\n',{mode:0o600});chmodSync(file,0o600);}
console.log('SQL Server settings prepared in ignored .env. Existing settings and MySQL credentials preserved; passwords not printed.');
if(env.DB_CLIENT&&env.DB_CLIENT!=='mssql')console.log('After migration, change DB_CLIENT=mssql in .env. Do not remove your MySQL settings.');
console.log('Next: npm run db:up; npm run db:prepare; stop the app and migrate your existing data with npm run db:migrate.');
