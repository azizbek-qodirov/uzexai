import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {quoteManifest} from '../lib/quotes.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('complete source periods, pagination, dates and mixed units survive SQLite import',()=>{
 const s=createStore();try{
 for(const p of quoteManifest.periods)assert.equal(s.execute('market_quotes',{import_id:p.id},'a','buyer').total,p.count);
 const q=s.execute('market_quotes',{query:'Aviner'},'a','buyer').quotes[0];assert.equal(q.price,202810.94);assert.equal(q.period_end,'09.10.2026');assert.match(q.name,/litr/);
 const a=s.execute('market_quotes',{offset:1000,limit:100},'a','buyer');assert.equal(a.quotes.length,100);assert.equal(a.quotes[0].row_number,1001);
 const cement=s.execute('market_quotes',{query:'cement'},'a','buyer');assert.ok(cement.total>30);
 }finally{s.close();}
});
test('benchmark migration preserves stock and confirmed orders across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'quotes-'));let s=createStore(join(dir,'db'));try{
 const lot=s.execute('search_lots',{query:'sement',region:'Toshkent'},'a','buyer').lots[0];assert.equal(lot.price,533208.79);
 const action=s.execute('prepare_order',{lot_id:lot.id,quantity:10},'a','buyer').action;s.confirm(action.id,'a','buyer');s.close();s=createStore(join(dir,'db'));
 assert.equal(s.execute('search_lots',{query:'sement',region:'Toshkent'},'a','buyer').lots[0].quantity,230);
 assert.equal(s.execute('account_overview',{},'a','buyer').balance,500000000-5332087.9);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('essential catalogue includes unavailable bricks and sourced purchasable staples',()=>{
 const s=createStore();try{
 const c=s.execute('essential_products',{},'a','buyer');assert.equal(c.items.length,13);
 const brick=c.items.find(p=>p.key === "g'isht");assert.equal(brick.status,'price_unavailable');assert.deepEqual(brick.quotes,[]);
 assert.equal(s.execute('search_lots',{query:'bricks'},'a','buyer').lots.length,0);
 assert.equal(s.execute('search_lots',{query:'rebar'},'a','buyer').lots.length,2);
 assert.equal(s.execute('search_lots',{query:'flour'},'a','buyer').lots.length,2);
 assert.equal(s.execute('search_lots',{query:'sugar'},'a','buyer').lots[0].price,10250000);
 const cement=s.execute('search_lots',{query:'cement'},'a','buyer').lots;assert.equal(cement.length,6);
 for(const group of c.items)for(const q of group.quotes){assert.ok(q.price>0);assert.equal(q.import_id,102);assert.ok(q.source_url.startsWith('https://uzex.uz/'));}
 }finally{s.close();}
});
