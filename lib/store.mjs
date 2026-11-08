import { analyse, validatePrice, productGroup } from './analytics.mjs';
import { productAliases } from './essentials.mjs';
import { importQuotes, queryQuotes, normalize, essentialProducts } from './quotes.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const services = [
  { name: 'Birja savdolari', url: 'https://uzex.uz/', description: 'Tovar-xom ashyo savdosi, kotirovkalar va savdo ma’lumotlari.' },
  { name: 'Davlat xaridlari', url: 'https://xarid.uzex.uz/', description: 'Davlat xaridlari, elektron do‘kon va auksionlar.' },
  { name: 'Elektron logistika', url: 'https://e-logistika.uzex.uz/', description: 'Yuk tashish takliflari va tashuvchilar.' },
  { name: 'Yarmarka', url: 'https://yarmarka.uzex.uz/', description: 'Elektron ko‘rgazma va yarmarka savdosi.' },
  { name: 'Agro UZEX', url: 'https://agro.uzex.uz/', description: 'Qishloq xo‘jaligi mahsulotlari platformasi.' },
  { name: 'Biznes xarid', url: 'https://biznesxarid.uzex.uz/', description: 'Xususiy biznes uchun tender va takliflar tanlovi.' },
];

export function createStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS lots(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, region TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL, seller TEXT NOT NULL, grade TEXT NOT NULL, delivery TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts(session TEXT PRIMARY KEY, balance REAL NOT NULL DEFAULT 500000000);
    CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, session TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, session TEXT NOT NULL, lot_id TEXT NOT NULL, quantity REAL NOT NULL, total REAL NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY, session TEXT NOT NULL, name TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, region TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  if (!db.prepare('SELECT count(*) AS n FROM lots').get().n) {
    const insert = db.prepare('INSERT INTO lots VALUES(?,?,?,?,?,?,?,?,?)');
    for (const row of [
      ['LOT-1001', 'Portlandsement M-400', 'Qurilish', 'Toshkent', 720000, 240, 'Bekobod sement · demo', 'M-400', '3–5 ish kuni'],
      ['LOT-1002', 'Portlandsement M-400', 'Qurilish', 'Navoiy', 695000, 500, 'Qizilqum material · demo', 'M-400', '5–7 ish kuni'],
      ['LOT-1003', 'Portlandsement M-500', 'Qurilish', 'Farg‘ona', 815000, 180, 'Farg‘ona sement · demo', 'M-500', '3–5 ish kuni'],
      ['LOT-1004', 'Bug‘doy, 3-sinf', 'Qishloq xo‘jaligi', 'Samarqand', 2850000, 120, 'Zarafshon don · demo', '3-sinf', '2–4 ish kuni'],
      ['LOT-1005', 'Paxta tolasi', 'To‘qimachilik', 'Buxoro', 24500000, 85, 'Buxoro tola · demo', '1-nav', '5–7 ish kuni'],
      ['LOT-1006', 'Mis katodi', 'Metall', 'Toshkent', 112000000, 40, 'Metall ta’minot · demo', 'M00k', '3–5 ish kuni'],
      ['LOT-1007', 'Karbamid', 'O‘g‘it', 'Navoiy', 4100000, 300, 'Navoiy agro · demo', '46% N', '2–4 ish kuni'],
      ['LOT-1008', 'Shakar', 'Oziq-ovqat', 'Xorazm', 10800000, 75, 'Xorazm oziq · demo', 'Oq kristall', '3–5 ish kuni'],
    ]) insert.run(...row);
  }
  // Migrate existing presentations without deleting stock, orders or pending actions.
  db.exec(`BEGIN IMMEDIATE;
    UPDATE lots SET id='LOT-' || substr(id,6) WHERE id LIKE 'DEMO-%';
    UPDATE orders SET lot_id='LOT-' || substr(lot_id,6) WHERE lot_id LIKE 'DEMO-%';
    UPDATE actions SET payload=json_set(payload,'$.lot_id','LOT-' || substr(json_extract(payload,'$.lot_id'),6))
      WHERE json_extract(payload,'$.lot_id') LIKE 'DEMO-%';
    UPDATE lots SET seller=replace(seller,' · demo','') WHERE seller LIKE '% · demo';
    COMMIT;`);
  importQuotes(db);
  db.exec(`CREATE TABLE IF NOT EXISTS published_listings(listing_id TEXT PRIMARY KEY, lot_id TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS price_alerts(id TEXT PRIMARY KEY, session TEXT NOT NULL, query TEXT NOT NULL, region TEXT, quantity REAL NOT NULL, target REAL NOT NULL, baseline REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active', created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, session TEXT NOT NULL, alert_id TEXT UNIQUE NOT NULL, message TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
  function publishListing(p) {
    const id='LOT-SELL-' + p.id;
    if(db.prepare('SELECT 1 FROM published_listings WHERE listing_id=?').get(p.id))return;
    db.prepare('INSERT INTO lots VALUES(?,?,?,?,?,?,?,?,?)').run(id,p.name,productGroup(p.name)?.category || 'Boshqa',p.region,p.price,p.quantity,'Ilovadagi sotuvchi','Sotuvchi e’loni','Sotuvchi bilan kelishiladi');
    db.prepare('INSERT INTO published_listings VALUES(?,?)').run(p.id,id);
  }
  // Backfill only confirmed listings, atomically and without restoring sold stock.
  db.exec('BEGIN IMMEDIATE');
  try { for(const p of db.prepare('SELECT * FROM listings').all())publishListing(p);db.exec('COMMIT'); }
  catch(e){db.exec('ROLLBACK');throw e;}
  const match = (l,args) => {
    const q=normalize(productAliases[normalize(args.query||'')]||args.query||'');
    return (!q || normalize(l.name).includes(q)) && (!args.quantity || l.quantity>=args.quantity) && (!args.max_price || l.price<=args.max_price);
  };
  const offers = args => db.prepare(`SELECT lots.*, CASE WHEN p.lot_id IS NULL THEN 'demo' ELSE 'seller' END AS origin FROM lots LEFT JOIN published_listings p ON p.lot_id=lots.id WHERE quantity>0 ORDER BY CASE WHEN p.lot_id IS NULL THEN 1 ELSE 0 END, price`).all().filter(l=>match(l,args));
  function evaluateAlerts() {
    for(const a of db.prepare("SELECT * FROM price_alerts WHERE status='active'").all()) {
      const active=offers(a).filter(l=>l.origin==='seller' && (!a.region || normalize(l.region).includes(normalize(a.region))));
      const benchmark=analyse(db,{query:a.query});
      // Regional alerts can only match real in-app listings, not unlocated weekly quotes.
      const price=active.length?Math.min(...active.map(l=>l.price)):!a.region && benchmark.available?benchmark.average:Infinity;
      if(price<=a.target) {
        const message=`${a.query}: ${price.toFixed(2)} UZS/tonna — maqsad ${a.target.toFixed(2)} UZS/tonna ga yetdi. ${a.region||'Haftalik benchmark / ilova takliflari'}. Sotib olishdan oldin shartlarni tekshiring.`;
        db.exec('BEGIN IMMEDIATE');
        try {db.prepare('INSERT OR IGNORE INTO notifications(id,session,alert_id,message) VALUES(?,?,?,?)').run(randomUUID(),a.session,a.id,message);db.prepare("UPDATE price_alerts SET status='triggered' WHERE id=?").run(a.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      }
    }
  }
  const account = session => {
    db.prepare('INSERT OR IGNORE INTO accounts(session) VALUES(?)').run(session);
    return db.prepare('SELECT balance FROM accounts WHERE session=?').get(session);
  };
  const pending = (session, role, kind, payload) => {
    const id = randomUUID();
    db.prepare('INSERT INTO actions(id,session,role,kind,payload) VALUES(?,?,?,?,?)').run(id, session, role, kind, JSON.stringify(payload));
    return { id, kind, status: 'pending', ...payload, demo: true };
  };
  const positive = (n, max = 1e12) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max;
  const safeText = (s) => typeof s === 'string' && s.trim().length >= 2 && s.length <= 160;
  function execute(name, args, session, role) {
    account(session);
    switch (name) {
      case 'essential_products': return essentialProducts(db);
      case 'market_quotes': return queryQuotes(db, args);
      case 'price_analytics': return analyse(db,args);
      case 'create_price_alert': {
        if(role!=='buyer')throw Error('Narx kuzatuvi Mijoz uchun.');
        if(!safeText(args.query) || !positive(args.quantity??1,1e6))throw Error('Mahsulot va musbat hajm kerak.');
        const a=analyse(db,args);
        if(!a.available)throw Error('Ushbu mahsulot uchun kuzatiladigan benchmark yo‘q.');
        const active=offers(args).filter(l=>l.origin==='seller' && (!args.region || normalize(l.region).includes(normalize(args.region))));
        const baseline=active.length?Math.min(...active.map(l=>l.price)):a.average;
        const target=args.target_price===undefined?Math.round(baseline*0.95*100)/100:args.target_price;
        if(!positive(target))throw Error('Maqsad narx musbat UZS/tonna bo‘lishi kerak.');
        const existing=db.prepare("SELECT * FROM price_alerts WHERE session=? AND query=? AND COALESCE(region,'')=? AND target=? AND status='active'").get(session,args.query,args.region||'',target);
        const id=existing?.id||randomUUID();
        if(!existing)db.prepare('INSERT INTO price_alerts(id,session,query,region,quantity,target,baseline) VALUES(?,?,?,?,?,?,?)').run(id,session,args.query,args.region||null,args.quantity||1,target,baseline);
        evaluateAlerts();
        return {type:'alert',id,target,baseline,unit:'UZS/tonna',quantity:args.quantity||1,region:args.region||null,note:'Kuzatuv saqlandi. Ilova ishlaganda tekshiriladi; ogohlantirish ilova ichida ko‘rinadi. Yangi haftalik ma’lumot importi yoki sotuvchi taklifi kerak. Tashqi xabar yuborilmaydi.'};
      }
      case 'list_price_alerts': evaluateAlerts();return {type:'notifications',alerts:db.prepare('SELECT * FROM price_alerts WHERE session=?').all(session),notifications:db.prepare('SELECT * FROM notifications WHERE session=? ORDER BY created DESC').all(session)};
      case 'cancel_price_alert': {
        const r=db.prepare("UPDATE price_alerts SET status='cancelled' WHERE id=? AND session=? AND status='active'").run(args.id,session);
        if(!r.changes)throw Error('Faol kuzatuv topilmadi.');return {type:'alert',id:args.id,note:'Kuzatuv bekor qilindi.'};
      }
      case 'search_lots': {
        const all=offers(args);
        const local=all.filter(l=>!args.region||normalize(l.region).includes(normalize(args.region)));
        const fallback=!!args.region && !local.length;
        const selected=fallback?all:local;
        return {demo:true,unit:'tonna',currency:'UZS',lots:selected.slice(0,8),requested_region:args.region||null,region_fallback:fallback,available_regions:[...new Set(all.map(l=>l.region))],note:fallback?'So‘ralgan hududda taklif yo‘q. Boshqa hududlardagi mos takliflar ko‘rsatilmoqda.':null};
      }
      case 'market_summary': return { demo: true, items: db.prepare('SELECT category, COUNT(*) AS offers, MIN(price) AS min_price, MAX(price) AS max_price, SUM(quantity) AS available_tonnes FROM lots GROUP BY category').all(), note: 'Sun’iy demo ma’lumotlari. Haqiqiy bozor kotirovkalari emas.' };
      case 'account_overview': return { demo: true, ...account(session), orders: db.prepare('SELECT * FROM orders WHERE session=? ORDER BY created DESC').all(session), listings: db.prepare('SELECT * FROM listings WHERE session=? ORDER BY created DESC').all(session) };
      case 'service_directory': return { services, note: 'Bu MVP tashqi portallarda operatsiya bajarmaydi.' };
      case 'prepare_listing': {
        if (role !== 'seller') throw new Error('Mahsulot joylashtirish faqat Sotuvchi rejimida mavjud.');
        if (!safeText(args.name) || !safeText(args.region) || !positive(args.quantity, 1e6) || !positive(args.price)) throw new Error('Mahsulot nomi, hudud, musbat hajm (tonna) va bir tonna narxi kerak.');
        const price=args.price*(args.price_unit==='kg'?1000:1);
        const quantity=args.quantity/(args.quantity_unit==='kg'?1000:1);
        if(args.price_unit && !['kg','tonna'].includes(args.price_unit) || args.quantity_unit && !['kg','tonna'].includes(args.quantity_unit))throw Error('Birlik kg yoki tonna bo‘lishi kerak.');
        const comparison=validatePrice(db,args.name,price);
        return { action: pending(session, role, 'listing', { name: args.name.trim(), region: args.region.trim(), quantity, price, total: quantity * price, comparison }) };
      }
      case 'prepare_order': {
        if (role !== 'buyer') throw new Error('Xarid buyurtmasi faqat Mijoz rejimida mavjud.');
        const lot = db.prepare('SELECT * FROM lots WHERE id=?').get(String(args.lot_id));
        if (!lot || !positive(args.quantity, 1e6) || args.quantity > lot.quantity) throw new Error('Lot yoki hajm noto‘g‘ri. Mavjud qoldiqni tekshiring.');
        const total = lot.price * args.quantity;
        if (total > account(session).balance) throw new Error('Balans yetarli emas. Hajmni kamaytiring.');
        return { action: pending(session, role, 'order', { lot_id: lot.id, name: lot.name, region: lot.region, quantity: args.quantity, price: lot.price, total, delivery: lot.delivery }) };
      }
      default: throw new Error('Bu vositaga ruxsat berilmagan.');
    }
  }
  function confirm(id, session, role) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT * FROM actions WHERE id=? AND session=? AND role=?').get(id, session, role);
      if (!row) throw new Error('So‘rov topilmadi.');
      if (row.status !== 'pending') throw new Error('Bu so‘rov allaqachon yakunlangan.');
      const p = JSON.parse(row.payload);
      if (row.kind === 'order') {
        const stock = db.prepare('UPDATE lots SET quantity=quantity-? WHERE id=? AND quantity>=?').run(p.quantity, p.lot_id, p.quantity);
        if (!stock.changes) throw new Error('Lot qoldig‘i o‘zgardi. Yangi so‘rov tayyorlang.');
        const debit = db.prepare('UPDATE accounts SET balance=balance-? WHERE session=? AND balance>=?').run(p.total, session, p.total);
        if (!debit.changes) throw new Error('Balans yetarli emas.');
        db.prepare('INSERT INTO orders(id,session,lot_id,quantity,total) VALUES(?,?,?,?,?)').run(id, session, p.lot_id, p.quantity, p.total);
      } else {
        validatePrice(db,p.name,p.price);
        db.prepare('INSERT INTO listings(id,session,name,quantity,price,region) VALUES(?,?,?,?,?,?)').run(id, session, p.name, p.quantity, p.price, p.region);
        publishListing({id,...p});
      }
      db.prepare("UPDATE actions SET status='confirmed' WHERE id=?").run(id);
      db.exec('COMMIT');
      try { evaluateAlerts(); } catch (e) { console.error('Price alert check will retry:',e.message); }
      return { id, kind: row.kind, status: 'confirmed', ...p, demo: true };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function cancel(id, session, role) {
    const result = db.prepare("UPDATE actions SET status='cancelled' WHERE id=? AND session=? AND role=? AND status='pending'").run(id, session, role);
    if (!result.changes) throw new Error('Faol so‘rov topilmadi.');
    return { id, status: 'cancelled', demo: true };
  }
  evaluateAlerts();
  return { execute, confirm, cancel, evaluateAlerts, refreshQuotes: () => { importQuotes(db); evaluateAlerts(); }, hasSession: id => !!db.prepare('SELECT 1 FROM accounts WHERE session=?').get(id), close: () => db.close() };
}

