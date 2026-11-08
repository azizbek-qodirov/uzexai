import { essentials, productAliases } from './essentials.mjs';
import { readFileSync } from 'node:fs';
export const quoteManifest = JSON.parse(readFileSync(new URL('../data/quotes/manifest.json', import.meta.url)));
export const normalize = s => String(s).toLowerCase().replace(/[‘’ʻʼ`]/g,"'").replace(/[аесорхуім]/g,c=>({'м':'m','а':'a','е':'e','с':'c','о':'o','р':'p','х':'x','у':'y','і':'i'}[c])).replace(/\s+/g,' ').trim();
export function importQuotes(db) {
  Object.assign(quoteManifest, JSON.parse(readFileSync(new URL('../data/quotes/manifest.json', import.meta.url))));
  db.exec(`CREATE TABLE IF NOT EXISTS weekly_quotes(import_id INTEGER, row_number INTEGER, name TEXT, price REAL, change REAL, change_percent TEXT, period_start TEXT, period_end TEXT, source_url TEXT, fetched_at TEXT, PRIMARY KEY(import_id,row_number));
    CREATE TABLE IF NOT EXISTS data_versions(version TEXT PRIMARY KEY);`);
  const insert=db.prepare('INSERT OR REPLACE INTO weekly_quotes VALUES(?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const p of [...(!quoteManifest.periods.some(p=>p.id===102)?[{id:102,url:'https://uzex.uz/WeeklyQuotes?ImportId=102'}]:[]),...quoteManifest.periods]) {
      const rows=JSON.parse(readFileSync(new URL(`../data/quotes/${p.id}.json`,import.meta.url)));
      db.prepare('DELETE FROM weekly_quotes WHERE import_id=?').run(p.id);
      for(const [n,name,price,change,percent,start,end] of rows) insert.run(p.id,n,name,price,change,percent,start,end,p.url,quoteManifest.fetched_at);
    }
    // Explicit benchmark mappings: inventory/regions remain simulated, prices use published rows.
    const version='weekly-benchmarks-2026-10-30-v1';
    if(!db.prepare('SELECT 1 FROM data_versions WHERE version=?').get(version)) {
      const mappings=[['LOT-1001',748],['LOT-1002',749],['LOT-1003',794],['LOT-1004',872],['LOT-1005',1215],['LOT-1006',574],['LOT-1007',268],['LOT-1008',884]];
      for(const [id,n] of mappings) {
        const q=db.prepare('SELECT * FROM weekly_quotes WHERE import_id=102 AND row_number=?').get(n);
        if(!q)throw Error('Missing benchmark');
        db.prepare('UPDATE lots SET name=?,price=?,grade=? WHERE id=?').run(q.name,q.price,'UZEX haftalik benchmark',id);
        db.prepare("UPDATE actions SET status='cancelled' WHERE status='pending' AND kind='order' AND json_extract(payload,'$.lot_id')=?").run(id);
      }
      db.prepare('INSERT INTO data_versions VALUES(?)').run(version);
    }
    // New demo inventory is inserted once; never replenish purchased stock on restart.
    const expansionVersion='essential-products-v1';
    if(!db.prepare('SELECT 1 FROM data_versions WHERE version=?').get(expansionVersion)) {
      const additions=[
        [2001,883,'Oziq-ovqat','Toshkent',100],[2002,750,'Qurilish','Toshkent',300],
        [2003,753,'Qurilish','Samarqand',250],[2004,776,'Qurilish','Navoiy',200],
        [2005,68,'Metall','Toshkent',80],[2006,69,'Metall','Samarqand',80],
        [2007,585,'Oziq-ovqat','Toshkent',100],[2008,588,'Oziq-ovqat','Samarqand',100],
        [2009,873,'Qishloq xo‘jaligi','Samarqand',200],[2010,874,'Qishloq xo‘jaligi','Buxoro',200],
        [2011,260,'Yoqilg‘i','Toshkent',300],[2012,1164,'Yoqilg‘i','Navoiy',300],
        [2013,42,'O‘g‘it','Navoiy',150],[2014,45,'O‘g‘it','Toshkent',150],
        [2015,173,'Yoqilg‘i','Toshkent',100],[2016,177,'Yoqilg‘i','Buxoro',100],
        [2017,713,'Polimer','Toshkent',80],[2018,716,'Polimer','Buxoro',80],
        [2019,265,'O‘g‘it','Navoiy',200]
      ];
      for(const [id,n,category,region,quantity] of additions) {
        const q=db.prepare('SELECT * FROM weekly_quotes WHERE import_id=102 AND row_number=?').get(n);
        if(!q)throw Error('Missing essential product benchmark');
        db.prepare('INSERT OR IGNORE INTO lots VALUES(?,?,?,?,?,?,?,?,?)').run(`LOT-${id}`,q.name,category,region,q.price,quantity,'Namuna yetkazib beruvchi','UZEX haftalik benchmark','Namuna: 3–5 ish kuni');
      }
      db.prepare('INSERT INTO data_versions VALUES(?)').run(expansionVersion);
    }
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK');throw e; }
}
export function queryQuotes(db,args={}) {
  const id=Number(args.import_id || quoteManifest.periods[0].id);
  const q=normalize(args.query||'');
  const aliases={cement:'sement',copper:'mis',wheat:'bug',sugar:'shakar',urea:'karbamid',cotton:'paxta'};
  const needle=productAliases[q]||aliases[q]||q;
  const all=db.prepare('SELECT * FROM weekly_quotes WHERE import_id=? ORDER BY row_number').all(id).filter(r=>normalize(r.name).includes(needle));
  const offset=Math.max(0,Math.floor(Number(args.offset)||0));
  const limit=Math.min(100,Math.max(1,Math.floor(Number(args.limit)||20)));
  return { type:'quotes',quotes:all.slice(offset,offset+limit),total:all.length,offset,periods:quoteManifest.periods,fetched_at:quoteManifest.fetched_at,
    missing_product: needle === "g'isht" && !all.length ? 'G‘isht uchun ushbu UZEX haftalik manbasida narx topilmadi. Sotuvchi narx va dona hisobidagi hajmni alohida taqdim etishi kerak; tonnaga aylantirmang.' : null,
    note:'UZEX haftalik kotirovkalari. Jonli taklif emas. Sana har bir qatorda berilgan. O‘lchov birligi va valyuta nomda berilmagan bo‘lsa, manbadan tekshiring; avtomatik tonnaga aylantirmang.' };
}

export function essentialProducts(db) {
  return { type:'essentials', items: essentials.map(p=>({ ...p, quotes:p.rows.map(n=>db.prepare('SELECT * FROM weekly_quotes WHERE import_id=102 AND row_number=?').get(n)), status:p.rows.length?'weekly_quote':'price_unavailable' })), note:'Haftalik narxlar; jonli taklif emas. G‘isht narxi manbada yo‘q. Demo lotlarining qoldig‘i va hududlari sun’iy.' };
}
