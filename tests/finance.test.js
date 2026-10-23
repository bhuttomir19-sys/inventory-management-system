import test from'node:test';import assert from'node:assert/strict';
import{connectDatabase}from'../storage.js';import{put,rows,createDocument}from'../db.js';
import{initializeFinance,openBooks,postJournal,financialState}from'../finance.js';
async function fixture(){const db=await connectDatabase({DB_CLIENT:'sqlite',DB_PATH:':memory:'});await initializeFinance(db);const productId=await put(db,'products',{name:'Widget',sku:'FIN-1',openingStock:10,stock:10,purchasePrice:5,sellingPrice:10});const customerId=await put(db,'customers',{name:'Buyer',openingBalance:20,balance:20});const vendorId=await put(db,'vendors',{name:'Supplier',openingBalance:30,balance:30});const snapshot={products:await rows(db,'products'),customers:await rows(db,'customers'),vendors:await rows(db,'vendors')};await db.transaction(()=>openBooks(db,{date:'2026-01-01',cash:100,bank:1000,capital:1000},snapshot));return{db,productId,customerId,vendorId};}
test('Accrual P&L, historical receivables and cash flow do not count invoice settlements twice',async()=>{
 const{db,productId,customerId}=await fixture();try{
  const sale=await createDocument(db,'sales',{date:'2026-01-02',partyId:customerId,items:[{productId,quantity:2,rate:10}],discount:2,charges:1,tax:10,paid:5,method:'Bank transfer'});assert.equal(sale.total,20.8);
  await createDocument(db,'payments',{date:'2026-02-01',partyId:customerId,direction:'received',amount:15.8,method:'Bank transfer'});
  assert.equal((await rows(db,'documents')).find(d=>d.kind==='sales').paid,20.8);
  const jan=await financialState(db,{from:'2026-01-01',to:'2026-01-31'});assert.equal(jan.cashFlow.netCashFlow,5);assert.equal(jan.profitLoss.netProfit,9);assert.equal(jan.trial.find(a=>a.code==='1100').balance,35.8);
  const feb=await financialState(db,{from:'2026-02-01',to:'2026-02-28'});assert.equal(feb.cashFlow.netCashFlow,15.8);assert.equal(feb.cashFlow.openingCash,1105);assert.equal(feb.profitLoss.netProfit,0);
  const all=await financialState(db,{from:'2026-01-01',to:'2026-02-28'});assert.equal(all.cashFlow.netCashFlow,20.8);assert.equal(all.balanceSheet.difference,0);assert.equal(all.cashFlow.difference,0);assert.equal(all.trial.find(a=>a.code==='2100').balance,1.8);
 }finally{await db.close();}
});
test('Balanced statements separate capital, drawings, loans, assets, transfers, tax and noncash depreciation',async()=>{
 const{db,productId,customerId,vendorId}=await fixture();try{
  await createDocument(db,'sales',{date:'2026-01-02',partyId:customerId,items:[{productId,quantity:2,rate:10}],discount:2,charges:1,tax:10,paid:5,method:'Bank transfer'});
  await createDocument(db,'payments',{date:'2026-02-01',partyId:customerId,direction:'received',amount:15.8,method:'Bank transfer'});
  await createDocument(db,'purchases',{date:'2026-03-01',partyId:vendorId,items:[{productId,quantity:2,rate:6}],discount:1,charges:2,tax:10,paid:5,method:'Bank transfer'});
  await createDocument(db,'payments',{date:'2026-03-02',partyId:vendorId,direction:'paid',amount:9.1,method:'Bank transfer'});
  await createDocument(db,'expenses',{date:'2026-03-03',amount:3,method:'Bank transfer',description:'Office'});
  await createDocument(db,'cash',{date:'2026-03-04',amount:200,direction:'received',method:'Cash',counterAccount:'3100',description:'Owner contribution'});
  await createDocument(db,'cash',{date:'2026-03-05',amount:50,direction:'paid',method:'Cash',counterAccount:'3200',description:'Owner withdrawal'});
  for(const [description,lines]of [
   ['Buy equipment',[{accountCode:'1400',debit:100},{accountCode:'1010',credit:100}]],
   ['Bank transfer',[{accountCode:'1010',debit:20},{accountCode:'1000',credit:20}]],
   ['Loan proceeds',[{accountCode:'1010',debit:100},{accountCode:'2200',credit:100}]],
   ['Depreciation',[{accountCode:'6200',debit:20},{accountCode:'1490',credit:20}]]
  ])await postJournal(db,{date:'2026-03-06',description,lines});
  const data=await financialState(db,{from:'2026-01-01',to:'2026-03-31'});assert.equal(data.profitLoss.netProfit,-15);assert.equal(data.balanceSheet.totalAssets,1406.8);assert.equal(data.balanceSheet.totalLiabilities,131.8);assert.equal(data.balanceSheet.totalEquity,1275);assert.equal(data.balanceSheet.difference,0);
  assert.equal(data.cashFlow.openingCash,1100);assert.equal(data.cashFlow.closingCash,1253.7);assert.equal(data.cashFlow.netCashFlow,153.7);assert.equal(data.cashFlow.difference,0);
  const sum=rows=>Math.round(rows.reduce((s,r)=>s+r.amount,0)*100)/100;assert.equal(sum(data.cashFlow.operating),3.7);assert.equal(sum(data.cashFlow.investing),-100);assert.equal(sum(data.cashFlow.financing),250);
  assert.equal(data.trial.find(a=>a.code==='1300').balance,1.1);assert.equal(data.trial.find(a=>a.code==='1200').balance,52);
  const march=data.months.find(m=>m.month==='2026-03');assert.equal(Math.round(march.inflow*100)/100,300); // capital + loan; internal transfer excluded
 }finally{await db.close();}
});
test('Failed journal and pre-cutover business transaction roll back, opening cannot be repeated',async()=>{
 const{db,productId,customerId}=await fixture();try{
  const count=(await db.prepare('SELECT COUNT(*) n FROM finance_journals').get()).n;
  await assert.rejects(()=>postJournal(db,{date:'2026-01-02',description:'Unbalanced',lines:[{accountCode:'1000',debit:10},{accountCode:'3100',credit:9}]}),/equal/);
  await assert.rejects(()=>createDocument(db,'sales',{date:'2025-12-31',partyId:customerId,items:[{productId,quantity:1,rate:10}],paid:0}),/before/);
  assert.equal((await rows(db,'products'))[0].stock,10);assert.equal((await rows(db,'documents')).length,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM finance_journals').get()).n,count);
  await assert.rejects(()=>db.transaction(()=>openBooks(db,{date:'2026-01-01'},{products:[],customers:[],vendors:[]})),/already/);
  await assert.rejects(()=>financialState(db,{from:'2025-01-01',to:'2026-01-01'}),/valid period/);
 }finally{await db.close();}
});
test('Purchase average-cost rounding reconciles to inventory, and new master openings post to equity',async()=>{
 const{db,productId,vendorId}=await fixture();try{
  await createDocument(db,'purchases',{date:'2026-02-01',partyId:vendorId,items:[{productId,quantity:5,rate:10}],paid:0});
  await put(db,'products',{name:'New opening stock',sku:'FIN-NEW',date:'2026-02-01',openingStock:2,stock:2,purchasePrice:3});
  const data=await financialState(db,{from:'2026-01-01',to:'2026-02-28'});assert.equal(data.trial.find(a=>a.code==='1200').balance,106.05);assert.equal(data.balanceSheet.difference,0);assert.equal(data.profitLoss.costOfSales,-.05);
 }finally{await db.close();}
});
