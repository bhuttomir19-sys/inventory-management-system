import{readFileSync}from'node:fs';import{resolve,basename}from'node:path';import{createHash}from'node:crypto';import AdmZip from'adm-zip';
const file=resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Usage: npm run package:verify -- path/to/package.zip');
const hash=data=>createHash('sha256').update(data).digest('hex');const zip=new AdmZip(file),entries=zip.getEntries(),prefix='TradeflowERP/';
const names=new Set();for(const entry of entries){if(!entry.entryName.startsWith(prefix)||entry.entryName.split('/').includes('..')||names.has(entry.entryName))throw Error('Unsafe or duplicate archive entry');names.add(entry.entryName);}
const metadata=JSON.parse(zip.readAsText(prefix+'package-manifest.json'));if(metadata.platform!=='win32-x64')throw Error('Wrong package platform');
const recorded=new Set();for(const item of metadata.files){const entry=zip.getEntry(prefix+item.path);if(!entry||entry.isDirectory)throw Error('Missing packaged file: '+item.path);const data=entry.getData();if(hash(data)!==item.sha256||data.length!==item.size)throw Error('File integrity failed: '+item.path);recorded.add(prefix+item.path);}
for(const entry of entries)if(!entry.isDirectory&&entry.entryName!==prefix+'package-manifest.json'&&!recorded.has(entry.entryName))throw Error('Unrecorded package file');
const node=zip.readFile(prefix+'runtime/node.exe');if(node.readUInt16LE(0)!==0x5a4d||node.readUInt16LE(node.readUInt32LE(0x3c)+4)!==0x8664)throw Error('Node binary is not Windows AMD64');
const manifest=JSON.parse(zip.readAsText(prefix+'app/package.json'));if(Object.keys(manifest.dependencies).sort().join(',')!=='dotenv,express,mssql,mysql2')throw Error('Unexpected server dependency set');
for(const name of names)if(/(?:^|\/)\.env(?:\.|\/|$)|(?:^|\/)\.git(?:\/|$)|^TradeflowERP\/app\/data\//.test(name)||name.endsWith('.node'))throw Error('Private/platform-specific file in payload');
for(const name of ['dm-sans.ttf','manrope.ttf'])if(!names.has(prefix+'app/dist/fonts/'+name))throw Error('Offline font missing');
const expected=readFileSync(file+'.sha256','utf8').trim().split(/\s+/);if(expected[0]!==hash(readFileSync(file))||expected[1]!==basename(file))throw Error('ZIP checksum sidecar mismatch');
console.log(JSON.stringify({status:'verified',files:metadata.files.length,node:metadata.node,commit:metadata.commit,sourceDirty:metadata.sourceDirty,sha256:expected[0]}));
