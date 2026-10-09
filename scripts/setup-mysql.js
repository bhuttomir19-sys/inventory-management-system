import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parse} from 'dotenv';
const file='.env';const text=existsSync(file)?readFileSync(file,'utf8'):'';const env=parse(text);
const defaults={DB_CLIENT:'mysql',MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'3306',MYSQL_DATABASE:'tradeflow',MYSQL_USER:'tradeflow',MYSQL_PASSWORD:randomBytes(24).toString('hex'),MYSQL_ROOT_PASSWORD:randomBytes(24).toString('hex')};
const additions=Object.entries(defaults).filter(([key])=>env[key]===undefined||env[key]==='').map(([key,value])=>`${key}=${value}`);
if(additions.length)writeFileSync(file,text+(text&&!text.endsWith('\n')?'\n':'')+additions.join('\n')+'\n',{mode:0o600});
console.log('MySQL settings prepared in ignored .env. Existing values were preserved; passwords were not printed.');
console.log('Next: npm run db:up; stop the app before migrating, then npm run db:migrate.');

if(env.DB_CLIENT&&env.DB_CLIENT!=='mysql')console.log('Your existing DB_CLIENT was preserved. Set DB_CLIENT=mysql in .env to switch the application.');
