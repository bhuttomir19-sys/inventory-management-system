import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
export function hashPassword(p) { const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(p,salt,64).toString('hex'); }
export function verifyPassword(p,h) { const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex')); }
export function openDB(file='data/tradeflow.sqlite') {
 if(file!==':memory:') mkdirSync('data',{recursive:true});
 const db=new DatabaseSync(file); db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS vendors(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, productId INTEGER NOT NULL REFERENCES products(id), date TEXT NOT NULL, quantity REAL NOT NULL, reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, userId INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, date TEXT, actor TEXT, action TEXT, details TEXT);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);`);
 return db;
}
export const rows=(db,table)=>db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all().map(r=>r.data?{...JSON.parse(r.data),id:r.id,...(r.kind?{kind:r.kind,date:r.date}:{})}:r);
export const put=(db,table,data,id)=>{ if(id) db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(data),id);else id=Number(db.prepare(`INSERT INTO ${table}(data) VALUES(?)`).run(JSON.stringify(data)).lastInsertRowid);return id;};
export function createDocument(db,kind,input) {
 if(!['sales','purchases','payments','expenses','adjustments','cash'].includes(kind)) throw Error('Invalid transaction type');
 const date=input.date||new Date().toISOString().slice(0,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) throw Error('Invalid date');
 db.exec('BEGIN IMMEDIATE');
 try {
 let data={...input,date};if(['payments','cash'].includes(kind)&&!['received','paid'].includes(input.direction))throw Error('Invalid payment direction');if(kind==='adjustments'&&!['in','out'].includes(input.direction))throw Error('Invalid stock direction');
 if(['sales','purchases'].includes(kind)) {
 const table=kind==='sales'?'customers':'vendors';const party=rows(db,table).find(p=>p.id===Number(input.partyId));if(!party) throw Error('Select a valid customer or vendor');
 if(!input.items?.length) throw Error('Add at least one product'); let subtotal=0,cost=0;
 for(const item of input.items){const p=rows(db,'products').find(p=>p.id===Number(item.productId)); const qty=Number(item.quantity),rate=Number(item.rate);if(!p||!Number.isFinite(qty)||qty<=0||!Number.isFinite(rate)||rate<0) throw Error('Invalid product, quantity or rate');if(kind==='sales'&&qty>p.stock) throw Error(`Insufficient stock for ${p.name}`);subtotal+=qty*rate;cost+=qty*p.purchasePrice;
 if(kind==='purchases')p.purchasePrice=Math.round(((p.stock*p.purchasePrice+qty*rate)/(p.stock+qty))*100)/100;p.stock+=kind==='sales'?-qty:qty; put(db,'products',p,p.id);db.prepare('INSERT INTO movements(productId,date,quantity,reason) VALUES(?,?,?,?)').run(p.id,date,kind==='sales'?-qty:qty,kind);item.name=p.name;item.sku=p.sku; }
 const discount=Number(input.discount||0),tax=Number(input.tax||0),charges=Number(input.charges||0),paid=Number(input.paid||0);if([discount,tax,charges,paid].some(n=>!Number.isFinite(n)||n<0)||discount>subtotal||tax>100) throw Error('Invalid discount, tax, charges or payment');
 const total=Math.round(((subtotal-discount)*(1+tax/100)+charges)*100)/100;if(!Number.isFinite(total))throw Error('Invoice total is invalid');if(paid>total)throw Error('Paid amount exceeds invoice total');party.balance=Math.round((Number(party.balance||0)+total-paid)*100)/100;put(db,table,party,party.id);
 data={...data,partyId:party.id,partyName:party.name,subtotal,total,paid,outstanding:Math.round((total-paid)*100)/100,revenue:subtotal-discount+charges,cost,status:paid===total?'Paid':paid>0?'Partial':'Unpaid'};
 } else {
 const amount=Number(input.amount);if(!Number.isFinite(amount)||amount<=0) throw Error('Amount must be positive');data.total=amount;
 if(kind==='payments'){const table=input.direction==='received'?'customers':'vendors';const party=rows(db,table).find(p=>p.id===Number(input.partyId));if(!party)throw Error('Select a valid customer or vendor');if(amount>party.balance)throw Error('Payment exceeds outstanding balance');party.balance=Math.round((party.balance-amount)*100)/100;put(db,table,party,party.id);data.partyName=party.name;
 let remaining=amount;for(const doc of rows(db,'documents').reverse().filter(d=>d.kind===(table==='customers'?'sales':'purchases')&&d.partyId===party.id&&d.outstanding>0)){const applied=Math.min(remaining,doc.outstanding);doc.paid=Math.round((doc.paid+applied)*100)/100;doc.outstanding=Math.round((doc.outstanding-applied)*100)/100;doc.status=doc.outstanding===0?'Paid':'Partial';db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(doc),doc.id);remaining-=applied;if(remaining<=0)break;}}
 if(kind==='adjustments'){const p=rows(db,'products').find(p=>p.id===Number(input.productId));const q=input.direction==='in'?amount:-amount;if(!p||p.stock+q<0)throw Error('Invalid stock adjustment');p.stock+=q;put(db,'products',p,p.id);db.prepare('INSERT INTO movements(productId,date,quantity,reason) VALUES(?,?,?,?)').run(p.id,date,q,input.reason||'Adjustment');}
 }
 const id=Number(db.prepare('INSERT INTO documents(kind,date,data) VALUES(?,?,?)').run(kind,date,JSON.stringify(data)).lastInsertRowid);const config=db.prepare('SELECT data FROM settings WHERE id=1').get();const prefix=kind==='sales'?(config?JSON.parse(config.data).invoicePrefix||'INV':'INV'):{purchases:'PUR',payments:'PAY',expenses:'EXP',adjustments:'STK',cash:'CSH'}[kind];data.number=`${prefix}-${String(id).padStart(5,'0')}`;db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(data),id);db.exec('COMMIT');return {...data,id,kind};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function seed(db) {
 if(db.prepare('SELECT count(*) n FROM users').get().n)return;
 const all=['dashboard','products','inventory','customers','vendors','sales','purchases','finance','expenses','reports','admin'];
 db.prepare('INSERT INTO users(name,email,password,role,permissions) VALUES(?,?,?,?,?)').run('Alex Morgan','admin@tradeflow.local',hashPassword(process.env.ADMIN_PASSWORD||'Tradeflow2026!'),'Super Admin',JSON.stringify(Object.fromEntries(all.map(m=>[m,['view','add','edit','delete','print','export']]))));
 put(db,'settings',{company:'Tradeflow Trading Co.',email:'hello@tradeflow.local',phone:'+92 300 1234567',address:'Business Avenue, Karachi',currency:'USD',tax:5,invoicePrefix:'INV',registration:'TRD-2026-001'},1);
 if(!db.prepare('SELECT * FROM settings').get())db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({company:'Tradeflow Trading Co.',currency:'USD',tax:5}));
 const products=[['EL-001','Wireless Headphones','Electronics','Sony','Piece',55,89,12,85],['EL-002','Smart Watch Pro','Electronics','Samsung','Piece',110,179,10,42],['OF-003','Ergonomic Office Chair','Office supplies','Herman','Piece',145,245,8,24],['EL-004','USB-C Charging Cable','Electronics','Anker','Piece',6,15,25,180],['OF-005','Premium Notebook Set','Office supplies','Moleskine','Set',8,18,20,95],['HM-006','Insulated Water Bottle','Home & living','Hydro','Piece',12,29,15,62],['EL-007','Bluetooth Speaker','Electronics','JBL','Piece',38,69,10,7],['OF-008','Desk Organizer','Office supplies','Orbit','Piece',9,22,15,9],['EL-009','Portable Power Bank','Electronics','Anker','Piece',22,45,12,8]];
 for(const [sku,name,category,brand,unit,purchasePrice,sellingPrice,minStock,stock] of products)put(db,'products',{sku,name,category,brand,unit,purchasePrice,sellingPrice,minStock,stock,openingStock:stock,status:'Active',description:''});
 ['Acme Corporation','Westfield Retail','Brightline Solutions','Urban Market','Nexus Enterprises'].forEach((name,i)=>put(db,'customers',{name,company:name,contact:['Sarah Johnson','David Chen','Emma Wilson','James Miller','Olivia Brown'][i],email:`accounts${i}@example.com`,phone:'+1 555 0100',address:'Commercial District',registration:'',openingBalance:0,balance:0}));
 ['Global Supply Co.','TechSource Distribution','Premier Wholesale'].forEach((name,i)=>put(db,'vendors',{name,company:name,contact:'Procurement team',email:`vendor${i}@example.com`,phone:'+1 555 0200',address:'Industrial Estate',registration:'',openingBalance:0,balance:0}));
 const now=new Date();for(let m=5;m>=0;m--){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-m,12)).toISOString().slice(0,10);createDocument(db,'purchases',{date:d,partyId:1+(m%3),items:[{productId:1,quantity:20+m*3,rate:55},{productId:4,quantity:40,rate:6}],paid:600,tax:5});createDocument(db,'sales',{date:d,partyId:1+(m%5),items:[{productId:1,quantity:16+m*2,rate:89},{productId:4,quantity:30,rate:15}],paid:700,tax:5});createDocument(db,'expenses',{date:d,category:'Office & utilities',description:'Monthly operating expenses',amount:240+m*20,method:'Bank transfer'});}
 db.prepare('INSERT INTO audit(date,actor,action,details) VALUES(?,?,?,?)').run(new Date().toISOString(),'System','Workspace initialized','Demo records created');
}
