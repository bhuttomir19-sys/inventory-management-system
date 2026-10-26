import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
export const appRoot=dirname(fileURLToPath(import.meta.url));
export function loadProductionConfig(file=process.env.TRADEFLOW_CONFIG){
 if(!file)throw Error('Set TRADEFLOW_CONFIG to the protected appsettings.json file');
 const config=JSON.parse(readFileSync(resolve(file),'utf8').replace(/^\uFEFF/,''));
 const url=new URL(config.APP_ORIGIN);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.origin!==config.APP_ORIGIN)throw Error('APP_ORIGIN must be an HTTPS origin without a trailing slash or path');
 for(const key of ['MSSQL_HOST','MSSQL_DATABASE','MSSQL_USER','MSSQL_PASSWORD'])if(typeof config[key]!=='string'||!config[key].trim())throw Error(`Missing ${key} in protected configuration`);
 for(const [key,fallback]of [['PORT',3000],['MSSQL_PORT',1433]]){const value=Number(config[key]??fallback);if(!Number.isInteger(value)||value<1||value>65535)throw Error(`Invalid ${key}`);config[key]=String(value);}
 if(config.MSSQL_TRUST_SERVER_CERTIFICATE!==undefined&&!['true','false',true,false].includes(config.MSSQL_TRUST_SERVER_CERTIFICATE))throw Error('Invalid SQL certificate setting');
 for(const key of ['APP_ORIGIN','PORT','MSSQL_HOST','MSSQL_PORT','MSSQL_DATABASE','MSSQL_USER','MSSQL_PASSWORD','MSSQL_TRUST_SERVER_CERTIFICATE'])if(config[key]!==undefined)process.env[key]=String(config[key]);
 Object.assign(process.env,{NODE_ENV:'production',DB_CLIENT:'mssql',BIND_HOST:'127.0.0.1',COOKIE_SECURE:'true',MSSQL_ENCRYPT:'true',MSSQL_ALLOW_INITIALIZE:'false',CODESPACES:'false'});
 process.env.MSSQL_TRUST_SERVER_CERTIFICATE=String(config.MSSQL_TRUST_SERVER_CERTIFICATE??false);
 for(const key of ['ADMIN_PASSWORD','DOTENV_CONFIG_PATH','DOTENV_CONFIG_OVERRIDE','DOTENV_KEY'])delete process.env[key];
 const releaseFile=join(appRoot,'release.json');if(existsSync(releaseFile)){const release=JSON.parse(readFileSync(releaseFile,'utf8'));if(!/^[a-f0-9]{40}$/.test(release.commit||''))throw Error('Invalid packaged release metadata');process.env.APP_RELEASE=release.commit;}else delete process.env.APP_RELEASE;
 process.chdir(appRoot);
 return config;
}
