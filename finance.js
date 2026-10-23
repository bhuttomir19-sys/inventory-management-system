// Financial books use immutable, balanced postings rather than mutable invoice paid totals.
export const chart=[
 ['1000','Cash on hand','asset','Cash and bank','operating',1],['1010','Bank accounts','asset','Cash and bank','operating',1],
 ['1100','Accounts receivable','asset','Receivables','operating',0],['1200','Inventory','asset','Inventory','operating',0],['1300','Input tax recoverable','asset','Taxes','operating',0],['1400','Fixed assets','asset','Fixed assets','investing',0],['1490','Accumulated depreciation','asset','Fixed assets','investing',0],
 ['2000','Accounts payable','liability','Payables','operating',0],['2100','Output tax payable','liability','Taxes','operating',0],['2200','Loans payable','liability','Borrowings','financing',0],
 ['3000','Opening balance equity','equity','Opening equity','financing',0],['3100','Owner capital','equity','Capital','financing',0],['3200','Owner drawings','equity','Drawings','financing',0],
 ['4000','Sales revenue','income','Revenue','operating',0],['4100','Other income','income','Other income','operating',0],['4200','Stock adjustment gains','income','Other income','operating',0],
 ['5000','Cost of goods sold','expense','Cost of sales','operating',0],['5100','Purchase discounts','expense','Cost of sales','operating',0],['5200','Purchase freight and charges','expense','Cost of sales','operating',0],
 ['6000','Operating expenses','expense','Operating expenses','operating',0],['6100','Damaged stock and losses','expense','Operating expenses','operating',0],['6200','Depreciation expense','expense','Operating expenses','operating',0],['6300','Inventory valuation rounding','expense','Cost of sales','operating',0]
];
export const round=n=>{const value=Math.round((Number(n)+Number.EPSILON)*100)/100;return Object.is(value,-0)?0:value;};
const n=value=>Number(value||0);
export const financialDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export async function financialBooksActive(db){if(!db.financeConfigured)return false;if(db.financeActive)return true;db.financeActive=!!await db.prepare('SELECT id FROM finance_books WHERE id=1').get();return db.financeActive;}
const cashAccount=method=>String(method||'Cash').toLowerCase()==='cash'?'1000':'1010';
export async function initializeFinance(db){
 if(db.driver!=='mssql'){
  const mysql=db.driver==='mysql',id=mysql?'INT AUTO_INCREMENT PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT',money=mysql?'DECIMAL(28,8)':'REAL';
  for(const statement of [
   `CREATE TABLE IF NOT EXISTS finance_accounts(code VARCHAR(20) PRIMARY KEY,name VARCHAR(120) NOT NULL,type VARCHAR(20) NOT NULL,groupName VARCHAR(60) NOT NULL,cashFlow VARCHAR(20) NOT NULL,isCash INTEGER NOT NULL DEFAULT 0)`,
   `CREATE TABLE IF NOT EXISTS finance_books(id INTEGER PRIMARY KEY,startDate VARCHAR(10) NOT NULL,createdAt VARCHAR(40) NOT NULL)`,
   `CREATE TABLE IF NOT EXISTS finance_journals(id ${id},date VARCHAR(10) NOT NULL,reference VARCHAR(100) NOT NULL,description VARCHAR(255) NOT NULL,sourceType VARCHAR(20) NOT NULL,sourceId INTEGER,UNIQUE(sourceType,sourceId))`,
   `CREATE TABLE IF NOT EXISTS finance_lines(journalId INTEGER NOT NULL,lineNumber INTEGER NOT NULL,accountCode VARCHAR(20) NOT NULL,debit ${money} NOT NULL DEFAULT 0,credit ${money} NOT NULL DEFAULT 0,PRIMARY KEY(journalId,lineNumber),FOREIGN KEY(journalId) REFERENCES finance_journals(id),FOREIGN KEY(accountCode) REFERENCES finance_accounts(code))`
  ])await db.exec(statement);
 }
 await db.transaction(async()=>{for(const [code,name,type,groupName,cashFlow,isCash]of chart)if(!await db.prepare('SELECT code FROM finance_accounts WHERE code=?').get(code))await db.prepare('INSERT INTO finance_accounts(code,name,type,groupName,cashFlow,isCash) VALUES(?,?,?,?,?,?)').run(code,name,type,groupName,cashFlow,isCash);});
 db.financeConfigured=true;db.financeActive=!!await db.prepare('SELECT * FROM finance_books WHERE id=1').get();
}
export async function postJournal(db,{date,reference,description,sourceType='manual',sourceId=null,lines}){
 if(!financialDate(date))throw Error('Enter a valid journal date');
 const book=await db.prepare('SELECT * FROM finance_books WHERE id=1').get();
 if(book&&date<book.startDate)throw Error('Transaction date is before the financial books start date');
 if(!String(description||'').trim()||String(description).length>255)throw Error('Journal description is required (maximum 255 characters)');
 if(!Array.isArray(lines)||lines.length>100)throw Error('Use 2–100 journal lines');
 const clean=lines.map(line=>({accountCode:String(line.accountCode),debit:round(n(line.debit)),credit:round(n(line.credit))})).filter(line=>line.debit||line.credit);
 if(clean.length<2)throw Error('A journal requires at least two nonzero lines');
 for(const line of clean){if(!Number.isFinite(line.debit)||!Number.isFinite(line.credit)||Math.abs(line.debit)>1e12||Math.abs(line.credit)>1e12||line.debit<0||line.credit<0||line.debit&&line.credit)throw Error('Each line must have one positive debit or credit');if(!await db.prepare('SELECT code FROM finance_accounts WHERE code=?').get(line.accountCode))throw Error('Unknown ledger account');}
 if(Math.round(clean.reduce((s,l)=>s+l.debit-l.credit,0)*100)!==0)throw Error('Total debits must equal total credits');
 return db.transaction(async()=>{
  const result=await db.prepare('INSERT INTO finance_journals(date,reference,description,sourceType,sourceId) VALUES(?,?,?,?,?)').run(date,String(reference||'Journal').slice(0,100),description,sourceType,sourceId);
  const id=Number(result.lastInsertRowid);
  for(const [i,line]of clean.entries())await db.prepare('INSERT INTO finance_lines(journalId,lineNumber,accountCode,debit,credit) VALUES(?,?,?,?,?)').run(id,i+1,line.accountCode,line.debit,line.credit);
  return id;
 });
}
const line=(accountCode,amount)=>({accountCode,debit:amount>0?round(amount):0,credit:amount<0?round(-amount):0});
export async function openBooks(db,input,snapshot){
 if(await db.prepare('SELECT id FROM finance_books WHERE id=1').get())throw Error('Financial books are already initialized');
 if(!financialDate(input.date)||input.date>new Date().toISOString().slice(0,10))throw Error('Choose an opening balance date on or before today');
 if(snapshot.latestDate&&input.date<snapshot.latestDate)throw Error('Opening date must be on or after the latest existing transaction because its balances are already brought forward');
 const values={};for(const key of ['cash','bank','fixedAssets','depreciation','loans','inputTax','outputTax','capital']){values[key]=round(n(input[key]));if(!Number.isFinite(values[key])||values[key]<0||values[key]>1e12)throw Error('Opening amounts must be nonnegative and within supported limits');}
 if(values.depreciation>values.fixedAssets)throw Error('Accumulated depreciation exceeds fixed asset cost');
 const inventory=round(snapshot.products.reduce((s,p)=>s+n(p.stock)*n(p.purchasePrice),0)),receivables=round(snapshot.customers.reduce((s,p)=>s+n(p.balance),0)),payables=round(snapshot.vendors.reduce((s,p)=>s+n(p.balance),0));
 if(input.expectedSnapshot&&['inventory','receivables','payables'].some(key=>round(n(input.expectedSnapshot[key]))!==({inventory,receivables,payables})[key]))throw Error('Opening business balances changed. Refresh and verify them again.');
 const lines=[line('1000',values.cash),line('1010',values.bank),line('1100',receivables),line('1200',inventory),line('1300',values.inputTax),line('1400',values.fixedAssets),line('1490',-values.depreciation),line('2000',-payables),line('2100',-values.outputTax),line('2200',-values.loans),line('3100',-values.capital)];
 const difference=round(lines.reduce((s,l)=>s+l.debit-l.credit,0));lines.push(line('3000',-difference));
 // A zero workspace needs no artificial zero-value journal.
 if(lines.some(l=>l.debit||l.credit))await postJournal(db,{date:input.date,reference:'OPENING',description:'Opening balances verified at financial cutover',sourceType:'opening',sourceId:1,lines});
 await db.prepare('INSERT INTO finance_books(id,startDate,createdAt) VALUES(?,?,?)').run(1,input.date,new Date().toISOString());
 return {inventory,receivables,payables,openingEquity:difference};
}
export async function postMasterOpening(db,table,record,id){
 if(!await financialBooksActive(db))return;
 const value=table==='products'?round(n(record.openingStock)*n(record.purchasePrice)):round(n(record.openingBalance));if(!value)return;
 const account={products:'1200',customers:'1100',vendors:'2000'}[table],signed=table==='vendors'?-value:value;
 await postJournal(db,{date:record.date||new Date().toISOString().slice(0,10),reference:`OPEN-${table}-${id}`,description:`Opening balance: ${record.name}`,sourceType:table,sourceId:id,lines:[line(account,signed),line('3000',-signed)]});
}
export async function postDocument(db,kind,data,id){
 if(!await financialBooksActive(db))return;
 const cash=cashAccount(data.method);let lines=[];
 if(kind==='sales')lines=[line(cash,n(data.paid)),line('1100',n(data.total)-n(data.paid)),line('4000',-round(n(data.revenue))),line('2100',-round(n(data.total)-round(n(data.revenue)))),line('5000',n(data.cost)),line('1200',-n(data.cost))];
 if(kind==='purchases'){
  const inventory=round(data.inventoryChange??data.subtotal),base=round(n(data.subtotal)-n(data.discount)+n(data.charges));
  lines=[line('1200',inventory),line('5100',-n(data.discount)),line('5200',n(data.charges)),line('1300',round(n(data.total)-base)),line(cash,-n(data.paid)),line('2000',-(n(data.total)-n(data.paid))),line('6300',round(n(data.subtotal)-inventory))];
 }
 if(kind==='payments')lines=[line(cash,data.direction==='received'?n(data.total):-n(data.total)),line(data.direction==='received'?'1100':'2000',data.direction==='received'?-n(data.total):n(data.total))];
 if(kind==='expenses')lines=[line('6000',n(data.total)),line(cash,-n(data.total))];
 if(kind==='cash'){
  const counter=String(data.counterAccount||(data.direction==='received'?'4100':'6000'));
  if(['1000','1010','1100','1200','2000','3000'].includes(counter))throw Error('Use payments for customer/vendor balances, journals for transfers, or stock adjustments for inventory');
  lines=[line(cash,data.direction==='received'?n(data.total):-n(data.total)),line(counter,data.direction==='received'?-n(data.total):n(data.total))];
 }
 if(kind==='adjustments'){const value=round(n(data.cost));lines=data.direction==='in'?[line('1200',value),line('4200',-value)]:[line('6100',value),line('1200',-value)];}
 if(!lines.some(l=>l.debit||l.credit))return;
 await postJournal(db,{date:data.date,reference:data.number,description:String(data.description||data.partyName||`${kind} ${data.number}`).slice(0,255),sourceType:'document',sourceId:id,lines});
}
export function buildFinancialStatements(accounts,journals,lines,{from,to,startDate}){
 const accountMap=new Map(accounts.map(a=>[a.code,a]));const journalMap=new Map(journals.map(j=>[j.id,j]));
 const included=journals.filter(j=>j.date<=to),includedIds=new Set(included.map(j=>j.id));
 const period=journals.filter(j=>j.date>=from&&j.date<=to&&j.sourceType!=='opening'),periodIds=new Set(period.map(j=>j.id));
 const isOpening=j=>j.date<from||j.sourceType==='opening'&&j.date<=from;
 const trial=accounts.map(a=>{const all=lines.filter(l=>l.accountCode===a.code&&includedIds.has(l.journalId));const opening=round(all.filter(l=>isOpening(journalMap.get(l.journalId))).reduce((s,l)=>s+n(l.debit)-n(l.credit),0));const activity=all.filter(l=>!isOpening(journalMap.get(l.journalId)));const debit=round(activity.reduce((s,l)=>s+n(l.debit),0)),credit=round(activity.reduce((s,l)=>s+n(l.credit),0)),signed=round(all.reduce((s,l)=>s+n(l.debit)-n(l.credit),0));return {...a,opening,debit,credit,signed,balance:['asset','expense'].includes(a.type)?signed:(-signed||0)};});
 const profits=accounts.filter(a=>['income','expense'].includes(a.type)).map(a=>{const activity=lines.filter(l=>l.accountCode===a.code&&periodIds.has(l.journalId));const signed=round(activity.reduce((s,l)=>s+n(l.debit)-n(l.credit),0));return {...a,amount:a.type==='income'?(-signed||0):signed};});
 const sum=(list,key)=>round(list.reduce((s,a)=>s+n(a[key]),0));
 const revenue=sum(profits.filter(a=>a.type==='income'&&a.groupName==='Revenue'),'amount'),otherIncome=sum(profits.filter(a=>a.type==='income'&&a.groupName!=='Revenue'),'amount'),costOfSales=sum(profits.filter(a=>a.type==='expense'&&a.groupName==='Cost of sales'),'amount'),operatingExpenses=sum(profits.filter(a=>a.type==='expense'&&a.groupName!=='Cost of sales'),'amount');
 const retainedEarnings=round(-trial.filter(a=>['income','expense'].includes(a.type)).reduce((s,a)=>s+a.signed,0));
 const assets=trial.filter(a=>a.type==='asset'),liabilities=trial.filter(a=>a.type==='liability'),equity=trial.filter(a=>a.type==='equity');
 const cashFlow={operating:[],investing:[],financing:[]};
 const cashJournalIds=new Set(lines.filter(l=>accountMap.get(l.accountCode)?.isCash&&periodIds.has(l.journalId)).map(l=>l.journalId));
 for(const a of accounts.filter(a=>!a.isCash)){
  const amount=round(lines.filter(l=>l.accountCode===a.code&&cashJournalIds.has(l.journalId)).reduce((s,l)=>s+n(l.credit)-n(l.debit),0));if(amount)cashFlow[a.cashFlow||'operating'].push({code:a.code,name:a.name,amount});
 }
 const closingCash=sum(trial.filter(a=>a.isCash),'signed');const openingCash=round(lines.filter(l=>accountMap.get(l.accountCode)?.isCash&&includedIds.has(l.journalId)&&isOpening(journalMap.get(l.journalId))).reduce((s,l)=>s+n(l.debit)-n(l.credit),0));
 const netCashFlow=round(Object.values(cashFlow).flat().reduce((s,a)=>s+a.amount,0));
 const months=new Map();for(const j of period){const key=j.date.slice(0,7);if(!months.has(key))months.set(key,{month:key,inflow:0,outflow:0,profit:0});}
 for(const l of lines.filter(l=>periodIds.has(l.journalId))){const j=journalMap.get(l.journalId),bucket=months.get(j.date.slice(0,7)),a=accountMap.get(l.accountCode);if(['income','expense'].includes(a.type))bucket.profit+=n(l.credit)-n(l.debit);}
 for(const j of period){const net=round(lines.filter(l=>l.journalId===j.id&&accountMap.get(l.accountCode)?.isCash).reduce((s,l)=>s+n(l.debit)-n(l.credit),0));const month=months.get(j.date.slice(0,7));month.inflow+=Math.max(0,net);month.outflow+=Math.max(0,-net);}
 const ledger=lines.filter(l=>periodIds.has(l.journalId)).map(l=>{const j=journalMap.get(l.journalId),a=accountMap.get(l.accountCode);return {...l,date:j.date,reference:j.reference,description:j.description,sourceType:j.sourceType,accountName:a.name,accountType:a.type};}).sort((a,b)=>a.date.localeCompare(b.date)||a.journalId-b.journalId||a.lineNumber-b.lineNumber);
 return {from,to,startDate,accounts,trial,profitLoss:{accounts:profits,revenue,otherIncome,costOfSales,grossProfit:round(revenue-costOfSales),operatingExpenses,netProfit:round(revenue-costOfSales+otherIncome-operatingExpenses)},balanceSheet:{assets,liabilities,equity,retainedEarnings,totalAssets:sum(assets,'balance'),totalLiabilities:sum(liabilities,'balance'),totalEquity:round(sum(equity,'balance')+retainedEarnings),difference:round(sum(assets,'balance')-sum(liabilities,'balance')-sum(equity,'balance')-retainedEarnings)},cashFlow:{...cashFlow,openingCash,closingCash,netCashFlow,difference:round(closingCash-openingCash-netCashFlow)},months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),ledger};
}
export async function financialState(db,{from,to}={}){
 const book=await db.prepare('SELECT * FROM finance_books WHERE id=1').get();const accounts=await db.prepare('SELECT * FROM finance_accounts ORDER BY code').all();
 if(!book)return {initialized:false,accounts};
 from=from||book.startDate;to=to||new Date().toISOString().slice(0,10);
 if(!financialDate(from)||!financialDate(to)||from>to||from<book.startDate)throw Error('Choose a valid period on or after the financial books start date');
 const journals=await db.prepare('SELECT * FROM finance_journals WHERE date<=? ORDER BY date,id').all(to);const lines=await db.prepare('SELECT * FROM finance_lines').all();
 return {initialized:true,...buildFinancialStatements(accounts,journals,lines,{from,to,startDate:book.startDate})};
}
