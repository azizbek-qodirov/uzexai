import { essentials, productAliases } from './essentials.mjs';
import { normalize, quoteManifest } from './quotes.mjs';
export function productGroup(query) {
 const q=normalize(query);const key=productAliases[q]||q;
 return essentials.find(p=>normalize(p.key)===key || normalize(p.name)===key) || essentials.filter(p=>normalize(p.name).includes(key)||(p.key.length>2 ? key.includes(normalize(p.key)) : key.split(/[^a-z]+/).includes(normalize(p.key)))).sort((a,b)=>b.key.length-a.key.length)[0];
}
export function analyse(db,args={}) {
 const group=productGroup(args.query||'');
 if(!group || !group.rows.length) return {type:'analytics',available:false,query:args.query,note:'Mos, birliklari taqqoslanadigan bozor ma’lumoti yetarli emas.'};
 const latest={id:102};
 const names=group.rows.map(n=>db.prepare('SELECT name FROM weekly_quotes WHERE import_id=? AND row_number=?').get(latest.id,n)?.name).filter(Boolean);
 const periods=quoteManifest.periods.filter(p=>p.label.includes('Внутренние')).sort((a,b)=>a.id-b.id);
 const sets=periods.map(p=>({p,rows:db.prepare('SELECT * FROM weekly_quotes WHERE import_id=?').all(p.id).filter(r=>names.some(n=>normalize(n)===normalize(r.name)))}));
 const common=names.filter(n=>sets.every(s=>s.rows.some(r=>normalize(r.name)===normalize(n))));
 const series=sets.map(({p,rows})=>{
   const comparable=rows.filter(r=>common.some(n=>normalize(n)===normalize(r.name)));
   const used=comparable.length?comparable:rows;
   return {import_id:p.id,label:p.label,average:used.length?used.reduce((s,r)=>s+r.price,0)/used.length:null,count:used.length,observed_dates:[...new Set(used.map(r=>r.period_end))],source_url:p.url,rows:used};
 }).filter(p=>p.count);
 const last=series.at(-1),first=series[0];
 const active=db.prepare('SELECT l.* FROM lots l JOIN published_listings p ON p.lot_id=l.id WHERE l.quantity>0').all().filter(l=>productGroup(l.name)?.key===group.key && (!args.region||normalize(l.region).includes(normalize(args.region))));
 const active_market=active.length?{count:active.length,average:active.reduce((sum,l)=>sum+l.price,0)/active.length,min:Math.min(...active.map(l=>l.price)),max:Math.max(...active.map(l=>l.price)),regions:[...new Set(active.map(l=>l.region))],checked_at:new Date().toISOString()}:null;
 const change=common.length && series.length>1 ? (last.average-first.average)/first.average*100 : null;
 return {type:'analytics',available:!!last,product:group.name,active_market,unit:'tonna',currency:'UZS',average:last?.average,average_per_kg:last?.average/1000,min:last?Math.min(...last.rows.map(r=>r.price)):null,max:last?Math.max(...last.rows.map(r=>r.price)):null,series,change_percent:change,trend:change===null?'insufficient':Math.abs(change)<0.01?'flat':change>0?'up':'down',comparable_variants:common.length,fetched_at:quoteManifest.fetched_at,
 note:'Bir xil tanlangan mahsulot variantlarining oddiy o‘rtacha haftalik benchmarki; savdo hajmi bilan vaznlanmagan. Qator sanalarini tekshiring: takror ko‘rsatilgan eski narx yangi savdo emas. Bugungi jonli narx yoki kelajak narxi kafolati emas.'};
}
export function validatePrice(db,name,price) {
 const a=analyse(db,{query:name});
 if(!a.available)throw Error('Bu mahsulot uchun taqqoslanadigan narx benchmarki yo‘q. E’lon qabul qilinmadi; mahsulot va birlikni aniqlashtiring.');
 // A 2x cap allows legitimate differences between grades while rejecting extreme mistakes.
 if(price>a.average*2)throw Error(`Narx rad etildi: ${price.toFixed(2)} UZS/tonna. Haftalik o‘rtacha ${a.average.toFixed(2)} UZS/tonna (${(a.average/1000).toFixed(2)} UZS/kg); limit 2 × o‘rtacha. Birlik yoki narxni tekshiring.`);
 return {average:a.average,average_per_kg:a.average/1000,ratio:price/a.average,source:'UZEX weekly',warning:price>a.average*1.5?'Narx haftalik o‘rtachadan 50% dan ortiq yuqori.':null};
}
