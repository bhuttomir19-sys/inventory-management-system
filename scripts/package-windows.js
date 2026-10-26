import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,rmSync,readdirSync,lstatSync}from'node:fs';
import {join,resolve,dirname,basename}from'node:path';import{fileURLToPath}from'node:url';import{tmpdir}from'node:os';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';import AdmZip from'adm-zip';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const npm=process.env.npm_execpath;if(!npm)throw Error('Run with npm run package:windows');
const assets=JSON.parse(readFileSync(join(root,'deploy/windows/assets.json'),'utf8'));const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));const source=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const output=resolve(root,process.env.TRADEFLOW_PACKAGE_OUTPUT||'releases');const stage=join(output,'.windows-stage');const packageRoot=join(stage,'TradeflowERP');const cache=process.env.TRADEFLOW_ASSET_CACHE||join(tmpdir(),'tradeflow-package-assets');mkdirSync(cache,{recursive:true});mkdirSync(output,{recursive:true});
function command(file,args,cwd=root){const result=spawnSync(file,args,{cwd,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Packaging command failed: '+basename(file));}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function download(url,file,expected){const path=join(cache,file);if(existsSync(path)&&hash(path)===expected)return path;command(process.platform==='win32'?'curl.exe':'curl',['--fail','--location','--silent','--show-error',url,'--output',path]);if(hash(path)!==expected)throw Error('Official asset checksum mismatch: '+file);return path;}
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{const path=join(directory,item.name);if(item.isSymbolicLink())throw Error('Unexpected symlink in package: '+path);return item.isDirectory()?files(path):[path];});}
try{
 rmSync(stage,{recursive:true,force:true});mkdirSync(join(packageRoot,'app'),{recursive:true});
 command(process.execPath,[npm,'run','build']);
 const app=join(packageRoot,'app');const dependencies=Object.fromEntries(['dotenv','express','mssql','mysql2'].map(name=>[name,lock.packages['node_modules/'+name].version]));
 writeFileSync(join(app,'package.json'),JSON.stringify({name:source.name+'-server',version:source.version,private:true,type:'module',scripts:{start:'node --use-system-ca windows-entry.mjs'},dependencies},null,2)+'\n');
 const isolatedLock=structuredClone(lock);isolatedLock.name=source.name+'-server';isolatedLock.packages[''].name=source.name+'-server';isolatedLock.packages[''].dependencies=dependencies;delete isolatedLock.packages[''].devDependencies;writeFileSync(join(app,'package-lock.json'),JSON.stringify(isolatedLock,null,2));
 command(process.execPath,[npm,'install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],app);
 command(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],app);
 for(const path of filesIgnoringBins(join(app,'node_modules')))if(path.endsWith('.node'))throw Error('A platform-specific native dependency needs a Windows build: '+path);
 function filesIgnoringBins(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{const path=join(directory,item.name);if(item.name==='.bin'){rmSync(path,{recursive:true,force:true});return [];}if(item.isSymbolicLink())throw Error('Unexpected runtime dependency symlink');return item.isDirectory()?filesIgnoringBins(path):[path];});}
 const modules=['server.js','storage.js','sqlite.js','db.js','branding.js','sessions.js','origins.js','mssql-storage.js','relational.js','relational-fields.js','migrate-relational.js','finance.js','mysql-schema.sql','mssql-schema.sql'];
 for(const file of modules)cpSync(join(root,file),join(app,file));
 cpSync(join(root,'dist'),join(app,'dist'),{recursive:true});mkdirSync(join(app,'scripts'));cpSync(join(root,'scripts/normalize-mssql.js'),join(app,'scripts/normalize-mssql.js'));
 const deployment=join(root,'deploy/windows');for(const name of ['runtime-config.mjs','windows-entry.mjs','create-admin.mjs'])cpSync(join(deployment,name),join(app,name));
 for(const name of ['Install.ps1','Common.ps1','Update.ps1','Uninstall.ps1','Test-Deployment.ps1','Install.cmd','Update.cmd','web.config.template'])cpSync(join(deployment,name),join(packageRoot,name));
 cpSync(join(deployment,'README-FIRST.md'),join(packageRoot,'README-FIRST.md'));cpSync(join(root,'docs'),join(packageRoot,'docs'),{recursive:true});
 mkdirSync(join(packageRoot,'runtime'));mkdirSync(join(packageRoot,'service'));mkdirSync(join(packageRoot,'licenses'));
 const nodeZip=download(assets.node.url,`node-${assets.node.version}-win-x64.zip`,assets.node.sha256);const node=new AdmZip(nodeZip);const prefix=`node-${assets.node.version}-win-x64/`;
 for(const [entry,target]of [['node.exe','runtime/node.exe'],['LICENSE','licenses/Node-LICENSE.txt']]){const data=node.readFile(prefix+entry);if(!data)throw Error('Official Node archive layout changed');writeFileSync(join(packageRoot,target),data);}
 cpSync(download(assets.winsw.url,'WinSW.NET461.exe',assets.winsw.sha256),join(packageRoot,'service/WinSW.exe'));
 cpSync(download(assets.winsw.licenseUrl,'WinSW-LICENSE.txt',assets.winsw.licenseSha256),join(packageRoot,'licenses/WinSW-LICENSE.txt'));
 for(const dependency of ['react','react-dom','lucide-react'])cpSync(join(root,'node_modules',dependency,'LICENSE'),join(packageRoot,'licenses',dependency+'-LICENSE.txt'));
 writeFileSync(join(packageRoot,'licenses/ASSET-SOURCES.json'),JSON.stringify(assets,null,2)+'\n');
 const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});if(revision.status!==0)throw Error('Cannot identify source revision');
 const commit=revision.stdout.trim();const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});if(status.status!==0)throw Error('Cannot inspect source state');const sourceDirty=!!status.stdout.trim();writeFileSync(join(app,'release.json'),JSON.stringify({commit,sourceDirty,version:source.version},null,2)+'\n');const entries=files(packageRoot).map(path=>{const relative=path.slice(packageRoot.length+1).replaceAll('\\','/');if(/(^|\/)(?:\.env(?:\..*)?|\.git|data|\.npmrc)(?:\/|$)/.test(relative))throw Error('Private/local file unexpectedly included: '+relative);return{path:relative,size:lstatSync(path).size,sha256:hash(path)};}).sort((a,b)=>a.path.localeCompare(b.path));
 writeFileSync(join(packageRoot,'package-manifest.json'),JSON.stringify({name:'TradeflowERP',version:source.version,commit,sourceDirty,platform:'win32-x64',node:assets.node.version,winsw:assets.winsw.version,schemaVersion:3,createdAt:new Date().toISOString(),files:entries},null,2)+'\n');
 const zip=new AdmZip();zip.addLocalFolder(packageRoot,'TradeflowERP');const name=`TradeflowERP-Windows-x64-${source.version}-${commit.slice(0,7)}${sourceDirty?'-dirty':''}.zip`;const archive=join(output,name);zip.writeZip(archive);writeFileSync(archive+'.sha256',hash(archive)+'  '+name+'\n');
 console.log('Deployment ZIP: '+archive);console.log('SHA256: '+hash(archive));console.log('No local database, .env, credentials, Git metadata or demonstration records were copied.');
}catch(error){console.error('Packaging failed: '+error.message);process.exitCode=1;}
