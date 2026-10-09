import 'dotenv/config';
import {existsSync} from 'node:fs';
import {connectDatabase} from './storage.js';
import express from 'express';
import { validateBranding, publicBranding } from './branding.js';
import { sessionDuration, sessionToken, cookieOptions } from './sessions.js';
import { createServer as createHttpServer } from 'node:http';
import { publicOrigins, validOrigin } from './origins.js';
import { randomBytes } from 'node:crypto';
import { seed,rows,put,hashPassword,verifyPassword,createDocument } from './db.js';
const db=await connectDatabase();
if(db.driver==='mysql'&&existsSync(process.env.DB_PATH||'data/tradeflow.sqlite')&&!(await db.prepare('SELECT COUNT(*) n FROM users').get()).n){await db.close();throw Error('Existing SQLite data found. Stop the app and run npm run db:migrate before starting MySQL mode.');}
await db.transaction(()=>seed(db));
// Reserve a connection per API request. Buffer JSON until a write transaction commits.
function route(method,path,...handlers){
 const handler=handlers.pop();
 app[method](path,...handlers,async(req,res,next)=>{
  const send=res.json.bind(res);let payload,hasPayload=false;const rejected=Symbol('rejected');
  res.json=body=>{payload=body;hasPayload=true;return res;};
  try{await db.request(async()=>{await handler(req,res,error=>{if(error)throw error;});if(res.statusCode>=400)throw rejected;},{transaction:method!=='get'});res.json=send;if(hasPayload)send(payload);}
  catch(error){res.json=send;if(error===rejected&&hasPayload)send(payload);else next(error);}
 });
}
const configuredOrigins=publicOrigins();
function safeOrigin(value){try{return new URL(value).origin;}catch{return '(invalid origin)';}}
const app=express();const httpServer=createHttpServer(app);app.disable('x-powered-by');app.use(express.json({limit:'3mb'}));
app.use(async(req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');if(req.method!=='GET'&&!validOrigin(req,configuredOrigins))return res.status(403).json({error:`Invalid request origin. Received: ${safeOrigin(req.headers.origin)}. Expected: ${configuredOrigins.join(', ')||`${req.protocol}://${req.get('host')}`}.`,code:'ORIGIN_MISMATCH'});next();});
route('get','/api/health',async(req,res)=>{await db.prepare('SELECT 1').get();res.json({status:'ok',version:'codespaces-2',publicOrigins:configuredOrigins,database:db.driver});});
app.use('/api',async(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
route('get','/api/branding',async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(publicBranding(JSON.parse((await db.prepare('SELECT data FROM settings').get()).data)));});
const attempts=new Map();
route('post','/api/login',async(req,res)=>{const key=req.ip;const a=attempts.get(key)||{n:0,time:Date.now()};if(Date.now()-a.time>900000){a.n=0;a.time=Date.now();}if(a.n>=20)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});const user=await db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email||'').toLowerCase());if(!user||!verifyPassword(String(req.body.password||''),user.password)){a.n++;attempts.set(key,a);return res.status(401).json({error:'Email or password is incorrect'});}attempts.delete(key);const token=randomBytes(32).toString('hex');const duration=sessionDuration(req.body.remember);await db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());await db.prepare('INSERT INTO sessions(token,userId,expires,duration) VALUES(?,?,?,?)').run(token,user.id,Date.now()+duration,duration);res.cookie('session',token,{...cookieOptions(),maxAge:duration});res.json({ok:true});});
route('post','/api/logout',async(req,res)=>{await db.prepare('DELETE FROM sessions WHERE token=?').run(sessionToken(req));res.clearCookie('session',cookieOptions());res.setHeader('Cache-Control','no-store');res.json({ok:true});});
app.use('/api',async(req,res,next)=>{
 const token=sessionToken(req);const now=Date.now();
 const session=await db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,now);
 if(!session){res.clearCookie('session',cookieOptions());return res.status(401).json({error:'Your session has ended. Please sign in again.'});}
 req.user=await db.prepare('SELECT * FROM users WHERE id=?').get(session.userId);
 if(!req.user){await db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.clearCookie('session',cookieOptions());return res.status(401).json({error:'Your session has ended. Please sign in again.'});}
 if(session.expires-now<session.duration/2){await db.prepare('UPDATE sessions SET expires=? WHERE token=?').run(now+session.duration,token);res.cookie('session',token,{...cookieOptions(),maxAge:session.duration});}
 req.permissions=JSON.parse(req.user.permissions);req.token=token;next();
});
const permit=(module,action)=>async(req,res,next)=>req.permissions[module]?.includes(action)?next():res.status(403).json({error:'You do not have permission for this action'});
const audit=async(req,action,details)=>await db.prepare('INSERT INTO audit(date,actor,action,details) VALUES(?,?,?,?)').run(new Date().toISOString(),req.user.name,action,details);
route('get','/api/state',async(req,res)=>{const allowed=m=>req.permissions[m]?.includes('view');const docs=(await rows(db,'documents')).filter(d=>allowed(['payments','cash'].includes(d.kind)?'finance':d.kind==='adjustments'?'inventory':d.kind));res.json({database:db.driver,user:{id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role,permissions:req.permissions},products:allowed('products')||allowed('inventory')||allowed('sales')||allowed('purchases')?await rows(db,'products'):[],customers:allowed('customers')||allowed('sales')||allowed('finance')?await rows(db,'customers'):[],vendors:allowed('vendors')||allowed('purchases')||allowed('finance')?await rows(db,'vendors'):[],documents:docs,movements:allowed('inventory')?await db.prepare('SELECT * FROM movements ORDER BY id DESC').all():[],settings:JSON.parse((await db.prepare('SELECT data FROM settings').get()).data),users:allowed('admin')?(await db.prepare('SELECT id,name,email,role,permissions FROM users').all()).map(u=>({...u,permissions:JSON.parse(u.permissions)})):[],audit:allowed('admin')?await db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all():[]});});
route('post','/api/password',async(req,res,next)=>{try{if(!verifyPassword(String(req.body.current||''),req.user.password))throw Error('Current password is incorrect');if(typeof req.body.password!=='string'||req.body.password.length<10)throw Error('Use at least 10 characters');await db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(req.body.password),req.user.id);await db.prepare('DELETE FROM sessions WHERE userId=? AND token<>?').run(req.user.id,req.token);await audit(req,'Changed password','Other sessions revoked');res.json({ok:true});}catch(e){next(e);}});
for(const table of ['products','customers','vendors']){
 route('post',`/api/${table}`,permit(table,'add'),async(req,res,next)=>{try{const d={...req.body};if(!d.name?.trim())throw Error('Name is required');if(table==='products'){if(!d.sku?.trim())throw Error('SKU is required');if((await rows(db,table)).some(p=>p.sku.toLowerCase()===d.sku.toLowerCase()))throw Error('SKU already exists');for(const k of ['purchasePrice','sellingPrice','minStock','openingStock']){d[k]=Number(d[k]||0);if(!Number.isFinite(d[k])||d[k]<0)throw Error('Prices and stock must be nonnegative');}d.stock=d.openingStock;}else{d.openingBalance=Number(d.openingBalance||0);if(!Number.isFinite(d.openingBalance)||d.openingBalance<0)throw Error('Invalid opening balance');d.balance=d.openingBalance;}const id=await put(db,table,d);await audit(req,`Created ${table}`,d.name);res.json({id});}catch(e){next(e);}});
 route('put',`/api/${table}/:id`,permit(table,'edit'),async(req,res,next)=>{try{const old=(await rows(db,table)).find(r=>r.id===Number(req.params.id));if(!old)return res.status(404).json({error:'Record not found'});const d={...old,...req.body,id:old.id,stock:old.stock,balance:old.balance,openingStock:old.openingStock,openingBalance:old.openingBalance};if(!d.name?.trim())throw Error('Name is required');if(table==='products'){if(!d.sku?.trim()||(await rows(db,table)).some(p=>p.id!==old.id&&p.sku===d.sku))throw Error('SKU must be unique');for(const k of ['purchasePrice','sellingPrice','minStock']){d[k]=Number(d[k]);if(!Number.isFinite(d[k])||d[k]<0)throw Error('Invalid price or stock level');}}await put(db,table,d,old.id);await audit(req,`Updated ${table}`,d.name);res.json({ok:true});}catch(e){next(e);}});
 route('delete',`/api/${table}/:id`,permit(table,'delete'),async(req,res,next)=>{try{const id=Number(req.params.id);const linked=(await rows(db,'documents')).some(d=>table==='products'?d.items?.some(i=>Number(i.productId)===id)||Number(d.productId)===id:Number(d.partyId)===id&&(table==='customers'?d.kind==='sales'||d.direction==='received':d.kind==='purchases'||d.direction==='paid'));if(linked)throw Error('This record has transactions. Keep it for ledger accuracy.');await db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);await audit(req,`Deleted ${table}`,String(id));res.json({ok:true});}catch(e){next(e);}});
}
route('post','/api/documents/:kind',async(req,res,next)=>{try{const kind=req.params.kind,module=['payments','cash'].includes(kind)?'finance':kind==='adjustments'?'inventory':kind;if(!req.permissions[module]?.includes('add'))return res.status(403).json({error:'Permission denied'});const doc=await createDocument(db,kind,req.body);await audit(req,`Created ${kind}`,doc.number);res.json(doc);}catch(e){next(e);}});
route('put','/api/settings',permit('admin','edit'),async(req,res,next)=>{try{const old=JSON.parse((await db.prepare('SELECT data FROM settings').get()).data);const settings=validateBranding({...old,...req.body});await put(db,'settings',settings,1);await audit(req,'Updated company settings',settings.company);res.json({ok:true});}catch(e){next(e);}});
route('post','/api/users',permit('admin','add'),async(req,res,next)=>{try{const {name,email,password,role,permissions}=req.body;if(!name||!email?.includes('@')||password?.length<10)throw Error('Name, valid email and password of at least 10 characters required');await db.prepare('INSERT INTO users(name,email,password,role,permissions) VALUES(?,?,?,?,?)').run(name,email.toLowerCase(),hashPassword(password),role,JSON.stringify(permissions));await audit(req,'Created user',email);res.json({ok:true});}catch(e){next(e);}});
route('put','/api/users/:id',permit('admin','edit'),async(req,res,next)=>{try{if(Number(req.params.id)===req.user.id)throw Error('You cannot change your own role');const {name,role,permissions}=req.body;if(!name||!role)throw Error('Name and role required');await db.prepare('UPDATE users SET name=?,role=?,permissions=? WHERE id=?').run(name,role,JSON.stringify(permissions),Number(req.params.id));await db.prepare('DELETE FROM sessions WHERE userId=?').run(Number(req.params.id));await audit(req,'Updated user',name);res.json({ok:true});}catch(e){next(e);}});
route('delete','/api/users/:id',permit('admin','delete'),async(req,res,next)=>{try{if(Number(req.params.id)===req.user.id)throw Error('You cannot delete yourself');await db.prepare('DELETE FROM sessions WHERE userId=?').run(Number(req.params.id));await db.prepare('DELETE FROM users WHERE id=?').run(Number(req.params.id));await audit(req,'Deleted user',req.params.id);res.json({ok:true});}catch(e){next(e);}});
route('get','/api/backup',permit('admin','export'),async(req,res)=>{await audit(req,'Exported backup','Business data');res.attachment('tradeflow-backup.json').json({version:1,products:await rows(db,'products'),customers:await rows(db,'customers'),vendors:await rows(db,'vendors'),documents:await rows(db,'documents'),movements:await db.prepare('SELECT * FROM movements').all(),settings:JSON.parse((await db.prepare('SELECT data FROM settings').get()).data)});});
route('post','/api/restore',permit('admin','edit'),async(req,res,next)=>{try{const b=req.body;if(b.version!==1||!['products','customers','vendors','documents','movements'].every(k=>Array.isArray(b[k]))||!b.settings?.company)throw Error('Invalid backup file');b.settings=validateBranding(b.settings);for(const t of ['movements','documents','products','customers','vendors'])await db.exec(`DELETE FROM ${t}`);for(const t of ['products','customers','vendors'])for(const r of b[t])await db.prepare(`INSERT INTO ${t}(id,data) VALUES(?,?)`).run(r.id,JSON.stringify(r));for(const d of b.documents)await db.prepare('INSERT INTO documents(id,kind,date,data) VALUES(?,?,?,?)').run(d.id,d.kind,d.date,JSON.stringify(d));for(const m of b.movements)await db.prepare('INSERT INTO movements VALUES(?,?,?,?,?)').run(m.id,m.productId,m.date,m.quantity,m.reason);await put(db,'settings',b.settings,1);await audit(req,'Restored backup','Business data replaced');res.json({ok:true});}catch(e){next(e);}});
app.use('/api',async(req,res)=>res.status(404).json({error:'Endpoint not found'}));app.use((err,req,res,next)=>res.status(400).json({error:err.code==='ER_DUP_ENTRY'||err.message.includes('UNIQUE')?'This email or identifier already exists':err.message}));
let viteServer;
if(process.env.NODE_ENV==='production'){app.use(express.static('dist'));app.get('/{*path}',async(req,res)=>res.sendFile(process.cwd()+'/dist/index.html'));}else{const {createServer}=await import('vite');viteServer=await createServer({server:{middlewareMode:true,allowedHosts:configuredOrigins.map(origin=>new URL(origin).hostname),hmr:{server:httpServer,...(process.env.CODESPACES==='true'?{clientPort:443}:{})}},appType:'spa'});app.use(viteServer.middlewares);}
const port=Number(process.env.PORT||3000);
httpServer.on('error',error=>{
 console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Stop the older Tradeflow server before restarting.`:`Server startup failed: ${error.message}`);
 process.exit(1);
});
httpServer.listen(port,'0.0.0.0',error=>{
 if(error)return; // Node may pass a bind error to the callback; the error handler reports it.
 console.log('Tradeflow running on port '+port);
 console.log('Public origins: '+(configuredOrigins.join(', ')||'local address only; set APP_ORIGIN for an HTTPS proxy'));
});
let shuttingDown=false;
async function shutdown(){
 if(shuttingDown)return;shuttingDown=true;
 const timeout=setTimeout(()=>process.exit(0),5000);timeout.unref();
 await viteServer?.close();
 httpServer.close(async()=>{await db.close();process.exit(0);});
 httpServer.closeAllConnections();
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
