import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {createAssistant} from '../lib/assistant.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const listing=(s,session='seller',price=11000000)=>s.execute('prepare_listing',{name:'Shakar',region:'Toshkent',quantity:10,price},session,'seller').action;
test('confirmed listings are public, priority searchable, purchasable and stock authoritative',()=>{
 const s=createStore();try{
 const a=listing(s);assert.ok(!s.execute('search_lots',{query:'shakar'},'buyer','buyer').lots.some(l=>l.origin==='seller'));
 s.confirm(a.id,'seller','seller');const results=s.execute('search_lots',{query:'sugar',region:'Toshkent'},'buyer','buyer');const lot=results.lots[0];assert.equal(lot.origin,'seller');assert.equal(lot.quantity,10);assert.equal(lot.price,11000000);
 const order=s.execute('prepare_order',{lot_id:lot.id,quantity:10},'buyer','buyer').action;s.confirm(order.id,'buyer','buyer');
 assert.ok(!s.execute('search_lots',{query:'shakar'},'other','buyer').lots.some(l=>l.id===lot.id));assert.throws(()=>s.confirm(a.id,'seller','seller'));
 }finally{s.close();}
});
test('no local result returns other regions without relaxing stock or budget',()=>{
 const s=createStore();try{
 const r=s.execute('search_lots',{query:'shakar',region:'Farg‘ona',quantity:1},'b','buyer');assert.equal(r.region_fallback,true);assert.ok(r.available_regions.includes('Toshkent'));assert.ok(r.lots.every(l=>l.region!=='Farg‘ona'));
 assert.equal(s.execute('search_lots',{query:'shakar',region:'Farg‘ona',max_price:1},'b','buyer').lots.length,0);
 }finally{s.close();}
});
test('seller prices normalized from kg and rejected above 2x sourced average',()=>{
 const s=createStore();try{
 const a=s.execute('price_analytics',{query:'shakar'},'s','seller');assert.ok(a.average>1e7);assert.equal(a.average_per_kg,a.average/1000);assert.equal(a.series.length,4);assert.ok(a.series.every(p=>p.rows.every(r=>r.import_id===p.import_id)));
 assert.throws(()=>s.execute('prepare_listing',{name:'Shakar',region:'Toshkent',quantity:1000,quantity_unit:'kg',price:100000,price_unit:'kg'},'s','seller'),/Narx rad etildi/);
 const p=s.execute('prepare_listing',{name:'Shakar',region:'Toshkent',quantity:1000,quantity_unit:'kg',price:11000,price_unit:'kg'},'s','seller').action;assert.equal(p.quantity,1);assert.equal(p.price,11000000);
 assert.throws(()=>s.execute('prepare_listing',{name:'G‘isht',region:'Toshkent',quantity:1,price:1000},'s','seller'),/benchmark/);
 }finally{s.close();}
});
test('listing backfill, sold stock and alerts persist across restart with private deduplicated notifications',()=>{
 const dir=mkdtempSync(join(tmpdir(),'market-'));const path=join(dir,'db');let s=createStore(path);try{
 const alert=s.execute('create_price_alert',{query:'shakar',region:'Toshkent',quantity:1,target_price:10000000},'b','buyer');assert.equal(s.execute('list_price_alerts',{},'b','buyer').notifications.length,0);
 const pending=listing(s,'s',9500000);s.confirm(pending.id,'s','seller');
 let n=s.execute('list_price_alerts',{},'b','buyer');assert.equal(n.notifications.length,1);assert.equal(n.alerts[0].status,'triggered');assert.equal(s.execute('list_price_alerts',{},'other','buyer').notifications.length,0);
 const lot=s.execute('search_lots',{query:'shakar'},'b','buyer').lots[0];const purchase=s.execute('prepare_order',{lot_id:lot.id,quantity:2},'b','buyer').action;s.confirm(purchase.id,'b','buyer');
 s.close();s=createStore(path);assert.equal(s.execute('search_lots',{query:'shakar'},'b','buyer').lots[0].quantity,8);assert.equal(s.execute('list_price_alerts',{},'b','buyer').notifications.length,1);assert.ok(s.hasSession('b'));
 const second=s.execute('create_price_alert',{query:'shakar',target_price:1},'b','buyer');assert.throws(()=>s.execute('cancel_price_alert',{id:second.id},'other','buyer'));s.execute('cancel_price_alert',{id:second.id},'b','buyer');
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('offline customer search, seller posting, analytics and alert requests use tools',async()=>{
 const s=createStore();const ai=createAssistant(s,{AI_MODE:'demo'});try{
 const a=await ai.chat('Toshkentda 10 tonna shakar sotaman, tonnasi 11000000 so‘m',{history:[]},'s','seller');const action=a.cards.find(c=>c.action)?.action;assert.ok(action);s.confirm(action.id,'s','seller');
 const b=await ai.chat('Toshkentdan 1 tonna shakar kerak',{history:[]},'b','buyer');assert.equal(b.cards[0].lots[0].origin,'seller');
 const analytical=await ai.chat('Shakar narxlari tahlili',{history:[]},'b','buyer');assert.equal(analytical.cards[0].type,'analytics');
 const alert=await ai.chat('1 tonna shakar narxi tushsa ogohlantir',{history:[]},'b','buyer');assert.equal(alert.cards[0].type,'alert');
 const bad=await ai.chat('Toshkentda 1 tonna shakar sotaman, kilosi 100000 so‘m',{history:[]},'s','seller');assert.match(bad.text,/rad etildi/);
 }finally{s.close();}
});
