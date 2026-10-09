const sum=(rows,key='total')=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const number=d=>d.number||`${{sales:'INV',purchases:'PUR',payments:'PAY',expenses:'EXP',adjustments:'STK',cash:'CSH'}[d.kind]}-${String(d.id).padStart(5,'0')}`;
const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function filterReportRows(rows,search=''){
 const terms=normalize(search).split(' ').filter(Boolean);
 return terms.length?rows.filter(row=>{const text=normalize(Object.values(row).join(' '));return terms.every(term=>text.includes(term));}):rows;
}
export function buildReportRows(s,tab,{dates={},search='',filter='All',sort='Newest'}={}){
 // Apply date/status constraints before aggregation; search the resulting visible rows.
 const docs=s.documents.filter(d=>(!dates.from||d.date>=dates.from)&&(!dates.to||d.date<=dates.to)&&(filter==='All'||d.status===filter||d.category===filter||d.method===filter));
 const sales=docs.filter(d=>d.kind==='sales'),purchases=docs.filter(d=>d.kind==='purchases'),expenses=docs.filter(d=>d.kind==='expenses');
 let rows;
 if(tab==='Inventory')rows=s.products.map(p=>({SKU:p.sku,Product:p.name,Stock:p.stock,Cost:p.purchasePrice,Value:p.stock*p.purchasePrice,Minimum:p.minStock}));
 else if(tab==='Stock movements')rows=s.movements.filter(m=>(!dates.from||m.date>=dates.from)&&(!dates.to||m.date<=dates.to)).map(m=>({Date:m.date,Product:s.products.find(p=>p.id===m.productId)?.name||'Unknown product',Quantity:m.quantity,Reason:m.reason}));
 else if(['Receivables','Payables'].includes(tab))rows=s[tab==='Receivables'?'customers':'vendors'].filter(p=>p.balance>0).map(p=>({Name:p.name,Email:p.email,Outstanding:p.balance}));
 else if(['Customer ledger','Vendor ledger'].includes(tab)){
  const type=tab==='Customer ledger'?'customers':'vendors';
  rows=s[type].flatMap(p=>[{Date:'Opening balance',Party:p.name,Reference:'Opening',Debit:p.openingBalance,Credit:0},...docs.filter(d=>Number(d.partyId)===p.id&&(type==='customers'?d.kind==='sales'||d.kind==='payments'&&d.direction==='received':d.kind==='purchases'||d.kind==='payments'&&d.direction==='paid')).map(d=>({Date:d.date,Party:p.name,Reference:number(d),Debit:d.kind==='payments'?0:d.total,Credit:d.kind==='payments'?d.total:d.paid}))]);
 }else if(tab==='Profit & loss'){
  const revenue=sales.reduce((a,d)=>a+Number(d.revenue??(d.subtotal-Number(d.discount||0)+Number(d.charges||0))),0);
  rows=[{Account:'Sales revenue',Amount:revenue},{Account:'Cost of goods sold',Amount:-sum(sales,'cost')},{Account:'Operating expenses',Amount:-sum(expenses)},{Account:'Net profit / loss',Amount:revenue-sum(sales,'cost')-sum(expenses)}];
 }else if(tab==='Cash flow'){
  const income=sum(sales,'paid')+sum(docs.filter(d=>['payments','cash'].includes(d.kind)&&d.direction==='received'));
  const out=sum(purchases,'paid')+sum(expenses)+sum(docs.filter(d=>['payments','cash'].includes(d.kind)&&d.direction==='paid'));
  rows=[{Account:'Cash received',Amount:income},{Account:'Cash paid',Amount:out},{Account:'Net cash flow',Amount:income-out}];
 }else if(tab==='Product sales')rows=s.products.map(p=>{const items=sales.flatMap(d=>d.items||[]).filter(i=>Number(i.productId)===p.id);return{Product:p.name,SKU:p.sku,Quantity:sum(items,'quantity'),Sales:items.reduce((a,i)=>a+Number(i.quantity)*Number(i.rate),0)};});
 else if(['Customer sales','Vendor purchases'].includes(tab)){
  const type=tab==='Customer sales'?'customers':'vendors',list=type==='customers'?sales:purchases;
  rows=s[type].map(p=>({Name:p.name,Invoices:list.filter(d=>d.partyId===p.id).length,Total:sum(list.filter(d=>d.partyId===p.id))}));
 }else{
  const kind={Sales:'sales',Purchases:'purchases',Expenses:'expenses'}[tab];
  rows=docs.filter(d=>!kind||d.kind===kind).map(d=>({Date:d.date,Reference:number(d),Type:d.kind,Party:d.partyName||d.description||d.reason||'',...(tab==='Expenses'?{Category:d.category||'',Method:d.method||''}:{}),Total:d.total,Paid:d.paid||0,Outstanding:d.outstanding||0,Status:d.status||'Recorded'}));
 }
 rows=filterReportRows(rows,search);
 if(sort==='Name A–Z')rows.sort((a,b)=>String(a.Name||a.Product||a.Party||a.Account||'').localeCompare(String(b.Name||b.Product||b.Party||b.Account||'')));
 if(sort==='Amount high–low')rows.sort((a,b)=>Number(b.Total??b.Amount??b.Sales??b.Outstanding??b.Value??0)-Number(a.Total??a.Amount??a.Sales??a.Outstanding??a.Value??0));
 return rows;
}
