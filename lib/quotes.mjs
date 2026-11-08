import { readFileSync } from 'node:fs';
export const quoteManifest = JSON.parse(readFileSync(new URL('../data/quotes/manifest.json', import.meta.url)));
export const normalize = s => String(s).toLowerCase().replace(/[‘’ʻʼ`]/g,"'").replace(/[аесорхуім]/g,c=>({'м':'m','а':'a','е':'e','с':'c','о':'o','р':'p','х':'x','у':'y','і':'i'}[c])).replace(/\s+/g,' ').trim();
export function importQuotes(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS weekly_quotes(import_id INTEGER, row_number INTEGER, name TEXT, price REAL, change REAL, change_percent TEXT, period_start TEXT, period_end TEXT, source_url TEXT, fetched_at TEXT, PRIMARY KEY(import_id,row_number));
    CREATE TABLE IF NOT EXISTS data_versions(version TEXT PRIMARY KEY);`);
  const insert=db.prepare('INSERT OR REPLACE INTO weekly_quotes VALUES(?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const p of quoteManifest.periods) {
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
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK');throw e; }
}
export function queryQuotes(db,args={}) {
  const id=Number(args.import_id || quoteManifest.periods[0].id);
  const q=normalize(args.query||'');
  const aliases={cement:'sement',copper:'mis',wheat:'bug',sugar:'shakar',urea:'karbamid',cotton:'paxta'};
  const needle=aliases[q]||q;
  const all=db.prepare('SELECT * FROM weekly_quotes WHERE import_id=? ORDER BY row_number').all(id).filter(r=>normalize(r.name).includes(needle));
  const offset=Math.max(0,Math.floor(Number(args.offset)||0));
  const limit=Math.min(100,Math.max(1,Math.floor(Number(args.limit)||20)));
  return { type:'quotes',quotes:all.slice(offset,offset+limit),total:all.length,offset,periods:quoteManifest.periods,fetched_at:quoteManifest.fetched_at,
    note:'UZEX haftalik kotirovkalari. Jonli taklif emas. Sana har bir qatorda berilgan. O‘lchov birligi va valyuta nomda berilmagan bo‘lsa, manbadan tekshiring; avtomatik tonnaga aylantirmang.' };
}
